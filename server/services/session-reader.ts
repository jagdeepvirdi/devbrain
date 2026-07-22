import path from 'node:path'
import { promises as fs } from 'node:fs'
import matter from 'gray-matter'
import { frontmatterString } from '../lib/frontmatter.js'

export interface SessionSummary {
  sessionId:     string
  folderName:    string
  date:          string   // YYYY-MM-DD
  started:       string   // ISO or folder-derived
  ended?:        string   // ISO, only when completed
  status:        'active' | 'completed'
  goals:         string[]
  workDone:      string[]
  decisions:     string[]
  openItems:     string[]
  workDoneCount: number
}

export interface SessionDetail extends SessionSummary {
  rawMarkdown: string
}

// ── Section parser ────────────────────────────────────────────────────────────

function parseSections(body: string) {
  const sections: Record<string, string[]> = {}
  let ended: string | undefined
  let current: string | null = null
  let inEndedBlock = false

  for (const raw of body.split('\n')) {
    const line = raw.trim()

    if (/^##\s+Session\s+Ended/i.test(line)) {
      inEndedBlock = true
      current = null
      continue
    }

    if (inEndedBlock) {
      const m = line.match(/^ended:\s*(.+)/)
      if (m) { ended = m[1].trim(); inEndedBlock = false }
      continue
    }

    if (/^## /.test(line)) {
      const key = line.slice(3).trim().toLowerCase().replace(/\s+/g, '_')
      current = key
      sections[key] = sections[key] ?? []
      continue
    }

    if (current && /^[-*]\s/.test(line)) {
      sections[current].push(line.slice(2).trim())
    }
  }

  return {
    goals:      sections['goals']      ?? [],
    workDone:   sections['work_done']  ?? [],
    decisions:  sections['decisions']  ?? [],
    openItems:  sections['open_items'] ?? [],
    ended,
  }
}

function dateFromFolder(folderName: string): string {
  const m = folderName.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : ''
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Scan `<fsPath>/sessions/` and return a summary for every SESSION.md found.
 * Folders that can't be read are silently skipped — returns [] when the
 * sessions directory doesn't exist yet (project hasn't run any sessions).
 * Results are sorted newest-first by folder name.
 */
export async function readSessions(fsPath: string): Promise<SessionSummary[]> {
  const sessionsDir = path.join(fsPath, 'sessions')

  let entries: string[]
  try {
    entries = await fs.readdir(sessionsDir)
  } catch {
    return []
  }

  const sessions: SessionSummary[] = []

  for (const entry of entries) {
    const sessionFile = path.join(sessionsDir, entry, 'SESSION.md')
    try {
      const raw         = await fs.readFile(sessionFile, 'utf-8')
      const { data, content } = matter(raw)

      const folderName  = entry
      const date        = dateFromFolder(folderName)
      const sessionId   = data.session_id ? String(data.session_id) : folderName
      const started     = frontmatterString(data.started) ?? date
      const status: SessionSummary['status'] =
        data.status === 'completed' ? 'completed' : 'active'

      const { goals, workDone, decisions, openItems, ended } = parseSections(content)

      sessions.push({
        sessionId,
        folderName,
        date,
        started,
        ...(ended ? { ended } : {}),
        status,
        goals,
        workDone,
        decisions,
        openItems,
        workDoneCount: workDone.length,
      })
    } catch {
      // skip unreadable session folders
    }
  }

  // Newest first — folder name is lexicographically sortable (YYYY-MM-DD_HH-MM_…)
  sessions.sort((a, b) => b.folderName.localeCompare(a.folderName))

  return sessions
}

/**
 * Read a single SESSION.md and return its full detail including raw markdown.
 * Matches by `session_id` frontmatter field first, then by folder name as
 * a fallback (supports the case where session_id wasn't written).
 * Returns null when the session can't be found.
 */
export async function readSessionDetail(
  fsPath:    string,
  sessionId: string,
): Promise<SessionDetail | null> {
  const sessionsDir = path.join(fsPath, 'sessions')

  let entries: string[]
  try {
    entries = await fs.readdir(sessionsDir)
  } catch {
    return null
  }

  for (const entry of entries) {
    const sessionFile = path.join(sessionsDir, entry, 'SESSION.md')
    try {
      const raw               = await fs.readFile(sessionFile, 'utf-8')
      const { data, content } = matter(raw)

      const folderName = entry
      const sid        = data.session_id ? String(data.session_id) : folderName

      if (sid !== sessionId && folderName !== sessionId) continue

      const date    = dateFromFolder(folderName)
      const started = frontmatterString(data.started) ?? date
      const status: SessionSummary['status'] =
        data.status === 'completed' ? 'completed' : 'active'

      const { goals, workDone, decisions, openItems, ended } = parseSections(content)

      return {
        sessionId: sid,
        folderName,
        date,
        started,
        ...(ended ? { ended } : {}),
        status,
        goals,
        workDone,
        decisions,
        openItems,
        workDoneCount: workDone.length,
        rawMarkdown: raw,
      }
    } catch {
      continue
    }
  }

  return null
}
