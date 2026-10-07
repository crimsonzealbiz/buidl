<#
.SYNOPSIS
  One-shot Windows setup for buidl: tools, GitHub sign-in, clone, install, config, dev server.

.DESCRIPTION
  Safe to re-run: every step checks what is already done and skips it.
  Run from PowerShell (no admin needed unless winget asks):

    powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1

  Steps:
    1. Installs Git, Node.js LTS and GitHub CLI with winget if they are missing
    2. Signs you in to GitHub in your browser (gh auth login) and lets git use it
    3. Checks you can see the repository (collaborator invites must be ACCEPTED)
    4. Clones the repo (or updates an existing clone) on the right branch
    5. npm install
    6. Creates .env.local with a generated SESSION_SECRET and your GitHub login
       as admin, and optionally your GitHub OAuth app credentials
    7. Starts the dev server at http://localhost:3000
#>
param(
  [string]$Directory = (Join-Path $HOME "code\buidl"),
  [string]$Repo = "crimsonzealbiz/buidl",
  [string]$Branch = "claude/solana-identity-network-dd0pqi",
  [switch]$NoStart
)

$ErrorActionPreference = "Stop"

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg) { Write-Host "    $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "    $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "`nERROR: $msg" -ForegroundColor Red; exit 1 }

function Refresh-Path {
  # Pick up tools that winget just installed without reopening the terminal.
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user"
}

function Open-Url($url) {
  try { Start-Process $url } catch { Warn "Open this link in your browser: $url" }
}

function Has($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

function Ensure-Tool($cmd, $wingetId, $label) {
  if (Has $cmd) { Ok "$label found"; return }
  if (-not (Has "winget")) {
    Fail "$label is not installed and winget is unavailable. Install $label manually, then re-run this script."
  }
  Warn "$label not found; installing with winget ($wingetId)..."
  winget install --id $wingetId -e --source winget --accept-package-agreements --accept-source-agreements
  Refresh-Path
  if (-not (Has $cmd)) { Fail "$label was installed but is not on PATH yet. Close this window, open a new PowerShell, and re-run the script." }
  Ok "$label installed"
}

# Runs a native command silently and returns its exit code. Windows PowerShell 5.1
# turns redirected stderr into terminating errors under "Stop", so relax it here.
function Quiet($exe, [string[]]$argList) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try { & $exe @argList 2>&1 | Out-Null; return $LASTEXITCODE }
  finally { $ErrorActionPreference = $prev }
}

# Runs a native command and fails the script if it exits non-zero.
function Run($exe, [string[]]$argList, $what) {
  & $exe @argList
  if ($LASTEXITCODE -ne 0) { Fail "$what failed (exit code $LASTEXITCODE)" }
}

# ---------------------------------------------------------------- 1. tools
Step "Checking tools"
Ensure-Tool "git" "Git.Git" "Git"
Ensure-Tool "node" "OpenJS.NodeJS.LTS" "Node.js"
Ensure-Tool "gh" "GitHub.cli" "GitHub CLI"

$nodeVersion = (node -v).TrimStart("v")
$parts = $nodeVersion.Split(".")
$major = [int]$parts[0]; $minor = [int]$parts[1]
if ($major -lt 22 -or ($major -eq 22 -and $minor -lt 13)) {
  Fail "Node.js $nodeVersion is too old; 22.13 or newer is required. Run: winget upgrade OpenJS.NodeJS.LTS"
}
Ok "Node.js $nodeVersion"

# ---------------------------------------------------------------- 2. GitHub sign-in
Step "Signing in to GitHub"
if ((Quiet "gh" @("auth", "status", "--hostname", "github.com")) -ne 0) {
  Warn "A browser window will open. Copy the one-time code shown here, paste it on GitHub, and approve."
  Run "gh" @("auth", "login", "--hostname", "github.com", "--git-protocol", "https", "--web") "GitHub sign-in"
} else {
  Ok "Already signed in"
}
# Lets plain `git` (clone, pull, push) use the GitHub CLI login: fixes "Authentication failed".
Run "gh" @("auth", "setup-git") "Configuring git to use your GitHub login"
$login = (gh api user --jq .login).Trim()
Ok "Signed in as $login"

# ---------------------------------------------------------------- 3. access
Step "Checking access to $Repo"
if ((Quiet "gh" @("repo", "view", $Repo, "--json", "name")) -ne 0) {
  Warn "Your account ($login) cannot see $Repo yet."
  Warn "Collaborator invitations must be accepted. Opening the invitation page..."
  Open-Url "https://github.com/$Repo/invitations"
  Fail "Accept the invitation (or ask the owner to re-send it to '$login'), then re-run this script."
}
Ok "Access confirmed"

# ---------------------------------------------------------------- 4. clone / update
Step "Getting the code into $Directory"
if (Test-Path (Join-Path $Directory ".git")) {
  Ok "Existing clone found; updating"
  Push-Location $Directory
  Run "git" @("fetch", "origin", $Branch) "git fetch"
  Run "git" @("checkout", $Branch) "git checkout"
  Run "git" @("pull", "--ff-only", "origin", $Branch) "git pull"
} else {
  $parent = Split-Path $Directory -Parent
  if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
  Run "gh" @("repo", "clone", $Repo, $Directory, "--", "--branch", $Branch) "Cloning"
  Push-Location $Directory
}
$head = (git log --oneline -1).Trim()
Ok "On $Branch at: $head"

# ---------------------------------------------------------------- 5. dependencies
Step "Installing dependencies (npm install, a few minutes the first time)"
Run "npm" @("install", "--no-fund") "npm install"
Ok "Dependencies installed"

# ---------------------------------------------------------------- 6. configuration
Step "Configuring .env.local"
$envPath = Join-Path $Directory ".env.local"
$utf8NoBom = New-Object System.Text.UTF8Encoding $false

function Set-EnvValue([string]$content, [string]$key, [string]$value) {
  $line = "$key=$value"
  $pattern = "(?m)^#?\s*$([regex]::Escape($key))=.*$"
  $re = New-Object System.Text.RegularExpressions.Regex $pattern
  # Replace only the first match; escape "$" so values are inserted literally.
  if ($re.IsMatch($content)) { return $re.Replace($content, $line.Replace('$', '$$'), 1) }
  return $content.TrimEnd() + "`n$line`n"
}
function Get-EnvValue([string]$content, [string]$key) {
  $m = [regex]::Match($content, "(?m)^$([regex]::Escape($key))=(.*)$")
  if ($m.Success) { return $m.Groups[1].Value.Trim() }
  return ""
}

if (Test-Path $envPath) {
  $content = [IO.File]::ReadAllText($envPath)
  Ok ".env.local exists; keeping your values and filling only what is empty"
} else {
  $content = [IO.File]::ReadAllText((Join-Path $Directory ".env.example"))
}

if (-not (Get-EnvValue $content "SESSION_SECRET")) {
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $content = Set-EnvValue $content "SESSION_SECRET" ([Convert]::ToBase64String($bytes))
  Ok "Generated SESSION_SECRET"
}
if (-not (Get-EnvValue $content "ADMIN_GITHUB_LOGINS")) {
  $content = Set-EnvValue $content "ADMIN_GITHUB_LOGINS" $login
  Ok "Made $login an admin (can create events)"
}

if (-not (Get-EnvValue $content "GITHUB_CLIENT_ID")) {
  Write-Host ""
  Write-Host "    Sign-in to the app needs a GitHub OAuth app (GitHub does not allow creating one automatically)." -ForegroundColor Yellow
  Write-Host "    Opening the form. Use exactly:" -ForegroundColor Yellow
  Write-Host "      Application name:            buidl (local)"
  Write-Host "      Homepage URL:                http://localhost:3000"
  Write-Host "      Authorization callback URL:  http://localhost:3000/api/auth/github/callback"
  Write-Host "    Then click 'Generate a new client secret'." -ForegroundColor Yellow
  Open-Url "https://github.com/settings/applications/new"
  $clientId = (Read-Host "    Paste the Client ID (or press Enter to skip for now)").Trim()
  if ($clientId) {
    $secure = Read-Host "    Paste the Client secret (hidden)" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $clientSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim() }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    $content = Set-EnvValue $content "GITHUB_CLIENT_ID" $clientId
    $content = Set-EnvValue $content "GITHUB_CLIENT_SECRET" $clientSecret
    Ok "Saved OAuth app credentials"
  } else {
    Warn "Skipped. The app will run, but 'Sign in with GitHub' will say it is not configured."
    Warn "Re-run this script later, or fill GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET in $envPath."
  }
}

[IO.File]::WriteAllText($envPath, $content, $utf8NoBom)
Ok "Wrote $envPath (never committed; it is in .gitignore)"

# ---------------------------------------------------------------- 7. run
Write-Host ""
Write-Host "Setup complete." -ForegroundColor Green
Write-Host "  Project:  $Directory"
Write-Host "  Proofs:   issuing devnet proofs also needs an issuer key; see README.md ('Running locally')."
if ($NoStart) {
  Write-Host "  Start it: cd `"$Directory`"; npm run dev"
  Pop-Location
  exit 0
}
Step "Starting the dev server (Ctrl+C to stop). Opening http://localhost:3000 shortly..."
Start-Job -ScriptBlock { Start-Sleep -Seconds 8; Start-Process "http://localhost:3000" } | Out-Null
& npm run dev
Pop-Location
