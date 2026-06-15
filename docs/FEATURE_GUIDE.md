# DevBrain — Feature Guide

A complete walkthrough of every feature in DevBrain, with step-by-step instructions for testing each one. Written for first-time users.

---

## Table of Contents

1. [Getting Started & Login](#1-getting-started--login)
2. [Projects](#2-projects)
3. [Dashboard](#3-dashboard)
4. [Documents](#4-documents)
5. [Document Q&A (Ask AI / RAG)](#5-document-qa-ask-ai--rag)
6. [Issues](#6-issues)
7. [Commands Library](#7-commands-library)
8. [Releases](#8-releases)
9. [Runbooks](#9-runbooks)
10. [Tasks Board](#10-tasks-board)
11. [AI Task Runner](#11-ai-task-runner)
12. [Global Search (⌘K)](#12-global-search-k)
13. [Notifications](#13-notifications)
14. [Bulk Operations](#14-bulk-operations)
15. [Templates](#15-templates)
16. [Git Integration](#16-git-integration)
17. [External Issue Sync (GitHub / Linear / Jira)](#17-external-issue-sync-github--linear--jira)
18. [Multi-user & RBAC](#18-multi-user--rbac)
19. [Audit Log](#19-audit-log)
20. [Settings & Backup](#20-settings--backup)
21. [Claude Code Integration](#21-claude-code-integration)
22. [Antigravity / Gemini CLI Integration](#22-antigravity--gemini-cli-integration)
23. [Font Size & UI Scale](#23-font-size--ui-scale)

---

## 1. Getting Started & Login

### What it does
DevBrain is protected by a password when `AUTH_PASSWORD` is set in `server/.env`. In development mode (no `AUTH_PASSWORD`), the login gate is skipped and a synthetic `dev` user is used automatically.

### How to test

1. Open `http://localhost:5174` (dev) or `http://localhost:3001` (prod).
2. Enter the password you set as `AUTH_PASSWORD` in `server/.env`.
3. Click **Log in**. You are redirected to the Dashboard.
4. Click the user icon / **Log out** link to end the session.
5. Confirm the browser cookie is cleared and you are returned to the login page.

**Dev-mode bypass:** Leave `AUTH_PASSWORD` blank in `server/.env`. The app loads directly without prompting for a password — useful during development.

---

## 2. Projects

### What it does
Projects are the top-level organising unit. Every piece of content (documents, issues, commands, releases, runbooks, tasks) belongs to a project. Five projects are pre-seeded on first launch: PlayCru, WealthView Pro, Memex, DevBrain, and Music Player. You can create more, edit them, and link each project to a local folder on disk for Git and AI session sync.

The **Project Switcher** in the top bar scopes the entire sidebar to the selected project, or to "All Projects" for a unified view.

### How to test

**Switching projects:**
1. Click the project name in the top bar (e.g. "PlayCru").
2. A dropdown appears showing all projects with color dots.
3. Click a different project — the sidebar content updates immediately.
4. Select "All Projects" to see the global view.

**Creating a project:**
1. Open the project dropdown → click **+ New Project**.
2. Fill in name, short name, description, color, status, type, and tech stack tags.
3. Click **Save**. The new project appears in the switcher.

**Editing / deleting:**
1. Navigate to **Projects** in the sidebar (All Projects view).
2. Find a project card → click the **Edit** (pencil) icon.
3. Change any field and save.
4. To delete, click the **Delete** icon and confirm.

**Linking a folder:**
1. On the Projects page, click **⊕ Link** on any project card.
2. Enter the absolute path to the project directory on disk (e.g. `D:\Project\playcru`). The folder should contain a `TASKS.md`, `CLAUDE.md`, or `ANTIGRAVITY.md` file.
3. Click **Save**. The badge changes to **⊙ Linked** and the project gains Git, Tasks, and Sessions tabs.

---

## 3. Dashboard

### What it does
The Dashboard gives a high-level view of activity across all (or the selected) projects. It includes:

- **Open Issues by Project** — horizontal bar chart, one bar per project colored by project color.
- **Avg Resolution Time (last 30 days)** — days-to-resolve bar chart per project.
- **Activity Heatmap** — 5-week × 7-day GitHub-contribution-style grid; shading intensity = event count that day; hover for a tooltip.
- **Embedding Health** — Done / Pending / Failed document embedding counts with a "Retry all failed" button.
- **Stale Issues** — Issues open > 14 days with no recent note, listed with priority badges and a one-click "Mark investigating" shortcut.

### How to test

1. Create at least one issue and one document (see sections 4 and 6).
2. Navigate to **Dashboard**.
3. Confirm the Open Issues bar chart shows a bar for the project you created an issue in.
4. Hover over any cell in the Activity Heatmap — a tooltip should show the date and event count.
5. Upload a document and wait for embedding to complete — the Embedding Health widget should show "Done: 1".
6. To test the Stale Issues widget: create an issue, then manually set `created_at` to 15+ days ago in Postgres (`UPDATE issues SET created_at = now() - interval '15 days' WHERE title = 'your issue'`), then refresh the Dashboard.

---

## 4. Documents

### What it does
Documents are the knowledge base. You can upload PDFs, DOCX, Markdown, plain text, Excel spreadsheets, or import from a URL. After upload, the server extracts text (using Microsoft MarkItDown for rich formats), splits it into 512-token chunks with 64-token overlap, and embeds each chunk using `nomic-embed-text` via Ollama. Embedded chunks power the RAG Q&A feature.

**Supported formats:** PDF · DOCX · MD · TXT · XLSX · URL

### How to test

**Uploading a file:**
1. Select a project from the switcher (or use All Projects).
2. Click **Documents** in the sidebar.
3. Click **Upload Document**.
4. Choose a PDF or Markdown file from your machine.
5. Optionally add tags (comma-separated).
6. Click **Upload**. The document appears in the list with an "Embedding…" status indicator.
7. Wait a few seconds. The status changes to a green dot ("Embedded").

**Importing a URL:**
1. Click **Upload Document** → switch to the **URL** tab.
2. Paste a web URL (e.g. a documentation page).
3. Click **Import**. DevBrain fetches and parses the page content.

**Viewing a document:**
1. Click any document title in the list.
2. The document viewer opens, showing the parsed text with syntax highlighting for code blocks.

**Filtering documents:**
1. Use the filter bar above the document list to filter by file type, tags, or date range.
2. Click a tag chip to filter documents with that tag.

**Re-embedding a document:**
1. Select the document checkbox.
2. The floating action bar appears — click **Re-embed** to reprocess the chunks and embeddings.

**Deleting a document:**
1. Click the trash icon on a document row, or select it and use the bulk delete action.

---

## 5. Document Q&A (Ask AI / RAG)

### What it does
The DocChat page lets you ask natural language questions against your uploaded documents. The answer is generated entirely locally by `mistral:7b` via Ollama. The flow is:
1. Your question is embedded with `nomic-embed-text`.
2. The top 5 most similar document chunks are retrieved via pgvector cosine similarity.
3. The chunks and your question are injected into a `mistral:7b` prompt.
4. The answer streams to the UI in real time via SSE.
5. Source citations appear as collapsible cards below the answer.

**No documents = no answers.** The model only uses the provided excerpts; it will not hallucinate from general knowledge.

### How to test

1. Upload at least one document (see section 4) and wait for embedding to complete.
2. Click **Ask AI** in the sidebar.
3. Optionally select a specific document or project from the scope dropdown to narrow context.
4. Type a question relevant to the document content (e.g. if you uploaded an API doc: *"What are the rate limits?"*).
5. Click **Ask** or press Enter.
6. Watch the answer stream in — text should appear word by word.
7. Below the answer, expand the **Sources** section to see which document chunks were used.
8. Ask a question about something *not* in the documents (e.g. "What is the capital of France?") — the model should respond: *"I don't see this in the provided documents."*

---

## 6. Issues

### What it does
Issues are structured investigation records. Each issue has:
- **Title, description, status** (`open` / `investigating` / `resolved` / `won't-fix`), **priority** (`low` / `medium` / `high` / `critical`)
- **Investigation steps** — ordered checklist items with done/not-done state
- **Notes** — timestamped free-text notes appended over time
- **Linked documents** — attach relevant documents to an issue
- **Linked commands** — attach relevant snippets
- **Resolution** — filled in when closing
- **Tags** — for filtering
- **AI summary** — `mistral:7b` generates a 3-bullet TL;DR on demand
- **AI auto-tagging** — `gemma3:4b` suggests tags on creation

**Triage view** — a dedicated tab showing stale and high-priority open issues sorted by urgency.

### How to test

**Creating an issue:**
1. Click **Issues** in the sidebar.
2. Click **New Issue**.
3. Fill in title and description.
4. Set priority to `high` and status to `open`.
5. Add an investigation step: type a step description and click **Add Step**.
6. Observe the AI-suggested tags that appear — accept or dismiss them.
7. Click **Save**.

**Working an issue:**
1. Open the issue by clicking its title.
2. Check off a step as done by clicking the checkbox.
3. Add a note in the **Notes** section and click **Add Note**.
4. Click **AI Summary** — a 3-bullet summary appears below the description (takes ~3s).
5. Change the status to `investigating` using the status dropdown.

**Filtering issues:**
1. Use the filter bar to filter by `status: open`, `priority: high`.
2. Add a tag filter — only issues with that tag appear.
3. Save the filter as a preset: click **Save Filter** and give it a name. The preset appears as a chip above the filter bar.

**Triage view:**
1. Click the **Triage** tab in the Issues header.
2. Issues open > 14 days with no recent note are listed by urgency.
3. Click **Mark investigating** on any stale issue to update its status in one click.

---

## 7. Commands Library

### What it does
Commands are reusable code snippets and shell commands. Each snippet has a title, the command itself, language (bash / python / dart / SQL / PowerShell / YAML), description, tags, and a favorite flag. Syntax highlighting is powered by Shiki. Features include:
- **One-click copy** to clipboard
- **Usage tracking** — `last_used` timestamp updated on copy
- **Favorites** — star commands for quick access
- **AI explanation** — `gemma3:4b` explains any command on demand; the explanation is stored and shown under the code block

### How to test

**Creating a command:**
1. Click **Commands** in the sidebar.
2. Click **New Command**.
3. Set title to "List Docker containers", language to `bash`, and command to `docker ps -a`.
4. Add a description and tag `docker`.
5. Click **Save**.

**Using a command:**
1. Find the command in the list.
2. Click the **Copy** button — the clipboard receives the command text.
3. Confirm the `last_used` timestamp updates (shown in the row as "Last used: just now").

**Favorite a command:**
1. Click the ☆ star icon on any command row.
2. The icon fills in (★) and the command moves to the top of the Favorites filter.
3. Use the **Favorites** filter chip to show only starred commands.

**AI explanation:**
1. Click on a command to open its detail view.
2. Click **Explain with AI**.
3. Wait ~1 second — `gemma3:4b` generates a plain-English explanation.
4. The explanation is stored; closing and reopening the command shows it without re-generating.
5. Click **Regenerate** to refresh the explanation.

**Filtering:**
1. Use the search bar to filter by keyword.
2. Click a language chip (e.g. `bash`) to show only bash commands.
3. Click a tag chip to filter by tag.

---

## 8. Releases

### What it does
Releases track version history per project using semantic versioning. Each release has a version number, date, type (`major` / `minor` / `patch` / `hotfix`), lists of features / fixes / breaking changes, notes, and linked issues. An AI drafting feature uses `mistral:7b` to generate release notes from resolved issues in a date range.

### How to test

**Creating a release manually:**
1. Select a project in the switcher.
2. Click **Releases** in the sidebar.
3. Click **New Release**.
4. Set version to `1.0.0`, type to `major`, and date to today.
5. Add a feature: type a description and press Enter.
6. Add a fix.
7. Click **Save**. The release appears on the timeline.

**AI-drafted release notes:**
1. Create and resolve at least one issue first (status = `resolved`).
2. Open **New Release** → click **Draft with AI**.
3. Set a date range covering the resolved issue.
4. Click **Generate** — `mistral:7b` drafts the Features, Fixes, and Breaking Changes sections from the resolved issues in that range (~2–3s).
5. Review and edit the draft, then save.

**Viewing the timeline:**
1. Create two or three releases with different versions.
2. The timeline shows them in chronological order with color-coded type badges.
3. Click any release to expand its full details.

---

## 9. Runbooks

### What it does
Runbooks are step-by-step operational playbooks — deployment procedures, incident response guides, debugging checklists. Each step can include:
- An instruction (required)
- An optional embedded command snippet
- An optional note or warning

Runbooks are tagged, searchable, and track the last time they were used.

### How to test

**Creating a runbook:**
1. Click **Runbooks** in the sidebar.
2. Click **New Runbook**.
3. Title it "Deploy to Production".
4. Add step 1: instruction = "Run tests", command = `npm test`.
5. Add step 2: instruction = "Build the client", command = `npm run build`.
6. Add step 3: instruction = "Restart the server", note = "Check logs for errors after restart".
7. Add tags: `deploy`, `production`.
8. Click **Save**.

**Using a runbook:**
1. Open the runbook by clicking its title.
2. Check off steps as you complete them.
3. Click the **Copy** button on any step's command to copy it to the clipboard.
4. The `last_used` timestamp updates when you open the runbook.

---

## 10. Tasks Board

### What it does
The Tasks board is a lightweight Kanban-style tracker built directly into DevBrain — no external tool required. Tasks are organized into four columns: **In Progress**, **To Do**, **Done**, and **Cancelled**. Each task has a title, description, priority (`critical` / `high` / `medium` / `low`), status, and tags. Tasks can be scoped to a project or created globally.

A **Quick Add** bar at the top lets you add a task in one keystroke.

### How to test

**Adding a task:**
1. Click **Tasks** in the sidebar.
2. In the Quick Add bar at the top, type a task title and press **Enter**.
3. The task appears in the **To Do** column.

**Changing priority and status:**
1. Click a task card to open its detail panel.
2. Change the priority to `critical` — the card border turns red.
3. Drag the card (or use the status dropdown in the detail panel) to move it to **In Progress**.

**Importing from TASKS.md:**
1. If the project folder is linked and contains a `TASKS.md`, click **Import from TASKS.md**.
2. DevBrain parses the markdown checkboxes and creates tasks for each item.

**Filtering:**
1. Use the column header counts to see per-column totals.
2. Use the priority filter chips above the board to show only `high` + `critical` tasks.

---

## 11. AI Task Runner

### What it does
The AI Task Runner is a freeform AI prompt interface — different from the RAG Q&A in DocChat. Here you describe a task and get a structured response. The output format is selectable:

| Format | Description |
|---|---|
| Markdown | Headers, bold, code blocks |
| Bullet list | Top-level bullets, sub-items |
| Table | Markdown table with a header row |
| JSON | Raw JSON object or array |
| Code | Code only, with language fence |
| Summary | 3–5 sentence prose |
| Plain text | No formatting |

The model used is `mistral:7b` (or Claude API if `USE_CLAUDE=true`).

### How to test

1. Click **Ask AI** or **AI Task** in the sidebar (this is the freeform task page, distinct from DocChat).
2. Select output format **Bullet list**.
3. Type: *"List the steps to debug a Flutter app crash on Android."*
4. Click **Run**.
5. The response streams in as a formatted bullet list.
6. Click **Copy** to copy the result to the clipboard.
7. Change the format to **JSON** and run: *"Give me a JSON object with keys: tool, version, purpose for Docker, Node.js, and Ollama."*
8. Verify the response is valid JSON.

---

## 12. Global Search (⌘K)

### What it does
The Global Search modal searches across **all** content types (documents, issues, commands, releases, runbooks) and **all** projects simultaneously. It uses a hybrid approach:
- **Semantic search** — pgvector cosine similarity on embeddings
- **Full-text search** — PostgreSQL `tsvector` ranking

Results are grouped and color-coded by project. The last 20 queries are stored as search history and shown when the query is empty. Smart suggestions (recent issue titles, document names) appear below the history.

### How to test

1. Press **⌘K** (Mac) or **Ctrl+K** (Windows/Linux) from anywhere in the app.
2. The search modal opens with focus on the input.
3. Type a word that appears in one of your documents (e.g. a technical term from an uploaded PDF).
4. Results appear as you type, grouped by project with colored dot indicators.
5. Click any result to navigate directly to that item.
6. Press **Escape** to close the modal without navigating.
7. Open the modal again — your previous query appears in the search history below the input.
8. Click a history item to re-run that search.

**Testing semantic search:**
1. Search for a concept using different wording than what appears in the document (e.g. if the document says "authentication", search for "login security").
2. The document should still appear in results (via semantic similarity), even though the exact words don't match.

---

## 13. Notifications

### What it does
DevBrain has a full notification system with in-app delivery and optional external channels via Apprise (Telegram, Slack, Discord, and 80+ others).

**Notification types:**
- **Stale issue** — auto-generated when an issue is open > threshold days with no recent note (once per issue per day)
- **Sync complete** — after an external issue sync runs
- **Session complete** — posted by Claude Code / Antigravity hooks on session exit
- **Manual** — via `POST /api/notify` from any external tool

**In-app notifications:**
- Bell icon in the top bar with an unread count badge
- Slide-in panel grouped by Today / Earlier
- Click any notification to navigate to the related entity

**Browser notifications:**
- Opt-in prompt on first panel open
- Delivered via the Web Notifications API

### How to test

**In-app notification:**
1. Click the **bell icon** in the top bar.
2. The notification panel slides in.
3. Any unread notifications appear with a colored left border.
4. Click a notification to navigate to the linked entity.
5. Click **Mark all read** to clear the unread badge.

**Stale issue alert:**
1. Create an issue and manually age it in Postgres (see section 3 testing for the SQL snippet).
2. The server background job runs periodically — after the next run, a stale-issue notification appears in the panel.
3. The notification links back to the issue.

**Manual notification via API:**
```bash
curl -X POST http://localhost:3001/api/notify \
  -H "Content-Type: application/json" \
  -d '{"title": "Test notification", "body": "Hello from curl", "project": "devbrain", "level": "info"}'
```
The notification appears in the bell panel within seconds.

**Notification Log:**
1. Click **Settings** → **Notification Log** (or navigate to the Notification Log page in the sidebar).
2. Filter by project, level (`info` / `warning` / `error`), channel, status, and date range.
3. Failed deliveries show a **Retry** button.

**External channels (Apprise / Telegram):**
1. Go to **Settings → Notification Hub**.
2. Add a Telegram channel: enter Bot Token and Chat ID.
3. DevBrain auto-constructs the `tgram://` Apprise URL.
4. Send a test notification — confirm it arrives in Telegram.
5. Use the per-project checkbox grid to opt projects in or out of each channel.

**Daily digest:**
1. In Settings, set the digest schedule (e.g. "09:00 daily").
2. The `digest_scheduler.py` script (APScheduler) fires at that time.
3. The digest contains: open issue count per project, last session date, stale-project callout.

---

## 14. Bulk Operations

### What it does
Issues, Documents, and Commands lists support multi-select with a floating action bar for batch operations.

**Available bulk actions (context-dependent):**
- **Tag** — add or remove tags from all selected items
- **Change Status** — update status on all selected issues
- **Re-embed** — re-chunk and re-embed all selected documents
- **Favorite** — toggle favorite on all selected commands
- **Delete** — delete all selected items with a confirmation prompt

### How to test

1. Navigate to **Issues** (or Documents or Commands).
2. Hover over any row — a checkbox appears on the left.
3. Click the checkbox to select that item. The row highlights and a floating action bar appears at the bottom of the screen.
4. Select additional items — the count in the action bar updates.
5. Click the column header checkbox to select **all** items on the page. It shows an indeterminate state (—) when only some are selected.
6. In the action bar, click **Change Status** → select `investigating` → confirm.
7. All selected issues update their status.
8. Click **Deselect all** in the action bar to clear the selection.

---

## 15. Templates

### What it does
Templates pre-fill the Issue and Runbook create modals with a title, description, tags, and steps. DevBrain ships four built-in read-only templates:
- **Bug Report** (issue)
- **Investigation** (issue)
- **Deployment Runbook** (runbook)
- **Incident Postmortem** (runbook)

You can duplicate any built-in template and create your own custom templates scoped to a project or available globally.

### How to test

**Using a built-in template:**
1. Click **Issues** → **New Issue**.
2. Click the **Use template ▾** dropdown at the top of the modal.
3. Select **Bug Report**.
4. The form pre-fills with a title skeleton, description, and tags.
5. Edit and save.

**Creating a custom template:**
1. Go to **Settings → Templates** (or the Templates section in the sidebar).
2. Click **New Template**.
3. Set type to `issue`, name it "API Regression Report", and add a description with placeholder text.
4. Set project scope to a specific project or leave it as **Global**.
5. Click **Save**.
6. Open **New Issue** — the new template appears in the **Use template** dropdown.

**Duplicating a built-in template:**
1. In Settings → Templates, find a built-in template (marked as read-only).
2. Click **Duplicate**. A copy is created as an editable custom template.
3. Edit the copy and save.

---

## 16. Git Integration

### What it does
If a project is linked to a folder on disk that contains a Git repository, DevBrain shows a **Git** tab in the project detail view with:
- **Commit history** — paginated list of commits with author, date, and message
- **Branch list** — all local branches with the active branch highlighted
- **Commit linking** — link a commit SHA to an issue for traceability

### How to test

1. Make sure the project has a linked folder containing a git repo (`fs_path` is set).
2. Navigate to **Projects** → click on the project card → open the **Git** tab.
3. Confirm the commit list loads showing recent commits.
4. Confirm branch names appear with the current branch highlighted.
5. Open an issue → click **Link Commit** → paste a commit SHA from the git log.
6. The SHA appears as a chip in the issue detail and links back to the commit.

---

## 17. External Issue Sync (GitHub / Linear / Jira)

### What it does
DevBrain can import and sync issues from external trackers. Imported issues appear alongside native issues with a **source badge chip** (GitHub / Linear / Jira). A sync-complete notification is created after each run.

**Supported sources:**
- **GitHub** — REST API; requires a Personal Access Token
- **Linear** — GraphQL API; requires an API key
- **Jira** — JQL query; requires a host URL, email, and API token

### How to test

1. Go to **Settings → Integrations**.
2. Click **Add Integration** and select **GitHub**.
3. Enter your GitHub Personal Access Token and the repository in `owner/repo` format.
4. Click **Save**.
5. Click **Sync now** on the integration row.
6. Navigate to **Issues** — imported GitHub issues appear with a `GitHub` badge chip.
7. A **Sync complete (N new issues)** notification appears in the bell panel.
8. Delete the integration — confirm the integration row disappears from Settings.

---

## 18. Multi-user & RBAC

### What it does
DevBrain supports multiple users with three roles:

| Role | Permissions |
|---|---|
| `admin` | Full access, user management, all settings |
| `member` | Create and edit all content |
| `viewer` | Read-only — cannot create, edit, or delete |

**User management features:**
- **Invite by email** — generates a one-time token (valid 48 hours)
- **Deactivate / reactivate** — disable a user without deleting their data
- **Admin password reset** — admin can reset any user's password
- **LDAP / AD** — auto-provisions users on first successful LDAP bind

**Per-project access control:** Members and viewers only see projects they have been explicitly assigned to. Admins see all projects.

### How to test

**Inviting a user:**
1. Go to **Settings → User Management** (admin only).
2. Click **Invite User** → enter an email address.
3. DevBrain generates a one-time invite link shown in a toast.
4. Open that URL in a private browser window → set a password → complete the invite.
5. The new user appears in the user list.

**Testing roles:**
1. Log in as an admin and create a second user with the `viewer` role.
2. Log out and log in as the viewer.
3. Confirm the viewer can see documents and issues but the **New Issue**, **New Document**, etc. buttons are absent.
4. Try hitting a create endpoint directly: `POST /api/issues` — confirm a `403 Forbidden` is returned.

**Deactivating a user:**
1. As admin, open Settings → User Management.
2. Click **Deactivate** on the viewer account.
3. Log out and try to log in as that viewer — the login should fail with "Account is deactivated".
4. Reactivate the account — login works again.

---

## 19. Audit Log

### What it does
Every create, update, delete, login, and password-change event is recorded in the `audit_events` table. The audit log in Settings shows a paginated history of all mutations.

**Filterable by:** entity type (issue, document, command, user, release, runbook, etc.)  
**Exportable:** as a CSV file.

### How to test

1. Perform several actions: create an issue, edit it, create a document, delete a command.
2. Go to **Settings → Audit Log**.
3. Confirm each action appears as a row with: timestamp, action type, entity type, entity name, and the user who performed it.
4. Use the **Entity type** filter — select `issue` — only issue events should show.
5. Click **Export CSV** — download the file and confirm it contains the audit rows.

---

## 20. Settings & Backup

### What it does
Settings uses a **two-column sidebar-nav layout**: a 168px left sidebar with 8 tab groups, and a right content pane that shows only the active group. Admin-only tabs (Users & Auth, Audit Log) are hidden from non-admin users.

| Tab | Sections inside |
|---|---|
| **General** | AI Backend (active provider, models, Ollama URL) · About (version, stack) |
| **Account** | Auth mode · Change password · Sign out |
| **Users & Auth** *(admin)* | User Management · LDAP Configuration |
| **Data** | Export JSON backup · Import JSON backup (dry run + live) · Scheduled Backup · Export by Project (zip) · Import from Zip · Danger Zone (reset seed) |
| **Notifications** | Notification Rules · Notification Hub (Apprise channels, digest) |
| **Integrations** | External Issue Sync *(admin)* · Claude Code scan root · Antigravity scan root |
| **Templates** | Manage built-in and custom templates |
| **Audit Log** *(admin)* | Paginated mutation history + CSV export |

### How to test

**Navigating tabs:**
1. Open **Settings** from the sidebar.
2. Click each tab in the left nav — only the sections for that group render on the right.
3. Confirm **Users & Auth** and **Audit Log** tabs are absent when logged in as a non-admin `member` or `viewer`.

**Changing password:**
1. Settings → **Account** → enter current password and new password → click **Update**.
2. Log out and log in with the new password.

**Backup:**
1. Settings → **Data** → **Export backup** → click **Download**.
2. A JSON file is downloaded containing all projects, documents (without raw content and embeddings), issues, commands, releases, and runbooks.
3. To configure auto-backup: go to **Scheduled Backup** inside the same Data tab, set a path and schedule → Save.

**LDAP test:**
1. Settings → **Users & Auth** → LDAP Configuration → enter server details.
2. Click **Test Connection** — DevBrain attempts a bind and reports success or the error message.

**AI Backend:**
1. Settings → **General** → AI Backend shows the active provider (`ollama` / `claude` / `gemini`), the chat model in use, and the Ollama URL.
2. To switch providers, set `AI_PROVIDER` in `server/.env` and restart the server.

---

## 21. Claude Code Integration

### What it does
The `integrations/claude-code/` directory provides hooks that fire on every Claude Code session start and end. After installing, every Claude Code project automatically gets:
- A `TASKS.md` scaffolded at session start (if absent)
- A timestamped `sessions/YYYY-MM-DD_HH-MM_<id>/SESSION.md` created at session start
- Task progress and the last session summary injected into Claude's context window automatically
- Session-complete notifications posted to DevBrain on exit

The `/devbrain` skill lets you trigger a manual task + session update at any point mid-session.

### How to install

**Windows:**
```powershell
powershell -ExecutionPolicy Bypass -File integrations\claude-code\install.ps1
```

**macOS / Linux / WSL:**
```bash
cd integrations/claude-code && ./install.sh
```

### How to test

1. Install the hooks (above).
2. Open any project directory in Claude Code (the one you ran the install from, or any other).
3. Start a new session — Claude's opening context should include a **"DevBrain Session Started"** block listing task progress and the previous session summary.
4. During the session, say: **"Update tasks"** or type `/devbrain`.
5. Claude updates `TASKS.md` checkboxes and fills in `SESSION.md`.
6. End the session — a session-complete notification should appear in DevBrain's bell panel within seconds.
7. In DevBrain, link the project folder (Settings → Claude Integration → set scan root, then Projects → ⊕ Link). Open the project's **Sessions** tab to see the session history and **Tasks** tab to see the live task tree.

---

## 22. Antigravity / Gemini CLI Integration

### What it does
The `integrations/antigravity/` directory provides the same session-tracking pattern as the Claude Code integration, but for the **Gemini CLI / Antigravity** AI assistant. Additional feature: completed tasks stamped with `<!-- done: YYYY-MM-DD -->` older than 7 days are automatically archived into `TASKS_ARCHIVE.md` at each session start, keeping `TASKS.md` clean.

**Hook config location:** `~/.gemini/config/hooks.json`

### How to install

**Windows:**
```powershell
powershell -ExecutionPolicy Bypass -File integrations\antigravity\install.ps1
```

**macOS / Linux / WSL:**
```bash
cd integrations/antigravity && ./install.sh
```

### How to test

1. Install the hooks (above).
2. Open any project directory in the Gemini CLI / Antigravity.
3. Start a session — the model's opening context should include a **"DevBrain Session Started"** block with per-phase task progress and the last session summary.
4. Say: **"Mark the auth task as done"** or type `/devbrain`.
5. The model updates `TASKS.md` and stamps completed items with `<!-- done: YYYY-MM-DD -->`.
6. End the session — `sessions/index.md` is updated.
7. Wait 7 days (or manually update the done-date to an old date in `TASKS.md`). On the next session start, archived tasks move to `TASKS_ARCHIVE.md`.
8. In DevBrain, configure the scan root under **Settings → Antigravity Integration**, then link the project folder. Open the project's **Sessions** and **Tasks** tabs to see the live data synced from the Antigravity hook files.

---

## 23. Font Size & UI Scale

### What it does
DevBrain lets you scale the entire interface — top bar, sidebar, and all page content — to one of four sizes. The choice is saved to `localStorage` and persists across page refreshes.

| Option | Base size | When to use |
|--------|-----------|-------------|
| **Small** | 12px | Dense data view; more content visible at once |
| **Medium** | 13px | Default — balanced density |
| **Large** | 15px | More comfortable reading |
| **XL** | 16px | High-DPI monitors or accessibility needs |

The setting uses CSS `zoom` on the app container with a compensated height (`100vh ÷ zoom`) so nothing is clipped and the layout stays intact at all sizes.

### How to test

1. Go to **Settings → General** (first tab in the sidebar nav).
2. You will see a **Font Size** section at the top with four buttons: Small, Medium, Large, XL. Each button shows a live "A" preview at that size.
3. Click **Large** — the entire interface (top bar, sidebar, page content) should immediately scale up. No page refresh required.
4. Click **XL** — the interface scales further. Verify you can still scroll to see all content on the Dashboard.
5. Click **Small** — the interface shrinks. More content fits on screen at once.
6. Refresh the page — the font size you selected should be remembered (stored in localStorage as `devbrain_density`).
7. Return to **Medium** to restore the default.

---

## Quick Reference: Where to Find Things

| Feature | Location |
|---|---|
| Project switcher | Top bar |
| Global search | ⌘K / Ctrl+K from anywhere |
| Document upload | Documents → Upload Document |
| RAG Q&A | Ask AI (sidebar) |
| Issue triage | Issues → Triage tab |
| AI task runner | AI Task (sidebar) |
| Bulk operations | Any list page — hover rows to reveal checkboxes |
| Templates | Settings → Templates or "Use template" in create modals |
| Notifications | Bell icon (top bar) |
| Audit log | Settings → Audit Log tab |
| Backup | Settings → Data tab → Export backup |
| User management | Settings → Users & Auth tab |
| AI backend info | Settings → General tab |
| Font size / UI scale | Settings → General tab → Font Size |
| Git history | Projects page → project card → Git tab |
| Claude Code hooks | `integrations/claude-code/` |
| Antigravity hooks | `integrations/antigravity/` |
