/**
 * index-code-graph.ts — CLI entry point for the Code Intelligence indexer
 * (TASKS.md Phase 40).
 *
 * Walks a project's source tree, dispatches each file to the right parser
 * by extension (tree-sitter for python/typescript/javascript/bash,
 * sql_bridge.py/perl_bridge.py for sql/plsql/perl), writes every entity and
 * direct (READS_TABLE/WRITES_TABLE) edge it finds, then runs Pass 2 link
 * resolution (analyzer/linkResolver.ts) to turn cross-file/cross-language
 * references into real CALLS/IMPORTS/INCLUDES edges. Always does a full
 * fresh rebuild (clearProjectGraph first) — no incremental/watch mode yet,
 * deliberately deferred (see TASKS.md Phase 40 "Decided").
 *
 * Usage (run from server/ directory):
 *   npx tsx scripts/index-code-graph.ts --project <shortName> [--dir <path>]
 *
 * `--project` is always required — it's what supplies project_id, which
 * every code_nodes row needs (a real FK, not optional). `--dir`, when given,
 * overrides *which* directory gets walked without touching the project's
 * own stored fs_path — handy for indexing a subdirectory or an alternate
 * checkout. Without it, the project's fs_path column is used (same one
 * Phase 37's on-disk file editor already reads/writes).
 */

import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ignoreFactory, { type Ignore } from 'ignore'
import { pool } from '../db/pool.js'
import { CODE_EXT_LANGUAGE } from '../services/parser.js'
import { treeSitterParser } from '../services/codeIntel/parsers/treeSitterParser.js'
import { bashParser } from '../services/codeIntel/parsers/bashParser.js'
import { pythonBridgeParser, extractEntitiesWithSchema } from '../services/codeIntel/parsers/pythonBridgeParser.js'
import { upsertNodes, upsertEdges, clearProjectGraph } from '../services/codeIntel/storage.js'
import { resolveLinks } from '../services/codeIntel/analyzer/linkResolver.js'
import type { BaseParser } from '../services/codeIntel/parsers/base.js'
import type { CodeNode, CodeEdge, UnresolvedRef, ProjectSqlSchema } from '../services/codeIntel/types.js'

// One parser "owns" each language — bash resolves to bashParser (not
// treeSitterParser, even though treeSitterParser.ts also technically covers
// bash internally; bashParser.ts wraps and enhances that, see TASKS.md
// Phase 40 item 7) so there's never ambiguity about which one runs.
const LANGUAGE_PARSERS: Record<string, BaseParser> = {
  python:     treeSitterParser,
  typescript: treeSitterParser,
  javascript: treeSitterParser,
  bash:       bashParser,
  sql:        pythonBridgeParser,
  plsql:      pythonBridgeParser,
  perl:       pythonBridgeParser,
}

// Excludes beyond whatever the project's own .gitignore already lists —
// unlike routes/project-files.ts (which only browses a directory listing
// and defaults to just '.git'), this walker actually *parses* every file it
// finds, so accidentally descending into a vendored dependency tree isn't
// just slow, it pollutes the graph with irrelevant vendored code.
const DEFAULT_EXCLUDES = ['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', 'vendor']

async function buildIgnore(root: string): Promise<Ignore> {
  const ig = ignoreFactory()
  ig.add(DEFAULT_EXCLUDES)
  try {
    ig.add(await fs.readFile(path.join(root, '.gitignore'), 'utf-8'))
  } catch { /* no root .gitignore — fine, defaults above still apply */ }
  return ig
}

async function* walk(dir: string, root: string, ig: Ignore): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const abs = path.join(dir, entry.name)
    const rel = path.relative(root, abs).split(path.sep).join('/')
    if (ig.ignores(rel)) continue
    if (entry.isDirectory()) {
      yield* walk(abs, root, ig)
    } else if (entry.isFile()) {
      yield abs
    }
  }
}

async function resolveProject(shortName: string): Promise<{ id: string; fsPath: string | null }> {
  const { rows } = await pool.query<{ id: string; fs_path: string | null }>(
    'SELECT id, fs_path FROM projects WHERE short_name = $1',
    [shortName],
  )
  if (rows.length === 0) throw new Error(`No project found with short_name '${shortName}'`)
  return { id: rows[0].id, fsPath: rows[0].fs_path }
}

// Empty/undefined is a valid, expected state — the SQL bridge works
// structurally without it, just less precisely on SELECT */ambiguous
// columns (see sql_bridge.py, Phase 40 item 4).
async function loadProjectSchema(projectId: string): Promise<ProjectSqlSchema | undefined> {
  const { rows } = await pool.query<{ table_name: string; column_name: string; data_type: string | null }>(
    'SELECT table_name, column_name, data_type FROM code_schema_columns WHERE project_id = $1',
    [projectId],
  )
  if (rows.length === 0) return undefined
  const schema: ProjectSqlSchema = {}
  for (const row of rows) {
    const columns = schema[row.table_name] ?? (schema[row.table_name] = [])
    columns.push({ columnName: row.column_name, dataType: row.data_type ?? undefined })
  }
  return schema
}

export interface IndexSummary {
  filesScanned:        number
  filesParsed:         number
  skipped:             { path: string; reason: string }[]
  nodesWritten:         number
  directEdgesWritten:   number
  referencesFound:      number
  referencesResolved:   number
  referencesUnresolved: number
  perLanguage:          Record<string, number>
}

export async function runIndexer(rootDir: string, projectId: string, schema: ProjectSqlSchema | undefined): Promise<IndexSummary> {
  const ig = await buildIgnore(rootDir)

  await clearProjectGraph(projectId)

  const allNodes: CodeNode[] = []
  const allEdges: CodeEdge[] = []
  const allRefs: UnresolvedRef[] = []
  const perLanguage: Record<string, number> = {}
  const skipped: { path: string; reason: string }[] = []
  let filesScanned = 0

  for await (const absPath of walk(rootDir, rootDir, ig)) {
    filesScanned++
    const ext = path.extname(absPath).slice(1).toLowerCase()
    const language = CODE_EXT_LANGUAGE[ext]
    const parser = language ? LANGUAGE_PARSERS[language] : undefined
    if (!language || !parser) {
      skipped.push({ path: absPath, reason: language ? `no code-intel parser for language '${language}'` : 'unrecognized extension' })
      continue
    }

    let source: string
    try {
      source = await fs.readFile(absPath, 'utf-8')
    } catch (err) {
      skipped.push({ path: absPath, reason: `read error: ${(err as Error).message}` })
      continue
    }

    try {
      const result = (language === 'sql' || language === 'plsql') && schema
        ? await extractEntitiesWithSchema(absPath, projectId, source, language, schema)
        : await parser.extractEntities(absPath, projectId, source)

      allNodes.push(...result.nodes)
      allEdges.push(...result.edges)
      allRefs.push(...result.unresolvedRefs)
      perLanguage[language] = (perLanguage[language] ?? 0) + 1
    } catch (err) {
      skipped.push({ path: absPath, reason: `parse error: ${(err as Error).message}` })
    }
  }

  await upsertNodes(allNodes)
  await upsertEdges(allEdges)
  const linkSummary = await resolveLinks(projectId, allRefs)

  return {
    filesScanned,
    filesParsed: filesScanned - skipped.length,
    skipped,
    nodesWritten: allNodes.length,
    directEdgesWritten: allEdges.length,
    referencesFound: allRefs.length,
    referencesResolved: linkSummary.resolved,
    referencesUnresolved: linkSummary.unresolved,
    perLanguage,
  }
}

function printSummary(summary: IndexSummary): void {
  console.log(`\nScanned ${summary.filesScanned} files.`)
  const perLang = Object.entries(summary.perLanguage).map(([lang, n]) => `${lang}: ${n}`).join(', ') || 'none'
  console.log(`  Parsed:  ${summary.filesParsed} (${perLang})`)
  console.log(`  Skipped: ${summary.skipped.length}`)
  if (summary.skipped.length > 0) {
    const reasonCounts = new Map<string, number>()
    for (const s of summary.skipped) reasonCounts.set(s.reason, (reasonCounts.get(s.reason) ?? 0) + 1)
    for (const [reason, count] of reasonCounts) console.log(`    ${reason}: ${count}`)
  }
  console.log(`\nNodes written: ${summary.nodesWritten}`)
  console.log(`Direct table edges written (READS_TABLE/WRITES_TABLE): ${summary.directEdgesWritten}`)
  console.log(
    `Link resolution: ${summary.referencesFound} references — ` +
    `${summary.referencesResolved} resolved, ${summary.referencesUnresolved} unresolved ` +
    `(see code_unresolved_refs / GET /api/code-intel/:projectId/unresolved)`,
  )
}

function parseArgs(argv: string[]): { project?: string; dir?: string } {
  const args: { project?: string; dir?: string } = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') args.project = argv[++i]
    else if (argv[i] === '--dir') args.dir = argv[++i]
  }
  return args
}

async function main(): Promise<void> {
  const { project: shortName, dir: dirOverride } = parseArgs(process.argv.slice(2))
  if (!shortName) {
    console.error('Usage: npx tsx scripts/index-code-graph.ts --project <shortName> [--dir <path>]')
    process.exitCode = 1
    return
  }

  const { id: projectId, fsPath } = await resolveProject(shortName)
  const rootDir = dirOverride ?? fsPath
  if (!rootDir) {
    console.error(`Project '${shortName}' has no fs_path configured — link one first, or pass --dir <path>.`)
    process.exitCode = 1
    return
  }

  console.log(`Indexing project '${shortName}' (${rootDir})...`)
  const schema = await loadProjectSchema(projectId)
  const summary = await runIndexer(rootDir, projectId, schema)
  printSummary(summary)
}

// Only self-run when this file is the actual process entry point (`npx tsx
// scripts/index-code-graph.ts ...`) — the standard Node ESM equivalent of
// Python's `if __name__ == '__main__':`. Without this, importing runIndexer
// from a test (or any other future module) would trigger a real main() run
// — including a real `pool.end()` — as a side effect of the import itself.
// pathToFileURL (not a manual `file://${...}` string) matters on Windows:
// process.argv[1] is a plain filesystem path with backslashes
// ("D:\...\index-code-graph.ts"), which doesn't equal import.meta.url's
// "file:///D:/..." form without going through the same URL conversion.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main()
    .catch(err => {
      console.error('Indexing failed:', err)
      process.exitCode = 1
    })
    .finally(() => pool.end())
}
