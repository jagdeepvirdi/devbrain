import { Router } from 'express'
import { createRequire } from 'module'
import type { Archiver, ArchiverOptions } from 'archiver'
const require = createRequire(import.meta.url)
// See server/services/backup.ts for why this isn't `require('archiver')` as
// the old factory function — archiver@8 replaced it with format classes.
const { ZipArchive } = require('archiver') as { ZipArchive: new (options?: ArchiverOptions) => Archiver }
import { pool } from '../db/pool.js'
import { addProjectToArchive, buildZipToStream } from '../services/exporter.js'
import { serverError } from '../lib/errors.js'

const router = Router()

// GET /api/export/project/:id
router.get('/project/:id', async (req, res) => {
  try {
    const { rows } = await pool.query<{ id: string; name: string; short_name: string }>(
      'SELECT id, name, short_name FROM projects WHERE id = $1',
      [req.params.id],
    )
    if (!rows.length) return res.status(404).json({ error: 'Project not found' })

    const project = rows[0]
    const date    = new Date().toISOString().slice(0, 10)

    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="devbrain-${project.short_name}-${date}.zip"`)

    const archive = new ZipArchive({ zlib: { level: 6 } })
    archive.on('error', err => { console.error('export error', err); res.end() })
    archive.pipe(res)

    await addProjectToArchive(archive, project)
    await archive.finalize()
  } catch (err) {
    serverError(res, err)
  }
})

// GET /api/export/all
router.get('/all', async (_req, res) => {
  try {
    const date = new Date().toISOString().slice(0, 10)
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="devbrain-export-${date}.zip"`)

    const archive = new ZipArchive({ zlib: { level: 6 } })
    archive.on('error', err => { console.error('export error', err); res.end() })
    archive.pipe(res)

    await buildZipToStream(archive, 'all')
  } catch (err) {
    serverError(res, err)
  }
})

export default router
