import { getAddressDecoder, type Address } from "@solana/kit";
import { SchemaDataType, deriveCredentialPda, deriveSchemaPda } from "@solana/attestation";
import { sha256 } from "./canonical";

/**
 * Onchain layout of a contribution proof. Field order is part of the schema;
 * changing it requires a new schema version.
 */
export const PROOF_SCHEMA_FIELDS = [
  ["holder", SchemaDataType.String],
  ["github_id", SchemaDataType.U64],
  ["event", SchemaDataType.String],
  ["product", SchemaDataType.String],
  ["category", SchemaDataType.String],
  ["approved_at", SchemaDataType.I64],
  ["stats", SchemaDataType.VecString],
  ["bundle_hash", SchemaDataType.VecU8],
] as const;

export const PROOF_SCHEMA_DESCRIPTION =
  "buidl reviewed hackathon contribution: holder wallet, GitHub id, event, product, category, approval time, reviewer-selected stats, sha256 of the evidence bundle";

export type ProofOnchainData = {
  holder: string;
  github_id: bigint;
  event: string;
  product: string;
  category: string;
  approved_at: bigint;
  stats: string[];
  bundle_hash: number[];
};

export async function deriveIssuerAddresses(opts: {
  authority: Address;
  credentialName: string;
  schemaName: string;
  schemaVersion: number;
}) {
  const [credential] = await deriveCredentialPda({ authority: opts.authority, name: opts.credentialName });
  const [schema] = await deriveSchemaPda({ credential, name: opts.schemaName, version: opts.schemaVersion });
  return { credential, schema };
}

/**
 * The attestation nonce is derived from the contribution id, so one
 * contribution can only ever map to one attestation address (no duplicates,
 * safe retries) and verifiers can recompute it from the bundle.
 */
export function proofNonce(contributionId: string): Address {
  return getAddressDecoder().decode(sha256(`buidl/proof/v1/${contributionId}`));
}

/** Truncates to at most `max` UTF-8 bytes on a character boundary (keeps transactions small). */
export function clip(s: string, max = 64): string {
  const enc = new TextEncoder();
  let out = "";
  for (const ch of s) {
    if (enc.encode(out + ch).length > max) break;
    out += ch;
  }
  return out;
}
