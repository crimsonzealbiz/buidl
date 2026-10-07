/**
 * Creates the issuer's Solana Attestation Service credential and schema on the
 * configured cluster (devnet or localnet). Idempotent. Refuses mainnet.
 */
import "./env";
import { solanaConfig } from "../src/lib/config";
import { loadIssuer } from "../src/lib/proof/runtime";
import { ensureIssuerSetup } from "../src/lib/proof/issuer";

const loaded = await loadIssuer();
if (!loaded.issuer) {
  console.error(`Cannot set up issuer: ${loaded.reason}`);
  process.exit(1);
}
const { issuer } = loaded;
const cfg = solanaConfig();
console.log(`Cluster: ${cfg.cluster} (${cfg.rpcUrl})`);
console.log(`Issuer authority: ${issuer.signer.address}`);
try {
  const { addresses, actions } = await ensureIssuerSetup(issuer.ledger, issuer.signer, issuer.config);
  console.log(`Credential: ${addresses.credential}`);
  console.log(`Schema:     ${addresses.schema}`);
  console.log(actions.length ? actions.join("\n") : "Already set up; nothing to do.");
} catch (e) {
  console.error(`Setup failed: ${(e as Error).message}`);
  process.exit(1);
}
