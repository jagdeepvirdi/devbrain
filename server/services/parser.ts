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

  // Support more formats via MarkItDown
  const markItDownSupported = ['pdf', 'docx', 'xlsx', 'xls', 'pptx', 'ppt', 'csv', 'json']
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
      case 'md':
        fileType = 'md'
        text     = await fs.readFile(filePath, 'utf-8')
        break
      case 'txt':
        fileType = 'txt'
        text     = await fs.readFile(filePath, 'utf-8')
        break
      case 'xlsx':
      case 'xls':
        fileType = 'xlsx'
        text     = await parseXlsx(filePath)
        break
      case 'pptx':
      case 'ppt':
        fileType = 'pdf' // Map to PDF for now if MD fails
        throw new Error('PPTX requires MarkItDown (Python) to be installed.')
      default:
        throw new Error(`Unsupported file type: .${ext}. Supported: pdf, docx, md, txt, xlsx, xls, pptx`)
    }
  } else {
    // Map extension to internal FileType
    fileType = (ext === 'md' ? 'md' : ext === 'txt' ? 'txt' : ext === 'docx' ? 'docx' : (ext === 'xlsx' || ext === 'xls') ? 'xlsx' : 'pdf') as FileType
  }

  return { text: text.trim(), fileType, title: baseName }
}

export async function parseUrl(url: string): Promise<ParseResult> {
  const text  = await fetchUrl(url)
  const title = new URL(url).hostname
  return { text: text.trim(), fileType: 'url', title }
}
