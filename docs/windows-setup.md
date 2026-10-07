# Windows setup

`scripts/setup-windows.ps1` does the whole setup and is safe to re-run.

1. Save `setup-windows.ps1` anywhere (for example `Downloads`). You need it
   before you have access to the repository, so get it from the person who
   invited you, or from the repo page on GitHub once you have access.
2. Open **PowerShell** (not as admin) in that folder and run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1
   ```

What it does, step by step (each step is skipped if already done):

| Step | What happens | What you do |
|---|---|---|
| Tools | Installs Git, Node.js LTS and GitHub CLI with `winget` if missing | Approve installer prompts |
| GitHub sign-in | `gh auth login` in your browser, then `gh auth setup-git` so `git` uses that login | Copy the one-time code, approve in the browser |
| Access check | Confirms you can see `crimsonzealbiz/buidl` | If it fails, accept the collaborator invitation it opens, then re-run |
| Code | Clones into `%USERPROFILE%\code\buidl` on branch `claude/solana-identity-network-dd0pqi` (or updates an existing clone) | Nothing |
| Dependencies | `npm install` | Wait a few minutes |
| Config | Creates `.env.local`: random `SESSION_SECRET`, you as admin, and optionally your GitHub OAuth app | Create the OAuth app on the page it opens and paste the Client ID and secret (or skip) |
| Run | `npm run dev` and opens http://localhost:3000 | Ctrl+C to stop |

Options: `-Directory D:\work\buidl` to clone elsewhere, `-NoStart` to skip
starting the server.

## Why the earlier clone failed

GitHub no longer accepts account passwords for `git`. Plain `git clone` of a
private repository fails until git has a token. `gh auth login` plus
`gh auth setup-git` provide one through a browser sign-in. The other common
cause is a collaborator invitation that was sent but not yet accepted:
access starts only after you click **Accept** at
https://github.com/crimsonzealbiz/buidl/invitations.

## Afterwards

- Start again later: `cd $HOME\code\buidl; npm run dev`
- Get updates: `git pull`
- Issuing devnet proofs needs an issuer key; see "Running locally" in the README.
  `npm run localnet` and `npm run e2e` need bash and the Agave CLI, so use WSL
  for those. Everything else works in plain PowerShell.
