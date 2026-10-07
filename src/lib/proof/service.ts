import { and, desc, eq, inArray } from "drizzle-orm";
import {
  decodeSchema,
  deriveAttestationPda,
  deriveEventAuthorityAddress,
  getCloseAttestationInstruction,
  getCreateAttestationInstructionAsync,
  serializeAttestationData,
} from "@solana/attestation";
import { address as toAddress, type KeyPairSigner } from "@solana/kit";
import { proofs, users } from "@/db/schema";
import type { Db } from "@/db";
import { AppError, assert } from "../errors";
import { newId } from "../ids";
import type { User } from "../auth/session";
import type { Ctx } from "../domain/context";
import { hasStaffRole } from "../domain/events";
import { isPlatformAdmin } from "../domain/context";
import { z } from "zod";
import { getContribution, getSubmission } from "../domain/submissions";
import { latestReview } from "../domain/reviews";
import { activeWallet } from "../wallet/link";
import { assertSafeCluster, TransactionFailedError, type Ledger } from "../solana/ledger";
import { buildProofBundle, onchainDataFromBundle, type ProofBundle } from "./bundle";
import { toHex, bundleHash } from "./canonical";
import { issuerAddresses, issuerHealth, type IssuerConfig } from "./issuer";
import { proofNonce } from "./sas-schema";
import { verifyProof } from "./verify";
import type { Proof } from "./types";

export type Issuer = { signer: KeyPairSigner; config: IssuerConfig; ledger: Ledger };

const STALE_PENDING_MS = 5 * 60 * 1000;

function jsonSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
}

/**
 * Issues the onchain proof for one approved contribution to the holder's
 * linked wallet. Only approved contributions qualify; team membership alone
 * never does. Safe to retry: the attestation address is deterministic.
 */
export async function issueProof(ctx: Ctx, issuer: Issuer, actor: User, contributionId: string): Promise<Proof> {
  const c = await getContribution(ctx.db, contributionId);
  const submission = await getSubmission(ctx.db, c.submissionId);
  const isHolder = actor.id === c.userId;
  const isStaff =
    (await hasStaffRole(ctx.db, submission.eventId, actor.id, "organizer")) ||
    (await hasStaffRole(ctx.db, submission.eventId, actor.id, "reviewer"));
  assert(isHolder || isStaff, "forbidden", "Only the contributor or event staff can issue this proof");
  assert(c.status === "approved", "precondition_failed", "Only approved contributions receive a proof");
  const review = await latestReview(ctx.db, c.id);
  assert(review?.decision === "approved", "precondition_failed", "No approving review found");

  const existing = await ctx.db.query.proofs.findFirst({ where: eq(proofs.contributionId, c.id) });
  if (existing?.status === "confirmed") return existing;
  assert(existing?.status !== "revoked", "precondition_failed", "This proof was revoked and cannot be re-issued");

  await assertSafeCluster(issuer.ledger);
  const addrs = await issuerAddresses(issuer.signer.address, issuer.config);
  // Fail fast, before recording anything, if the issuer cannot pay or is not set up.
  const health = await issuerHealth(issuer.ledger, issuer.signer.address, issuer.config);
  assert(health.problems.length === 0, "not_configured", health.problems.join("; "));

  let proof: Proof;
  if (!existing) {
    const wallet = await activeWallet(ctx.db, c.userId);
    assert(wallet, "precondition_failed", "The contributor must link a Solana wallet before a proof can be issued");
    const bundle = await buildProofBundle(ctx.db, {
      contributionId: c.id,
      review,
      wallet,
      issuer: addrs,
      cluster: issuer.ledger.cluster,
    });
    const nonce = proofNonce(c.id);
    const [attestation] = await deriveAttestationPda({ credential: addrs.credential, schema: addrs.schema, nonce });
    const inserted = await ctx.db
      .insert(proofs)
      .values({
        id: newId(),
        contributionId: c.id,
        userId: c.userId,
        reviewId: review.id,
        walletAddress: wallet.address,
        cluster: issuer.ledger.cluster,
        programAddress: addrs.program,
        credentialAddress: addrs.credential,
        schemaAddress: addrs.schema,
        attestationAddress: attestation,
        nonce,
        onchainData: jsonSafe(onchainDataFromBundle(bundle)) as unknown as Record<string, unknown>,
        bundle: bundle as unknown as Record<string, unknown>,
        bundleHash: toHex(bundleHash(bundle)),
        status: "pending",
        createdAt: ctx.now(),
      })
      .onConflictDoNothing()
      .returning();
    if (!inserted[0]) throw new AppError("conflict", "Proof issuance is already in progress");
    proof = inserted[0];
  } else {
    const stalePending =
      existing.status === "pending" && ctx.now().getTime() - existing.createdAt.getTime() > STALE_PENDING_MS;
    assert(existing.status !== "pending" || stalePending, "conflict", "Proof issuance is already in progress");
    proof = existing;
    // The previous attempt may have landed even if we never saw confirmation.
    const reconciled = await reconcile(ctx.db, issuer, proof);
    if (reconciled.status === "confirmed") return reconciled;
    const claimed = await ctx.db
      .update(proofs)
      .set({ status: "pending", error: null })
      .where(and(eq(proofs.id, proof.id), eq(proofs.status, existing.status)))
      .returning();
    assert(claimed[0], "conflict", "Proof issuance is already in progress");
    proof = claimed[0];
  }

  return send(ctx, issuer, proof);
}

async function send(ctx: Ctx, issuer: Issuer, proof: Proof): Promise<Proof> {
  const bundle = proof.bundle as unknown as ProofBundle;
  try {
    const schemaAcc = await issuer.ledger.getAccount(toAddress(proof.schemaAddress));
    if (!schemaAcc.exists) throw new Error("Issuer schema not found onchain; run `npm run sas:setup` first");
    const schema = decodeSchema(schemaAcc).data;
    const data = serializeAttestationData(schema, onchainDataFromBundle(bundle) as unknown as Record<string, unknown>);
    const ix = await getCreateAttestationInstructionAsync({
      payer: issuer.signer,
      authority: issuer.signer,
      credential: toAddress(proof.credentialAddress),
      schema: toAddress(proof.schemaAddress),
      attestation: toAddress(proof.attestationAddress),
      nonce: toAddress(proof.nonce),
      data,
      expiry: 0,
    });
    await issuer.ledger.send(issuer.signer, [ix], async (signature) => {
      await ctx.db.update(proofs).set({ status: "sent", txSignature: signature }).where(eq(proofs.id, proof.id));
    });
  } catch (e) {
    const logs = e instanceof TransactionFailedError && e.logs.length ? `\n${e.logs.join("\n")}` : "";
    const [failed] = await ctx.db
      .update(proofs)
      .set({ status: "failed", error: `${(e as Error).message}${logs}`.slice(0, 4000) })
      .where(eq(proofs.id, proof.id))
      .returning();
    // A failed send may still have landed (e.g. timeout); check before reporting failure.
    const reconciled = await reconcile(ctx.db, issuer, failed);
    if (reconciled.status === "confirmed") return reconciled;
    throw new AppError("upstream_failed", `Proof transaction failed: ${(e as Error).message}`);
  }
  return reconcile(ctx.db, issuer, (await ctx.db.query.proofs.findFirst({ where: eq(proofs.id, proof.id) }))!);
}

/**
 * Marks a proof confirmed only after independently verifying the attestation
 * onchain against the stored bundle.
 */
export async function reconcile(db: Db, issuer: Issuer, proof: Proof): Promise<Proof> {
  const result = await verifyProof(
    issuer.ledger,
    proof.attestationAddress,
    {
      authority: issuer.signer.address,
      credential: toAddress(proof.credentialAddress),
      schema: toAddress(proof.schemaAddress),
    },
    proof.bundle as unknown as ProofBundle,
  );
  if (!result.valid) {
    const exists = result.checks.find((c) => c.name === "Attestation exists onchain")?.ok;
    if (exists) {
      const [row] = await db
        .update(proofs)
        .set({
          status: "failed",
          error: `Onchain attestation does not match bundle: ${result.checks.filter((c) => !c.ok).map((c) => c.name).join("; ")}`,
        })
        .where(eq(proofs.id, proof.id))
        .returning();
      return row;
    }
    return proof;
  }
  const [row] = await db
    .update(proofs)
    .set({ status: "confirmed", error: null, confirmedAt: proof.confirmedAt ?? new Date() })
    .where(eq(proofs.id, proof.id))
    .returning();
  return row;
}

/**
 * Revokes a proof by closing its attestation onchain. Only the event's
 * organizers (or platform admins) can revoke, and a reason is required and
 * kept. After this, verification reports the proof as not found and it stops
 * counting toward opportunities.
 */
export async function revokeProof(ctx: Ctx, issuer: Issuer, actor: User, proofId: string, reason: string) {
  const why = z.string().trim().min(10, "Give a reason of at least 10 characters").max(1000).parse(reason);
  const proof = await getProof(ctx.db, proofId);
  assert(proof, "not_found", "Proof not found");
  const c = await getContribution(ctx.db, proof.contributionId);
  const submission = await getSubmission(ctx.db, c.submissionId);
  assert(
    isPlatformAdmin(actor) || (await hasStaffRole(ctx.db, submission.eventId, actor.id, "organizer")),
    "forbidden",
    "Only this event's organizers can revoke its proofs",
  );
  assert(proof.status === "confirmed", "precondition_failed", `Only confirmed proofs can be revoked (status: ${proof.status})`);
  assert(
    proof.credentialAddress === (await issuerAddresses(issuer.signer.address, issuer.config)).credential,
    "precondition_failed",
    "This proof was issued by a different issuer key",
  );
  await assertSafeCluster(issuer.ledger);

  let signature: string | null = null;
  const acc = await issuer.ledger.getAccount(toAddress(proof.attestationAddress));
  if (acc.exists) {
    const ix = getCloseAttestationInstruction({
      payer: issuer.signer,
      authority: issuer.signer,
      credential: toAddress(proof.credentialAddress),
      attestation: toAddress(proof.attestationAddress),
      eventAuthority: await deriveEventAuthorityAddress(),
      attestationProgram: toAddress(proof.programAddress),
    });
    try {
      signature = await issuer.ledger.send(issuer.signer, [ix]);
    } catch (e) {
      throw new AppError("upstream_failed", `Revocation transaction failed: ${(e as Error).message}`);
    }
  }
  // Record the revocation only once the attestation is really gone.
  assert(!(await issuer.ledger.getAccount(toAddress(proof.attestationAddress))).exists, "upstream_failed", "Attestation still exists onchain");
  const [row] = await ctx.db
    .update(proofs)
    .set({ status: "revoked", revokedAt: ctx.now(), revokedBy: actor.id, revokeReason: why, revokeTxSignature: signature })
    .where(eq(proofs.id, proof.id))
    .returning();
  return row;
}

export async function getProof(db: Db, id: string) {
  return (await db.query.proofs.findFirst({ where: eq(proofs.id, id) })) ?? null;
}

export async function proofByAttestation(db: Db, attestation: string) {
  return (await db.query.proofs.findFirst({ where: eq(proofs.attestationAddress, attestation) })) ?? null;
}

export async function proofForContribution(db: Db, contributionId: string) {
  return (await db.query.proofs.findFirst({ where: eq(proofs.contributionId, contributionId) })) ?? null;
}

export function proofsForUser(db: Db, userId: string) {
  return db.query.proofs.findMany({ where: eq(proofs.userId, userId), orderBy: [desc(proofs.createdAt)] });
}

export function confirmedProofsForUsers(db: Db, userIds: string[]) {
  return db
    .select({ proof: proofs, user: users })
    .from(proofs)
    .innerJoin(users, eq(users.id, proofs.userId))
    .where(and(inArray(proofs.userId, userIds), eq(proofs.status, "confirmed")));
}

/** The exportable evidence package for a proof. */
export function exportEvidence(proof: Proof) {
  return {
    format: "buidl-evidence-export/1",
    proof: {
      cluster: proof.cluster,
      program: proof.programAddress,
      credential: proof.credentialAddress,
      schema: proof.schemaAddress,
      attestation: proof.attestationAddress,
      nonce: proof.nonce,
      transaction: proof.txSignature,
      status: proof.status,
      bundleSha256: proof.bundleHash,
    },
    bundle: proof.bundle,
    howToVerify: [
      "1. Fetch the attestation account from the cluster and check it is owned by the Solana Attestation Service program.",
      "2. Check its credential's authority is the issuer you trust and the schema matches.",
      "3. Compute sha256 over the canonical JSON of `bundle` (keys sorted recursively, no whitespace) and compare with the attestation's bundle_hash field.",
      "4. Verify bundle.holder.walletLink.signature (ed25519, base58) over walletLink.message with the holder wallet's public key.",
      "Or run: npm run verify -- <attestation> --bundle <this-file.json> --issuer <issuer authority>",
    ],
  };
}
