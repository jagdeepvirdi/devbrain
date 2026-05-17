# DevBrain - Production startup script
# Builds both client and server, then starts:
#   Ollama (native) + Postgres (Docker) + compiled Express server (serves built client from server/public)

param(
    [switch]$SkipBuild   # Pass -SkipBuild to reuse the last build output
)

$Root = $PSScriptRoot
$ErrorActionPreference = "Stop"

function Write-Step($msg)  { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-OK($msg)    { Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "    [WARN] $msg" -ForegroundColor Yellow }
function Write-Fail($msg)  { Write-Host "    [!!] $msg" -ForegroundColor Red; exit 1 }

# --- 0. Pre-flight env checks --------------------------------------------------
Write-Step "Checking environment..."

$envFile = "$Root\server\.env"
if (-not (Test-Path $envFile)) { Write-Fail "server/.env not found — copy .env.example and fill in values" }

$envContent = Get-Content $envFile -Raw

# Warn on default JWT secret
if ($envContent -match "JWT_SECRET\s*=\s*devbrain-dev-secret") {
    Write-Warn "JWT_SECRET is still the dev default — change it before exposing this to a network"
    Write-Host "    Generate one: node -e `"console.log(require('crypto').randomBytes(32).toString('hex'))`"" -ForegroundColor DarkGray
}

# Fail if AUTH_PASSWORD is missing or empty
if ($envContent -notmatch "AUTH_PASSWORD\s*=\s*.+") {
    Write-Fail "AUTH_PASSWORD is not set in server/.env — required for production login`n    Add: AUTH_PASSWORD=your-strong-password"
}

Write-OK "Environment checks passed"

# --- 1. Ollama -------------------------------------------------------------------
Write-Step "Checking Ollama on port 11434..."
$ollamaRunning = $false
try {
    $null = Invoke-WebRequest -Uri "http://localhost:11434/api/tags" -UseBasicParsing -TimeoutSec 2
    $ollamaRunning = $true
} catch { }

if ($ollamaRunning) {
    Write-OK "Ollama already running"
} else {
    Write-Host "    Starting Ollama..." -ForegroundColor Yellow
    Start-Process "ollama" -ArgumentList "serve" -WindowStyle Hidden
    Start-Sleep -Seconds 4
    try {
        $null = Invoke-WebRequest -Uri "http://localhost:11434/api/tags" -UseBasicParsing -TimeoutSec 3
        Write-OK "Ollama started"
    } catch {
        Write-Fail "Ollama failed to start - is it installed? Run: winget install Ollama.Ollama"
    }
}

# --- 2. Build ------------------------------------------------------------------
if (-not $SkipBuild) {
    Write-Step "Building server (tsc)..."
    Set-Location "$Root\server"
    npm run build
    if ($LASTEXITCODE -ne 0) { Write-Fail "Server build failed" }
    Write-OK "Server compiled to server/dist"

    Write-Step "Building client (vite build)..."
    Set-Location "$Root\client"
    npm run build
    if ($LASTEXITCODE -ne 0) { Write-Fail "Client build failed" }
    Write-OK "Client built to client/dist"

    # Copy client build into server/public so Express serves it as static files
    Write-Step "Copying client build to server/public..."
    $publicDir = "$Root\server\public"
    if (Test-Path $publicDir) { Remove-Item $publicDir -Recurse -Force }
    Copy-Item "$Root\client\dist" $publicDir -Recurse
    Write-OK "Client assets in server/public"
} else {
    Write-Host "`n    [SKIP] Build skipped (-SkipBuild flag set)" -ForegroundColor Yellow

    if (-not (Test-Path "$Root\server\dist\index.js")) {
        Write-Fail "server/dist/index.js not found - run without -SkipBuild first"
    }
    if (-not (Test-Path "$Root\server\public\index.html")) {
        Write-Fail "server/public/index.html not found - run without -SkipBuild first"
    }
    Write-OK "Using existing build artifacts"
}

# --- 3. Postgres (Docker Compose - postgres service only) ----------------------
Write-Step "Starting Postgres via Docker Compose..."
Set-Location $Root
docker compose up -d postgres
if ($LASTEXITCODE -ne 0) { Write-Fail "Docker Compose failed - is Docker Desktop running?" }

Write-Host "    Waiting for Postgres healthcheck" -NoNewline
$attempts = 0
while ($true) {
    Start-Sleep -Seconds 2
    $containerId = docker compose ps -q postgres 2>$null
    if ($containerId) {
        $health = docker inspect --format "{{.State.Health.Status}}" $containerId 2>$null
        if ($health -eq "healthy") { Write-Host " ready!" -ForegroundColor Green; break }
    }
    Write-Host "." -NoNewline
    $attempts++
    if ($attempts -gt 25) { Write-Fail "Postgres did not become healthy in time" }
}

# --- 4. Database migrations (idempotent — safe to run every time) --------------
Write-Step "Running database migrations..."
Set-Location "$Root\server"
node db/migrate-org-v2.mjs
if ($LASTEXITCODE -ne 0) { Write-Fail "migrate-org-v2.mjs failed — check DB connection and schema" }
Write-OK "Migrations up to date"

# --- 5. Express server - compiled JS (serves client from server/public) --------
Write-Step "Starting Express server (node dist/index.js on :3001)..."
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$Root\server'; Write-Host '[SERVER] Starting production build...' -ForegroundColor Cyan; npm run start"
) -WindowStyle Normal

# Give the server a moment to bind before printing the summary
Start-Sleep -Seconds 2

# --- Summary -------------------------------------------------------------------
Write-Host ""
Write-Host "  DevBrain PRODUCTION environment started" -ForegroundColor Green
Write-Host "  -----------------------------------------" -ForegroundColor DarkGray
Write-Host "  App       http://localhost:3001  (Express serves built client + API)" -ForegroundColor White
Write-Host "  Postgres  localhost:5433" -ForegroundColor White
Write-Host "  Ollama    http://localhost:11434" -ForegroundColor White
Write-Host ""
Write-Host "  Tip: .\start-prod.ps1 -SkipBuild to restart without rebuilding." -ForegroundColor DarkGray
