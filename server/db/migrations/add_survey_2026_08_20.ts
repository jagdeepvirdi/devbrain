/**
 * Migration: add_survey_2026_08_20
 *
 * Adds every active project found under D:\Project that wasn't already tracked
 * in DevBrain, discovered by a filesystem survey on 2026-08-20. Skips folders
 * that aren't standalone projects (`common/`, `design/` — shared reference/asset
 * folders, not code projects) and anything already seeded (Music Player has no
 * folder yet — still planning).
 *
 * Run from D:\Project\devbrain\server:
 *   npx tsx db/migrations/add_survey_2026_08_20.ts
 *
 * Idempotent — safe to run more than once (skips by short_name if it already exists).
 * Uses its own pg.Pool so it does not need JWT_SECRET or other server env vars.
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)

try {
  const raw = readFileSync(resolve(__dirname, '../../.env'), 'utf-8')
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim()
    if (!process.env[key]) process.env[key] = val
  }
} catch {
  // no .env — rely on environment
}

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('[!!] DATABASE_URL is not set')
  process.exit(1)
}

const { Pool } = pg
const pool = new Pool({ connectionString: DATABASE_URL })

type ProjectSeed = {
  name:             string
  short_name:       string
  description:      string
  color:            string
  status:           'active' | 'paused' | 'planning'
  tech_stack:       string[]
  type:             'mobile' | 'web' | 'desktop' | 'fintech' | 'tool' | 'integration'
  kind:             'personal' | 'office'
  git_type:         'github' | 'local-git' | null
  repo_path:        string
  repo_url:         string | null
  claude_code_safe: boolean
}

const PROJECTS: ProjectSeed[] = [
  {
    name:             'ArcInvestments',
    short_name:       'arcinvestments',
    description:      'Professional-grade Thai stock market analysis dashboard covering SET100, sSET, and MAI (~254 equities). Frontend-only React/Vite app with a dark financial-terminal aesthetic; real Yahoo Finance data merged with a mock fallback per ticker.',
    color:            '#14B8A6',
    status:           'active',
    tech_stack:       ['React', 'Vite', 'Tailwind CSS', 'JavaScript', 'Python (Yahoo Finance fetch)'],
    type:             'fintech',
    kind:             'personal',
    git_type:         'github',
    repo_path:        'D:\\Project\\ArcInvestments',
    repo_url:         'https://github.com/jagdeepvirdi/arc-investments',
    claude_code_safe: true,
  },
  {
    name:             'Residual Edge',
    short_name:       'residualedge',
    description:      'Multi-strategy quantitative research + trading system for NSE/BSE Indian equities: market-neutral paper strategy, live-capital compounder, intraday research backtester (JARVIS), and an AI-infrastructure investment tracker (Brahma-AI) — all sharing one real-time ops dashboard.',
    color:            '#3B82F6',
    status:           'active',
    tech_stack:       ['Python', 'kiteconnect', 'upstox API', 'pandas', 'scikit-learn', 'optuna', 'Playwright', 'PostgreSQL', 'React', 'Vite', 'Claude API'],
    type:             'fintech',
    kind:             'personal',
    git_type:         'github',
    repo_path:        'D:\\Project\\ResidualEdge',
    repo_url:         'https://github.com/jagdeepvirdi/ResidualEdge',
    claude_code_safe: true,
  },
  {
    name:             'Tekton India',
    short_name:       'tekton',
    description:      'Full static marketing/e-commerce website for Tekton India, a custom resin/epoxy furniture brand in Kanpur. Showcases finished products and an interactive custom table configurator (Three.js 3D preview). Pure HTML/CSS/JS, no build step, deploys to GoDaddy shared hosting.',
    color:            '#C2410C',
    status:           'active',
    tech_stack:       ['HTML', 'CSS', 'JavaScript', 'Three.js', 'Formspree', 'EmailJS', 'Firebase'],
    type:             'web',
    kind:             'personal',
    git_type:         'github',
    repo_path:        'D:\\Project\\Tekton',
    repo_url:         'https://github.com/jagdeepvirdi/tekton',
    claude_code_safe: true,
  },
  {
    name:             'Aina',
    short_name:       'aina',
    description:      '"India, Unfiltered." — an ad-free aggregator of independent Indian journalism: topic feeds and Investigation Timelines built from native RSS/YouTube/Substack feeds, with build-time AI summarization/categorization (falls back to deterministic heuristics with no LLM key). Astro SSG (AstroPaper base) + Pagefind search; pre-launch as of 2026-07-23.',
    color:            '#F43F5E',
    status:           'active',
    tech_stack:       ['Astro', 'Tailwind CSS', 'JavaScript', 'Pagefind', 'GitHub Actions', 'Gemini/Anthropic API'],
    type:             'web',
    kind:             'personal',
    git_type:         'local-git',
    repo_path:        'D:\\Project\\aina',
    repo_url:         null,
    claude_code_safe: true,
  },
  {
    name:             'jagdeepsinghvirdi.com',
    short_name:       'jsvsite',
    description:      'Personal portfolio/landing site at jagdeepsinghvirdi.com. Single-page static site with an animated bracket logo mark and rotating tagline.',
    color:            '#06B6D4',
    status:           'active',
    tech_stack:       ['HTML', 'CSS', 'JavaScript'],
    type:             'web',
    kind:             'personal',
    git_type:         'github',
    repo_path:        'D:\\Project\\jagdeepsinghvirdi\\jagdeepsinghvirdi.com',
    repo_url:         'https://github.com/jagdeepvirdi/jagdeepsinghvirdi.com',
    claude_code_safe: true,
  },
  {
    name:             'File to Markdown',
    short_name:       'mdconverter',
    description:      'Local-first, fully offline desktop app that converts documents (PDF, DOCX, legacy .doc, images, audio/video) to Markdown using Microsoft MarkItDown, with OCR and transcription. Native window via pywebview (WebView2), packaged with PyInstaller.',
    color:            '#84CC16',
    status:           'active',
    tech_stack:       ['Python', 'pywebview', 'MarkItDown', 'PyInstaller', 'JavaScript'],
    type:             'desktop',
    kind:             'personal',
    git_type:         'github',
    repo_path:        'D:\\Project\\md-converter',
    repo_url:         'https://github.com/jagdeepvirdi/file-to-markdown',
    claude_code_safe: true,
  },
  {
    name:             'PDF Merge',
    short_name:       'mergepdf',
    description:      'Standalone, offline-capable single-page web app for merging PDFs entirely client-side with per-file page-range selection and drag-to-reorder — no server, no upload, files never leave the device. Built on vendored pdf-lib.',
    color:            '#0EA5E9',
    status:           'paused',
    tech_stack:       ['HTML', 'JavaScript', 'pdf-lib'],
    type:             'tool',
    kind:             'personal',
    git_type:         null,
    repo_path:        'D:\\Project\\merge-pdf',
    repo_url:         null,
    claude_code_safe: true,
  },
  {
    name:             'Mosaic Life',
    short_name:       'orbitly',
    description:      'Personal life operating system for Jagdeep and family ("Everything. Together. Balanced.") — Today dashboard, Calendar, Learning Planner, Tasks, Health & Wellness, Festivals, Sports Tracker, Family Space. Rebranded from "Orbitly"; internal identifiers (repo, package name, storage keys) intentionally kept the old name.',
    color:            '#D946EF',
    status:           'active',
    tech_stack:       ['React', 'Vite', 'Tailwind CSS', 'React Router', 'Docker'],
    type:             'web',
    kind:             'personal',
    git_type:         'github',
    repo_path:        'D:\\Project\\orbitly',
    repo_url:         'https://github.com/jagdeepvirdi/orbitly',
    claude_code_safe: true,
  },
  {
    name:             'Outpost',
    short_name:       'outpost',
    description:      'Standalone log/process watcher and error-alerting tool for the NT Billing project — tails and rotates Perl/Oracle batch logs on a bastion host (rsync mirror from the read-only production host), categorizes errors by regex/keyword rules, dedups within a rolling window, and reports into DevBrain via /api/notify and /api/issues. No LLM dependency by design.',
    color:            '#475569',
    status:           'active',
    tech_stack:       ['Python', 'PyYAML', 'requests', 'SQLite (planned)'],
    type:             'tool',
    kind:             'personal',
    git_type:         null,
    repo_path:        'D:\\Project\\Outpost',
    repo_url:         null,
    claude_code_safe: true,
  },
]

async function run(): Promise<void> {
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    console.log(`\n[1/2] Inserting ${PROJECTS.length} projects (skip if short_name exists)...\n`)

    for (const p of PROJECTS) {
      const { rows } = await client.query<{ id: string }>(
        'SELECT id FROM projects WHERE short_name = $1', [p.short_name]
      )

      if (rows.length > 0) {
        console.log(`      [SKIP] ${p.name} already exists (id=${rows[0].id})`)
        continue
      }

      const { rows: inserted } = await client.query<{ id: string }>(
        `INSERT INTO projects
           (name, short_name, description, color, status, tech_stack,
            type, kind, git_type, repo_path, repo_url, claude_code_safe, fs_path)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$10)
         RETURNING id`,
        [
          p.name, p.short_name, p.description, p.color, p.status, p.tech_stack,
          p.type, p.kind, p.git_type, p.repo_path, p.repo_url, p.claude_code_safe,
        ]
      )
      console.log(`      [OK]   ${p.name} inserted id=${inserted[0].id}`)
    }

    await client.query('COMMIT')
    console.log('\n[2/2] COMMIT — migration complete.\n')

  } catch (err) {
    await client.query('ROLLBACK')
    console.error('\n[!!] ROLLBACK — migration failed:', (err as Error).message)
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

run().catch(() => process.exit(1))
