/**
 * Migration: add_code_intel_graph
 *
 * Adds the storage layer for the Code Intelligence & Knowledge Graph engine
 * (TASKS.md Phase 40): code_nodes/code_edges hold the call/reference graph
 * (functions, subroutines, procedures, classes, scripts and the CALLS/
 * IMPORTS/READS_TABLE/WRITES_TABLE/INCLUDES relationships between them),
 * code_schema_tables/code_schema_columns hold an optional user-supplied table
 * definition registry that sharpens future SQL column-lineage resolution
 * once populated (empty at ship time — the SQL parser works structurally
 * without it), and code_unresolved_refs records call references indexing
 * couldn't statically resolve (dynamic dispatch, variable-built SQL, etc.)
 * instead of silently dropping them.
 * Safe to re-run (IF NOT EXISTS throughout).
 *
 * Run from server/ directory:
 *   npx tsx db/migrations/add_code_intel_graph.ts
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
} catch { /* no .env — rely on environment */ }

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) { console.error('[!!] DATABASE_URL not set'); process.exit(1) }

const { Pool } = pg
const pool = new Pool({ connectionString: DATABASE_URL })

async function run(): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    console.log('[1/5] Creating code_nodes table...')
    // file_path/start_line/end_line/content_hash are nullable — a 'table'
    // node (added when normalizing sql_bridge.py/perl_bridge.py output,
    // Phase 40) represents a table referenced in a READS_TABLE/WRITES_TABLE
    // edge that may never be CREATE TABLE-defined anywhere in the indexed
    // source, so it has no file location or content to hash. Every other
    // entity type still always has all four — this is nullable for that one
    // case, not optional in general.
    await client.query(`
      CREATE TABLE IF NOT EXISTS code_nodes (
        id           TEXT        PRIMARY KEY,
        project_id   TEXT        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        file_path    TEXT,
        language     TEXT        NOT NULL,
        entity_type  TEXT        NOT NULL,
        name         TEXT        NOT NULL,
        signature    TEXT,
        docstring    TEXT,
        start_line   INTEGER,
        end_line     INTEGER,
        content_hash TEXT,
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
    // Explicit ALTERs (not just relying on the CREATE above) so re-running
    // this migration against a database where it already ran with the old
    // NOT NULL constraints still picks up the relaxation.
    await client.query(`ALTER TABLE code_nodes ALTER COLUMN file_path DROP NOT NULL`)
    await client.query(`ALTER TABLE code_nodes ALTER COLUMN start_line DROP NOT NULL`)
    await client.query(`ALTER TABLE code_nodes ALTER COLUMN end_line DROP NOT NULL`)
    await client.query(`ALTER TABLE code_nodes ALTER COLUMN content_hash DROP NOT NULL`)
    await client.query(`CREATE INDEX IF NOT EXISTS code_nodes_project_idx ON code_nodes (project_id)`)
    await client.query(`CREATE INDEX IF NOT EXISTS code_nodes_file_path_idx ON code_nodes (file_path)`)
    console.log('      done')

    console.log('[2/5] Creating code_edges table...')
    // `columns` is populated only for READS_TABLE/WRITES_TABLE edges, once the
    // SQL bridge can resolve column-level lineage (see TASKS.md Phase 40) —
    // NULL means "unknown/unresolved", not "no columns".
    await client.query(`
      CREATE TABLE IF NOT EXISTS code_edges (
        source_id         TEXT NOT NULL REFERENCES code_nodes(id) ON DELETE CASCADE,
        target_id         TEXT NOT NULL REFERENCES code_nodes(id) ON DELETE CASCADE,
        relationship_type TEXT NOT NULL
                             CHECK (relationship_type IN ('CALLS', 'IMPORTS', 'READS_TABLE', 'WRITES_TABLE', 'INCLUDES')),
        columns            TEXT[],
        PRIMARY KEY (source_id, target_id, relationship_type)
      )
    `)
    await client.query(`CREATE INDEX IF NOT EXISTS code_edges_target_idx ON code_edges (target_id)`)
    await client.query(`CREATE INDEX IF NOT EXISTS code_edges_source_idx ON code_edges (source_id)`)
    console.log('      done')

    console.log('[3/5] Creating code_schema_tables/code_schema_columns...')
    await client.query(`
      CREATE TABLE IF NOT EXISTS code_schema_tables (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        table_name TEXT NOT NULL,
        PRIMARY KEY (project_id, table_name)
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS code_schema_columns (
        project_id  TEXT NOT NULL,
        table_name  TEXT NOT NULL,
        column_name TEXT NOT NULL,
        data_type   TEXT,
        PRIMARY KEY (project_id, table_name, column_name),
        FOREIGN KEY (project_id, table_name)
          REFERENCES code_schema_tables (project_id, table_name) ON DELETE CASCADE
      )
    `)
    console.log('      done')

    console.log('[4/5] Creating code_unresolved_refs table...')
    await client.query(`
      CREATE TABLE IF NOT EXISTS code_unresolved_refs (
        id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        project_id      TEXT        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        from_entity_id  TEXT        NOT NULL REFERENCES code_nodes(id) ON DELETE CASCADE,
        raw_target_name TEXT        NOT NULL,
        kind            TEXT        NOT NULL,
        reason          TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
    await client.query(`CREATE INDEX IF NOT EXISTS code_unresolved_refs_project_idx ON code_unresolved_refs (project_id)`)
    // Widens/(re)creates the kind CHECK separately from CREATE TABLE IF NOT
    // EXISTS, which is a no-op on a table that already exists — 'import' was
    // added after this migration's first run (treeSitterParser.ts, Phase 40)
    // so re-running must still pick it up on an already-created table.
    await client.query(`ALTER TABLE code_unresolved_refs DROP CONSTRAINT IF EXISTS code_unresolved_refs_kind_check`)
    await client.query(`
      ALTER TABLE code_unresolved_refs ADD CONSTRAINT code_unresolved_refs_kind_check
        CHECK (kind IN ('call', 'import', 'sql_exec', 'script_invocation'))
    `)
    console.log('      done')

    console.log('[5/5] Done.')

    await client.query('COMMIT')
    console.log('\nMigration complete.\n')
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('\n[!!] ROLLBACK:', (err as Error).message)
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

run().catch(() => process.exit(1))
