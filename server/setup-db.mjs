import pg from 'pg'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const { Pool } = pg

// In Docker, devbrain IS the superuser — connect directly
const pool = new Pool({
  user: 'devbrain', host: 'localhost', port: 5433,
  database: 'devbrain', password: 'devbrain',
  connectionTimeoutMillis: 5000,
})

const c = await pool.connect()

// Enable extensions
await c.query('CREATE EXTENSION IF NOT EXISTS pgcrypto')
console.log('✓  Extension pgcrypto enabled')
await c.query('CREATE EXTENSION IF NOT EXISTS vector')
console.log('✓  Extension vector (pgvector) enabled')

// Run schema (skip CREATE EXTENSION lines — already done above)
const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'db', 'schema.sql')
let schema = await fs.readFile(schemaPath, 'utf8')
schema = schema.replace(/CREATE EXTENSION.*?;\n?/g, '')

await c.query(schema)
console.log('✓  Schema applied')

c.release()
await pool.end()

console.log('\n✅  Database ready. You can now start the server.')
