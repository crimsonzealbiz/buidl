/**
 * Generates a new issuer keypair in solana-keygen JSON format at keys/issuer.json
 * (gitignored). Fund it on devnet with `solana airdrop` or the devnet faucet.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createKeyPairSignerFromBytes } from "@solana/kit";

const out = process.argv[2] ?? "keys/issuer.json";
if (existsSync(out)) {
  console.error(`${out} already exists; refusing to overwrite`);
  process.exit(1);
}
const kp = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
const bytes = Uint8Array.from([...pkcs8.slice(-32), ...pub]);
const signer = await createKeyPairSignerFromBytes(bytes);
mkdirSync("keys", { recursive: true });
writeFileSync(out, JSON.stringify(Array.from(bytes)), { mode: 0o600 });
console.log(`Wrote ${out}\nIssuer authority (public): ${signer.address}`);
console.log(`Set ISSUER_SECRET_KEY to the file's contents, e.g.\n  ISSUER_SECRET_KEY='$(cat ${out})'`);
