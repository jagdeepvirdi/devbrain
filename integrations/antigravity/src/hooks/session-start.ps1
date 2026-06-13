# =============================================================================
# DevBrain x Antigravity -- session-start.ps1
# Fires on SessionStart hook. Runs on native Windows PowerShell.
#
# What it does:
#   1. Scaffolds TASKS.md if the project doesn't have one yet
#   2. Archives [x] tasks stamped <!-- done: YYYY-MM-DD --> older than 7 days
#      into TASKS_ARCHIVE.md, keeping TASKS.md clean
#   3. Creates a timestamped session folder + SESSION.md
#   4. Prints per-phase task progress + last-session summary to stdout
#      (Antigravity reads this context at session start)
# =============================================================================

# -- Read hook JSON from stdin ------------------------------------------------
$inputRaw = @($input) -join "`n"

try {
    $hookData  = $inputRaw | ConvertFrom-Json
    $sessionId = if ($hookData.session_id) { $hookData.session_id } else { "unknown" }
    $cwd       = if ($hookData.cwd)        { $hookData.cwd }        else { (Get-Location).Path }
} catch {
    $sessionId = "unknown"
    $cwd       = (Get-Location).Path
}

# -- Derived values -----------------------------------------------------------
$projectName = Split-Path $cwd -Leaf
$timestamp   = Get-Date -Format "yyyy-MM-dd_HH-mm"
$utcNow      = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$today       = Get-Date -Format "yyyy-MM-dd"
$shortId     = $sessionId.Substring(0, [Math]::Min(8, $sessionId.Length))

$sessionsRoot = Join-Path $cwd "sessions"
$sessionDir  = Join-Path $sessionsRoot "${timestamp}_${shortId}"
$sessionFile = Join-Path $sessionDir "SESSION.md"
$tasksFile   = Join-Path $cwd "TASKS.md"
$archiveFile = Join-Path $cwd "TASKS_ARCHIVE.md"
$indexFile   = Join-Path $sessionsRoot "index.md"

# =============================================================================
# Helper: days elapsed since a YYYY-MM-DD date string
# =============================================================================
function Get-DaysSince ([string]$dateStr) {
    try {
        $d = [datetime]::ParseExact($dateStr, 'yyyy-MM-dd', $null)
        return ([datetime]::Today - $d).Days
    } catch {
        return -1
    }
}

# =============================================================================
# Helper: parse TASKS.md into a list of phase objects {Name, Total, Done}
# Skips YAML frontmatter. Counts all - [ ] / [x] / [~] / [!] items per phase.
# =============================================================================
function Get-TaskPhases ([string]$filePath) {
    $phases = [System.Collections.Generic.List[hashtable]]::new()
    $current = $null
    $fmCount = 0  # counts --- delimiters to skip frontmatter
 
    foreach ($line in (Get-Content $filePath -Encoding UTF8)) {
        if ($line -eq '---') { $fmCount++; continue }
        if ($fmCount -lt 2)  { continue }        # inside frontmatter

        if ($line -match '^## (.+)') {
            if ($current) { $phases.Add($current) }
            $current = @{ Name = $Matches[1].Trim(); Total = 0; Done = 0 }
        } elseif ($current -and $line -match '^- \[') {
            $current.Total++
            if ($line -match '^- \[x\]') { $current.Done++ }
        }
    }
    if ($current) { $phases.Add($current) }
    return $phases
}

# =============================================================================
# Helper: archive completed tasks older than $thresholdDays into TASKS_ARCHIVE.md
#
# A task is eligible if it matches: - [x] ... <!-- done: YYYY-MM-DD -->
# Eligible tasks are removed from TASKS.md and appended to TASKS_ARCHIVE.md
# grouped by their original phase heading. Frontmatter in both files is
# preserved; only last_updated is refreshed.
# =============================================================================
function Invoke-TasksArchive ([string]$tasksFile, [string]$archiveFile, [int]$thresholdDays = 7) {
    $lines = Get-Content $tasksFile -Encoding UTF8
    $keepLines    = [System.Collections.Generic.List[string]]::new()
    $archiveMap   = [System.Collections.Generic.Dictionary[string, System.Collections.Generic.List[string]]]::new()
    $currentPhase = '(General)'
    $archivedAny  = $false
    $fmCount      = 0

    foreach ($line in $lines) {
        # Pass frontmatter through unchanged
        if ($line -eq '---') {
            $fmCount++
            $keepLines.Add($line)
            continue
        }
        if ($fmCount -lt 2) {
            $keepLines.Add($line)
            continue
        }

        # Track current phase for grouping archived items
        if ($line -match '^## (.+)') {
            $currentPhase = $Matches[1].Trim()
            $keepLines.Add($line)
            continue
        }

        # Eligible for archive: [x] with <!-- done: YYYY-MM-DD --> older than threshold
        if ($line -match '^- \[x\].*<!--\s*done:\s*(\d{4}-\d{2}-\d{2})\s*-->') {
            $age = Get-DaysSince $Matches[1]
            if ($age -ge $thresholdDays) {
                if (-not $archiveMap.ContainsKey($currentPhase)) {
                    $archiveMap[$currentPhase] = [System.Collections.Generic.List[string]]::new()
                }
                $archiveMap[$currentPhase].Add($line)
                $archivedAny = $true
                continue
            }
        }

        $keepLines.Add($line)
    }

    if (-not $archivedAny) { return }

    # Write cleaned TASKS.md — refresh last_updated in frontmatter
    $cleaned = ($keepLines | ForEach-Object {
        if ($_ -match '^last_updated:') { "last_updated: $today" } else { $_ }
    }) -join "`n"
    $cleaned | Out-File $tasksFile -Encoding UTF8 -NoNewline

    # Build the block to append to TASKS_ARCHIVE.md
    $appendLines = [System.Collections.Generic.List[string]]::new()
    foreach ($phase in $archiveMap.Keys) {
        $appendLines.Add("")
        $appendLines.Add("## $phase")
        $appendLines.Add("<!-- archived_on: $today -->")
        foreach ($item in $archiveMap[$phase]) { $appendLines.Add($item) }
    }
    $appendBlock = ($appendLines -join "`n") + "`n"

    if (-not (Test-Path $archiveFile)) {
        # Bootstrap archive file with frontmatter
        $header = "---`nproject: $projectName`nlast_updated: $today`n---`n`n# Archived Tasks`n"
        ($header + $appendBlock) | Out-File $archiveFile -Encoding UTF8 -NoNewline
    } else {
        # Refresh last_updated in existing archive, then append
        $existing = Get-Content $archiveFile -Raw -Encoding UTF8
        $existing = $existing -replace '(?m)^last_updated:.*$', "last_updated: $today"
        $existing | Out-File $archiveFile -Encoding UTF8 -NoNewline
        $appendBlock | Out-File $archiveFile -Encoding UTF8 -Append
    }
}

# =============================================================================
# 1. Scaffold TASKS.md if missing
# =============================================================================
if (-not (Test-Path $tasksFile)) {
    @"
---
project: $projectName
created: $utcNow
last_updated: $utcNow
---

# TASKS

## Phase 1: Setup
- [ ] Define initial goals

## Backlog
- [ ] Add tasks here
"@ | Out-File -FilePath $tasksFile -Encoding UTF8
}

# =============================================================================
# 2. Archive stale completed tasks
# =============================================================================
if (Test-Path $tasksFile) {
    Invoke-TasksArchive $tasksFile $archiveFile
}

# =============================================================================
# 3. Create session folder + SESSION.md
# =============================================================================
New-Item -ItemType Directory -Force -Path $sessionDir | Out-Null

@"
---
session_id: $shortId
project: $projectName
started: $utcNow
status: active
---

# Session: $timestamp

## Goals
# -- Antigravity will fill this in based on your first prompt --

## Work Done
<!-- Updated during session -->

## Decisions
<!-- Key choices made -->

## Open Items
<!-- What remains -->
"@ | Out-File -FilePath $sessionFile -Encoding UTF8

# =============================================================================
# 4. Scaffold sessions/index.md if missing
# =============================================================================
if (-not (Test-Path $indexFile)) {
    @"
# Sessions Index -- $projectName

| Date-Time | Session ID | Status |
|-----------|------------|--------|
"@ | Out-File -FilePath $indexFile -Encoding UTF8
}

# =============================================================================
# 5. Print context to stdout (Antigravity reads this at session start)
# =============================================================================
Write-Output "## DevBrain Session Started"
Write-Output "Session  : $timestamp"
Write-Output "Project  : $projectName"
Write-Output "Location : $cwd"
Write-Output ""

Write-Output "### Task Progress"
if (Test-Path $tasksFile) {
    $phases = Get-TaskPhases $tasksFile
    if ($phases.Count -gt 0) {
        $totalDone  = ($phases | Measure-Object -Property Done  -Sum).Sum
        $totalItems = ($phases | Measure-Object -Property Total -Sum).Sum
        $overallPct = if ($totalItems -gt 0) { [Math]::Round($totalDone / $totalItems * 100) } else { 0 }
        Write-Output "Overall: $totalDone/$totalItems tasks done ($overallPct%)"
        Write-Output ""
        foreach ($p in $phases) {
            $pct    = if ($p.Total -gt 0) { [Math]::Round($p.Done / $p.Total * 100) } else { 0 }
            $status = if ($pct -eq 100) { "[DONE]" } elseif ($p.Total -eq 0) { "[----]" } else { "[$pct%] " }
            Write-Output "  $status $($p.Name)  ($($p.Done)/$($p.Total))"
        }
    } else {
        Write-Output "(TASKS.md found but no phases detected)"
    }
} else {
    Write-Output "(No TASKS.md)"
}

Write-Output ""
Write-Output "### Last Session"

$previousSession = Get-ChildItem $sessionsRoot -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending |
    Where-Object { $_.Name -ne "${timestamp}_${shortId}" } |
    Select-Object -First 1

if ($previousSession) {
    $prevFile = Join-Path $previousSession.FullName "SESSION.md"
    if (Test-Path $prevFile) {
        Get-Content $prevFile | Select-Object -First 25 | ForEach-Object { Write-Output $_ }
    }
} else {
    Write-Output "(No previous sessions -- this is the first session for this project)"
}

exit 0
