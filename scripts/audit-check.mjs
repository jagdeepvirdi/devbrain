#!/usr/bin/env node
// Runs `npm audit` in the current directory and fails only on high/critical
// findings whose GHSA advisory IDs are NOT in the accepted-risk allowlist
// passed as the first CLI argument (comma-separated). Lets known,
// currently-unfixable transitive vulnerabilities pass while still catching
// new ones.
//
// Usage: node audit-check.mjs GHSA-xxxx-xxxx-xxxx,GHSA-yyyy-yyyy-yyyy

import { execSync } from 'node:child_process'

const allow = new Set(
  (process.argv[2] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
)

function runAudit() {
  try {
    return execSync('npm audit --json', { maxBuffer: 1024 * 1024 * 20 }).toString()
  } catch (err) {
    // npm audit exits non-zero when vulnerabilities are found; stdout still holds the JSON
    if (err.stdout) return err.stdout.toString()
    console.error('npm audit failed to produce output')
    console.error(err.message)
    process.exit(1)
  }
}

const report = JSON.parse(runAudit())
const vulnerabilities = report.vulnerabilities || {}

// npm audit's `via` array mixes two kinds of entries: advisory objects (this package
// has its own advisory, identified by `url`) and plain strings (this package is only
// vulnerable because it depends on another vulnerable package by that name). A package
// is "covered" if every direct advisory it carries is allowlisted AND every package it
// transitively depends on for its vulnerability is itself covered.
function isCovered(pkg, visited = new Set()) {
  if (visited.has(pkg)) return true // cycle guard
  visited.add(pkg)

  const info = vulnerabilities[pkg]
  if (!info) return false

  const ownAdvisoryIds = (info.via || [])
    .filter((v) => typeof v === 'object' && v.url)
    .map((v) => v.url.split('/').pop())
  const viaPackages = (info.via || []).filter((v) => typeof v === 'string')

  if (ownAdvisoryIds.length === 0 && viaPackages.length === 0) return false
  if (!ownAdvisoryIds.every((id) => allow.has(id))) return false
  return viaPackages.every((viaPkg) => isCovered(viaPkg, visited))
}

const unaccepted = []
let acceptedCount = 0

for (const [pkg, info] of Object.entries(vulnerabilities)) {
  if (info.severity !== 'high' && info.severity !== 'critical') continue

  if (isCovered(pkg)) {
    acceptedCount++
  } else {
    const advisoryIds = (info.via || [])
      .filter((v) => typeof v === 'object' && v.url)
      .map((v) => v.url.split('/').pop())
    unaccepted.push({ pkg, severity: info.severity, advisoryIds })
  }
}

if (unaccepted.length > 0) {
  console.error(`Found ${unaccepted.length} high/critical vulnerabilities NOT in the accepted-risk allowlist:`)
  for (const u of unaccepted) {
    console.error(`  - ${u.pkg} (${u.severity}): ${u.advisoryIds.join(', ') || 'no advisory url found'}`)
  }
  console.error('\nFix them, or if this is a known-unfixable transitive dep, add its GHSA ID to the')
  console.error('allowlist in .github/workflows/security-audit.yml with a dated comment explaining why.')
  process.exit(1)
}

console.log(
  acceptedCount > 0
    ? `npm audit: ${acceptedCount} high/critical finding(s), all covered by the accepted-risk allowlist.`
    : 'npm audit: no high/critical findings.'
)
