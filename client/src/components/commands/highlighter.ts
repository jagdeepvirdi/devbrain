import { useState, useEffect } from 'react'
import { createHighlighter, type Highlighter } from 'shiki'

export const SUPPORTED_LANGS = ['bash', 'powershell', 'python', 'typescript', 'javascript', 'dart', 'sql', 'yaml'] as const
export type SupportedLang = typeof SUPPORTED_LANGS[number]

let hlPromise: Promise<Highlighter> | null = null
function getHl(): Promise<Highlighter> {
  if (!hlPromise) {
    hlPromise = createHighlighter({
      themes: ['github-dark'],
      langs:  [...SUPPORTED_LANGS],
    })
  }
  return hlPromise
}

export function useHighlighter() {
  const [hl, setHl] = useState<Highlighter | null>(null)
  useEffect(() => { getHl().then(setHl) }, [])
  return hl
}

export const LANG_COLOR: Record<string, string> = {
  bash:       '#2ECC71',
  powershell: '#8B5CF6',
  python:     '#3B82F6',
  typescript: '#818CF8',
  javascript: '#FBBF24',
  dart:       '#06B6D4',
  sql:        '#F59E0B',
  yaml:       '#EC4899',
  plaintext:  '#64748B',
}

export function langColor(lang: string) { return LANG_COLOR[lang] ?? LANG_COLOR.plaintext }

export function fmtDate(s: string | null) {
  if (!s) return 'never'
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export const SHIKI_STYLE = `
.shiki-wrap pre { margin: 0; padding: 14px 16px; overflow-x: auto; }
.shiki-wrap pre code { font-family: var(--font-mono); font-size: 12.5px; line-height: 1.65; }
`
