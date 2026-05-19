// Phase 12 schema additions: linked_commits + pr_url on issues,
// github_pat_enc on projects, app_settings table for integrations.
import pg from 'pg'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Load .env from server directory
const envPath = path.join(__dirname, '..', '.env')
try {
  const lines = readFileSync(envPath, 'utf8').split('\n')
  for (const line of lines) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim()
  }
} catch {}

const { Pool } = pg
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

await pool.query(`
  -- Git integration columns
  ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS github_pat_enc TEXT;

  ALTER TABLE issues
    ADD COLUMN IF NOT EXISTS linked_commits TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS pr_url TEXT;

  -- Settings store for integrations (Jira, Linear, etc.)
  CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT PRIMARY KEY,
    value      JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`)

console.log('Phase 12 migration complete.')
await pool.end()
