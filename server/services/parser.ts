import fs from 'fs/promises'
import path from 'path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { FileType } from '../../shared/types.js'

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
  const XLSX = await import('xlsx')
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
  if (markItDownSupported.includes(ext)) {
    text = await parseWithMarkItDown(filePath)
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

  return { text: text.trim(), fileType, title: baseName, language }
}

export async function parseUrl(url: string): Promise<ParseResult> {
  const text  = await fetchUrl(url)
  const title = new URL(url).hostname
  return { text: text.trim(), fileType: 'url', title }
}
