# validate.ps1 — run typecheck + tests for server and client
# Usage: powershell -ExecutionPolicy Bypass -File scripts\validate.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

function Step($label, $cmd, $dir) {
    Write-Host "`n>> $label" -ForegroundColor Cyan
    Push-Location (Join-Path $root $dir)
    try { Invoke-Expression $cmd }
    catch { Write-Host "FAILED: $label" -ForegroundColor Red; exit 1 }
    finally { Pop-Location }
}

Step "Server: typecheck"    "npm run typecheck" "server"
Step "Server: lint"         "npm run lint"      "server"
Step "Server: tests"        "npm test"          "server"
Step "Client: typecheck"    "npm run typecheck" "client"
Step "Client: lint"         "npm run lint"      "client"

Write-Host "`nAll checks passed." -ForegroundColor Green
