# CLAUDE.md — DevBrain (Work Knowledge Base)

## Project Overview
DevBrain is a private developer knowledge base for organizing work artifacts across all active projects: documents, issue investigation notes, code fixes, release notes, runbooks, and frequently used commands. It supports document Q&A via RAG (ask questions against your own docs), issue investigation workflows, and structured runbooks. **All AI runs locally via Ollama on RTX 2060 Max-Q — zero API cost.** Designed first for personal use, org-sharing later.

## Active Projects Tracked in DevBrain

| Project | Short Name | Color | Stack | Status |
|---|---|---|---|---|
| PlayCru | `playcru` | `#2ECC71` Performance Green | Flutter, Firebase, Dart, Firestore, Cloud Functions | Active |
| WealthView Pro (QuantCru) | `quantcru` | `#F59E0B` Amber | Python, React, Zerodha Kite API, PostgreSQL, LSTM | Active |
| Memex | `memex` | `#8B5CF6` Purple | React, Node.js, PostgreSQL, Ollama, pgvector | Active |
| DevBrain | `devbrain` | `#6366F1` Indigo | React, Node.js, PostgreSQL, Ollama, pgvector | Active |
| Music Player | `musicplayer` | `#EC4899` Pink | Flutter Desktop (Dart) | Planning |

## Tech Stack
- **Frontend**: React + Vite + TypeScript
- **Styling**: Tailwind CSS + design tokens from Claude Design
- **State**: Zustand + React Query
- **Backend**: Node.js + Express (TypeScript)
- **Database**: PostgreSQL (local Docker) with pgvector extension
- **AI (Primary)**: **Ollama on RTX 2060 Max-Q 6GB — 100% local, zero cost**
  - Document Q&A / RAG: `mistral:7b` (~4.5GB VRAM, ~3s response)
  - Classification + summarization: `gemma3:4b` (~3.5GB VRAM, ~1s response)
  - Embeddings: `nomic-embed-text` (~300MB, ~50ms)
- **AI (Optional / Manual only)**: Anthropic Claude API — only behind explicit "Enhance with Claude" button, never automatic
- **Auth**: Local bcrypt + JWT (single user v1); LDAP/SSO for org v2
- **File Parsing**: `pdf-parse` (PDF), `mammoth` (DOCX), `marked` (MD), `xlsx` (spreadsheets)
- **Code Highlighting**: Shiki
- **Search**: pgvector (semantic) + PostgreSQL tsvector (full-text) hybrid

## Hardware Configuration
- **GPU**: NVIDIA GeForce RTX 2060 Max-Q (6GB VRAM) — primary AI inference
- **CPU**: AMD Ryzen 9 4900HS (8 cores, 3.0GHz) — server + build tasks
- **RAM**: 32GB — runs all Docker services + dev tools simultaneously without pressure
- **Note**: AMD integrated GPU (496MB) ignored by Ollama — NVIDIA used exclusively

## Docker Compose Setup
```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    ports: ["5432:5432"]
    environment:
      POSTGRES_DB: devbrain
      POSTGRES_PASSWORD: devbrain
    volumes:
      - pg_data:/var/lib/postgresql/data

  ollama:
    image: ollama/ollama
    ports: ["11434:11434"]
    volumes:
      - ollama_data:/root/.ollama
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]

  app:
    build: ./server
    ports: ["3001:3001"]
    depends_on: [postgres, ollama]
    environment:
      DATABASE_URL: postgresql://devbrain:devbrain@postgres:5432/devbrain
      OLLAMA_URL: http://ollama:11434

volumes:
  pg_data:
  ollama_data:
```

## Ollama Model Setup (one-time)
```bash
docker exec -it devbrain-ollama-1 ollama pull mistral:7b
docker exec -it devbrain-ollama-1 ollama pull gemma3:4b
docker exec -it devbrain-ollama-1 ollama pull nomic-embed-text
```

## Project Structure
```
devbrain/
├── client/
│   └── src/
│       ├── components/
│       │   ├── projects/      # Project switcher, project cards, seeder
│       │   ├── docs/          # Document viewer, uploader, Q&A chat
│       │   ├── issues/        # Issue cards, investigation flow
│       │   ├── commands/      # Command palette, snippets
│       │   ├── releases/      # Release notes timeline
│       │   ├── runbooks/      # Investigation runbooks
│       │   └── search/        # Global search modal (⌘K)
│       ├── pages/
│       │   ├── Dashboard.tsx          # Global across all projects
│       │   ├── ProjectDashboard.tsx   # Per-project view
│       │   ├── Projects.tsx           # All projects list
│       │   ├── Documents.tsx
│       │   ├── DocChat.tsx            # RAG Q&A interface
│       │   ├── Issues.tsx
│       │   ├── Commands.tsx
│       │   ├── Releases.tsx
│       │   └── Runbooks.tsx
│       ├── hooks/
│       ├── store/
│       └── lib/
│           ├── api.ts
│           ├── ai.ts          # Unified AI client (Ollama + Claude toggle)
│           └── streaming.ts   # SSE response handler
├── server/
│   ├── routes/
│   │   ├── projects.ts                  # Project CRUD + seeding
│   │   ├── documents.ts                 # Upload, parse, embed, CRUD
│   │   ├── issues.ts                    # Issue notes CRUD
│   │   ├── commands.ts                  # Commands/snippets CRUD
│   │   ├── releases.ts                  # Release notes CRUD
│   │   ├── search.ts                    # Hybrid search
│   │   ├── chat.ts                      # RAG Q&A (streaming SSE)
│   │   ├── claude-projects.ts           # Claude Code project discovery + task/session sync
│   │   └── antigravity-projects.ts      # Antigravity project discovery + task/session sync
│   ├── services/
│   │   ├── ai.ts                        # Unified AI client (Ollama/Claude toggle)
│   │   ├── ollama.ts                    # Ollama chat + embed + stream
│   │   ├── parser.ts                    # Multi-format document parser
│   │   ├── embedder.ts                  # Chunk + embed docs
│   │   ├── rag.ts                       # RAG retrieval + answer generation
│   │   ├── summarizer.ts                # Issue summarization, release notes
│   │   └── antigravity-discovery.ts     # Scans fs_path for Antigravity TASKS.md + sessions
│   ├── db/
│   │   ├── schema.sql
│   │   ├── seed.ts                      # Seeds default projects on first run
│   │   └── migrations/
│   └── index.ts
├── integrations/
│   ├── claude-code/                     # Claude Code hooks + install scripts
│   └── antigravity/                     # Antigravity/Gemini CLI hooks + install scripts
│       ├── install.ps1                  # Windows native install
│       ├── install.sh                   # macOS/Linux/WSL install
│       ├── README.md
│       └── src/
│           ├── config/hooks.reference.json
│           ├── hooks/
│           │   ├── session-start.ps1 / .sh
│           │   └── session-end.ps1 / .sh
│           ├── skills/devbrain/SKILL.md  # /devbrain slash command for Antigravity
│           └── templates/
│               ├── TASKS.md
│               └── SESSION.md
└── shared/
    └── types.ts
```

## Unified AI Client (ai.ts)
Single abstraction — swap Ollama ↔ Claude via env flag, zero code changes elsewhere:
```ts
const USE_CLAUDE = process.env.ANTHROPIC_API_KEY && process.env.USE_CLAUDE === 'true'
const OLLAMA_BASE = process.env.OLLAMA_URL || 'http://localhost:11434'

export async function aiChat(prompt: string, system: string): Promise<string> {
  if (USE_CLAUDE) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system,
        messages: [{ role: 'user', content: prompt }]
      })
    })
    const data = await res.json()
    return data.content[0].text
  }

  // Default: Ollama (local, free)
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OLLAMA_CHAT_MODEL || 'mistral',
      stream: false,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt }
      ]
    })
  })
  const data = await res.json()
  return data.message.content
}

export async function aiEmbed(text: string): Promise<number[]> {
  // Always local — embeddings never need Claude
  const res = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'nomic-embed-text', prompt: text })
  })
  const data = await res.json()
  return data.embedding
}

// Streaming version for DocChat UI
export async function aiChatStream(
  messages: { role: string; content: string }[],
  onChunk: (chunk: string) => void
): Promise<void> {
  if (USE_CLAUDE) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        stream: true,
        system: messages.find(m => m.role === 'system')?.content || '',
        messages: messages.filter(m => m.role !== 'system')
      })
    })
    // Parse Claude SSE stream
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const lines = decoder.decode(value).split('\n').filter(l => l.startsWith('data:'))
      for (const line of lines) {
        try {
          const json = JSON.parse(line.slice(5))
          if (json.type === 'content_block_delta') onChunk(json.delta.text)
        } catch {}
      }
    }
    return
  }

  // Ollama streaming
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OLLAMA_CHAT_MODEL || 'mistral',
      stream: true,
      messages
    })
  })
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const lines = decoder.decode(value).split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        const json = JSON.parse(line)
        if (json.message?.content) onChunk(json.message.content)
      } catch {}
    }
  }
}
```

## Data Models

### Project
```ts
type Project = {
  id: string
  name: string
  shortName: string            // 'playcru' | 'quantcru' | 'memex' | 'devbrain' | 'musicplayer'
  description: string
  color: string                // hex — used throughout UI for this project
  status: 'active' | 'paused' | 'planning'
  techStack: string[]          // ['Flutter', 'Firebase', 'Dart']
  type: 'mobile' | 'web' | 'desktop' | 'fintech' | 'tool'
  repoUrl?: string
  createdAt: Date
}
```

### Seed Data (server/db/seed.ts)
Run automatically on first launch if projects table is empty:
```ts
export const SEED_PROJECTS: Omit<Project, 'id' | 'createdAt'>[] = [
  {
    name: 'PlayCru',
    shortName: 'playcru',
    description: 'Hyperlocal social sports app for Bangkok/SEA. Flutter/Firebase. Pickup games, ELO ratings, crew management across 6 sports.',
    color: '#2ECC71',
    status: 'active',
    techStack: ['Flutter', 'Firebase', 'Dart', 'Firestore', 'Cloud Functions', 'Riverpod'],
    type: 'mobile',
    repoUrl: ''
  },
  {
    name: 'WealthView Pro',
    shortName: 'quantcru',
    description: 'Fintech dashboard for Indian stock markets. Zerodha Kite API integration, algorithmic trading, LSTM prediction models, NSE/BSE tracking.',
    color: '#F59E0B',
    status: 'active',
    techStack: ['Python', 'React', 'Zerodha Kite API', 'PostgreSQL', 'LSTM', 'pandas'],
    type: 'fintech',
    repoUrl: ''
  },
  {
    name: 'Memex',
    shortName: 'memex',
    description: 'Personal knowledge OS. Auto-classifies notes, recipes, media, passwords from Google Keep, URLs, YouTube, Instagram. Ollama-powered.',
    color: '#8B5CF6',
    status: 'active',
    techStack: ['React', 'Node.js', 'PostgreSQL', 'Ollama', 'pgvector', 'Tailwind'],
    type: 'web',
    repoUrl: ''
  },
  {
    name: 'DevBrain',
    shortName: 'devbrain',
    description: 'Private developer knowledge base. Document Q&A via RAG, issue investigation, commands library, release notes, runbooks.',
    color: '#6366F1',
    status: 'active',
    techStack: ['React', 'Node.js', 'PostgreSQL', 'Ollama', 'pgvector', 'Tailwind'],
    type: 'tool',
    repoUrl: ''
  },
  {
    name: 'Music Player',
    shortName: 'musicplayer',
    description: 'Cross-platform music player for Linux and Windows. Built with Flutter Desktop. Project for nephew — teaching and building together.',
    color: '#EC4899',
    status: 'planning',
    techStack: ['Flutter', 'Dart', 'just_audio', 'audioplayers'],
    type: 'desktop',
    repoUrl: ''
  }
]
```

### Document
```ts
type Document = {
  id: string
  projectId?: string           // null = global/cross-project
  title: string
  fileType: 'pdf' | 'docx' | 'md' | 'txt' | 'xlsx' | 'url'
  content: string
  tags: string[]
  source: string               // file path or URL
  createdAt: Date
}
// Chunks stored in document_chunks table with pgvector embedding column
```

### Issue
```ts
type Issue = {
  id: string
  projectId?: string
  title: string
  description: string
  status: 'open' | 'investigating' | 'resolved' | 'wont-fix'
  priority: 'low' | 'medium' | 'high' | 'critical'
  investigationSteps: { order: number; instruction: string; done: boolean }[]
  notes: { id: string; content: string; createdAt: Date }[]
  linkedDocs: string[]
  linkedCommands: string[]
  resolution: string
  tags: string[]
  createdAt: Date
  resolvedAt?: Date
}
```

### Command / Snippet
```ts
type Command = {
  id: string
  projectId?: string
  title: string
  command: string
  language: string             // 'bash' | 'python' | 'dart' | 'sql' | 'powershell' | 'yaml'
  description: string
  tags: string[]
  isFavorite: boolean
  lastUsed?: Date
}
```

### Release
```ts
type Release = {
  id: string
  projectId: string
  version: string              // semver
  date: Date
  type: 'major' | 'minor' | 'patch' | 'hotfix'
  fixes: string[]
  features: string[]
  breakingChanges: string[]
  notes: string
  linkedIssues: string[]
}
```

### Runbook
```ts
type Runbook = {
  id: string
  projectId?: string
  title: string
  steps: { order: number; instruction: string; command?: string; note?: string }[]
  tags: string[]
  lastUsedAt?: Date
}
```

## Project-Specific Commands (pre-seeded examples)

### PlayCru
```bash
# Deploy Cloud Functions to asia-southeast1
firebase deploy --only functions --project playcru-dev

# Start emulators with playcru-sg Firestore database
firebase emulators:start --only firestore,functions --project playcru-dev

# Flutter build Android release
flutter build apk --release --flavor production

# Flutter run with specific Firebase project
flutter run --dart-define=FIREBASE_PROJECT=playcru-dev

# View Firestore indexes
firebase firestore:indexes --project playcru-dev
```

### WealthView Pro (QuantCru)
```python
# Kite API — fetch OHLC historical data
kite.historical_data(instrument_token, from_date, to_date, interval="day")

# Fetch holdings
kite.holdings()

# Place order
kite.place_order(tradingsymbol="INFY", exchange="NSE", transaction_type="BUY",
                 quantity=1, order_type="MARKET", product="CNC")
```
```bash
# Run backtest
python backtest.py --strategy momentum --symbol RELIANCE --from 2023-01-01

# Start Kite WebSocket feed
python kite_ticker.py --tokens 738561 895745
```

### Music Player (Flutter Desktop)
```bash
# Run on Linux
flutter run -d linux

# Run on Windows
flutter run -d windows

# Build Linux release
flutter build linux --release

# Build Windows release
flutter build windows --release

# Add audio package
flutter pub add just_audio
```

## RAG Architecture (Document Q&A — 100% local)

### Ingestion
1. Upload file → `parser.ts` extracts plain text
2. Split into 512-token chunks with 64-token overlap
3. Embed each chunk via `nomic-embed-text` (Ollama, ~50ms/chunk on RTX 2060)
4. Store in `document_chunks` table with pgvector column

### Query Flow
1. User asks question → embed via `nomic-embed-text`
2. pgvector cosine similarity → top 5 chunks (scoped to project/doc if selected)
3. Inject chunks + question into `mistral:7b` prompt
4. Stream response via SSE → typewriter render in UI
5. Citations shown as collapsible cards below answer

### RAG System Prompt
```
You are a technical assistant for a developer's private knowledge base.
Answer using ONLY the provided document excerpts.
If the answer isn't in the excerpts, say "I don't see this in the provided documents."
Cite the document title for each fact you use.
Format your answer in Markdown.

Document excerpts:
{chunks}
```

## Navigation Structure
```
Top bar: [DevBrain logo] [Project switcher dropdown ▼] .............. [⌘K Search] [Settings]

Project switcher shows:
● PlayCru          (green dot)
● WealthView Pro   (amber dot)
● Memex            (purple dot)
● DevBrain         (indigo dot)
● Music Player     (pink dot)
─────────────────
  + New Project

Sidebar (scoped to selected project or "All Projects"):
├── Dashboard
├── Documents
├── Ask AI (DocChat)
├── Issues
├── Commands
├── Releases
└── Runbooks
```

## "All Projects" Global Views
- **Global Dashboard** — activity feed across all projects, open issues count per project, recently viewed
- **Global Search** — ⌘K searches across ALL projects simultaneously, results grouped by project with color dot
- **Global Commands** — all commands across projects, filterable by project chip
- **Global Issues** — all open issues across projects, sortable by priority + project

## Environment Variables
```env
DATABASE_URL=postgresql://devbrain:devbrain@localhost:5432/devbrain
OLLAMA_URL=http://localhost:11434
OLLAMA_CHAT_MODEL=mistral
PORT=3001
JWT_SECRET=<random 32-char string>

# Optional — set USE_CLAUDE=true to route AI calls through Claude API
ANTHROPIC_API_KEY=
USE_CLAUDE=false
```

## Performance on RTX 2060 Max-Q
| Task | Time |
|---|---|
| RAG answer (mistral:7b) | ~3–5 seconds |
| Embed a doc chunk (nomic-embed-text) | ~50ms |
| Command explanation (gemma3:4b) | ~1 second |
| Release note generation | ~2–3 seconds |
| Issue summarization | ~2–3 seconds |
| Full-text search (pg tsvector) | <50ms |
| Semantic search (pgvector) | <100ms |

## Code Style
- TypeScript strict mode, no `any`
- Zod for all API request validation
- Stream AI responses via SSE
- Shiki for syntax highlighting
- All file uploads processed server-side only
- All AI calls go through `services/ai.ts` — never call Ollama or Claude API directly from routes

## Design System
See design exported from Claude Design. Key tokens:
- Background: `#0A0A0F`
- Surface: `#12121A`, `#1A1A26`
- Accent: electric indigo `#6366F1`
- Project colors: PlayCru `#2ECC71`, QuantCru `#F59E0B`, Memex `#8B5CF6`, DevBrain `#6366F1`, Music `#EC4899`
- Success: `#22C55E`, Warning: `#F59E0B`, Danger: `#EF4444`
- Text primary: `#E2E8F0`, muted: `#64748B`
- Font display: `IBM Plex Sans`
- Font mono: `JetBrains Mono`
- Radius: `6px` cards, `4px` code blocks
- Borders: `1px solid rgba(255,255,255,0.08)`

## Cost Summary
| Feature | Cost |
|---|---|
| All AI features (RAG, explanation, summarization) | $0 — Ollama on local GPU |
| Semantic embeddings | $0 — Ollama local |
| Database + server | $0 — local Docker |
| Claude API (optional enhance button) | Pay-per-use, manual only |
| **Monthly baseline** | **$0** |

## Non-Goals (v1)
- No cloud hosting — local machine only
- No Git integration (v2)
- No Jira/Linear sync (v2)
- No real-time collaboration
- Claude API never auto-called — manual opt-in only

## Claude Code Integration

This project uses the **DevBrain x Claude Code** integration (`integrations/claude-code/`).

**Install (Windows):** `powershell -ExecutionPolicy Bypass -File integrations\claude-code\install.ps1`
— copies `.ps1` hooks to `~\.claude\scripts\`, registers them in `~\.claude\settings.json`

**Install (macOS/Linux/WSL):** `cd integrations/claude-code && ./install.sh`
— copies `.sh` hooks to `~/.claude/scripts/`, merges into `~/.claude/settings.json`

### What the Hooks Do
- **SessionStart** — scaffolds `TASKS.md` if absent, creates a timestamped session folder under `sessions/`, injects current task state + last session summary into Claude's context
- **SessionEnd** — marks session completed, appends row to `sessions/index.md`

### File Locations
- `TASKS.md` — project root; tracks work phases and backlog
- `sessions/YYYY-MM-DD_HH-MM_<id>/SESSION.md` — per-session log
- `sessions/index.md` — session timeline

### Claude Responsibilities at Session End
1. Update `TASKS.md` checkboxes: `[x]` done · `[~]` in-progress · `[!]` blocked
2. Fill in the active `SESSION.md`: Goals, Work Done, Decisions, Open Items (bullets, max 5 each)

Trigger manually: `/devbrain` — or say "update tasks" / "write session summary".

---

## Antigravity Integration

This project also supports the **DevBrain x Antigravity** integration (`integrations/antigravity/`) — the same session-tracking pattern as Claude Code, but for the **Gemini CLI / Antigravity** AI assistant.

**Install (Windows):** `powershell -ExecutionPolicy Bypass -File integrations\antigravity\install.ps1`
— copies `.ps1` hooks to `~\.gemini\config\scripts\`, registers them in `~\.gemini\config\hooks.json`

**Install (macOS/Linux/WSL):** `cd integrations/antigravity && ./install.sh`
— copies `.sh` hooks to `~/.gemini/config/scripts/`, merges into `~/.gemini/config/hooks.json`

### What the Hooks Do
- **SessionStart** — scaffolds `TASKS.md` if absent, archives stale completed tasks to `TASKS_ARCHIVE.md`, creates a timestamped session folder under `sessions/`, prints per-phase task progress + last session summary to stdout (Antigravity reads this as context at session open)
- **SessionEnd** — writes the completed timestamp, appends a row to `sessions/index.md`

### File Locations (per linked project)
- `TASKS.md` — project root; tracks work phases and backlog
- `TASKS_ARCHIVE.md` — completed tasks stamped `<!-- done: YYYY-MM-DD -->` older than 7 days are auto-archived here
- `sessions/YYYY-MM-DD_HH-MM_<id>/SESSION.md` — per-session log
- `sessions/index.md` — session timeline

### Task Markers
`[ ]` todo · `[x]` done · `[~]` in-progress · `[!]` blocked

### AI Responsibilities at Session End
1. Update `TASKS.md` checkboxes
2. Fill in the active `SESSION.md`: Goals, Work Done, Decisions, Open Items (bullets, max 5 each)

Trigger manually: `/devbrain` — or say "update tasks" / "write session summary" / "mark X as done".

### DevBrain Server-Side (Antigravity Discovery)
- **`server/routes/antigravity-projects.ts`** — REST endpoints: `POST /api/antigravity-projects/scan`, `GET /api/antigravity-projects/:id/tasks`, `GET /api/antigravity-projects/:id/sessions`, `GET /api/antigravity-projects/:id/sessions/:sid`, `GET /api/antigravity-projects/:id/tasks/watch` (SSE live updates)
- **`server/services/antigravity-discovery.ts`** — walks a configured `scan_root` directory, detects projects by presence of `TASKS.md`, parses frontmatter + task phases + session history
- **Settings** — `GET/PUT /api/settings/antigravity` stores `antigravity_scan_root` in `app_settings`; configure the root folder in Settings → Antigravity Integration

### Projects Page
The "Link folder" modal now accepts `TASKS.md`, `CLAUDE.md`, or `ANTIGRAVITY.md` as the marker file, and the project badge shows **AI SYNC** for any linked integration (Claude Code or Antigravity).
