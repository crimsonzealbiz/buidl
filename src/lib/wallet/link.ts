import { and, eq, isNull } from "drizzle-orm";
import {
  address as toAddress,
  getBase58Encoder,
  getPublicKeyFromAddress,
  isAddress,
  verifySignature,
  type SignatureBytes,
} from "@solana/kit";
import type { Db } from "@/db";
import { walletChallenges, wallets } from "@/db/schema";
import { AppError, assert } from "../errors";
import { newId, randomToken } from "../ids";
import type { User } from "../auth/session";

const CHALLENGE_TTL_MS = 10 * 60 * 1000;

export type LinkMessageFields = {
  domain: string;
  address: string;
  githubLogin: string;
  githubId: number;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
};

/**
 * The exact text a wallet signs. It names both identities, so a valid
 * signature is self-contained evidence that the wallet holder agreed to the link.
 */
export function buildLinkMessage(f: LinkMessageFields): string {
  return [
    `${f.domain} wants you to link your Solana wallet to your GitHub identity.`,
    "",
    `Wallet: ${f.address}`,
    `GitHub: ${f.githubLogin} (id ${f.githubId})`,
    "Purpose: link-wallet",
    `Domain: ${f.domain}`,
    `Nonce: ${f.nonce}`,
    `Issued At: ${f.issuedAt}`,
    `Expires At: ${f.expiresAt}`,
  ].join("\n");
}

/** Parses a link message back into its fields (used by independent verifiers). */
export function parseLinkMessage(message: string): LinkMessageFields | null {
  const get = (label: string) => message.match(new RegExp(`^${label}: (.+)$`, "m"))?.[1];
  const gh = get("GitHub")?.match(/^(\S+) \(id (\d+)\)$/);
  const fields = {
    domain: get("Domain"),
    address: get("Wallet"),
    githubLogin: gh?.[1],
    githubId: gh ? Number(gh[2]) : undefined,
    nonce: get("Nonce"),
    issuedAt: get("Issued At"),
    expiresAt: get("Expires At"),
  };
  if (Object.values(fields).some((v) => v === undefined)) return null;
  const parsed = fields as LinkMessageFields;
  return buildLinkMessage(parsed) === message ? parsed : null;
}

/** Verifies an Ed25519 signature (base58) by `walletAddress` over `message`. */
export async function verifyWalletSignature(walletAddress: string, message: string, signatureB58: string) {
  if (!isAddress(walletAddress)) return false;
  let sig: Uint8Array;
  try {
    sig = new Uint8Array(getBase58Encoder().encode(signatureB58));
  } catch {
    return false;
  }
  if (sig.length !== 64) return false;
  try {
    const key = await getPublicKeyFromAddress(toAddress(walletAddress));
    return await verifySignature(key, sig as SignatureBytes, new TextEncoder().encode(message));
  } catch {
    return false;
  }
}

export async function createLinkChallenge(db: Db, user: User, walletAddress: string, domain: string, now = new Date()) {
  assert(isAddress(walletAddress), "invalid_input", "Not a valid Solana address");
  const nonce = randomToken(16);
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
  const message = buildLinkMessage({
    domain,
    address: walletAddress,
    githubLogin: user.githubLogin,
    githubId: user.githubId,
    nonce,
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
  await db.insert(walletChallenges).values({ id: newId(), userId: user.id, address: walletAddress, nonce, message, expiresAt });
  return { nonce, message, expiresAt };
}

/**
 * Completes a link: the challenge must belong to this user, be unused and
 * unexpired, and carry a valid signature from the wallet it names.
 */
export async function completeLink(db: Db, user: User, nonce: string, signatureB58: string, now = new Date()) {
  const challenge = await db.query.walletChallenges.findFirst({ where: eq(walletChallenges.nonce, nonce) });
  assert(challenge && challenge.userId === user.id, "not_found", "Unknown wallet challenge");
  assert(!challenge.usedAt, "conflict", "This challenge was already used");
  assert(challenge.expiresAt > now, "precondition_failed", "This challenge has expired; request a new one");
  const ok = await verifyWalletSignature(challenge.address, challenge.message, signatureB58);
  assert(ok, "invalid_input", "Signature does not match the wallet and message");

  const otherOwner = await db.query.wallets.findFirst({
    where: and(eq(wallets.address, challenge.address), isNull(wallets.revokedAt)),
  });
  if (otherOwner && otherOwner.userId !== user.id) {
    throw new AppError("conflict", "This wallet is already linked to another identity");
  }

  return db.transaction(async (tx) => {
    // Consume the challenge atomically; a concurrent replay finds it used.
    const consumed = await tx
      .update(walletChallenges)
      .set({ usedAt: now })
      .where(and(eq(walletChallenges.id, challenge.id), isNull(walletChallenges.usedAt)))
      .returning();
    assert(consumed.length === 1, "conflict", "This challenge was already used");
    // One active wallet per identity: linking a new one revokes the previous one.
    await tx
      .update(wallets)
      .set({ revokedAt: now })
      .where(and(eq(wallets.userId, user.id), isNull(wallets.revokedAt)));
    const [w] = await tx
      .insert(wallets)
      .values({
        id: newId(),
        userId: user.id,
        address: challenge.address,
        message: challenge.message,
        signature: signatureB58,
        linkedAt: now,
      })
      .returning();
    return w;
  });
}

export async function activeWallet(db: Db, userId: string) {
  return (
    (await db.query.wallets.findFirst({ where: and(eq(wallets.userId, userId), isNull(wallets.revokedAt)) })) ?? null
  );
}
