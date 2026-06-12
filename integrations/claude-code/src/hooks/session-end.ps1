# =============================================================================
# DevBrain x Claude Code -- session-end.ps1
# Fires on SessionEnd hook. Runs on native Windows PowerShell.
#
# What it does:
#   1. Finds the active SESSION.md (most recent session folder)
#   2. Marks it as completed with an end timestamp
#   3. Appends a row to sessions/index.md
#   4. Updates last_updated in TASKS.md
#
# Note: SessionEnd cannot block termination. Keep this fast.
#       Heavy work runs in a background job so Claude exits immediately.
# =============================================================================

# -- Read hook JSON from stdin ------------------------------------------------
$inputRaw = @($input) -join "`n"

try {
    $hookData = $inputRaw | ConvertFrom-Json
    $cwd      = if ($hookData.cwd) { $hookData.cwd } else { (Get-Location).Path }
} catch {
    $cwd = (Get-Location).Path
}

# -- Capture values needed by the background job ------------------------------
$sessionsRoot = Join-Path $cwd "sessions"
$tasksFile    = Join-Path $cwd "TASKS.md"
$utcNow       = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$timestamp    = Get-Date -Format "yyyy-MM-dd_HH-mm"

# -- Run cleanup in a background job so hook exits fast -----------------------
$job = Start-Job -ScriptBlock {
    param($sessionsRoot, $tasksFile, $utcNow, $timestamp)

    # Find the most recent session folder (the active one)
    $activeSession = Get-ChildItem $sessionsRoot -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending |
        Select-Object -First 1

    if ($activeSession) {
        $sessionFile = Join-Path $activeSession.FullName "SESSION.md"

        if (Test-Path $sessionFile) {
            # Mark session as completed
            $content = Get-Content $sessionFile -Raw
            $content  = $content -replace "status: active", "status: completed"

            # Append end timestamp
            $content += "`n## Session Ended`nended: $utcNow`n"
            $content | Out-File -FilePath $sessionFile -Encoding UTF8 -NoNewline
        }

        # Append row to sessions/index.md
        $indexFile = Join-Path $sessionsRoot "index.md"
        if (Test-Path $indexFile) {
            $sessionName = $activeSession.Name
            "| $timestamp | $sessionName | completed |" |
                Out-File -FilePath $indexFile -Encoding UTF8 -Append
        }
    }

    # Update last_updated in TASKS.md
    if (Test-Path $tasksFile) {
        $tasks   = Get-Content $tasksFile -Raw
        $tasks   = $tasks -replace "last_updated:.*", "last_updated: $utcNow"
        $tasks | Out-File -FilePath $tasksFile -Encoding UTF8 -NoNewline
    }

    # -- Calculate session metrics and notify DevBrain --
    $projectName = Split-Path $cwd -Leaf
    $duration = "unknown"
    $filesCount = 0

    if ($activeSession) {
        $sessionFile = Join-Path $activeSession.FullName "SESSION.md"
        if (Test-Path $sessionFile) {
            $startedLine = Select-String -Path $sessionFile -Pattern "^started:\s*(.+)" | Select-Object -First 1
            if ($startedLine) {
                $startedStr = $startedLine.Matches.Groups[1].Value.Trim()
                try {
                    $startedTime = [DateTime]::Parse($startedStr)
                    $elapsed = (Get-Date) - $startedTime
                    $duration = [Math]::Max(1, [Math]::Round($elapsed.TotalMinutes))
                } catch {}
            }
        }

        try {
            $gitStatus = git status --porcelain 2>$null
            if ($gitStatus) {
                $filesCount = ($gitStatus | Measure-Object).Count
            }
        } catch {}
    }

    try {
        $body = @{
            project = $projectName
            title = "Session complete — $projectName"
            body = "Duration: ${duration}m, Files changed: $filesCount"
            level = "info"
        } | ConvertTo-Json

        Invoke-RestMethod -Uri "http://localhost:3001/api/notify" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 3 -ErrorAction SilentlyContinue | Out-Null
    } catch {}

} -ArgumentList $sessionsRoot, $tasksFile, $utcNow, $timestamp, $cwd


# Detach -- don't wait for the job, let Claude exit cleanly
# The job continues running in the background
$job | Out-Null

exit 0
