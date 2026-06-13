# =============================================================================
# DevBrain x Antigravity -- install.ps1
# Native Windows PowerShell installer
# Run with: powershell -ExecutionPolicy Bypass -File install.ps1
# =============================================================================

param(
    [switch]$Uninstall
)

# -- Colours ------------------------------------------------------------------
function Write-Ok   ($msg) { Write-Host "[OK]   $msg" -ForegroundColor Green }
function Write-Info ($msg) { Write-Host "[-->]  $msg" -ForegroundColor Cyan }
function Write-Warn ($msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Write-Err  ($msg) { Write-Host "[ERR]  $msg" -ForegroundColor Red }
function Write-Header ($msg) { Write-Host "`n--- $msg ---" -ForegroundColor White }

# -- Paths --------------------------------------------------------------------
$ScriptDir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$SrcHooks     = Join-Path $ScriptDir "src\hooks"
$SrcSkills    = Join-Path $ScriptDir "src\skills\devbrain"
$SrcConfig    = Join-Path $ScriptDir "src\config\hooks.reference.json"

# Antigravity/Gemini CLI reads config from ~\.gemini\config
$GeminiConfigDir = Join-Path $env:USERPROFILE ".gemini\config"
$DestScripts  = Join-Path $GeminiConfigDir "scripts"
$DestSkills   = Join-Path $GeminiConfigDir "skills\devbrain"
$SettingsFile = Join-Path $GeminiConfigDir "hooks.json"
$SettingsBak  = Join-Path $GeminiConfigDir "hooks.json.devbrain-backup"

# Absolute paths written into hooks.json -- what Antigravity resolves
$HookStartCmd = Join-Path $DestScripts "session-start.ps1"
$HookEndCmd   = Join-Path $DestScripts "session-end.ps1"

# -- Uninstall ----------------------------------------------------------------
if ($Uninstall) {
    Write-Header "DevBrain x Antigravity -- Uninstall"

    $startScript = Join-Path $DestScripts "session-start.ps1"
    $endScript   = Join-Path $DestScripts "session-end.ps1"

    if (Test-Path $startScript) {
        Remove-Item $startScript, $endScript -ErrorAction SilentlyContinue
        Write-Ok "Removed hook scripts from $DestScripts"
    }

    if (Test-Path $DestSkills) {
        Remove-Item $DestSkills -Recurse -Force
        Write-Ok "Removed devbrain skill"
    }

    if (Test-Path $SettingsBak) {
        Copy-Item $SettingsBak $SettingsFile -Force
        Write-Ok "Restored hooks.json from backup"
    } else {
        Write-Warn "No backup found. Remove the SessionStart and SessionEnd blocks"
        Write-Warn "from $SettingsFile manually."
    }

    Write-Host "`nUninstall complete." -ForegroundColor Green
    exit 0
}

# -- Header -------------------------------------------------------------------
Write-Host ""
Write-Host "DevBrain x Antigravity -- Installer (Windows)" -ForegroundColor White
Write-Host "==============================================="
Write-Host ""
Write-Info "Gemini config dir : $GeminiConfigDir"
Write-Info "Hook script path  : $HookStartCmd"

# -- Preflight ----------------------------------------------------------------
Write-Header "Checking prerequisites"

# Antigravity / Gemini CLI
try {
    $geminiVer = & gemini --version 2>$null
    Write-Ok "Gemini/Antigravity CLI found: $geminiVer"
} catch {
    Write-Err "Gemini/Antigravity CLI not found. Make sure gemini is installed"
    exit 1
}

# PowerShell version (need 5.1+ for ConvertTo-Json depth)
if ($PSVersionTable.PSVersion.Major -lt 5) {
    Write-Err "PowerShell 5.1 or higher required. Current: $($PSVersionTable.PSVersion)"
    exit 1
}
Write-Ok "PowerShell $($PSVersionTable.PSVersion) found"

# Source hooks directory
if (-not (Test-Path $SrcHooks)) {
    Write-Err "src\hooks\ not found. Run this script from integrations\antigravity\"
    exit 1
}
Write-Ok "Source files found"

# -- Create directories -------------------------------------------------------
Write-Header "Setting up directories"

New-Item -ItemType Directory -Force -Path $DestScripts | Out-Null
New-Item -ItemType Directory -Force -Path $DestSkills  | Out-Null
Write-Ok "$GeminiConfigDir\scripts\ ready"
Write-Ok "$GeminiConfigDir\skills\devbrain\ ready"

# -- Copy hook scripts ---------------------------------------------------------
Write-Header "Installing hook scripts"

# On Windows, hooks run as PowerShell scripts (.ps1)
Copy-Item (Join-Path $SrcHooks "session-start.ps1") $DestScripts -Force
Copy-Item (Join-Path $SrcHooks "session-end.ps1")   $DestScripts -Force
Write-Ok "session-start.ps1 installed"
Write-Ok "session-end.ps1   installed"

# -- Copy skill ---------------------------------------------------------------
Write-Header "Installing DevBrain skill"

Copy-Item "$SrcSkills\*" $DestSkills -Recurse -Force
Write-Ok "devbrain SKILL.md installed"

# -- Merge hooks.json ---------------------------------------------------------
Write-Header "Merging hooks.json"

$hooksBlock = @{
    SessionStart = @(
        @{
            matcher = ""
            hooks   = @(
                @{
                    type    = "command"
                    command = $HookStartCmd
                    timeout = 30
                }
            )
        }
    )
    SessionEnd = @(
        @{
            matcher = ""
            hooks   = @(
                @{
                    type    = "command"
                    command = $HookEndCmd
                    timeout = 60
                }
            )
        }
    )
}

if (Test-Path $SettingsFile) {
    # Back up before touching
    Copy-Item $SettingsFile $SettingsBak -Force
    Write-Ok "Backed up existing hooks.json -> hooks.json.devbrain-backup"

    $existing = Get-Content $SettingsFile -Raw | ConvertFrom-Json

    # Check for existing DevBrain hooks (idempotent)
    if ($existing.SessionStart) {
        Write-Warn "SessionStart hook already exists in hooks.json -- skipping merge."
        Write-Warn "To re-install cleanly: .\install.ps1 -Uninstall then .\install.ps1"
    } else {
        # Merge: add our hooks into existing object
        $existing | Add-Member -MemberType NoteProperty -Name "SessionStart" -Value $hooksBlock.SessionStart
        $existing | Add-Member -MemberType NoteProperty -Name "SessionEnd"   -Value $hooksBlock.SessionEnd

        $existing | ConvertTo-Json -Depth 10 | Out-File $SettingsFile -Encoding UTF8
        Write-Ok "DevBrain hooks merged into hooks.json"
        Write-Info "Existing hooks were preserved"
    }
} else {
    # No settings file yet -- create fresh
    $hooksBlock | ConvertTo-Json -Depth 10 | Out-File $SettingsFile -Encoding UTF8
    Write-Ok "Created hooks.json with DevBrain hooks"
}

# -- Verify -------------------------------------------------------------------
Write-Header "Verification"

$pass = $true

if (Test-Path (Join-Path $DestScripts "session-start.ps1")) {
    Write-Ok "session-start.ps1 present"
} else {
    Write-Err "session-start.ps1 missing from $DestScripts"
    $pass = $false
}

if (Test-Path (Join-Path $DestScripts "session-end.ps1")) {
    Write-Ok "session-end.ps1 present"
} else {
    Write-Err "session-end.ps1 missing from $DestScripts"
    $pass = $false
}

if (Test-Path (Join-Path $DestSkills "SKILL.md")) {
    Write-Ok "devbrain SKILL.md present"
} else {
    Write-Err "SKILL.md missing from $DestSkills"
    $pass = $false
}

if (Test-Path $SettingsFile) {
    $check = Get-Content $SettingsFile -Raw | ConvertFrom-Json
    if ($check.SessionStart) {
        Write-Ok "SessionStart hook registered in hooks.json"
    } else {
        Write-Err "SessionStart not found in hooks.json"
        $pass = $false
    }
}

# -- Done ---------------------------------------------------------------------
Write-Host ""
if ($pass) {
    Write-Host "Installation complete." -ForegroundColor Green
    Write-Host ""
    Write-Host "  Open any project in Gemini/Antigravity CLI to activate tracking:"
    Write-Host "    cd your-project && gemini"
    Write-Host ""
    Write-Host "  First session will create:"
    Write-Host "    your-project\TASKS.md"
    Write-Host "    your-project\sessions\YYYY-MM-DD_HH-MM_<id>\SESSION.md"
    Write-Host ""
    Write-Host "  To uninstall:"
    Write-Host "    .\install.ps1 -Uninstall"
    Write-Host ""
} else {
    Write-Host "Installation finished with errors. Review output above." -ForegroundColor Red
    exit 1
}
