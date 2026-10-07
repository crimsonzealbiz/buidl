/**
 * Runtime configuration. Each integration reports whether it is configured so
 * the UI can say exactly what is missing instead of pretending to work.
 */
export type Cluster = "devnet" | "localnet";

export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function sessionSecret(): string | null {
  return process.env.SESSION_SECRET ?? null;
}

export function githubOAuthConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** GitHub logins allowed to create events and opportunities. */
export function adminLogins(): string[] {
  return (process.env.ADMIN_GITHUB_LOGINS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export type SolanaConfig = {
  cluster: Cluster;
  rpcUrl: string;
  credentialName: string;
  schemaName: string;
  schemaVersion: number;
};

export function solanaConfig(): SolanaConfig {
  const cluster = (process.env.SOLANA_CLUSTER ?? "devnet") as Cluster;
  if (cluster !== "devnet" && cluster !== "localnet") {
    // Mainnet is deliberately unsupported until separately authorized.
    throw new Error(`SOLANA_CLUSTER must be "devnet" or "localnet", got "${cluster}"`);
  }
  return {
    cluster,
    rpcUrl:
      process.env.SOLANA_RPC_URL ??
      (cluster === "devnet" ? "https://api.devnet.solana.com" : "http://127.0.0.1:8899"),
    credentialName: process.env.SAS_CREDENTIAL_NAME ?? "buidl-identity",
    schemaName: process.env.SAS_SCHEMA_NAME ?? "buidl-contribution",
    schemaVersion: Number(process.env.SAS_SCHEMA_VERSION ?? "1"),
  };
}

/** The issuer keypair as a JSON byte array (solana-keygen format). */
export function issuerSecretKey(): Uint8Array | null {
  const raw = process.env.ISSUER_SECRET_KEY;
  if (!raw) return null;
  const bytes = JSON.parse(raw) as number[];
  if (!Array.isArray(bytes) || bytes.length !== 64) {
    throw new Error("ISSUER_SECRET_KEY must be a 64-byte JSON array (solana-keygen format)");
  }
  return Uint8Array.from(bytes);
}

export type ConfigStatus = { name: string; ok: boolean; detail: string };

export function configStatus(): ConfigStatus[] {
  let sol: SolanaConfig | null = null;
  let solErr = "";
  try {
    sol = solanaConfig();
  } catch (e) {
    solErr = (e as Error).message;
  }
  let issuerOk = false;
  let issuerErr = "ISSUER_SECRET_KEY not set";
  try {
    issuerOk = issuerSecretKey() !== null;
    if (issuerOk) issuerErr = "";
  } catch (e) {
    issuerErr = (e as Error).message;
  }
  return [
    { name: "Session secret", ok: !!sessionSecret(), detail: sessionSecret() ? "set" : "SESSION_SECRET not set" },
    {
      name: "GitHub OAuth",
      ok: !!githubOAuthConfig(),
      detail: githubOAuthConfig() ? "client configured" : "GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET not set",
    },
    { name: "Solana cluster", ok: !!sol, detail: sol ? `${sol.cluster} via ${sol.rpcUrl}` : solErr },
    { name: "Proof issuer key", ok: issuerOk, detail: issuerOk ? "loaded" : issuerErr },
  ];
}
