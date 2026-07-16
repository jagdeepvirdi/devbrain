/**
 * Migration: rechunk_all_documents
 *
 * One-time re-embed of every existing document with the new chunking
 * algorithm from Phase 32.3 (token-based sizing, Markdown-header-aware
 * splitting, document-title metadata header on every chunk). Existing
 * chunks were built with the old fixed-1800-char splitter and no title
 * header, so they benefit from being redone.
 *
 * Unlike the schema-only migrations in this folder, this one needs the
 * real app modules (pool, embedder, aiEmbed) — which pull in `env.ts`,
 * which reads process.env directly with no dotenv.config() of its own.
 * So `.env` is parsed into process.env here BEFORE those modules are
 * imported (dynamically, after the env is ready).
 *
 * Run from server/ directory:
 *   npx tsx db/migrations/rechunk_all_documents.ts
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
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

async function run(): Promise<void> {
  const { pool }          = await import('../pool.js')
  const { embedDocument } = await import('../../services/embedder.js')

  const { rows } = await pool.query<{ id: string; title: string; content: string; language: string | null }>(
    'SELECT id, title, content, language FROM documents ORDER BY created_at'
  )

  console.log(`Re-chunking ${rows.length} document(s) with the new token-based, title-aware chunker...\n`)

  let done = 0
  let failed = 0

  for (const doc of rows) {
    try {
      const count = await embedDocument(doc.id, doc.content, { title: doc.title, language: doc.language })
      await pool.query(`UPDATE documents SET embedding_status = 'done' WHERE id = $1`, [doc.id])
      done++
      console.log(`  [${done + failed}/${rows.length}] "${doc.title}" — ${count} chunks`)
    } catch (err) {
      failed++
      console.error(`  [!!] "${doc.title}" failed:`, (err as Error).message)
      await pool.query(`UPDATE documents SET embedding_status = 'failed' WHERE id = $1`, [doc.id]).catch(() => {})
    }
  }

  console.log(`\nDone. Re-chunked ${done}/${rows.length} document(s)${failed ? `, ${failed} failed` : ''}.\n`)
  await pool.end()
}

run().catch(err => { console.error(err); process.exit(1) })
