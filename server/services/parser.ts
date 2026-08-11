import fs from 'fs/promises'
import path from 'path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { FileType } from '../../shared/types.js'
import { aiChat } from './ai.js'
import { loadXlsx } from '../lib/xlsxCompat.js'

const execAsync = promisify(exec)

export type ParseResult = {
  text:     string
  fileType: FileType
  title:    string
  language?: string
}

// ── Source code ──────────────────────────────────────────────────────────
// Extension -> display language, for the Codes tab and future syntax
// highlighting. Anything not listed here falls through to the generic
// txt/md/etc. handling below, unchanged from before this map existed.

const CODE_EXT_LANGUAGE: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  mjs: 'javascript', cjs: 'javascript',
  py: 'python', dart: 'dart', java: 'java', kt: 'kotlin', kts: 'kotlin',
  go: 'go', rs: 'rust', rb: 'ruby', php: 'php', swift: 'swift',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp',
  sh: 'bash', bash: 'bash', ps1: 'powershell',
  vue: 'vue', svelte: 'svelte',
  pl: 'perl', pm: 'perl',
  sql: 'sql',
  // Oracle PL/SQL package spec (.spc) / body (.bdy) — common in SAP-interface projects.
  spc: 'plsql', bdy: 'plsql', pks: 'plsql', pkb: 'plsql',
}

// ── MarkItDown Bridge ─────────────────────────────────────────────────────

async function parseWithMarkItDown(filePath: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`python server/scripts/markitdown_bridge.py "${filePath}"`)
    return stdout.trim()
  } catch (err) {
    console.warn('MarkItDown conversion failed, falling back to JS parsers:', (err as Error).message)
    return null
  }
}

// ── PDF ───────────────────────────────────────────────────────────────────

async function parsePdf(filePath: string): Promise<string> {
  const { default: pdfParse } = await import('pdf-parse')
  const buf  = await fs.readFile(filePath)
  const data = await pdfParse(buf)
  return data.text
}

// ── DOCX ──────────────────────────────────────────────────────────────────

async function parseDocx(filePath: string): Promise<string> {
  const mammoth = await import('mammoth')
  const result  = await mammoth.extractRawText({ path: filePath })
  return result.value
}

// ── Legacy DOC ────────────────────────────────────────────────────────────
// mammoth and MarkItDown both only understand the OOXML .docx format, not
// the legacy OLE binary .doc format, so it needs its own parser.

async function parseDoc(filePath: string): Promise<string> {
  const { default: WordExtractor } = await import('word-extractor')
  const extractor = new WordExtractor()
  const doc = await extractor.extract(filePath)
  return doc.getBody()
}

// ── XLSX ──────────────────────────────────────────────────────────────────

async function parseXlsx(filePath: string): Promise<string> {
  const XLSX = await loadXlsx()
  const wb   = XLSX.readFile(filePath)
  return wb.SheetNames.map((name: string) => {
    const ws  = wb.Sheets[name]
    const csv = XLSX.utils.sheet_to_csv(ws)
    return `## Sheet: ${name}\n${csv}`
  }).join('\n\n')
}

// ── HTML ──────────────────────────────────────────────────────────────────

async function parseHtml(filePath: string): Promise<string> {
  const { convert } = await import('html-to-text')
  const html = await fs.readFile(filePath, 'utf-8')
  return convert(html, { wordwrap: false })
}

// ── Jupyter Notebook ────────────────────────────────────────────────────────
// Notebooks are just JSON, so this is parsed natively rather than routed
// through MarkItDown — no Python dependency needed either way.

type NbCellOutput = {
  output_type: string
  text?:       string[] | string
  data?:       Record<string, string[] | string>
  ename?:      string
  evalue?:     string
}

type NbCell = {
  cell_type: string
  source:    string[] | string
  outputs?:  NbCellOutput[]
}

function joinSource(src: string[] | string | undefined): string {
  if (!src) return ''
  return Array.isArray(src) ? src.join('') : src
}

function renderCellOutput(out: NbCellOutput): string {
  if (out.output_type === 'error') return `${out.ename}: ${out.evalue}`
  if (out.output_type === 'stream') return joinSource(out.text)
  if (out.data?.['text/plain']) return joinSource(out.data['text/plain'])
  return ''
}

async function parseIpynb(filePath: string): Promise<string> {
  const raw   = await fs.readFile(filePath, 'utf-8')
  const nb    = JSON.parse(raw) as { cells?: NbCell[] }
  const cells = nb.cells ?? []

  return cells.map((cell, i) => {
    const label  = cell.cell_type === 'code' ? `Code Cell ${i + 1}` : `Markdown Cell ${i + 1}`
    const source = joinSource(cell.source)
    const output = (cell.outputs ?? []).map(renderCellOutput).filter(Boolean).join('\n')
    return output ? `## ${label}\n${source}\n\nOutput:\n${output}` : `## ${label}\n${source}`
  }).join('\n\n')
}

// ── URL via Jina ──────────────────────────────────────────────────────────
// r.jina.ai is free, no API key, returns clean markdown from any URL.

async function fetchUrl(url: string): Promise<string> {
  const res = await fetch(`https://r.jina.ai/${url}`, {
    headers: { Accept: 'text/plain' },
    signal:  AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`Jina fetch failed: ${res.status} ${res.statusText}`)
  return res.text()
}

// ── Title extraction ────────────────────────────────────────────────────
// Prefer the title that's actually in the document over the filename.
// Only a leading ATX-style markdown heading (`# Title`) counts as "clear" —
// anything else (body text, a stray '#' comment, no heading at all) is too
// ambiguous to trust, so callers fall back to the filename.

export function extractMarkdownHeadingTitle(text: string): string | null {
  const firstLine = text.split('\n').find(line => line.trim().length > 0)
  if (!firstLine) return null
  const match = firstLine.trim().match(/^#{1,6}\s+(.+?)\s*#*$/)
  return match ? match[1].trim() : null
}

// PDF/DOCX cover pages are often a real title spread across several plain-text
// lines (doc type, project name, subsystem — no markdown, so the heading regex
// above can't see it) rather than a single clean heading. Naively joining
// those lines collides across documents that share the same cover-page
// preamble (e.g. two design docs for the same interface, differing only past
// line 4), silently losing the disambiguating info the filename carried. An
// AI read of the excerpt can pick the actually-distinctive part instead.
// Best-effort only — on any failure (Ollama unreachable, malformed reply)
// the caller falls back to the filename, same as when no heading is found.
const AI_TITLE_FILE_TYPES = new Set<FileType>(['pdf', 'docx'])

export async function generateTitleFromContent(text: string, originalName?: string): Promise<string | null> {
  const excerpt = text.slice(0, 2000).trim()
  if (excerpt.length < 20) return null

  const system =
    'You extract a short, clean, human-readable title (under 90 characters, no underscores, no filename slugs) ' +
    'for a document from its opening text and original filename. Respond with ONLY the title itself — no ' +
    'quotes, no markdown, no explanation. Skip boilerplate like version numbers, dates, or FINAL/DRAFT status. ' +
    'The excerpt may be near-identical to other similarly-named documents (e.g. different variants/revisions ' +
    'of the same interface) — if so, append " (X)" to the end, where X is a short 2-4 word distinguishing tag ' +
    "drawn from the filename's unique part (e.g. a variant name like 'Accrual' or 'Deferral', or a short code " +
    'like TOC/JS) — never restate the whole filename. ' +
    'If the excerpt does not clearly state a title, respond with exactly: NONE'

  const filenameLine = originalName ? `Filename: ${originalName}\n` : ''

  try {
    const raw   = await aiChat(`${filenameLine}Document excerpt:\n${excerpt}\n\nTitle:`, system)
    const title = raw.trim().replace(/^["'#\s]+|["'\s]+$/g, '')
    if (!title || title.length > 200 || /^none$/i.test(title)) return null
    return title
  } catch {
    return null
  }
}

// ── Exports ───────────────────────────────────────────────────────────────

export async function parseFile(filePath: string, originalName: string): Promise<ParseResult> {
  const ext      = path.extname(originalName).toLowerCase().slice(1)
  const baseName = path.basename(originalName, path.extname(originalName))

  let fileType: FileType
  let text: string | null = null
  let language: string | undefined

  // Support more formats via MarkItDown
  // .ipynb is deliberately excluded — it's just JSON, so parseIpynb() handles
  // it natively without needing the Python bridge at all.
  const markItDownSupported = ['pdf', 'docx', 'xlsx', 'xls', 'pptx', 'ppt', 'csv', 'json', 'html', 'htm']
  let viaMarkItDown = false
  if (markItDownSupported.includes(ext)) {
    text = await parseWithMarkItDown(filePath)
    viaMarkItDown = text !== null
  }

  // Fallback to legacy JS parsers if MarkItDown failed or isn't used for this ext
  if (text === null) {
    switch (ext) {
      case 'pdf':
        fileType = 'pdf'
        text     = await parsePdf(filePath)
        break
      case 'docx':
        fileType = 'docx'
        text     = await parseDocx(filePath)
        break
      case 'doc':
        fileType = 'docx'
        text     = await parseDoc(filePath)
        break
      case 'md':
        fileType = 'md'
        text     = await fs.readFile(filePath, 'utf-8')
        break
      case 'txt':
      case 'yaml':
      case 'yml':
      case 'log':
      case 'json':
      case 'csv':
        fileType = 'txt'
        text     = await fs.readFile(filePath, 'utf-8')
        break
      case 'xlsx':
      case 'xls':
        fileType = 'xlsx'
        text     = await parseXlsx(filePath)
        break
      case 'html':
      case 'htm':
        fileType = 'txt'
        text     = await parseHtml(filePath)
        break
      case 'ipynb':
        fileType = 'txt'
        text     = await parseIpynb(filePath)
        break
      case 'pptx':
      case 'ppt':
        fileType = 'pdf' // Map to PDF for now if MD fails
        throw new Error('PPTX requires MarkItDown (Python) to be installed.')
      default:
        if (ext in CODE_EXT_LANGUAGE) {
          fileType = 'code'
          language = CODE_EXT_LANGUAGE[ext]
          text     = await fs.readFile(filePath, 'utf-8')
          break
        }
        throw new Error(`Unsupported file type: .${ext}. Supported: pdf, doc, docx, md, txt, xlsx, xls, pptx, yaml, yml, log, json, csv, html, htm, ipynb, or a source code extension (${Object.keys(CODE_EXT_LANGUAGE).join(', ')})`)
    }
  } else {
    // Map extension to internal FileType
    const textExts = ['txt', 'yaml', 'yml', 'log', 'json', 'csv', 'html', 'htm', 'ipynb']
    fileType = (ext === 'md' ? 'md' : textExts.includes(ext) ? 'txt' : ext === 'docx' ? 'docx' : (ext === 'xlsx' || ext === 'xls') ? 'xlsx' : 'pdf') as FileType
  }

  const trimmedText = text.trim()
  // Only trust a heading pulled from markdown source or a MarkItDown
  // conversion — native raw-text extraction (pdf-parse, mammoth, plain
  // txt/csv/json) has no reliable heading marker, so a leading '#' there is
  // more likely a comment than a title.
  const heading = (ext === 'md' || viaMarkItDown) ? extractMarkdownHeadingTitle(trimmedText) : null
  const title   = heading
    ?? (AI_TITLE_FILE_TYPES.has(fileType) ? await generateTitleFromContent(trimmedText, originalName) : null)
    ?? baseName

  return { text: trimmedText, fileType, title, language }
}

export async function parseUrl(url: string): Promise<ParseResult> {
  const text    = await fetchUrl(url)
  const trimmedText = text.trim()
  const title   = extractMarkdownHeadingTitle(trimmedText) ?? new URL(url).hostname
  return { text: trimmedText, fileType: 'url', title }
}
