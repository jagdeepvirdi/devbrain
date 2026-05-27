import { createRequire } from 'module'
const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const archiver = require('archiver') as typeof import('archiver')
import matter from 'gray-matter'
import { pool } from '../db/pool.js'

export type ExportProject = { id: string; name: string; short_name: string }

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'untitled'
}

// ── Markdown builders ─────────────────────────────────────────────────────

function documentMd(doc: DbDocument): string {
  return matter.stringify(doc.content ?? '', {
    title:      doc.title,
    file_type:  doc.file_type,
    tags:       doc.tags,
    source:     doc.source,
    created_at: doc.created_at,
  })
}

function issueMd(issue: DbIssue): string {
  const steps = (issue.investigation_steps as Step[]) ?? []
  const notes = (issue.notes as Note[]) ?? []
  const body = [
    issue.description ? `${issue.description}\n` : '',
    steps.length > 0
      ? `## Investigation Steps\n\n${steps.map(s => `- [${s.done ? 'x' : ' '}] ${s.instruction}`).join('\n')}\n`
      : '',
    notes.length > 0
      ? `## Notes\n\n${notes.map(n => `- ${n.content}`).join('\n')}\n`
      : '',
  ].filter(Boolean).join('\n')

  return matter.stringify(body, {
    title:       issue.title,
    status:      issue.status,
    priority:    issue.priority,
    tags:        issue.tags,
    description: issue.description,
    resolution:  issue.resolution,
    created_at:  issue.created_at,
    resolved_at: issue.resolved_at ?? null,
  })
}

function commandMd(cmd: DbCommand): string {
  const body = `\`\`\`${cmd.language}\n${cmd.command}\n\`\`\`\n`
  return matter.stringify(body, {
    title:       cmd.title,
    language:    cmd.language,
    description: cmd.description,
    tags:        cmd.tags,
    is_favorite: cmd.is_favorite,
    created_at:  cmd.created_at,
  })
}

function issuesMd(issues: DbIssue[], projectName: string): string {
  const sections = issues.map(i => {
    const steps = (i.investigation_steps as Step[]) ?? []
    const notes = (i.notes as Note[]) ?? []
    return [
      `## ${i.title}`,
      '',
      `**Status:** ${i.status} | **Priority:** ${i.priority} | **Tags:** ${i.tags.join(', ') || '—'}`,
      `**Created:** ${i.created_at.slice(0, 10)}`,
      '',
      i.description || '',
      steps.length > 0 ? `\n### Steps\n\n${steps.map(s => `- [${s.done ? 'x' : ' '}] ${s.instruction}`).join('\n')}` : '',
      notes.length > 0 ? `\n### Notes\n\n${notes.map(n => `- ${n.content}`).join('\n')}` : '',
    ].filter(x => x !== undefined).join('\n').trimEnd()
  })
  return `# Issues — ${projectName}\n\n${sections.join('\n\n---\n\n')}`
}

function commandsMd(commands: DbCommand[], projectName: string): string {
  const sections = commands.map(c => [
    `## ${c.title}`,
    '',
    `**Language:** ${c.language} | **Favorite:** ${c.is_favorite} | **Tags:** ${c.tags.join(', ') || '—'}`,
    '',
    c.description || '',
    '',
    `\`\`\`${c.language}\n${c.command}\n\`\`\``,
  ].join('\n').trimEnd())
  return `# Commands — ${projectName}\n\n${sections.join('\n\n---\n\n')}`
}

function releasesMd(releases: DbRelease[], projectName: string): string {
  const sections = releases.map(r => {
    const features      = (r.features      ?? []).map((f: string) => `- ${f}`).join('\n')
    const fixes         = (r.fixes         ?? []).map((f: string) => `- ${f}`).join('\n')
    const breakingChanges = (r.breaking_changes ?? []).map((f: string) => `- ${f}`).join('\n')
    return [
      `## ${r.version} (${r.date})`,
      '',
      `**Type:** ${r.type} | **Date:** ${r.date}`,
      r.notes ? `\n${r.notes}` : '',
      features      ? `\n### Features\n\n${features}`       : '',
      fixes         ? `\n### Fixes\n\n${fixes}`             : '',
      breakingChanges ? `\n### Breaking Changes\n\n${breakingChanges}` : '',
    ].filter(Boolean).join('\n').trimEnd()
  })
  return `# Releases — ${projectName}\n\n${sections.join('\n\n---\n\n')}`
}

function runbooksMd(runbooks: DbRunbook[], projectName: string): string {
  const sections = runbooks.map(rb => {
    const steps = (rb.steps as RunbookStep[]) ?? []
    return [
      `## ${rb.title}`,
      '',
      `**Tags:** ${rb.tags.join(', ') || '—'}`,
      steps.length > 0
        ? `\n### Steps\n\n${steps.map((s, i) => `${i + 1}. ${s.instruction}${s.command ? `\n   \`${s.command}\`` : ''}${s.note ? `\n   *${s.note}*` : ''}`).join('\n')}`
        : '',
    ].filter(Boolean).join('\n').trimEnd()
  })
  return `# Runbooks — ${projectName}\n\n${sections.join('\n\n---\n\n')}`
}

// ── DB row types ──────────────────────────────────────────────────────────

interface Step        { instruction: string; done: boolean }
interface Note        { content: string; created_at: string }
interface RunbookStep { instruction: string; command?: string; note?: string }

interface DbDocument { id: string; title: string; file_type: string; tags: string[]; source: string; created_at: string; content: string }
interface DbIssue    { id: string; title: string; status: string; priority: string; tags: string[]; description: string; resolution: string; created_at: string; resolved_at: string | null; investigation_steps: unknown; notes: unknown }
interface DbCommand  { id: string; title: string; command: string; language: string; description: string; tags: string[]; is_favorite: boolean; created_at: string }
interface DbRelease  { id: string; version: string; date: string; type: string; features: string[]; fixes: string[]; breaking_changes: string[]; notes: string; created_at: string }
interface DbRunbook  { id: string; title: string; steps: unknown; tags: string[]; last_used_at: string | null; created_at: string }

// ── Core export function ──────────────────────────────────────────────────

export async function addProjectToArchive(archive: archiver.Archiver, project: ExportProject): Promise<void> {
  const p = project.short_name

  const [docs, issues, commands, releases, runbooks] = await Promise.all([
    pool.query<DbDocument>(
      'SELECT id, title, file_type, tags, source, created_at, content FROM documents WHERE project_id = $1 ORDER BY created_at',
      [project.id],
    ),
    pool.query<DbIssue>(
      'SELECT id, title, status, priority, tags, description, resolution, created_at, resolved_at, investigation_steps, notes FROM issues WHERE project_id = $1 ORDER BY created_at',
      [project.id],
    ),
    pool.query<DbCommand>(
      'SELECT id, title, command, language, description, tags, is_favorite, created_at FROM commands WHERE project_id = $1 ORDER BY created_at',
      [project.id],
    ),
    pool.query<DbRelease>(
      'SELECT id, version, date, type, features, fixes, breaking_changes, notes, created_at FROM releases WHERE project_id = $1 ORDER BY date DESC',
      [project.id],
    ),
    pool.query<DbRunbook>(
      'SELECT id, title, steps, tags, last_used_at, created_at FROM runbooks WHERE project_id = $1 ORDER BY created_at',
      [project.id],
    ),
  ])

  // One .md per document (with frontmatter + content)
  for (const doc of docs.rows) {
    archive.append(documentMd(doc), { name: `${p}/documents/${slugify(doc.title)}.md` })
  }

  // One .md per issue (individual, frontmatter-parseable for import)
  for (const issue of issues.rows) {
    archive.append(issueMd(issue), { name: `${p}/issues/${slugify(issue.title)}.md` })
  }

  // One .md per command (individual, frontmatter-parseable for import)
  for (const cmd of commands.rows) {
    archive.append(commandMd(cmd), { name: `${p}/commands/${slugify(cmd.title)}.md` })
  }

  // Collective human-readable files (per spec)
  if (issues.rows.length > 0) {
    archive.append(issuesMd(issues.rows, project.name), { name: `${p}/issues.md` })
  }
  if (commands.rows.length > 0) {
    archive.append(commandsMd(commands.rows, project.name), { name: `${p}/commands.md` })
  }
  if (releases.rows.length > 0) {
    archive.append(releasesMd(releases.rows, project.name), { name: `${p}/releases.md` })
  }
  if (runbooks.rows.length > 0) {
    archive.append(runbooksMd(runbooks.rows, project.name), { name: `${p}/runbooks.md` })
  }
}

export async function buildZipToStream(
  archive: archiver.Archiver,
  projectIds: string[] | 'all',
): Promise<void> {
  let projects: ExportProject[]
  if (projectIds === 'all') {
    const { rows } = await pool.query<ExportProject>('SELECT id, name, short_name FROM projects ORDER BY name')
    projects = rows
  } else {
    const { rows } = await pool.query<ExportProject>(
      'SELECT id, name, short_name FROM projects WHERE id = ANY($1) ORDER BY name',
      [projectIds],
    )
    projects = rows
  }
  for (const project of projects) {
    await addProjectToArchive(archive, project)
  }
  await archive.finalize()
}
