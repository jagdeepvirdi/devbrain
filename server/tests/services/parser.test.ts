import { describe, it, expect, afterAll, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Mock exec before module loads
vi.mock('node:child_process', () => ({
  exec: vi.fn((cmd, cb) => {
    // Filenames containing "nomd" simulate MarkItDown being unavailable/failing,
    // so tests can exercise the native JS fallback parsers.
    if (cmd.includes('markitdown_bridge.py') && !cmd.includes('nomd')) {
      cb(null, { stdout: 'Mocked Markdown Content' })
    } else {
      cb(new Error('Unknown command'))
    }
  }),
}))

// Mock word-extractor before module loads — legacy .doc parsing needs a real
// OLE binary file, so unit tests stub the extractor instead.
vi.mock('word-extractor', () => ({
  default: class {
    extract() {
      return Promise.resolve({ getBody: () => 'Extracted legacy doc text' })
    }
  },
}))

// Mock pdf-parse and mammoth — a real PDF/DOCX needs a real binary fixture,
// so the native-fallback path (MarkItDown unavailable) is tested with stubs,
// same reasoning as word-extractor above.
vi.mock('pdf-parse', () => ({
  default: vi.fn().mockResolvedValue({ text: 'Extracted PDF text' }),
}))
vi.mock('mammoth', () => ({
  extractRawText: vi.fn().mockResolvedValue({ value: 'Extracted DOCX text' }),
}))

const { parseFile, parseUrl } = await import('../../services/parser.js')
const XLSX = await import('xlsx')

// ── Temp file helpers ─────────────────────────────────────────────────────────

const tmpFiles: string[] = []

async function writeTmp(name: string, content: string): Promise<string> {
  const p = path.join(os.tmpdir(), `devbrain-test-${Date.now()}-${name}`)
  await fs.writeFile(p, content, 'utf-8')
  tmpFiles.push(p)
  return p
}

afterAll(async () => {
  await Promise.allSettled(tmpFiles.map(f => fs.unlink(f)))
})

// ── Markdown ──────────────────────────────────────────────────────────────────

describe('parseFile — .md', () => {
  it('returns fileType md and the raw markdown text', async () => {
    const content = '# Hello\n\nThis is a **markdown** file.'
    const p       = await writeTmp('test.md', content)

    const result = await parseFile(p, 'my-notes.md')

    expect(result.fileType).toBe('md')
    expect(result.title).toBe('my-notes')
    expect(result.text).toBe(content.trim())
  })

  it('trims leading and trailing whitespace from the text', async () => {
    const p      = await writeTmp('padded.md', '\n\n  content  \n\n')
    const result = await parseFile(p, 'padded.md')
    expect(result.text).toBe('content')
  })
})

// ── Plain text ────────────────────────────────────────────────────────────────

describe('parseFile — .txt', () => {
  it('returns fileType txt with raw text content', async () => {
    const content = 'Line one\nLine two\nLine three'
    const p       = await writeTmp('notes.txt', content)

    const result = await parseFile(p, 'notes.txt')

    expect(result.fileType).toBe('txt')
    expect(result.title).toBe('notes')
    expect(result.text).toBe(content)
  })
})

// ── Plain-text-like formats (yaml, log) ───────────────────────────────────────

describe('parseFile — .yaml/.yml/.log', () => {
  it.each([
    ['config.yaml', 'key: value\nlist:\n  - a\n  - b'],
    ['config.yml', 'key: value'],
    ['server.log', '[INFO] started\n[ERROR] boom'],
  ])('returns fileType txt with raw content for %s', async (name, content) => {
    const p = await writeTmp(name, content)
    const result = await parseFile(p, name)

    expect(result.fileType).toBe('txt')
    expect(result.text).toBe(content)
  })
})

// ── Source code ───────────────────────────────────────────────────────────────

describe('parseFile — source code extensions', () => {
  it.each([
    ['index.ts', 'typescript', 'export const x = 1'],
    ['app.py', 'python', 'def main():\n    pass'],
    ['main.dart', 'dart', 'void main() {}'],
    ['server.go', 'go', 'package main'],
    ['lib.rs', 'rust', 'fn main() {}'],
    ['deploy.ps1', 'powershell', 'Write-Host "hi"'],
    ['schema.sql', 'sql', 'CREATE TABLE foo (id INT);'],
    ['legacy.pl', 'perl', 'print "hi\\n";'],
    ['pkg_utils.spc', 'plsql', 'CREATE OR REPLACE PACKAGE pkg_utils AS END;'],
    ['pkg_utils.bdy', 'plsql', 'CREATE OR REPLACE PACKAGE BODY pkg_utils AS END;'],
  ])('returns fileType code with the detected language for %s', async (name, language, content) => {
    const p = await writeTmp(name, content)
    const result = await parseFile(p, name)

    expect(result.fileType).toBe('code')
    expect(result.language).toBe(language)
    expect(result.text).toBe(content)
  })

  it('does not set a language for non-code formats', async () => {
    const p = await writeTmp('notes.md', '# hi')
    const result = await parseFile(p, 'notes.md')
    expect(result.language).toBeUndefined()
  })
})

// ── CSV / JSON via MarkItDown ─────────────────────────────────────────────────

describe('parseFile — .csv/.json via MarkItDown', () => {
  it('maps fileType to txt (not the unknown-MD-type pdf default)', async () => {
    const p = await writeTmp('report.csv', 'a,b\n1,2')
    const result = await parseFile(p, 'report.csv')

    expect(result.fileType).toBe('txt')
    expect(result.text).toBe('Mocked Markdown Content')
  })
})

// ── CSV / JSON native fallback ─────────────────────────────────────────────────

describe('parseFile — .csv/.json fallback when MarkItDown is unavailable', () => {
  it('reads raw CSV content directly', async () => {
    const content = 'a,b\n1,2'
    const p = await writeTmp('table-nomd.csv', content)
    const result = await parseFile(p, 'table-nomd.csv')

    expect(result.fileType).toBe('txt')
    expect(result.text).toBe(content)
  })

  it('reads raw JSON content directly', async () => {
    const content = '{"a":1}'
    const p = await writeTmp('data-nomd.json', content)
    const result = await parseFile(p, 'data-nomd.json')

    expect(result.fileType).toBe('txt')
    expect(result.text).toBe(content)
  })
})

// ── HTML via MarkItDown ─────────────────────────────────────────────────────

describe('parseFile — .html via MarkItDown', () => {
  it('maps fileType to txt', async () => {
    const p = await writeTmp('page.html', '<html><body><h1>Hi</h1></body></html>')
    const result = await parseFile(p, 'page.html')

    expect(result.fileType).toBe('txt')
    expect(result.text).toBe('Mocked Markdown Content')
  })
})

// ── HTML native fallback ─────────────────────────────────────────────────────

describe('parseFile — .html fallback when MarkItDown is unavailable', () => {
  it('strips tags via html-to-text', async () => {
    const html = '<html><body><h1>Title</h1><p>Hello <b>world</b></p></body></html>'
    const p = await writeTmp('page-nomd.html', html)
    const result = await parseFile(p, 'page-nomd.html')

    expect(result.fileType).toBe('txt')
    expect(result.text.toLowerCase()).toContain('title')
    expect(result.text).toContain('Hello world')
    expect(result.text).not.toContain('<h1>')
  })
})

// ── PDF via MarkItDown ────────────────────────────────────────────────────────

describe('parseFile — .pdf via MarkItDown', () => {
  it('maps fileType to pdf', async () => {
    const p = await writeTmp('doc.pdf', 'binary-junk')
    const result = await parseFile(p, 'doc.pdf')

    expect(result.fileType).toBe('pdf')
    expect(result.text).toBe('Mocked Markdown Content')
  })
})

// ── PDF native fallback ───────────────────────────────────────────────────────

describe('parseFile — .pdf fallback when MarkItDown is unavailable', () => {
  it('extracts text via pdf-parse', async () => {
    const p = await writeTmp('doc-nomd.pdf', 'binary-junk')
    const result = await parseFile(p, 'doc-nomd.pdf')

    expect(result.fileType).toBe('pdf')
    expect(result.text).toBe('Extracted PDF text')
  })
})

// ── DOCX via MarkItDown ───────────────────────────────────────────────────────

describe('parseFile — .docx via MarkItDown', () => {
  it('maps fileType to docx', async () => {
    const p = await writeTmp('doc.docx', 'binary-junk')
    const result = await parseFile(p, 'doc.docx')

    expect(result.fileType).toBe('docx')
    expect(result.text).toBe('Mocked Markdown Content')
  })
})

// ── DOCX native fallback ──────────────────────────────────────────────────────

describe('parseFile — .docx fallback when MarkItDown is unavailable', () => {
  it('extracts text via mammoth', async () => {
    const p = await writeTmp('doc-nomd.docx', 'binary-junk')
    const result = await parseFile(p, 'doc-nomd.docx')

    expect(result.fileType).toBe('docx')
    expect(result.text).toBe('Extracted DOCX text')
  })
})

// ── XLSX via MarkItDown ───────────────────────────────────────────────────────

describe('parseFile — .xlsx via MarkItDown', () => {
  it('maps fileType to xlsx', async () => {
    const p = await writeTmp('sheet.xlsx', 'binary-junk')
    const result = await parseFile(p, 'sheet.xlsx')

    expect(result.fileType).toBe('xlsx')
    expect(result.text).toBe('Mocked Markdown Content')
  })
})

// ── XLSX native fallback (real workbook, xlsx package unmocked) ──────────────

describe('parseFile — .xlsx fallback when MarkItDown is unavailable', () => {
  it('converts each sheet to CSV under a "## Sheet: <name>" heading', async () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['a', 'b'], [1, 2]]), 'Sheet1')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['x'], [9]]), 'Sheet2')
    const p = path.join(os.tmpdir(), `devbrain-test-${Date.now()}-nomd.xlsx`)
    XLSX.writeFile(wb, p)
    tmpFiles.push(p)

    const result = await parseFile(p, 'workbook-nomd.xlsx')

    expect(result.fileType).toBe('xlsx')
    expect(result.text).toContain('## Sheet: Sheet1')
    expect(result.text).toContain('a,b')
    expect(result.text).toContain('1,2')
    expect(result.text).toContain('## Sheet: Sheet2')
    expect(result.text).toContain('x')
  })
})

// ── Jupyter Notebook (always native) ─────────────────────────────────────────

describe('parseFile — .ipynb', () => {
  it('renders markdown and code cells with stdout/text outputs', async () => {
    const notebook = {
      cells: [
        { cell_type: 'markdown', source: ['# Analysis\n', 'Some notes.'] },
        {
          cell_type: 'code',
          source: ['print("hi")'],
          outputs: [{ output_type: 'stream', text: ['hi\n'] }],
        },
        {
          cell_type: 'code',
          source: ['df.head()'],
          outputs: [{ output_type: 'execute_result', data: { 'text/plain': ['   a  b\n0  1  2'] } }],
        },
      ],
    }
    const p = await writeTmp('notebook.ipynb', JSON.stringify(notebook))
    const result = await parseFile(p, 'analysis.ipynb')

    expect(result.fileType).toBe('txt')
    expect(result.text).toContain('# Analysis')
    expect(result.text).toContain('Some notes.')
    expect(result.text).toContain('print("hi")')
    expect(result.text).toContain('Output:\nhi')
    expect(result.text).toContain('df.head()')
    expect(result.text).toContain('a  b')
  })

  it('handles cells with no outputs', async () => {
    const notebook = { cells: [{ cell_type: 'code', source: ['x = 1'] }] }
    const p = await writeTmp('simple.ipynb', JSON.stringify(notebook))
    const result = await parseFile(p, 'simple.ipynb')

    expect(result.text).toBe('## Code Cell 1\nx = 1')
  })

  it('renders an error output, and drops an output of an unrecognized type with no text/plain data', async () => {
    const notebook = {
      cells: [
        { cell_type: 'code', source: ['1/0'], outputs: [{ output_type: 'error', ename: 'ZeroDivisionError', evalue: 'division by zero' }] },
        { cell_type: 'code', source: ['show(plot)'], outputs: [{ output_type: 'display_data', data: { 'image/png': ['...'] } }] },
      ],
    }
    const p = await writeTmp('errors.ipynb', JSON.stringify(notebook))
    const result = await parseFile(p, 'errors.ipynb')

    expect(result.text).toContain('Output:\nZeroDivisionError: division by zero')
    // second cell's output has no text/plain, so renderCellOutput falls back
    // to '' and the whole "Output:" section is omitted for that cell
    expect(result.text).toBe(
      '## Code Cell 1\n1/0\n\nOutput:\nZeroDivisionError: division by zero\n\n## Code Cell 2\nshow(plot)'
    )
  })

  it('handles a plain-string (non-array) source and a cell with no source at all', async () => {
    const notebook = {
      cells: [
        { cell_type: 'code', source: 'x = 1' },
        { cell_type: 'markdown' }, // no `source` field
      ],
    }
    const p = await writeTmp('string-source.ipynb', JSON.stringify(notebook))
    const result = await parseFile(p, 'string-source.ipynb')

    expect(result.text).toBe('## Code Cell 1\nx = 1\n\n## Markdown Cell 2')
  })

  it('renders nothing when the notebook JSON has no cells field at all', async () => {
    const p = await writeTmp('no-cells.ipynb', JSON.stringify({}))
    const result = await parseFile(p, 'no-cells.ipynb')

    expect(result.text).toBe('')
  })
})

// ── Legacy DOC ────────────────────────────────────────────────────────────────

describe('parseFile — .doc', () => {
  it('extracts text via word-extractor and maps to fileType docx', async () => {
    const p = await writeTmp('legacy.doc', 'ole-binary-junk')
    const result = await parseFile(p, 'legacy.doc')

    expect(result.fileType).toBe('docx')
    expect(result.title).toBe('legacy')
    expect(result.text).toBe('Extracted legacy doc text')
  })
})

// ── PPTX (via MarkItDown) ─────────────────────────────────────────────────────

describe('parseFile — .pptx', () => {
  it('calls MarkItDown bridge and returns the converted text', async () => {
    const p = await writeTmp('presentation.pptx', 'binary-junk')
    const result = await parseFile(p, 'presentation.pptx')

    expect(result.fileType).toBe('pdf') // We mapped unknown MD types to pdf
    expect(result.text).toBe('Mocked Markdown Content')
  })
})

// ── PPTX (MarkItDown unavailable) ─────────────────────────────────────────────

describe('parseFile — .pptx when MarkItDown is unavailable', () => {
  it('throws, since PPTX has no native JS fallback', async () => {
    const p = await writeTmp('presentation-nomd.pptx', 'binary-junk')

    await expect(parseFile(p, 'presentation-nomd.pptx')).rejects.toThrow(/PPTX requires MarkItDown/)
  })
})

// ── Unsupported extension ─────────────────────────────────────────────────────

describe('parseFile — unsupported type', () => {
  it('throws an error for unsupported extensions', async () => {
    const p = await writeTmp('program.exe', 'binary')

    await expect(parseFile(p, 'program.exe')).rejects.toThrow(/Unsupported file type/)
  })
})

// ── Title extraction ──────────────────────────────────────────────────────────

describe('parseFile — title extraction', () => {
  it('strips the extension to form the title', async () => {
    const p = await writeTmp('release-notes.md', '# v1.2')
    const { title } = await parseFile(p, 'release-notes.md')
    expect(title).toBe('release-notes')
  })

  it('handles names with multiple dots', async () => {
    const p = await writeTmp('v1.2.3.txt', 'content')
    const { title } = await parseFile(p, 'v1.2.3.txt')
    expect(title).toBe('v1.2.3')
  })
})

// ── parseUrl (via Jina) ────────────────────────────────────────────────────────

describe('parseUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches the URL through r.jina.ai, trims the text, and uses the hostname as the title', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('\n  # Some Page\n\ncontent  \n'),
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await parseUrl('https://example.com/article')

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://r.jina.ai/https://example.com/article')
    expect((opts.headers as Record<string, string>).Accept).toBe('text/plain')
    expect(result).toEqual({ text: '# Some Page\n\ncontent', fileType: 'url', title: 'example.com' })
  })

  it('throws when the Jina fetch responds non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, statusText: 'Bad Gateway' }))

    await expect(parseUrl('https://example.com')).rejects.toThrow(/Jina fetch failed: 502 Bad Gateway/)
  })
})
