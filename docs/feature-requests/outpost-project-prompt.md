# Outpost — new project setup prompt

Standalone log/process watcher + error-alerting tool for the NT Billing project.
Investigated 2026-08-18 and deliberately kept OUT of DevBrain (see rationale in the
prompt below). Paste the prompt into the new `outpost` repo's setup/onboarding step.

## Project name

**Outpost** (short name: `outpost`) — runs on a remote host, watches things locally,
reports back to DevBrain as the hub. Alternatives considered: `Beacon`, `Watchtower`.

## Prompt

```
Build "Outpost" — a standalone log/process watcher and error-alerting tool for the
NT Billing project (Perl scripts + Oracle DB procedures, cron-scheduled batch jobs).

## Why this is a separate tool, not part of DevBrain

This was deliberately investigated and decided against building into DevBrain (a
private dev-knowledge-base app running Ollama on a single 6GB GPU, single-tenant,
explicitly "local machine only" / no ops-monitoring mandate in its own scope). Key
reasons, carry these as hard constraints:

1. NT Billing's actual batch execution likely happens on a different host than
   wherever DevBrain runs (DevBrain sees /var/log/syslog and cron-style paths in its
   NT Billing runbooks — Linux paths — while the git checkout lives on a Windows dev
   box). CONFIRM the real execution host before building anything, and design Outpost
   to run ON that host, next to the logs — not remotely polling them.
2. DevBrain has no real-time log-tailing infrastructure to lean on (its own
   "scheduler" is a daily poll loop, not a stream processor) — so build this from
   scratch, don't try to bolt it onto DevBrain's code.
3. Never forward raw log content into DevBrain. DevBrain auto-embeds everything it
   ingests (documents AND issue descriptions) into a semantically-searchable vector
   store with no redaction step. NT Billing logs plausibly contain customer/billing
   data. Outpost must only ever send short, already-sanitized summaries — never
   verbatim log lines, never raw stack traces with data in them.
4. No LLM/AI dependency for categorization. Use regex/keyword rules. DevBrain's GPU
   is a shared, single-instance resource — don't add a reason to contend for it, and
   don't require Ollama/any model to run Outpost.

## What Outpost does

- Tails multiple live-growing log files (config-driven list, not hardcoded) — handle
  log rotation correctly (reopen on inode change, don't lose lines).
- Supervises the NT Billing processes/cron jobs themselves, not just their logs:
  detect a job that should have run but didn't (missed cron fire), and detect a
  process that died mid-run vs. one that's still legitimately in progress.
- Categorizes each detected error by regex/keyword rules against a config file
  (e.g. ORA- codes, Perl `die` patterns, "DBI Error", exit codes) into a small set of
  severities (info/warning/error/critical) with a short human-readable category label
  — not just "found an error," but "what kind."
- Deduplicates/collapses repeated identical errors within a rolling time window
  before alerting — a burst of the same failure should produce one alert with a
  count, not N alerts. This is required client-side because DevBrain's notify
  endpoint is rate-limited (20 requests/minute) and does no batching itself.
- Reports alerts into DevBrain's EXISTING notification/issue surface — do not invent
  a new delivery mechanism, DevBrain already has one (see below).

## DevBrain integration contract (already exists, do not modify DevBrain)

Transient alerts (the common case):
  POST http://<devbrain-host>:3001/api/notify
  Body: { "project": "ntbilling", "title": string (<=200 chars),
          "body": string (<=5000 chars), "level": "info"|"success"|"warning"|"error" }
  - No auth required (this endpoint is intentionally public for tooling like this).
  - Rate-limited to 20 req/min per source IP — respect this with client-side
    dedup/batching, don't just retry into it.
  - No server-side retry exists — if the POST fails or times out, Outpost must retry
    with backoff itself.
  - DevBrain already fans this out to the user's configured delivery channels via
    Apprise (email today, Slack/Discord/generic webhooks later) — Outpost does NOT
    need to implement its own email/Slack/webhook sending. Configuring those channels
    is a DevBrain Settings task, not an Outpost feature. Don't build SMTP/webhook
    code into this tool.

Persistent/trackable incidents (worth a tracked record, not just a ping):
  POST http://<devbrain-host>:3001/api/issues
  Headers: Authorization: Bearer <dbrn_... personal access token>
  Body: { "project_id": "<ntbilling project id>", "title": string (<=300 chars),
          "description": string (<=10000 chars), "priority": "low"|"medium"|"high"|"critical" }
  - Requires a DevBrain personal access token (mint one under Settings > Account >
    API Tokens, role >= member) — store it as a secret, never in the repo.
  - Same rule: short sanitized summary in the description, never a raw log dump.

Resilience for when DevBrain itself is unreachable: don't silently drop alerts.
Implement a local dead-letter fallback (append to a local file/queue and retry later)
so an alert isn't lost just because the hub is down or the network hiccups.

## Tech / structure

- Python 3, stdlib + `requests` (or similarly minimal deps) — this runs on an ops
  box, keep the dependency footprint small and easy to install without a build chain.
- Config file (YAML/TOML) driving: which log files to watch, which processes/cron
  jobs to supervise and their expected schedule, categorization rules, DevBrain
  endpoint URL + credentials, dedup window, rate-limit-aware batching window.
- Long-running as a proper OS service — provide a systemd unit file (this is the
  actual production shape; it must survive reboots and auto-restart on crash,
  unlike DevBrain's own background job which has no such supervision).
- README covering: install, config format with example, how to mint/rotate the
  DevBrain API token, and what "sanitized summary" means in practice (a short
  checklist of what NOT to put in an alert body).

## Non-goals for v1

- No LLM-based classification.
- No new DevBrain server-side code or schema changes — build entirely against the
  existing /api/notify and /api/issues contract above.
- No custom email/Slack/Discord client code — DevBrain's Apprise channels handle
  delivery once alerts land in DevBrain.
- No web UI — this is a headless service; DevBrain's own UI is where alerts/issues
  get viewed.

Scaffold the repo, propose the config schema, and implement log tailing +
categorization + the DevBrain client (with retry/backoff and dead-letter fallback)
first — process supervision (missed-cron / dead-process detection) can be a
second pass once the log-tailing path is solid.
```

## Source investigation

Full topology/notify-surface/scheduler/scope/data-sensitivity/GPU-contention findings
that led to this decision live in the DevBrain conversation history (2026-08-18),
not duplicated here.
