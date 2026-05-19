# Feature Request: DevBrain Claude Integration V2

## Context
DevBrain already has a Claude Code integration under integrations/claude-code/ 
that writes TASKS.md and SESSION.md files into each project via hooks.
This feature request builds the DevBrain UI layer on top of that foundation.

## Feature 1: Claude Project Discovery

Scan the user's file system for Claude projects. A folder qualifies as a 
Claude project if it contains any of:
- CLAUDE.md
- sessions/ folder with at least one SESSION.md inside
- TASKS.md with our YAML frontmatter schema (project: field present)

Discovery should:
- Start from a user-configured root path (e.g. ~/projects or D:\dev)
- Be recursive up to 3 levels deep (don't scan the entire filesystem)
- Run on demand or on DevBrain startup, not continuously
- Return: project name, path, last session date, task completion %

## Feature 2: Project Curation

After discovery, user controls what appears in DevBrain:
- Pin: always show at the top
- Active: show in main list  
- Archived: discovered but hidden from main view
- Ignored: never surface again

Store curation state in a local DevBrain config file, not inside the 
project folder itself (we don't want to pollute the user's project).
Config location: ~/.devbrain/projects.json

Format:
{
  "projects": [
    {
      "path": "/Users/jagdeep/projects/playcru",
      "label": "PlayCru",          // optional display override
      "status": "active",          // pinned | active | archived | ignored
      "added_at": "2025-05-17T10:00:00Z",
      "added_by": "discovery"      // discovery | manual
    }
  ]
}

User can also manually add a project by pasting a folder path.

## Feature 3: Project Sharing

A project owner can export a share package. It should contain:
- TASKS.md (sanitised — no absolute paths)
- sessions/index.md
- The last N session summaries (user chooses N, default 5)
- A manifest.json with project name, owner handle, export date, DevBrain version

Export format: a single .devbrain-share file (zip with renamed extension).

Recipient imports it into their DevBrain. It appears as a read-only 
"shared project" — they can see tasks and sessions but cannot write back.

Future: optional sync via a shared URL (out of scope for V2).

## Feature 4: TASKS.md Sync

DevBrain should treat TASKS.md as the source of truth for task state.

Behaviour:
- On project open: read TASKS.md and render it in DevBrain
- Watch for file changes (fs.watch or polling fallback): reload on change
- Parse the YAML frontmatter for metadata (project, last_updated)
- Parse checkboxes: [ ] todo, [x] done, [~] in progress, [!] blocked
- Show completion % = done / total tasks
- Do NOT write back to TASKS.md from DevBrain UI in V2 — read only for now
  (avoid conflicts with Claude Code writing to it simultaneously)

## Feature 5: Session Viewer

Show session history per project as a timeline.

Data source: sessions/YYYY-MM-DD_HH-MM_<id>/SESSION.md files

Each session card should show:
- Date and time (parsed from folder name)
- Status badge: active | completed
- Goals section (first bullet points under ## Goals)
- Work Done count (number of bullet points under ## Work Done)
- Expandable: full SESSION.md content rendered as markdown

Timeline view:
- Most recent at top
- Group by week
- Filter by status
- Search across session content

## Feature 6: Blog Draft Mode (future, design now)

Do not implement this in V2. But design the data model so it's 
easy to add later.

A "blog post" is derived from one or more sessions:
- User selects sessions to include
- DevBrain sends session content to Claude API
- Claude drafts a blog post in the user's voice
- Draft appears in DevBrain for editing and export

The SESSION.md "Work Done" and "Decisions" sections are the 
primary source material for the blog.

For now: just make sure SESSION.md stores enough narrative detail 
that this is possible later. The current format already supports this.

## Technical Notes

- DevBrain stack: [FILL IN YOUR STACK HERE before giving this to Claude Code]
- File watching: use chokidar if Node-based, watchdog if Python
- projects.json should be created on first run if missing
- All file paths stored in projects.json should be absolute
- Discovery scan should be cancellable if it takes too long
- Test with: PlayCru project at [your actual path]