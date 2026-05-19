---
name: devbrain
description: Update TASKS.md or write SESSION.md summary. Use when completing work, asked to summarize, or at session end.
---

## TASKS.md Format
Status markers: [ ] todo | [x] done | [~] in progress | [!] blocked
Always include YAML frontmatter with last_updated timestamp.
Phases group related items. Backlog holds unscheduled items.

When marking a task done, ALWAYS append a completion stamp on the same line:
  - [x] Task title <!-- done: YYYY-MM-DD -->
Replace YYYY-MM-DD with today's actual date. This stamp is required for the
7-day auto-archive sweep that keeps TASKS.md clean.

## SESSION.md Format
Frontmatter: session_id, project, started, status (active|completed)
Sections: Goals, Work Done, Decisions, Open Items
Keep each section to bullet points, max 5 per section.
Work Done entries: "- [filename or feature]: what changed and why"
