/**
 * Migration: backfill_document_titles
 *
 * Documents uploaded before the heading-aware title extraction (see
 * services/parser.ts extractMarkdownHeadingTitle) were all titled from their
 * filename, even when the document itself had a clear `# Heading`. This
 * retroactively re-derives a title from each document's already-stored
 * content, using the exact same rule new uploads use.
 *
 * Only documents whose current title still looks auto-generated (i.e. still
 * equals the filename/hostname `source` would have produced) are touched —
 * anything you've since retitled by hand is left alone.
 *
 * Run from server/ directory:
 *   npx tsx db/migrations/backfill_document_titles.ts           # dry run, no writes
 *   npx tsx db/migrations/backfill_document_titles.ts --apply   # writes the updates
 */

import { readFileSync } from 'fs'
import path, { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

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
} catch { /* no .env — rely on environment */ }

// Same filename-derivation rule parser.ts uses when it first assigns a title.
function expectedAutoTitle(fileType: string, source: string): string | null {
  if (!source) return null
  if (fileType === 'url') {
    try { return new URL(source).hostname } catch { return null }
  }
  return path.basename(source, path.extname(source))
}

async function run(): Promise<void> {
  const apply = process.argv.includes('--apply')

  const { pool }                       = await import('../pool.js')
  const { extractMarkdownHeadingTitle } = await import('../../services/parser.js')

  const { rows } = await pool.query<{ id: string; title: string; content: string; file_type: string; source: string }>(
    `SELECT id, title, content, file_type, source FROM documents
     WHERE file_type IN ('md', 'pdf', 'docx', 'xlsx', 'txt', 'url')
     ORDER BY created_at`
  )

  console.log(`Scanning ${rows.length} document(s) for a retitle-worthy heading (${apply ? 'APPLY' : 'DRY RUN'})...\n`)

  let changed = 0
  let skippedEdited = 0
  let skippedNoHeading = 0

  for (const row of rows) {
    const expected = expectedAutoTitle(row.file_type, row.source)
    if (expected === null || row.title !== expected) {
      skippedEdited++
      continue
    }

    const heading = extractMarkdownHeadingTitle(row.content)
    if (!heading || heading === row.title) {
      skippedNoHeading++
      continue
    }

    changed++
    console.log(`  "${row.title}" -> "${heading}"  (id=${row.id})`)
    if (apply) {
      await pool.query('UPDATE documents SET title = $2 WHERE id = $1', [row.id, heading])
    }
  }

  console.log(`\n${changed} document(s) ${apply ? 'retitled' : 'would be retitled'}.`)
  console.log(`${skippedEdited} skipped (title differs from filename — looks manually edited).`)
  console.log(`${skippedNoHeading} skipped (no leading heading found in content).`)
  if (!apply && changed > 0) {
    console.log('\nDry run only — re-run with --apply to write these changes.')
  }

  await pool.end()
}

run().catch(err => { console.error(err); process.exit(1) })
