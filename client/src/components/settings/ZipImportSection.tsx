import React, { useState, useRef } from 'react'
import { settingsApi, type ImportSummary } from '../../lib/api'
import { useToast } from '../Toast'

export function ZipImportSection() {
  const { toast } = useToast()
  const zipRef = useRef<HTMLInputElement>(null)
  const [zipFile,  setZipFile]  = useState<File | null>(null)
  const [loading,  setLoading]  = useState(false)
  const [result,   setResult]   = useState<ImportSummary | null>(null)
  const [error,    setError]    = useState('')

  async function handleImport(dryRun: boolean) {
    if (!zipFile) return
    setLoading(true); setError(''); setResult(null)
    try {
      const r = await settingsApi.zipImport(zipFile, dryRun)
      setResult(r)
      if (!dryRun) {
        const total = Object.values(r.summary).reduce((s, t) => s + t.created, 0)
        toast(`Zip import complete — ${total} records created`)
      }
    } catch (e) { setError((e as Error).message) }
    finally { setLoading(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 4 }}>
      <div style={{ fontSize: 12, color: 'var(--fg-4)' }}>
        Import from a DevBrain zip export — restores documents, issues, and commands; skips records that already exist.
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input ref={zipRef} type="file" accept=".zip" style={{ display: 'none' }} onChange={e => { setZipFile(e.target.files?.[0] ?? null); setResult(null); setError(''); e.target.value = '' }} />
        <button onClick={() => zipRef.current?.click()} style={{ height: 28, padding: '0 12px', borderRadius: 'var(--radius)', border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-2)', fontSize: 12.5, cursor: 'default' }}>
          {zipFile ? zipFile.name : 'Choose zip file'}
        </button>
        {zipFile && (
          <>
            <button onClick={() => handleImport(true)} disabled={loading} style={{ height: 28, padding: '0 12px', borderRadius: 'var(--radius)', border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-2)', fontSize: 12.5, opacity: loading ? 0.6 : 1, cursor: 'default' }}>Dry run</button>
            <button onClick={() => handleImport(false)} disabled={loading} style={{ height: 28, padding: '0 12px', borderRadius: 'var(--radius)', border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', fontSize: 12.5, opacity: loading ? 0.6 : 1, cursor: 'default' }}>Import</button>
          </>
        )}
      </div>
      {error && <div style={{ fontSize: 12, color: '#EF4444', padding: '6px 10px', borderRadius: 5, background: 'rgba(239,68,68,.06)', border: '1px solid rgba(239,68,68,.2)' }}>{error}</div>}
      {result && (
        <div style={{ borderRadius: 7, border: '1px solid var(--line)', background: 'var(--bg)', padding: '10px 12px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>{result.dry_run ? 'Dry run preview' : 'Import result'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 1fr', gap: '4px 12px' }}>
            <span style={{ fontSize: 11, color: 'var(--fg-4)' }} /><span style={{ fontSize: 11, color: '#22C55E', fontWeight: 600 }}>to create</span><span style={{ fontSize: 11, color: 'var(--fg-4)', fontWeight: 600 }}>skip</span>
            {Object.entries(result.summary).map(([table, tally]) => (
              <React.Fragment key={table}>
                <span style={{ fontSize: 12, color: 'var(--fg-2)', fontFamily: 'var(--font-mono)' }}>{table}</span>
                <span style={{ fontSize: 12, color: tally.created > 0 ? '#22C55E' : 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>{tally.created}</span>
                <span style={{ fontSize: 12, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>{tally.skipped}</span>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
