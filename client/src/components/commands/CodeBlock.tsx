import { useState } from 'react'
import type { Highlighter } from 'shiki'
import { SUPPORTED_LANGS, type SupportedLang, langColor } from './highlighter'

export function CodeBlock({ code, lang, hl }: { code: string; lang: string; hl: Highlighter | null }) {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const safeLang = SUPPORTED_LANGS.includes(lang as SupportedLang) ? (lang as SupportedLang) : undefined
  let html: string | null = null
  if (hl && safeLang) {
    try { html = hl.codeToHtml(code, { lang: safeLang, theme: 'github-dark' }) } catch { /* fallback */ }
  }

  return (
    <div style={{ position: 'relative', borderRadius: 6, overflow: 'hidden', border: '1px solid rgba(255,255,255,.08)' }}>
      {html
        ? <div className="shiki-wrap" dangerouslySetInnerHTML={{ __html: html }} style={{ maxHeight: 400, overflowY: 'auto' }} />
        : <pre style={{ margin: 0, padding: '14px 16px', background: '#0d1117', color: '#e6edf3', fontFamily: 'var(--font-mono)', fontSize: '12.5px', lineHeight: 1.65, overflowX: 'auto', maxHeight: 400, overflowY: 'auto' }}>{code}</pre>
      }
      <button onClick={copy} style={{
        position: 'absolute', top: 8, right: 8,
        padding: '3px 10px', fontSize: '11px', borderRadius: 4,
        background: copied ? 'rgba(34,197,94,.15)' : 'rgba(0,0,0,.4)',
        border:     `1px solid ${copied ? 'rgba(34,197,94,.4)' : 'rgba(255,255,255,.12)'}`,
        color:      copied ? '#22C55E' : '#94A3B8',
        cursor: 'default', transition: 'all .15s', backdropFilter: 'blur(4px)',
      }}>
        {copied ? '✓ Copied' : 'Copy'}
      </button>
    </div>
  )
}

export function LangBadge({ lang }: { lang: string }) {
  const color = langColor(lang)
  return (
    <span style={{
      fontSize: '10px', padding: '1px 6px', borderRadius: 3, flexShrink: 0,
      background: `${color}20`, color, border: `1px solid ${color}40`,
      fontFamily: 'var(--font-mono)', letterSpacing: '.03em',
    }}>
      {lang}
    </span>
  )
}
