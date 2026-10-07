/**
 * Independently verifies a buidl proof using only a Solana RPC endpoint, the
 * issuer authority you trust, and (optionally) an exported evidence file.
 *
 *   npm run verify -- <attestation> [--bundle export.json] [--issuer <authority>] [--rpc <url>]
 */
import "./env";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { address as toAddress } from "@solana/kit";
import { solanaConfig } from "../src/lib/config";
import { RpcLedger } from "../src/lib/solana/ledger";
import { issuerAddresses } from "../src/lib/proof/issuer";
import { verifyProof } from "../src/lib/proof/verify";
import { loadTrustAnchor } from "../src/lib/proof/runtime";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { bundle: { type: "string" }, issuer: { type: "string" }, rpc: { type: "string" }, json: { type: "boolean" } },
});
const attestation = positionals[0];
if (!attestation) {
  console.error("usage: npm run verify -- <attestation> [--bundle file] [--issuer authority] [--rpc url]");
  process.exit(2);
}
const cfg = solanaConfig();
const trust = values.issuer
  ? await issuerAddresses(toAddress(values.issuer), {
      credentialName: cfg.credentialName,
      schemaName: cfg.schemaName,
      schemaVersion: cfg.schemaVersion,
    })
  : await loadTrustAnchor();
if (!trust) {
  console.error("Pass --issuer <authority> (or set ISSUER_AUTHORITY).");
  process.exit(2);
}
let bundle;
if (values.bundle) {
  const file = JSON.parse(readFileSync(values.bundle, "utf8"));
  bundle = file.bundle ?? file;
}
const ledger = new RpcLedger(cfg.cluster, values.rpc ?? cfg.rpcUrl);
const res = await verifyProof(ledger, attestation, trust, bundle);
if (values.json) console.log(JSON.stringify(res, null, 2));
else {
  for (const c of res.checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}  — ${c.detail}`);
  if (res.onchain) console.log("\nOnchain data:", res.onchain);
  console.log(`\n${res.valid ? "VALID" : "INVALID"}${bundle ? " (checked against evidence bundle)" : " (chain only)"}`);
}
process.exit(res.valid ? 0 : 1);
