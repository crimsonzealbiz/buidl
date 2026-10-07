# Demo runbook

A 10-minute live demo of the full flow on Solana devnet. Everything shown is
real: GitHub sign-in, wallet signatures, review decisions, and devnet transactions.

## Before the demo (once)

1. Follow "Running locally" in the README: GitHub OAuth app, `.env.local`,
   `npm run issuer:keygen`, fund the issuer with devnet SOL, `npm run sas:setup`.
2. Put your GitHub login in `ADMIN_GITHUB_LOGINS`.
3. Start the app (`npm run dev`), sign in, and check the **Configuration**
   table on the home page (admins only). Every row should say *ready*,
   including **Issuer readiness** (SOL balance, credential, schema).
4. You need **three GitHub accounts** (organizer, builder, reviewer). The
   reviewer can't be on the builder's team. Use separate browser profiles,
   and have each one sign in once so they can be added as staff.
5. Prepare a **public repo** with at least one commit, and be ready to push a
   new commit from the builder's account during the demo.
6. Install a wallet that supports message signing (Phantom, Solflare,
   Backpack) in the builder's browser profile.

## The script

| # | Who | Do | Say |
|---|-----|----|-----|
| 1 | Organizer | Events → **Create sample event**. On the event page, add the reviewer under Staff. | "An event in one click, with prizes, team size and a demo-day opportunity." |
| 2 | Builder | Dashboard shows **Next steps**. Link a wallet (sign a message, no transaction). | "Your GitHub identity and wallet are linked by signature, so anyone can re-verify it." |
| 3 | Builder | Register, create a team, register the repo. | "We record the repo's commit at registration. Anything before it counts as pre-existing work." |
| 4 | Builder | Push a commit, then submit the product. | |
| 5 | Builder | Describe *your* contribution, then pick your commit from **Your commits since the baseline**. Optionally add a design file or doc. Submit for review. | "Each person claims their own work. Commits are checked for authorship, but reviewers judge whether the work is meaningful, not commit counts." |
| 6 | Reviewer | Dashboard → review queue. Approve, write a rationale, select stats to publish. | "Every member is reviewed individually. Nobody gets a proof just for being on the team." |
| 7 | Builder | Contribution page → **Issue proof**, then open the proof and view it in Explorer. | "That's a Solana Attestation Service attestation on devnet with the stats the reviewer chose." |
| 8 | Anyone (signed out) | Proof → **Verify independently**, then upload the downloaded evidence file. | "Verification needs only the chain and this file, with no trust in our database." |
| 9 | Builder | Opportunities → the demo-day slot → **Apply**. | "Eligibility comes from proofs re-checked onchain right now." |
| 10 | Organizer (optional) | Proof page → **Revoke**. Re-verify. | "Mistakes can be corrected: the attestation is closed and stops verifying." |

## If something goes wrong

- **"Issuer wallet has 0 SOL"**: fund the issuer address shown on the home page.
- **"credential/schema not created"**: run `npm run sas:setup`.
- **Commit shows "GitHub check failed"**: the commit's email must be linked to the builder's GitHub account, and the commit must be newer than the registration baseline.
- **No wallet button**: the browser has no Wallet Standard wallet; install one and reload.
