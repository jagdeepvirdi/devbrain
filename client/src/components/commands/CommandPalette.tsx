import { useState, useEffect, useRef } from 'react'
import { commandsApi, type Command } from '../../lib/api'
import { LangBadge } from './CodeBlock'

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [query,   setQuery]   = useState('')
  const [results, setResults] = useState<Command[]>([])
  const [selIdx,  setSelIdx]  = useState(0)
  const [copied,  setCopied]  = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      commandsApi.list({ search: query || undefined, limit: 8 }).then(data => {
        setResults(data.items.slice(0, 8))
        setSelIdx(0)
      }).catch(() => setResults([]))
    }, 120)
    return () => clearTimeout(t)
  }, [query])

  function copyCmd(cmd: Command) {
    navigator.clipboard.writeText(cmd.command).then(() => {
      commandsApi.use(cmd.id).catch(() => {})
      setCopied(cmd.id)
      setTimeout(() => { setCopied(null); onClose() }, 900)
    })
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape')    { onClose(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelIdx(i => Math.min(i + 1, results.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSelIdx(i => Math.max(i - 1, 0)) }
    if (e.key === 'Enter' && results[selIdx]) copyCmd(results[selIdx])
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '14vh', zIndex: 100, backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div onClick={e => e.stopPropagation()} style={{ width: 580, background: 'var(--panel)', border: '1px solid var(--line-2)', borderRadius: 10, boxShadow: '0 32px 80px rgba(0,0,0,.7)', overflow: 'hidden' }}>
        {/* Search input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
          <span style={{ fontSize: 14, color: 'var(--fg-3)' }}>⌘</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search commands…"
            style={{ flex: 1, background: 'none', border: 'none', color: 'var(--fg)', fontSize: '14px', outline: 'none' }}
          />
          <span style={{ fontSize: '11px', color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>Esc to close</span>
        </div>

        {/* Results */}
        <div style={{ maxHeight: 380, overflowY: 'auto' }}>
          {results.length === 0
            ? <div style={{ padding: '24px', textAlign: 'center', fontSize: '13px', color: 'var(--fg-3)' }}>
                No commands found
              </div>
            : results.map((cmd, i) => (
              <div
                key={cmd.id}
                onClick={() => copyCmd(cmd)}
                onMouseEnter={() => setSelIdx(i)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 14px', cursor: 'default',
                  background: i === selIdx ? 'var(--bg-elev-2)' : 'transparent',
                  borderBottom: '1px solid var(--line)',
                }}
              >
                <LangBadge lang={cmd.language} />
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--fg)', marginBottom: 2 }}>
                    {cmd.title}
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {cmd.command.split('\n')[0]}
                  </div>
                </div>
                {cmd.project_name && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '11px', color: 'var(--fg-3)', flexShrink: 0 }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: cmd.project_color ?? 'var(--fg-3)' }} />
                    {cmd.project_name}
                  </span>
                )}
                {copied === cmd.id
                  ? <span style={{ fontSize: '11px', color: '#22C55E', flexShrink: 0 }}>✓ Copied</span>
                  : <span style={{ fontSize: '11px', color: 'var(--fg-4)', flexShrink: 0 }}>↵ copy</span>
                }
              </div>
            ))
          }
        </div>

        <div style={{ padding: '8px 14px', borderTop: '1px solid var(--line)', display: 'flex', gap: 16, fontSize: '11px', color: 'var(--fg-4)' }}>
          <span>↑↓ navigate</span>
          <span>↵ copy command</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>
  )
}
