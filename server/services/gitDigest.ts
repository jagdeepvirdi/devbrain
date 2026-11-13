import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { aiChat } from './ai.js'
import { requireLocalAI } from '../lib/requireLocalAI.js'

const execFileAsync = promisify(execFile)

export const CHUNK_SIZE = 40
const MAX_COMMITS = 400          // hard cap per project per week
const MAX_SUBJECT_LEN = 200

export interface Commit { sha: string; date: string; author: string; subject: string }
export interface DigestSummary {
  highlights: string[]; features: string[]; fixes: string[]; risks: string[]; summary: string
}
export interface GitStats { files_changed: number; insertions: number; deletions: number }

// ── Week math (UTC, Monday-based) ────────────────────────────────────────────

/** Normalize any YYYY-MM-DD to the Monday of its week; returns [monday, nextMonday]. */
export function weekBounds(day: string): { start: string; end: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('week must be YYYY-MM-DD')
  const d = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) throw new Error('week must be a valid date')
  const offset = (d.getUTCDay() + 6) % 7          // Mon=0 … Sun=6
  const start = new Date(d.getTime() - offset * 86_400_000)
  const end = new Date(start.getTime() + 7 * 86_400_000)
  const iso = (x: Date) => x.toISOString().slice(0, 10)
  return { start: iso(start), end: iso(end) }
}

// ── Git collection (execFile only — never a shell string) ────────────────────

function git(args: string[], cwd: string) {
  return execFileAsync('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 })
}

const SEP = '\x1f'

export async function collectCommits(repoPath: string, start: string, end: string): Promise<Commit[]> {
  const { stdout } = await git([
    'log', `--since=${start}T00:00:00Z`, `--until=${end}T00:00:00Z`,
    '--no-merges', `-n${MAX_COMMITS}`,
    `--pretty=format:%h${SEP}%aI${SEP}%an${SEP}%s`,
  ], repoPath)
  return stdout.split('\n').filter(Boolean).map(line => {
    const [sha, date, author, ...rest] = line.split(SEP)
    return { sha, date, author, subject: rest.join(SEP).slice(0, MAX_SUBJECT_LEN) }
  })
}

export async function collectBranches(repoPath: string, start: string): Promise<string[]> {
  const { stdout } = await git([
    'for-each-ref', '--sort=-committerdate', '--format=%(refname:short)%1f%(committerdate:short)',
    'refs/heads',
  ], repoPath)
  return stdout.split('\n').filter(Boolean)
    .map(l => l.split(SEP))
    .filter(([, d]) => d >= start)
    .map(([name]) => name)
}

export async function collectStats(repoPath: string, start: string, end: string): Promise<GitStats> {
  const { stdout } = await git([
    'log', `--since=${start}T00:00:00Z`, `--until=${end}T00:00:00Z`,
    '--no-merges', `-n${MAX_COMMITS}`, '--shortstat', '--pretty=format:',
  ], repoPath)
  const stats: GitStats = { files_changed: 0, insertions: 0, deletions: 0 }
  for (const m of stdout.matchAll(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/g)) {
    stats.files_changed += Number(m[1])
    stats.insertions    += Number(m[2] ?? 0)
    stats.deletions     += Number(m[3] ?? 0)
  }
  return stats
}

// ── Map-reduce summarization ─────────────────────────────────────────────────

export function chunk<T>(items: T[], size = CHUNK_SIZE): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

const EMPTY: DigestSummary = { highlights: [], features: [], fixes: [], risks: [], summary: '' }

/** Pull a DigestSummary out of a model reply; throws if no usable JSON object. */
export function parseSummary(raw: string): DigestSummary {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('AI returned no JSON object')
  const j = JSON.parse(match[0]) as Partial<DigestSummary>
  const arr = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  return {
    highlights: arr(j.highlights), features: arr(j.features), fixes: arr(j.fixes), risks: arr(j.risks),
    summary: typeof j.summary === 'string' ? j.summary : '',
  }
}

const SYSTEM = 'You are a technical writer summarizing a week of git commits. Return only valid JSON.'

const SHAPE = `Return ONLY a JSON object with this exact structure (no markdown, no explanation):
{
  "highlights": ["most important things shipped or changed"],
  "features": ["new functionality"],
  "fixes": ["bug fixes and hardening"],
  "risks": ["risky, unfinished or breaking changes worth a second look"],
  "summary": "2-3 sentence overview"
}
Keep items concise and user-facing. Use empty arrays when a category has nothing.`

/** Call the model; on malformed JSON retry once (mirrors the release importer). */
async function ask(prompt: string): Promise<DigestSummary> {
  try {
    return parseSummary(await aiChat(prompt, SYSTEM))
  } catch {
    return parseSummary(await aiChat(prompt, SYSTEM))
  }
}

const uniq = (xs: string[]) => [...new Set(xs)]

export async function summarizeCommits(commits: Commit[]): Promise<DigestSummary> {
  if (!commits.length) return { ...EMPTY, summary: 'No commits this week.' }

  const partials: DigestSummary[] = []
  for (const part of chunk(commits)) {
    const list = part.map(c => `- ${c.subject}`).join('\n')
    partials.push(await ask(`Summarize these git commit messages.\n\nCommits:\n${list}\n\n${SHAPE}`))
  }
  if (partials.length === 1) return partials[0]

  // Reduce: merge the per-chunk results into one digest.
  const merged = partials.map((p, i) =>
    `Part ${i + 1}: ${p.summary}\nHighlights: ${p.highlights.join('; ')}\nFeatures: ${p.features.join('; ')}\n` +
    `Fixes: ${p.fixes.join('; ')}\nRisks: ${p.risks.join('; ')}`).join('\n\n')
  try {
    return await ask(`Merge these partial summaries of one week's commits into a single deduplicated summary.\n\n${merged}\n\n${SHAPE}`)
  } catch {
    // Merge step failed twice — fall back to a mechanical union rather than lose the week.
    return {
      highlights: uniq(partials.flatMap(p => p.highlights)), features: uniq(partials.flatMap(p => p.features)),
      fixes: uniq(partials.flatMap(p => p.fixes)), risks: uniq(partials.flatMap(p => p.risks)),
      summary: partials.map(p => p.summary).filter(Boolean).join(' '),
    }
  }
}

// ── Public entry point ───────────────────────────────────────────────────────

export interface ProjectDigest {
  week_start: string; week_end: string; commit_count: number
  branches: string[]; stats: GitStats; summary: DigestSummary
}

export async function buildProjectDigest(repoPath: string, week: string): Promise<ProjectDigest> {
  requireLocalAI()
  const { start, end } = weekBounds(week)
  const commits = await collectCommits(repoPath, start, end)
  const [branches, stats, summary] = await Promise.all([
    collectBranches(repoPath, start),
    collectStats(repoPath, start, end),
    summarizeCommits(commits),
  ])
  return { week_start: start, week_end: end, commit_count: commits.length, branches, stats, summary }
}
