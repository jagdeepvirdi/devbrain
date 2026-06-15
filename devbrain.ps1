# devbrain.ps1 - Unified dev/prod start, stop, restart, and status for Windows
#
# Usage:
#   .\devbrain.ps1 dev   start              # hot-reload dev environment
#   .\devbrain.ps1 dev   stop               # stop dev servers and Postgres
#   .\devbrain.ps1 dev   restart            # stop then start dev
#   .\devbrain.ps1 dev   status             # show running status of all services
#   .\devbrain.ps1 prod  start              # build + start production
#   .\devbrain.ps1 prod  start -SkipBuild   # restart prod without rebuilding
#   .\devbrain.ps1 prod  stop               # stop prod server and Postgres
#   .\devbrain.ps1 prod  restart            # stop, build, then start prod
#   .\devbrain.ps1 prod  restart -SkipBuild # stop then restart without rebuilding
#   .\devbrain.ps1 prod  status             # show running status of all services

param(
    [Parameter(Position = 0, Mandatory)]
    [ValidateSet('dev', 'prod')]
    [string]$Mode,

    [Parameter(Position = 1, Mandatory)]
    [ValidateSet('start', 'stop', 'restart', 'status')]
    [string]$Action,

    [switch]$SkipBuild
)

$Root = $PSScriptRoot
$ErrorActionPreference = 'Stop'
$PidFile = "$Root\.devbrain-pids"

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function OK($msg)   { Write-Host "    [OK] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "    [!!] $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "    [!!] $msg" -ForegroundColor Red; exit 1 }

# ── Ollama ────────────────────────────────────────────────────────────────────
function Start-Ollama {
    Step "Checking Ollama on port 11434..."
    try {
        $null = Invoke-WebRequest -Uri "http://localhost:11434/api/tags" -UseBasicParsing -TimeoutSec 2
        OK "Ollama already running"; return
    } catch { }

    Write-Host "    Starting Ollama..." -ForegroundColor Yellow
    Start-Process "ollama" -ArgumentList "serve" -WindowStyle Hidden
    Start-Sleep -Seconds 4
    try {
        $null = Invoke-WebRequest -Uri "http://localhost:11434/api/tags" -UseBasicParsing -TimeoutSec 3
        OK "Ollama started"
    } catch {
        Fail "Ollama failed to start - is it installed?  Run: winget install Ollama.Ollama"
    }
}

# ── Postgres ──────────────────────────────────────────────────────────────────
function Start-Postgres {
    Step "Starting Postgres via Docker Compose..."
    Set-Location $Root
    docker compose up -d postgres
    if ($LASTEXITCODE -ne 0) { Fail "Docker Compose failed - is Docker Desktop running?" }

    Write-Host "    Waiting for Postgres healthcheck" -NoNewline
    $i = 0
    while ($true) {
        Start-Sleep -Seconds 2
        $id = docker compose ps -q postgres 2>$null
        if ($id) {
            $h = docker inspect --format "{{.State.Health.Status}}" $id 2>$null
            if ($h -eq "healthy") { Write-Host " ready!" -ForegroundColor Green; break }
        }
        Write-Host "." -NoNewline
        $i++
        if ($i -gt 25) { Fail "Postgres did not become healthy in time" }
    }
}

function Stop-Postgres {
    Step "Stopping Postgres..."
    Set-Location $Root
    docker compose stop postgres
    OK "Postgres stopped"
}

# ── Migrations ────────────────────────────────────────────────────────────────
function Run-Migrations {
    Step "Running database migrations..."
    Set-Location "$Root\server"
    node db/migrate-org-v2.mjs
    if ($LASTEXITCODE -ne 0) { Fail "Migration failed - check DB connection and schema" }
    OK "Migrations up to date"
}

# ── Env check (prod only) ─────────────────────────────────────────────────────
function Assert-ProdEnv {
    Step "Checking environment..."
    $envFile = "$Root\server\.env"
    if (-not (Test-Path $envFile)) { Fail "server/.env not found - copy .env.example and fill in values" }
    $env = Get-Content $envFile -Raw
    if ($env -match "JWT_SECRET\s*=\s*devbrain-dev-secret") {
        Warn "JWT_SECRET is still the dev default - change it before exposing to a network"
        Write-Host "    Generate: node -e `"console.log(require('crypto').randomBytes(32).toString('hex'))`"" -ForegroundColor DarkGray
    }
    if ($env -notmatch "AUTH_PASSWORD\s*=\s*.+") {
        Fail "AUTH_PASSWORD not set in server/.env`n    Add: AUTH_PASSWORD=your-strong-password"
    }
    OK "Environment checks passed"
}

# ── PID tracking ──────────────────────────────────────────────────────────────
function Save-Pids([int[]]$Pids) { $Pids | Set-Content $PidFile }

function Stop-Pids {
    if (-not (Test-Path $PidFile)) { Warn "No PID file found - nothing to stop"; return }
    foreach ($pid in (Get-Content $PidFile | Where-Object { $_ -match '^\d+$' })) {
        $null = taskkill /PID $pid /T /F 2>&1
        if ($LASTEXITCODE -eq 0) { OK "Killed process tree $pid" }
        else { Warn "Process $pid already gone" }
    }
    Remove-Item $PidFile -Force
}

# ── Build (prod only) ─────────────────────────────────────────────────────────
function Build-All {
    if ($SkipBuild) {
        Write-Host "`n    [SKIP] Build skipped (-SkipBuild)" -ForegroundColor Yellow
        if (-not (Test-Path "$Root\server\dist\index.js"))     { Fail "server/dist/index.js not found - run without -SkipBuild first" }
        if (-not (Test-Path "$Root\server\public\index.html")) { Fail "server/public/index.html not found - run without -SkipBuild first" }
        OK "Using existing build artifacts"; return
    }

    Step "Building server (tsc)..."
    Set-Location "$Root\server"; npm run build
    if ($LASTEXITCODE -ne 0) { Fail "Server build failed" }
    OK "Server compiled to server/dist"

    Step "Building client (vite build)..."
    Set-Location "$Root\client"; npm run build
    if ($LASTEXITCODE -ne 0) { Fail "Client build failed" }
    OK "Client built to client/dist"

    Step "Copying client build → server/public..."
    $pub = "$Root\server\public"
    if (Test-Path $pub) { Remove-Item $pub -Recurse -Force }
    Copy-Item "$Root\client\dist" $pub -Recurse
    OK "Client assets in server/public"
}

# ── Status ────────────────────────────────────────────────────────────────────
function Show-Status([bool]$IncludeClient = $false) {
    Step "DevBrain status..."

    # Ollama
    try {
        $null = Invoke-WebRequest -Uri "http://localhost:11434/api/tags" -UseBasicParsing -TimeoutSec 2
        OK "Ollama        running   http://localhost:11434"
    } catch {
        Warn "Ollama        NOT running"
    }

    # Postgres
    $id = docker compose ps -q postgres 2>$null
    if ($id) {
        $h = docker inspect --format "{{.State.Health.Status}}" $id 2>$null
        if ($h -eq "healthy") { OK "Postgres      healthy   localhost:5435" }
        else                   { Warn "Postgres      $h" }
    } else {
        Warn "Postgres      NOT running"
    }

    # Server
    $srv = Test-NetConnection -ComputerName localhost -Port 3001 -WarningAction SilentlyContinue -InformationLevel Quiet
    if ($srv) { OK "Server        running   http://localhost:3001" }
    else       { Warn "Server        NOT running" }

    # Vite client (dev only)
    if ($IncludeClient) {
        $cli = Test-NetConnection -ComputerName localhost -Port 5174 -WarningAction SilentlyContinue -InformationLevel Quiet
        if ($cli) { OK "Client        running   http://localhost:5174" }
        else       { Warn "Client        NOT running" }
    }

    # Tracked PIDs
    if (Test-Path $PidFile) {
        $pids = (Get-Content $PidFile | Where-Object { $_ -match '^\d+$' }) -join ', '
        Write-Host "`n    Tracked PIDs: $pids" -ForegroundColor DarkGray
    } else {
        Write-Host "`n    No PID file (servers may not be managed by this script)" -ForegroundColor DarkGray
    }
    Write-Host ""
}

# ── Restart ───────────────────────────────────────────────────────────────────
function Restart-Dev  { Stop-Dev;  Start-Dev }
function Restart-Prod { Stop-Prod; Start-Prod }

# ══════════════════════════════════════════════════════════════════════════════
# DEV
# ══════════════════════════════════════════════════════════════════════════════
function Start-Dev {
    Start-Ollama
    Start-Postgres

    $envFile = "$Root\server\.env"
    if ((Test-Path $envFile) -and ((Get-Content $envFile -Raw) -notmatch "AUTH_PASSWORD\s*=\s*.+")) {
        Warn "AUTH_PASSWORD not set - running without login gate (dev mode)"
    }

    Run-Migrations

    Step "Starting Express server (tsx watch on :3001)..."
    $srv = Start-Process powershell -ArgumentList "-NoExit", "-Command",
        "Set-Location '$Root\server'; Write-Host '[SERVER]' -ForegroundColor Cyan; npm run dev" `
        -WindowStyle Normal -PassThru

    Step "Starting Vite dev server (:5174)..."
    $cli = Start-Process powershell -ArgumentList "-NoExit", "-Command",
        "Set-Location '$Root\client'; Write-Host '[CLIENT]' -ForegroundColor Cyan; npm run dev" `
        -WindowStyle Normal -PassThru

    Save-Pids @($srv.Id, $cli.Id)

    Write-Host ""
    Write-Host "  DevBrain DEV started" -ForegroundColor Green
    Write-Host "  ─────────────────────────────────────────" -ForegroundColor DarkGray
    Write-Host "  Frontend  http://localhost:5174" -ForegroundColor White
    Write-Host "  Backend   http://localhost:3001" -ForegroundColor White
    Write-Host "  Postgres  localhost:5435" -ForegroundColor White
    Write-Host "  Ollama    http://localhost:11434" -ForegroundColor White
    Write-Host "  Stop:     .\devbrain.ps1 dev stop" -ForegroundColor DarkGray
    Write-Host ""
}

function Stop-Dev {
    Step "Stopping dev servers..."
    Stop-Pids
    Stop-Postgres
    Write-Host ""
    Write-Host "  DevBrain DEV stopped." -ForegroundColor Green
    Write-Host ""
}

# ══════════════════════════════════════════════════════════════════════════════
# PROD
# ══════════════════════════════════════════════════════════════════════════════
function Start-Prod {
    Assert-ProdEnv
    Start-Ollama
    Build-All
    Start-Postgres
    Run-Migrations

    Step "Starting Express server (node dist/index.js on :3001)..."
    $srv = Start-Process powershell -ArgumentList "-NoExit", "-Command",
        "Set-Location '$Root\server'; Write-Host '[SERVER]' -ForegroundColor Cyan; npm run start" `
        -WindowStyle Normal -PassThru

    Start-Sleep -Seconds 2
    Save-Pids @($srv.Id)

    Write-Host ""
    Write-Host "  DevBrain PROD started" -ForegroundColor Green
    Write-Host "  ─────────────────────────────────────────" -ForegroundColor DarkGray
    Write-Host "  App       http://localhost:3001  (API + static client)" -ForegroundColor White
    Write-Host "  Postgres  localhost:5435" -ForegroundColor White
    Write-Host "  Ollama    http://localhost:11434" -ForegroundColor White
    Write-Host "  Stop:     .\devbrain.ps1 prod stop" -ForegroundColor DarkGray
    Write-Host "  Tip:      .\devbrain.ps1 prod start -SkipBuild  (restart without rebuilding)" -ForegroundColor DarkGray
    Write-Host ""
}

function Stop-Prod {
    Step "Stopping production server..."
    Stop-Pids
    Stop-Postgres
    Write-Host ""
    Write-Host "  DevBrain PROD stopped." -ForegroundColor Green
    Write-Host ""
}

# ── Dispatch ──────────────────────────────────────────────────────────────────
switch ("$Mode/$Action") {
    "dev/start"    { Start-Dev }
    "dev/stop"     { Stop-Dev }
    "dev/restart"  { Restart-Dev }
    "dev/status"   { Show-Status $true }
    "prod/start"   { Start-Prod }
    "prod/stop"    { Stop-Prod }
    "prod/restart" { Restart-Prod }
    "prod/status"  { Show-Status $false }
}
