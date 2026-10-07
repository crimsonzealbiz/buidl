# buidl

A Solana-first identity network for hackathon builders. A builder's GitHub
identity is linked to a Solana wallet by signature. Each teammate documents
their **own** contribution with evidence (code, design, research, docs, and
more). An event reviewer approves or rejects each contribution individually,
and an approval becomes a **Solana Attestation Service (SAS)** proof on devnet
that anyone can verify against an exported evidence bundle. Demo opportunities
decide eligibility from proofs re-verified onchain.

The core flow:

```
GitHub sign-in → signed wallet link → event registration + repository baseline
→ product submission → per-person contribution + evidence (+ teammate confirmations)
→ reviewer decision (with selected stats) → SAS attestation on devnet
→ independent verification + evidence export → proof-based opportunity eligibility
```

## Stack

Next.js 16 (App Router, server actions) · TypeScript · Drizzle ORM on
PGlite (embedded, default) or Postgres · `@solana/kit` 8 ·
`@solana/attestation` 2.1 (the SAS SDK) · Vitest · LiteSVM · Playwright.

## Running locally

On Windows, `scripts/setup-windows.ps1` does all of this for you; see [docs/windows-setup.md](docs/windows-setup.md).

```bash
npm install
cp .env.example .env.local      # fill in SESSION_SECRET, GitHub OAuth, ADMIN_GITHUB_LOGINS
npm run issuer:keygen           # writes keys/issuer.json (gitignored)
# fund the printed address on devnet (solana airdrop / faucet), then set ISSUER_SECRET_KEY to the file contents
npm run sas:setup               # creates the SAS credential + schema (idempotent; refuses mainnet)
npm run dev
```

Local validator instead of devnet (needs the Agave CLI):

```bash
npm run localnet                # solana-test-validator with the vendored SAS program
SOLANA_CLUSTER=localnet npm run sas:setup
```

## Verifying a proof independently

```bash
npm run verify -- <attestation> --bundle exported.json --issuer <issuer authority> [--rpc <url>]
```

The verifier trusts only the chain, the issuer authority you pass, and the
file. It checks SAS ownership, credential authority and signer, schema
layout, expiry, the bundle's sha256 against the attested hash, the
deterministic nonce/PDA, and the wallet's ed25519 signature over the
GitHub-link message. `GET /api/issuer` publishes the trust anchor.

## Tests

```bash
npm test                                         # unit + full core flow on LiteSVM (real SAS program)
LOCALNET_RPC_URL=http://127.0.0.1:8899 npm test  # also run the core flow over JSON-RPC on a local validator
npm run e2e                                      # browser flow (requires `npm run localnet` running)
```

See [docs/demo.md](docs/demo.md) for a live demo runbook and [docs/progress.md](docs/progress.md) for status, results and known gaps.
