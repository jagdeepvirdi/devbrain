# DevBrain - Dev startup script
# Starts: Ollama (native) + Postgres (Docker) + Express server (tsx watch) + Vite dev server

$Root = $PSScriptRoot
$ErrorActionPreference = "Stop"

function Write-Step($msg)  { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-OK($msg)    { Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "    [!!] $msg" -ForegroundColor Yellow }
function Write-Fail($msg)  { Write-Host "    [!!] $msg" -ForegroundColor Red; exit 1 }

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

# --- 2. Postgres (Docker Compose - postgres service only) ----------------------
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

# --- 3. Database migrations (idempotent - safe to run every time) --------------
Write-Step "Running database migrations..."
Set-Location "$Root\server"
node db/migrate-org-v2.mjs
if ($LASTEXITCODE -ne 0) { Write-Fail "migrate-org-v2.mjs failed - check DB connection and schema" }
Write-OK "Migrations up to date"

# --- 4. Dev auth notice --------------------------------------------------------
$envFile = "$Root\server\.env"
if (Test-Path $envFile) {
    $envContent = Get-Content $envFile -Raw
    if ($envContent -notmatch "AUTH_PASSWORD\s*=\s*.+") {
        Write-Warn "AUTH_PASSWORD not set in server/.env - running in dev mode (no login required)"
        Write-Host "    To enable login: add AUTH_PASSWORD=yourpassword to server/.env" -ForegroundColor DarkGray
    }
}

# --- 5. Express server - tsx watch ---------------------------------------------
Write-Step "Starting Express server (tsx watch on :3001)..."
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$Root\server'; Write-Host '[SERVER] Starting...' -ForegroundColor Cyan; npm run dev"
) -WindowStyle Normal

# --- 6. Vite dev server --------------------------------------------------------
Write-Step "Starting Vite dev server (:5173)..."
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$Root\client'; Write-Host '[CLIENT] Starting...' -ForegroundColor Cyan; npm run dev"
) -WindowStyle Normal

# --- Summary -------------------------------------------------------------------
Write-Host ""
Write-Host "  DevBrain DEV environment started" -ForegroundColor Green
Write-Host "  -------------------------------------" -ForegroundColor DarkGray
Write-Host "  Frontend  http://localhost:5173" -ForegroundColor White
Write-Host "  Backend   http://localhost:3001" -ForegroundColor White
Write-Host "  Postgres  localhost:5433" -ForegroundColor White
Write-Host "  Ollama    http://localhost:11434" -ForegroundColor White
Write-Host ""
Write-Host "  Server and client are running in separate windows." -ForegroundColor DarkGray
Write-Host "  Close those windows (or Ctrl+C inside them) to stop." -ForegroundColor DarkGray
