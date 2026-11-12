---
session_id: b0f7e772
project: devbrain
started: 2026-11-12T13:46:19Z
status: active
---

# Session: 2026-11-12_20-46

## Goals
- Resume from the last session and work through the P0 tier in TASKS.md (Phase 46 Step 1 hardening)
- Gather the P1 inputs so Phase 46 Steps 2-4 can start

## Work Done
- POST /api/notify now requires auth (requireAuth); session-end hooks (Claude Code + Antigravity, .ps1/.sh) send DEVBRAIN_API_TOKEN as a Bearer token
- Closed the shell injection in routes/git.ts: execFile helper, ref allowlist (no leading '-'), clamped limit; injection regression tests added
- POST /api/issues dedupe via optional external_ref + unique partial index (schema.sql); notify_auth.test.ts runs the real requireAuth chain (mutation-checked); coverage gate green
- Scanned for local repos and recorded P1 answers (paths, draft categories + blocklist, schedule) in TASKS.md

## Decisions
- /api/notify requires auth for all callers, no loopback exemption (remoteAddress is spoofable behind a proxy)
- Dedupe uses a new external_ref column, kept separate from the sync-managed external_id; calls without a ref are unchanged
- ActivityWatch via local REST API; browsing import as a nightly Task Scheduler job reading a temp copy of History

## Open Items
- Rotate the admin password (owner action) - the only P0 item left
- Set DEVBRAIN_API_TOKEN and re-run both install.ps1 scripts, or session-end notifications get a 401; re-apply schema.sql before any caller sends external_ref
- Install ActivityWatch (winget was blocked) and link devbrain/quantcru/playcru in Projects -> Link folder; review the draft categories and blocklist
- Check the live DB for a unique index on issues.external_id (integrations ON CONFLICT may fail without one)
- Everything after adadf24 is local only - not pushed yet (user chose to wait); push and check CI next session
