# DevBrain × Claude Code Integration

Automatically generate and maintain `TASKS.md` and `SESSION.md` files across all your Claude Code projects — so every session is logged, every task tracked, and your DevBrain always knows where you left off.

## What This Does

Every time you start a Claude Code session in any project:

- **Scaffolds `TASKS.md`** if one doesn't exist yet
- **Creates a timestamped session folder** under `sessions/YYYY-MM-DD_HH-MM_<id>/`
- **Injects your current task state** into Claude's context automatically
- **Logs the session summary** when you exit

Your project folder ends up looking like this:

```
my-project/
├── TASKS.md
└── sessions/
    ├── index.md
    ├── 2025-05-17_10-30_a1b2c3d4/
    │   └── SESSION.md
    └── 2025-05-18_09-15_e5f6g7h8/
        └── SESSION.md
```

DevBrain reads these files to give you a visual timeline of everything you've worked on, across all projects.

---

## Prerequisites

| Requirement | Check |
|---|---|
| [Claude Code](https://claude.ai/code) installed | `claude --version` |
| `python3` available | `python3 --version` |
| `jq` for safe settings merge (optional but recommended) | `jq --version` |

**macOS:** `brew install jq`  
**Ubuntu/Debian:** `sudo apt install jq`  
**Windows:** See [Windows Setup](#windows-setup) below.

---

## Install

From the root of your DevBrain repo:

```bash
cd integrations/claude-code
chmod +x install.sh
./install.sh
```

That's it. Open any project in Claude Code and the hooks fire automatically.

### What install.sh does

1. Copies `src/hooks/` scripts to `~/.claude/scripts/`
2. Makes them executable
3. Copies `src/skills/devbrain/` to `~/.claude/skills/devbrain/`
4. Merges the hooks block into `~/.claude/settings.json` (backs up your existing file first)

Nothing is overwritten without a backup. If `jq` is not found, it prints the JSON to merge manually.

---

## Uninstall

```bash
cd integrations/claude-code
./install.sh --uninstall
```

Removes the scripts and skills. Restores your `settings.json` backup if one exists.

---

## Windows Setup

Three options — native PowerShell is the simplest:

**Option A — Native PowerShell (recommended):**

```powershell
powershell -ExecutionPolicy Bypass -File integrations\claude-code\install.ps1
```

Installs `.ps1` hook scripts to `~\.claude\scripts\` and registers them in `~\.claude\settings.json`. No WSL or Git Bash required.

**Option B — WSL:**  
Run Claude Code inside WSL. The bash scripts work identically. Use `./install.sh`.

**Option C — Git Bash:**  
Install [Git for Windows](https://git-scm.com/download/win). Run `./install.sh`, or edit `~/.claude/settings.json` manually using the block in `src/config/settings.reference.json`, pointing commands to Git Bash:

```json
"command": "C:\\Program Files\\Git\\bin\\bash.exe ~/.claude/scripts/session-start.sh"
```

---

## File Formats

### TASKS.md

```markdown
---
project: my-project
created: 2025-05-17T10:30:00Z
last_updated: 2025-05-17T10:30:00Z
---

# TASKS

## Phase 1: Setup
- [x] Initialize project
- [ ] Configure auth

## Backlog
- [ ] Add dark mode
```

Status markers: `[ ]` todo · `[x]` done · `[~]` in progress · `[!]` blocked

### SESSION.md

```markdown
---
session_id: a1b2c3d4
project: my-project
started: 2025-05-17T10:30:00Z
status: completed
---

# Session: 2025-05-17_10-30

## Goals
- Fix Google Sign-In on Android

## Work Done
- Updated auth handler to use Credential Manager v2
- Fixed session persistence bug in firebase_options.dart

## Decisions
- Targeting Android API 28+ only for Credential Manager

## Open Items
- Apple Sign-In still pending
```

---

## Using the DevBrain Skill

Once installed, you can trigger a manual summary at any point in a session:

```
/devbrain
```

Claude will update `TASKS.md` checkboxes based on what was completed and append a summary to the active `SESSION.md`.

You can also just say naturally:
- *"Update tasks"*
- *"Write session summary"*
- *"Mark the auth task as done"*

Claude auto-detects these via the skill description.

---

## Connecting to DevBrain Viewer

In DevBrain, point the project scanner at your projects root folder. It looks for:

- Any subfolder containing `TASKS.md` → recognized as a tracked project
- `sessions/index.md` → session timeline
- `sessions/*/SESSION.md` → individual session detail

No additional config needed. The YAML frontmatter in each file carries all the metadata DevBrain needs.

---

## Contributing

This integration is part of [DevBrain](../../README.md). To contribute:

1. Fork the repo
2. Make changes under `integrations/claude-code/`
3. Test by running `./install.sh` and starting a Claude Code session
4. Open a PR with a short description of what changed and why

Bug reports and feature requests go in the main DevBrain issue tracker with the label `claude-integration`.

---

## How It Works (for the curious)

Claude Code exposes lifecycle hooks — shell scripts that fire at defined points in the session. This integration uses two:

- **`SessionStart`** — fires when Claude Code opens. The script's stdout is injected directly into Claude's context window, so Claude immediately knows your current tasks and last session summary without you saying anything.
- **`SessionEnd`** — fires when you exit. Writes the completed timestamp and updates the sessions index.

The hooks are registered globally in `~/.claude/settings.json`, so they apply to every project automatically — no per-project setup needed.

See [`src/hooks/`](src/hooks/) for the full script source.
