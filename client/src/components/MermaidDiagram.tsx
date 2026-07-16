import { useEffect, useRef, useState, useId } from 'react'
import type { Mermaid } from 'mermaid'

// mermaid is a ~640KB (gzip ~155KB) dependency — loaded lazily on first
// render of an actual diagram instead of bundled into the app's initial
// load, since most sessions never touch a diagram at all.
let mermaidPromise: Promise<Mermaid> | null = null
function loadMermaid(): Promise<Mermaid> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(m => {
      const mermaid = m.default
      mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict', fontFamily: 'var(--font-mono)' })
      return mermaid
    })
  }
  return mermaidPromise
}

// Renders an AI-generated Mermaid diagram definition to inline SVG. Content
// comes from the model at runtime (not authored here), so a parse/render
// failure is expected occasionally — shown as an inline error with the raw
// definition rather than crashing the panel.
export function MermaidDiagram({ definition }: { definition: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingLib, setLoadingLib] = useState(true)
  const rawId = useId().replace(/:/g, '-')

  useEffect(() => {
    let cancelled = false
    setError(null)
    setLoadingLib(true)

    loadMermaid()
      .then(mermaid => mermaid.render(`mermaid-diagram-${rawId}`, definition))
      .then(({ svg }) => {
        if (!cancelled && containerRef.current) containerRef.current.innerHTML = svg
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to render diagram')
      })
      .finally(() => { if (!cancelled) setLoadingLib(false) })

    return () => { cancelled = true }
  }, [definition, rawId])

  if (error) {
    return (
      <div style={{ padding: '10px 12px', borderRadius: 6, background: 'rgba(239,68,68,.06)', border: '1px solid rgba(239,68,68,.25)', fontSize: 11.5, color: '#F8A8A8' }}>
        <div style={{ marginBottom: 6 }}>Couldn't render this diagram — try regenerating.</div>
        <pre style={{ margin: 0, fontSize: 10.5, whiteSpace: 'pre-wrap', color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>{definition}</pre>
      </div>
    )
  }

  return (
    <>
      {loadingLib && <div style={{ fontSize: 11.5, color: 'var(--fg-4)' }}>Loading diagram renderer…</div>}
      <div ref={containerRef} style={{ overflowX: 'auto', display: 'flex', justifyContent: 'center' }} />
    </>
  )
}
