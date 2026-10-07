# Progress

_Last updated: 2026-10-07_

## Spec gap

`plan.md` and `codex-prompt.md` were **not present** in the repository or on
any remote branch (the repository was empty, with no commits). Work so far
follows the flow and constraints given in the kickoff request. The milestone
labels below are this project's own. Once `plan.md` is added, its milestones
and acceptance criteria need to be reconciled with this work.

## Milestones

| # | Milestone | Status |
|---|-----------|--------|
| 1 | Scaffold, DB schema/migrations, test harness, **early SAS compatibility check** | Done |
| 2 | GitHub OAuth, sessions, signed wallet linkage | Done (live GitHub not exercised; see blockers) |
| 3 | Events, staff roles, registration, teams, repository baseline | Done |
| 4 | Product submission, per-person contributions, evidence, teammate confirmations, reviewer decisions | Done |
| 5 | SAS proof issuance, independent verification, evidence export | Done on LiteSVM + local validator; **devnet not exercised** |
| 6 | Proof-based opportunity eligibility, UI for the full flow | Done |
| 7 | Product decisions round 1: event settings, leaving teams, proof revocation, token encryption | Done |
| 8 | Demo/MVP readiness | Done: next-steps guidance, commit picker, teammate disputes, issuer readiness check, applicant list, sample event, admin-only config, demo runbook (`docs/demo.md`) |
| — | X/Ethos, token badges, community features, AI | Deferred by design |

## Product decisions (from review of the first build)

| Topic | Decision | Implemented as |
|---|---|---|
| Repositories | One per team | Enforced (unchanged) |
| Repo visibility | Public only | Enforced (unchanged) |
| Leaving a team | Allowed | Before the deadline, if your own claim is still a draft or has changes requested (it is discarded). Your confirmations on teammates' open claims are withdrawn. An empty team is deleted. |
| Event editing | Name, description, dates, max team size, chain, prizes, website | Organizer-only edit form. Team size is enforced on join, and can't be lowered below an existing team's size. Slug stays fixed because it is in URLs and proofs. |
| Proof issuance | Manual after approval (no background jobs) | "Issue proof" button for the contributor or event staff (unchanged) |
| GitHub tokens | Encrypt | AES-256-GCM at rest (`src/lib/crypto.ts`), key from `TOKEN_ENCRYPTION_KEY` or derived from `SESSION_SECRET` |
| Proof revocation | Build it | Organizers or admins close the attestation onchain with a required reason. Recorded only after the account is confirmed gone. A revoked proof can't be re-issued, fails verification, and stops counting for opportunities. |
| Staff overview | Added | Event page lists every team, its product, and each member's claim status for organizers and reviewers |

## SAS compatibility findings (checked first)

- `sas-lib@1.0.10` (the old npm name) still depends on `@solana/kit ^5`, but
  current kit is 8.x. Mixing the two would mean two kit copies. **Use
  `@solana/attestation@2.1.0`** (the renamed SDK, peer `@solana/kit ^8`),
  which is what this project does.
- The SAS program was built from source (commit `af8fd17`, program v2.0.0)
  with Agave v4.2.2 and vendored in `vendor/sas/` for tests only. The upstream
  CHANGELOG says v2.0.0 is not yet deployed. Its changes from the deployed
  binary are bug fixes, with no instruction or account layout changes. The
  remaining risk is small: run one devnet issuance before relying on it.
- Credential creation, schema creation (8 fields incl. `VecString`, `VecU8`)
  and attestation creation and decoding all work against the real program.

## Design decisions

- **No automatic team awards.** A proof requires that builder's own
  contribution claim, evidence, and an approving review by an event reviewer
  who is not on the team. Membership alone yields nothing (tested).
- **Commit counts, social reputation and ratings are not evidence.** GitHub
  checks establish *authorship only*: the commit or PR is in the registered
  repo, attributed to the builder's GitHub id, after the registration baseline,
  and contained in the submitted commit. Reviewers judge meaning. Onchain
  stats are reviewer-selected and derived from reviewed evidence (no follower
  or commit counts).
- **Non-engineering contributors:** categories include design, product,
  research, content, community, business. Evidence kinds include design
  files, documents, videos and deployments, and teammates can corroborate a
  claim.
- **Deterministic nonce** = sha256(`buidl/proof/v1/<contributionId>`). One
  contribution maps to exactly one attestation address. Retries are safe, and
  verifiers can recompute the PDA from the bundle.
- **Evidence bundle** (canonical JSON, keys sorted) holds the full record,
  including the wallet-link message and signature. Its sha256 is attested
  onchain.
- **"Confirmed" only after read-back.** A proof is marked confirmed only after
  the attestation is fetched from chain and verified against the stored bundle.
- **Mainnet is refused** by checking the cluster genesis hash. `devnet` mode
  also refuses any RPC whose genesis is not devnet.
- **Eligibility** re-verifies each proof onchain and uses the *attested*
  event and category, not database claims. A proof that disappears onchain
  stops counting.

## Test results (actual, this session)

- `npm run typecheck`: clean.
- `npx next build`: succeeds (22 routes).
Latest run (after the demo-readiness round):
- `npm test` on LiteSVM: **30/30**. With `LOCALNET_RPC_URL`, **43/43**. New
  coverage: teammate disputes (recorded, not counted as confirmations, refused
  after a decision), commit suggestions (own commits after the baseline only),
  next-steps guidance for builders and reviewers, issuer pre-check
  (unfunded or unset-up issuer fails before any proof record is created),
  applicant names on opportunities, sample event creation (admin only).
- `npm run e2e`: **PASS**. Evidence is now added through the commit picker,
  and the teammate step uses the confirm/dispute form.

Previous round (product decisions):
- `npm test` on LiteSVM: **28/28**. With `LOCALNET_RPC_URL`, **39/39**, adding
  team-size enforcement, leaving teams, event editing, revocation onchain
  (attestation closed, verification fails, re-issue refused, eligibility
  lost), and token encryption (round-trip, fresh IV, tamper and wrong-key rejection).
- `npm run e2e`: **PASS**, now also covering editing event settings (team
  size, prizes) and revoking a proof from the proof page, after which public
  verification reports it invalid.

Earlier run:
- `npm test`: **25/25 passed** (3 files):
  - wallet linkage: valid sig, wrong wallet, wrong message, replay, other
    user's challenge, expiry, one wallet ↔ one identity, relink revokes
  - core flow on **LiteSVM with the real SAS program**: event → team → repo
    baseline → submission → engineering + design + rejected community claims →
    GitHub authorship checks (verified / pre-baseline / teammate's commit /
    other repo / after submission) → COI-refused reviews → per-contribution
    approvals → proofs to linked wallets → idempotent retry → independent
    verification (valid, tampered bundle, wrong issuer, missing) → eligibility
    and application → eligibility lost on a cluster without the proof → mainnet refusal
  - units: OAuth state, OAuth error surfacing, URL parsing, canonical JSON,
    nonce, UTF-8 clipping, stat selection, link-message round-trip
- `LOCALNET_RPC_URL=… npm test`: **34/34 passed**, adding the core flow over
  real JSON-RPC against `solana-test-validator` (Agave 4.2.2) with SAS loaded.
- `npm run e2e` (Playwright, Chromium): **PASS**. Covers OAuth sign-in for 4
  users, event creation, staff, registration, team via join code, repo
  baseline, submission, contributions and evidence, teammate confirmation,
  reviews with stats, a Wallet Standard wallet signing the link message,
  proof issuance confirmed on the local validator, export download, and
  public verification with the uploaded export. Then an opportunity: the
  ineligible builder is refused, and the eligible one applies.
  The CLI verifier then passed all 18 checks on that attestation, and
  `solana confirm` shows the SAS program executed and the transaction
  finalized.

**Test doubles, stated plainly:** GitHub (OAuth and REST) is a local stub in
the vitest suite and the browser e2e, because GitHub is unreachable from this
sandbox. The test wallet holds a real ed25519 key. Solana transactions are
real, but on LiteSVM or a local validator, **not devnet**.

## Blockers (environment)

1. **Solana devnet RPC is blocked** by the sandbox network policy
   (`api.devnet.solana.com` → proxy 403). No devnet transaction has been
   sent. To unblock: allow the RPC host (or set `SOLANA_RPC_URL` to an allowed
   provider), fund the issuer key, and run `npm run sas:setup`.
2. **GitHub API / OAuth is blocked** (`api.github.com` → 403). Live sign-in,
   repository baseline capture, and commit verification against real GitHub
   are implemented but unexercised. They need network access plus OAuth app
   credentials.

## Configuration required

See `.env.example`: `SESSION_SECRET`, `GITHUB_CLIENT_ID/SECRET` (callback
`$APP_URL/api/auth/github/callback`), `ADMIN_GITHUB_LOGINS`,
`ISSUER_SECRET_KEY` (funded devnet key from `npm run issuer:keygen`),
optionally `DATABASE_URL`, `SOLANA_RPC_URL`, `ISSUER_AUTHORITY`, `GITHUB_TOKEN`.
`GITHUB_API_URL` / `GITHUB_WEB_URL` exist for GitHub Enterprise and the e2e stub.

## Incomplete / known gaps

- Devnet issuance and live GitHub not yet exercised (see blockers).
- One repository per team and public repositories only (product decisions).
- Organizers can't remove someone else from a team; members leave themselves.
- Proof issuance is a manual step and runs inside the request (product decision).
- Opportunity pages re-verify every proof via RPC on each view (no caching).
- No rate limiting. Mutations use Next.js server actions (origin-checked) and
  SameSite=Lax cookies.
- Visual design is functional, not polished.
- Agave CLI is required for `npm run localnet` / `npm run e2e`. It was
  installed manually in this sandbox at `/opt/agave` and is not a project dependency.
