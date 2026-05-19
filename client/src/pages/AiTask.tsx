import { useState, useRef } from 'react'
import { aitaskApi, type OutputFormat } from '../lib/api'

const FORMATS: { value: OutputFormat; label: string; hint: string }[] = [
  { value: 'markdown',  label: 'Markdown',   hint: 'Headers, bold, code blocks' },
  { value: 'bullets',   label: 'Bullet list', hint: '• top-level  – sub-items' },
  { value: 'table',     label: 'Table',       hint: 'Markdown table with header row' },
  { value: 'json',      label: 'JSON',        hint: 'Raw JSON object or array only' },
  { value: 'code',      label: 'Code',        hint: 'Code only, with language fence' },
  { value: 'summary',   label: 'Summary',     hint: '3–5 sentence prose summary' },
  { value: 'plaintext', label: 'Plain text',  hint: 'No formatting at all' },
]

const EXAMPLE_TASKS = [
  'List the steps to debug a Flutter app crash on Android.',
  'Generate a SQL query to find the top 5 documents by embedding similarity given a query vector.',
  'Summarize the difference between IVFFlat and HNSW indexes in pgvector.',
  'Write a Python function to batch-fetch OHLC data from Zerodha Kite API.',
  'Create a release notes template for a minor version bump.',
]

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }
  return (
    <button onClick={copy} style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      height: 24, padding: '0 10px',
      borderRadius: 'var(--radius)', border: '1px solid var(--line-2)',
      background: 'var(--bg-elev)', color: copied ? 'var(--green)' : 'var(--fg-3)',
      fontSize: '11.5px', cursor: 'default',
    }}>
      {copied ? '✓ Copied' : label}
    </button>
  )
}

export function AiTaskPage() {
  const [task, setTask]       = useState('')
  const [format, setFormat]   = useState<OutputFormat>('markdown')
  const [result, setResult]   = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const textareaRef           = useRef<HTMLTextAreaElement>(null)

  async function run() {
    if (!task.trim()) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const data = await aitaskApi.run(task.trim(), format)
      setResult(data.result)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  function useExample(ex: string) {
    setTask(ex)
    setResult(null)
    setError(null)
    textareaRef.current?.focus()
  }

  // Build the "copy to claude.ai" prompt
  const claudePrompt = result
    ? task   // they already have the result, copy just the task to try in claude
    : `${task}\n\nPlease format your response as: ${FORMATS.find(f => f.value === format)?.label}`

  const label = { style: { display: 'block', fontSize: '11px', color: 'var(--fg-3)', textTransform: 'uppercase' as const, letterSpacing: '.07em', fontWeight: 600, marginBottom: '8px' } }

  return (
    <>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 24px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <h1 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--fg)' }}>AI Task</h1>
        <span style={{ fontSize: '11.5px', color: 'var(--fg-3)' }}>powered by Ollama (local · free)</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '11px', color: 'var(--fg-4)' }}>
            Want Claude? Copy the prompt →
          </span>
          <CopyButton text={claudePrompt} label="Copy prompt for claude.ai" />
          <a
            href="https://claude.ai"
            target="_blank"
            rel="noopener noreferrer"
            style={{ height: 24, padding: '0 10px', display: 'inline-flex', alignItems: 'center', borderRadius: 'var(--radius)', border: '1px solid var(--accent-line)', background: 'var(--accent-dim)', color: 'var(--accent-2)', fontSize: '11.5px' }}
          >
            Open claude.ai ↗
          </a>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '900px', width: '100%', margin: '0 auto', alignSelf: 'stretch' }}>

        {/* How it works notice */}
        <div style={{ padding: '12px 16px', background: 'var(--accent-dim)', border: '1px solid var(--accent-line)', borderRadius: 'var(--radius)', fontSize: '12.5px', color: 'var(--fg-2)', lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--accent-2)' }}>How this works:</strong> Describe your task below and pick an output format. Ollama runs it locally on your GPU — no cost, no data leaves your machine.
          {' '}To use Claude instead (claude.ai subscription), click <strong>Copy prompt for claude.ai</strong> and paste it there.
        </div>

        {/* Task input */}
        <div>
          <label style={label.style}>Task / Prompt</label>
          <textarea
            ref={textareaRef}
            value={task}
            onChange={e => setTask(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run() }}
            placeholder="Describe what you want. Be specific about context and constraints."
            rows={5}
            style={{
              width: '100%', padding: '10px 12px',
              background: 'var(--bg-elev-2)',
              border: '1px solid var(--line-2)',
              borderRadius: 'var(--radius)',
              fontSize: '13.5px', color: 'var(--fg)',
              resize: 'vertical', lineHeight: 1.55,
            }}
          />
          <div style={{ marginTop: '6px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '11px', color: 'var(--fg-4)', alignSelf: 'center' }}>Examples:</span>
            {EXAMPLE_TASKS.map(ex => (
              <button key={ex} onClick={() => useExample(ex)}
                style={{ fontSize: '11px', color: 'var(--accent-2)', background: 'var(--accent-dim)', border: '1px solid var(--accent-line)', borderRadius: '4px', padding: '2px 8px', cursor: 'default', textAlign: 'left' }}>
                {ex.length > 55 ? ex.slice(0, 55) + '…' : ex}
              </button>
            ))}
          </div>
        </div>

        {/* Format selector */}
        <div>
          <label style={label.style}>Output format</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {FORMATS.map(f => (
              <button
                key={f.value}
                onClick={() => setFormat(f.value)}
                title={f.hint}
                style={{
                  height: 30, padding: '0 12px',
                  borderRadius: 'var(--radius)',
                  border: format === f.value ? 'none' : '1px solid var(--line-2)',
                  background: format === f.value ? 'var(--accent)' : 'var(--bg-elev)',
                  color: format === f.value ? 'white' : 'var(--fg-2)',
                  fontSize: '12px', cursor: 'default',
                  boxShadow: format === f.value ? '0 0 0 1px rgba(99,102,241,.3), 0 0 18px rgba(99,102,241,.15)' : 'none',
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
          <p style={{ margin: '6px 0 0', fontSize: '11.5px', color: 'var(--fg-4)' }}>
            {FORMATS.find(f => f.value === format)?.hint}
          </p>
        </div>

        {/* Run button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={run}
            disabled={loading || !task.trim()}
            style={{
              height: 34, padding: '0 20px',
              borderRadius: 'var(--radius)',
              background: 'var(--accent)', color: 'white',
              border: 'none', fontSize: '13px',
              opacity: (loading || !task.trim()) ? .5 : 1,
              boxShadow: '0 0 0 1px rgba(99,102,241,.3), 0 0 18px rgba(99,102,241,.25)',
              cursor: 'default',
            }}
          >
            {loading ? 'Generating…' : '▶  Generate with Ollama'}
          </button>
          <span style={{ fontSize: '11.5px', color: 'var(--fg-4)' }}>⌘↵ to run</span>
        </div>

        {/* Error */}
        {error && (
          <div style={{ padding: '12px 14px', background: 'rgba(240,90,90,.08)', border: '1px solid rgba(240,90,90,.25)', borderRadius: 'var(--radius)', fontSize: '12.5px', color: '#F8A8A8' }}>
            <strong>Error:</strong> {error}
            {error.toLowerCase().includes('ollama') && (
              <span style={{ display: 'block', marginTop: '4px', color: '#F8A8A8', opacity: .7 }}>
                Make sure Ollama is running: <code style={{ fontFamily: 'var(--font-mono)' }}>docker compose up ollama</code>
              </span>
            )}
          </div>
        )}

        {/* Result */}
        {result !== null && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '11px', color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 600 }}>
                Result — {FORMATS.find(f => f.value === format)?.label}
              </span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
                <CopyButton text={result} label="Copy result" />
                <CopyButton text={claudePrompt} label="Copy prompt" />
              </div>
            </div>
            <div style={{
              background: 'var(--bg-elev)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius)',
              padding: '16px',
              fontFamily: format === 'json' || format === 'code' ? 'var(--font-mono)' : 'var(--font-ui)',
              fontSize: format === 'json' || format === 'code' ? '12.5px' : '13px',
              color: 'var(--fg-2)',
              lineHeight: 1.65,
              whiteSpace: 'pre-wrap',
              overflowX: 'auto',
              wordBreak: 'break-word' as const,
              maxHeight: '60vh',
              overflowY: 'auto',
            }}>
              {result}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
