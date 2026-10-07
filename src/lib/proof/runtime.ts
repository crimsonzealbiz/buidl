import { address as toAddress, createKeyPairSignerFromBytes, isAddress, type Address } from "@solana/kit";
import { issuerSecretKey, solanaConfig } from "../config";
import { RpcLedger } from "../solana/ledger";
import { issuerAddresses } from "./issuer";
import type { Issuer } from "./service";
import type { TrustAnchor } from "./verify";

/** The configured issuer, or a reason it is unavailable. Never a placeholder. */
export async function loadIssuer(): Promise<{ issuer: Issuer } | { issuer: null; reason: string }> {
  let cfg;
  let secret;
  try {
    cfg = solanaConfig();
    secret = issuerSecretKey();
  } catch (e) {
    return { issuer: null, reason: (e as Error).message };
  }
  if (!secret) return { issuer: null, reason: "ISSUER_SECRET_KEY is not set; proofs cannot be issued" };
  const signer = await createKeyPairSignerFromBytes(secret);
  return {
    issuer: {
      signer,
      ledger: new RpcLedger(cfg.cluster, cfg.rpcUrl),
      config: { credentialName: cfg.credentialName, schemaName: cfg.schemaName, schemaVersion: cfg.schemaVersion },
    },
  };
}

/**
 * The issuer authority verifiers trust: ISSUER_AUTHORITY (public key) if set,
 * otherwise the public key of ISSUER_SECRET_KEY.
 */
export async function loadTrustAnchor(): Promise<TrustAnchor | null> {
  const cfg = solanaConfig();
  let authority: Address | null = null;
  const pub = process.env.ISSUER_AUTHORITY;
  if (pub && isAddress(pub)) authority = toAddress(pub);
  else {
    const secret = issuerSecretKey();
    if (secret) authority = (await createKeyPairSignerFromBytes(secret)).address;
  }
  if (!authority) return null;
  const a = await issuerAddresses(authority, {
    credentialName: cfg.credentialName,
    schemaName: cfg.schemaName,
    schemaVersion: cfg.schemaVersion,
  });
  return { authority, credential: a.credential, schema: a.schema };
}

export function readLedger() {
  const cfg = solanaConfig();
  return new RpcLedger(cfg.cluster, cfg.rpcUrl);
}
