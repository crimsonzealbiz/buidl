import {
  SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS,
  decodeAttestation,
  decodeCredential,
  decodeSchema,
  deriveAttestationPda,
  deserializeAttestationData,
} from "@solana/attestation";
import { address as toAddress, isAddress, type Address } from "@solana/kit";
import type { Ledger } from "../solana/ledger";
import { parseLinkMessage, verifyWalletSignature } from "../wallet/link";
import { bundleHash, toHex } from "./canonical";
import { onchainDataFromBundle, type ProofBundle } from "./bundle";
import { PROOF_SCHEMA_FIELDS, proofNonce } from "./sas-schema";

export type Check = { name: string; ok: boolean; detail: string };

export type DecodedProof = {
  holder: string;
  githubId: string;
  event: string;
  product: string;
  category: string;
  approvedAt: string;
  stats: string[];
  bundleHashHex: string;
};

export type VerificationResult = {
  valid: boolean;
  attestation: string;
  checks: Check[];
  onchain: DecodedProof | null;
  /** Present when the attestation was matched against an evidence bundle. */
  bundleMatched: boolean;
};

export type TrustAnchor = {
  /** The issuer authority this verifier trusts (published by the platform). */
  authority: Address;
  credential: Address;
  schema: Address;
};

/**
 * Verifies a proof from the chain alone, optionally against an exported
 * evidence bundle. Every step is reported so a third party can see exactly
 * what was and was not established.
 */
export async function verifyProof(
  ledger: Ledger,
  attestationAddress: string,
  trust: TrustAnchor,
  bundle?: ProofBundle,
  now = new Date(),
): Promise<VerificationResult> {
  const checks: Check[] = [];
  const result = (onchain: DecodedProof | null): VerificationResult => ({
    valid: checks.every((c) => c.ok),
    attestation: attestationAddress,
    checks,
    onchain,
    bundleMatched: !!bundle && checks.every((c) => c.ok),
  });
  const check = (name: string, ok: boolean, detail: string) => {
    checks.push({ name, ok, detail });
    return ok;
  };

  if (!check("Address format", isAddress(attestationAddress), attestationAddress)) return result(null);
  const acc = await ledger.getAccount(toAddress(attestationAddress));
  if (!acc.exists) {
    check("Attestation exists onchain", false, "not found (never issued, or revoked/closed)");
    return result(null);
  }
  check("Attestation exists onchain", true, "found");
  if (!check("Owned by Solana Attestation Service", acc.programAddress === SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS, acc.programAddress)) {
    return result(null);
  }
  let att;
  try {
    att = decodeAttestation(acc).data;
  } catch (e) {
    check("Decodes as an attestation", false, (e as Error).message);
    return result(null);
  }
  check("Issued under the trusted credential", att.credential === trust.credential, att.credential);
  check("Uses the trusted schema", att.schema === trust.schema, att.schema);

  const credAcc = await ledger.getAccount(att.credential);
  if (credAcc.exists) {
    const cred = decodeCredential(credAcc).data;
    check("Credential authority is the trusted issuer", cred.authority === trust.authority, cred.authority);
    check("Signed by an authorized signer", cred.authorizedSigners.includes(att.signer), att.signer);
  } else {
    check("Credential exists", false, "credential account missing");
  }
  const expiry = Number(att.expiry);
  check("Not expired", expiry === 0 || expiry > now.getTime() / 1000, expiry === 0 ? "no expiry" : new Date(expiry * 1000).toISOString());

  const schemaAcc = await ledger.getAccount(att.schema);
  if (!check("Schema exists", schemaAcc.exists, att.schema) || !schemaAcc.exists) return result(null);
  const schema = decodeSchema(schemaAcc).data;
  check(
    "Schema layout matches buidl proof v1",
    schema.fieldNames.join(",") === PROOF_SCHEMA_FIELDS.map(([n]) => n).join(","),
    schema.fieldNames.join(","),
  );
  let data: Record<string, unknown>;
  try {
    data = deserializeAttestationData<Record<string, unknown>>(schema, att.data);
  } catch (e) {
    check("Attestation data decodes", false, (e as Error).message);
    return result(null);
  }
  const onchain: DecodedProof = {
    holder: String(data.holder),
    githubId: String(data.github_id),
    event: String(data.event),
    product: String(data.product),
    category: String(data.category),
    approvedAt: new Date(Number(data.approved_at) * 1000).toISOString(),
    stats: (data.stats as string[]) ?? [],
    bundleHashHex: toHex(Uint8Array.from(data.bundle_hash as number[])),
  };

  if (!bundle) return result(onchain);

  // Bundle checks: the exported record must be exactly what was attested.
  check("Bundle hash matches onchain hash", toHex(bundleHash(bundle)) === onchain.bundleHashHex, onchain.bundleHashHex);
  const expected = onchainDataFromBundle(bundle);
  check(
    "Onchain fields match bundle",
    expected.holder === onchain.holder &&
      String(expected.github_id) === onchain.githubId &&
      expected.event === onchain.event &&
      expected.category === onchain.category &&
      expected.stats.join("|") === onchain.stats.join("|"),
    `${onchain.holder} / github ${onchain.githubId} / ${onchain.event} / ${onchain.category}`,
  );
  const nonce = proofNonce(bundle.contribution.id);
  check("Nonce derives from the contribution id", nonce === att.nonce, att.nonce);
  const [pda] = await deriveAttestationPda({ credential: att.credential, schema: att.schema, nonce });
  check("Attestation address is the canonical PDA", pda === attestationAddress, pda);
  check(
    "Bundle names the trusted issuer",
    bundle.issuer.authority === trust.authority && bundle.issuer.credential === trust.credential,
    bundle.issuer.authority,
  );
  check("Review decision is approval", bundle.review.decision === "approved", bundle.review.decision);

  const link = bundle.holder.walletLink;
  const parsed = parseLinkMessage(link.message);
  check(
    "Wallet-link message names this wallet and GitHub id",
    !!parsed && parsed.address === bundle.holder.wallet && parsed.githubId === bundle.holder.githubId,
    parsed ? `${parsed.address} ↔ github ${parsed.githubId}` : "unparseable link message",
  );
  check(
    "Wallet signed the link message",
    await verifyWalletSignature(bundle.holder.wallet, link.message, link.signature),
    "ed25519 signature over the link message",
  );
  return result(onchain);
}
