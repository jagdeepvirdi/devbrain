import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { commandsApi, type Command, type CommandInput } from '../lib/api'
import { useProjectStore } from '../store/projectStore'
import { useToast } from '../components/Toast'
import { SkeletonRow } from '../components/Skeleton'
import { createHighlighter, type Highlighter } from 'shiki'
import { useRecentlyViewed } from '../hooks/useRecentlyViewed'

// ── Shiki singleton ──────────────────────────────────────────────────────────

const SUPPORTED_LANGS = ['bash', 'powershell', 'python', 'typescript', 'javascript', 'dart', 'sql', 'yaml'] as const
type SupportedLang = typeof SUPPORTED_LANGS[number]

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

function useHighlighter() {
  const [hl, setHl] = useState<Highlighter | null>(null)
  useEffect(() => { getHl().then(setHl) }, [])
  return hl
}

// ── Constants ────────────────────────────────────────────────────────────────

const LANG_COLOR: Record<string, string> = {
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

function langColor(lang: string) { return LANG_COLOR[lang] ?? LANG_COLOR.plaintext }

function fmtDate(s: string | null) {
  if (!s) return 'never'
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── CSS injected once for Shiki pre ─────────────────────────────────────────

const SHIKI_STYLE = `
.shiki-wrap pre { margin: 0; padding: 14px 16px; overflow-x: auto; }
.shiki-wrap pre code { font-family: var(--font-mono); font-size: 12.5px; line-height: 1.65; }
`

// ── CodeBlock ────────────────────────────────────────────────────────────────

function CodeBlock({ code, lang, hl }: { code: string; lang: string; hl: Highlighter | null }) {
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

// ── LangBadge ────────────────────────────────────────────────────────────────

function LangBadge({ lang }: { lang: string }) {
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

// ── CommandCard ──────────────────────────────────────────────────────────────

function CommandCard({ cmd, selected, onClick, onFavToggle, isChecked, onToggleSelect, hasSelection }: {
  cmd: Command
  selected: boolean
  onClick: () => void
  onFavToggle: (e: React.MouseEvent) => void
  isChecked: boolean
  onToggleSelect: (id: string) => void
  hasSelection: boolean
}) {
  const firstLine = cmd.command.split('\n')[0]

  return (
    <a
      href={`/commands?open=${cmd.id}`}
      onClick={e => { if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); onClick() } }}
      className={`bulk-select-row ${isChecked ? 'bulk-select-row-selected' : ''} ${hasSelection ? 'bulk-select-has-selection' : ''}`}
      style={{
        display: 'block', textDecoration: 'none', color: 'inherit',
        padding: '9px 10px', borderRadius: 6, cursor: 'default',
        background: selected ? 'var(--bg-elev-2)' : 'transparent',
        border: `1px solid ${selected ? 'var(--line-2)' : 'transparent'}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
        <input
          type="checkbox"
          className="bulk-select-checkbox"
          checked={isChecked}
          onChange={e => {
            e.stopPropagation()
            onToggleSelect(cmd.id)
          }}
          onClick={e => e.stopPropagation()}
          style={{ accentColor: 'var(--accent)', cursor: 'default', width: 14, height: 14, flexShrink: 0, marginRight: 2 }}
        />
        <LangBadge lang={cmd.language} />
        <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {cmd.title}
        </span>
        {cmd.namespace === 'personal' && (
          <span style={{ fontSize: '9px', padding: '1px 5px', borderRadius: 3, background: 'rgba(99,102,241,.15)', border: '1px solid rgba(99,102,241,.3)', color: 'var(--accent-2)', flexShrink: 0, letterSpacing: '.03em' }}>
            personal
          </span>
        )}
        <button
          onClick={onFavToggle}
          aria-label={cmd.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
          aria-pressed={cmd.is_favorite}
          style={{
            fontSize: 13, flexShrink: 0,
            color: cmd.is_favorite ? '#F59E0B' : 'var(--fg-4)',
            background: 'none', border: 'none', padding: 0, lineHeight: 1,
          }}
        >
          {cmd.is_favorite ? '★' : '☆'}
        </button>
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: cmd.description ? 3 : 0 }}>
        {firstLine}
      </div>
      {cmd.description && (
        <div style={{ fontSize: '11.5px', color: 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {cmd.description}
        </div>
      )}
      {cmd.tags.length > 0 && (
        <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
          {cmd.tags.slice(0, 5).map(t => (
            <span key={t} style={{ fontSize: '10px', padding: '0 5px', borderRadius: 3, background: 'var(--bg-elev)', border: '1px solid var(--line)', color: 'var(--fg-3)' }}>
              {t}
            </span>
          ))}
        </div>
      )}
    </a>
  )
}

// ── CommandDetail ────────────────────────────────────────────────────────────

function CommandDetail({ cmd, hl, onUpdate, onDelete }: {
  cmd: Command
  hl: Highlighter | null
  onUpdate: (id: string, updates: Partial<CommandInput>) => Promise<void>
  onDelete: (id: string) => void
}) {
  const [title, setTitle]           = useState(cmd.title)
  const [description, setDesc]      = useState(cmd.description)
  const [command, setCommand]       = useState(cmd.command)
  const [editingCode, setEditCode]  = useState(false)
  const [explaining, setExplaining] = useState(false)
  const [explanation, setExplain]   = useState<string | null>(cmd.explanation ?? null)
  const [confirmDel, setConfirmDel] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const { track } = useRecentlyViewed()

  useEffect(() => {
    setTitle(cmd.title)
    setDesc(cmd.description)
    setCommand(cmd.command)
    setEditCode(false)
    setExplain(cmd.explanation ?? null)
    setConfirmDel(false)
    track({ id: cmd.id, type: 'command', title: cmd.title, projectName: cmd.project_name ?? undefined, projectColor: cmd.project_color ?? undefined })
  }, [cmd.id, track])

  async function explain() {
    setExplaining(true)
    setExplain(null)
    try {
      const res = await commandsApi.explain(cmd.id)
      setExplain(res.explanation)
    } catch {
      setExplain('Failed to get explanation — is Ollama running?')
    } finally {
      setExplaining(false)
    }
  }

  const color = langColor(cmd.language)

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={() => { if (title.trim() && title !== cmd.title) onUpdate(cmd.id, { title: title.trim() }) }}
          style={{ flex: 1, background: 'none', border: 'none', color: 'var(--fg)', fontSize: 18, fontWeight: 600, padding: 0, outline: 'none' }}
          aria-label="Command title"
        />
        <button
          onClick={() => {
            const url = `${window.location.origin}/commands?open=${cmd.id}`
            navigator.clipboard.writeText(url).then(() => { setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2000) })
          }}
          aria-label="Copy link to this command"
          style={{ fontSize: '11px', color: linkCopied ? '#4ADE80' : 'var(--fg-4)', padding: '3px 8px', borderRadius: 4, border: `1px solid ${linkCopied ? 'rgba(74,222,128,.4)' : 'var(--line-2)'}`, flexShrink: 0 }}
        >
          {linkCopied ? '✓ Copied' : '⎘ Link'}
        </button>
        <button
          onClick={() => onUpdate(cmd.id, { is_favorite: !cmd.is_favorite })}
          aria-label={cmd.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
          aria-pressed={cmd.is_favorite}
          style={{
            fontSize: 18, color: cmd.is_favorite ? '#F59E0B' : 'var(--fg-4)',
            background: 'none', border: 'none', flexShrink: 0,
          }}
        >
          {cmd.is_favorite ? '★' : '☆'}
        </button>
        {!confirmDel
          ? <button onClick={() => setConfirmDel(true)} aria-label="Delete command" style={{ fontSize: '11.5px', padding: '4px 10px', borderRadius: 5, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)' }}>
              Delete
            </button>
          : <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => onDelete(cmd.id)} aria-label="Confirm delete command" style={{ fontSize: '11.5px', padding: '4px 10px', borderRadius: 5, border: '1px solid #EF4444', background: 'rgba(239,68,68,.1)', color: '#EF4444' }}>
                Confirm
              </button>
              <button onClick={() => setConfirmDel(false)} style={{ fontSize: '11.5px', padding: '4px 10px', borderRadius: 5, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)' }}>
                Cancel
              </button>
            </div>
        }
      </div>

      {/* Meta row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <select
          value={cmd.language}
          onChange={e => onUpdate(cmd.id, { language: e.target.value })}
          style={{ fontSize: '11.5px', padding: '3px 8px', borderRadius: 4, border: `1px solid ${color}50`, background: `${color}18`, color, cursor: 'default', outline: 'none' }}
        >
          {[...SUPPORTED_LANGS, 'plaintext'].map(l => <option key={l} value={l}>{l}</option>)}
        </select>

        {cmd.project_name && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '11.5px', color: 'var(--fg-3)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: cmd.project_color ?? 'var(--fg-3)', flexShrink: 0 }} />
            {cmd.project_name}
          </span>
        )}

        <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--fg-4)' }}>
          Last used: {fmtDate(cmd.last_used)}
        </span>
      </div>

      {/* Code block */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.07em' }}>
            Command
          </span>
          <button onClick={() => setEditCode(v => !v)} style={{ fontSize: '11px', padding: '2px 8px', borderRadius: 4, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', cursor: 'default' }}>
            {editingCode ? 'Done' : 'Edit'}
          </button>
        </div>
        {editingCode
          ? <textarea
              value={command}
              onChange={e => setCommand(e.target.value)}
              onBlur={() => { if (command.trim() && command !== cmd.command) onUpdate(cmd.id, { command: command.trim() }) }}
              style={{
                width: '100%', minHeight: 120, fontFamily: 'var(--font-mono)', fontSize: '12.5px',
                lineHeight: 1.65, background: '#0d1117', color: '#e6edf3',
                border: '1px solid var(--line)', borderRadius: 6, padding: '12px 14px',
                resize: 'vertical', boxSizing: 'border-box', outline: 'none',
              }}
            />
          : <CodeBlock code={cmd.command} lang={cmd.language} hl={hl} />
        }
      </div>

      {/* Description */}
      <div>
        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6 }}>
          Description
        </div>
        <textarea
          value={description}
          onChange={e => setDesc(e.target.value)}
          onBlur={() => { if (description !== cmd.description) onUpdate(cmd.id, { description }) }}
          placeholder="What does this command do?"
          rows={2}
          style={{
            width: '100%', background: 'var(--bg-elev)', border: '1px solid var(--line)',
            borderRadius: 6, padding: '8px 12px', color: 'var(--fg)', fontSize: '13px',
            resize: 'vertical', boxSizing: 'border-box', outline: 'none', lineHeight: 1.5,
          }}
        />
      </div>

      {/* Tags */}
      {cmd.tags.length > 0 && (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {cmd.tags.map(t => (
            <span key={t} style={{ fontSize: '11.5px', padding: '2px 8px', borderRadius: 4, background: 'var(--bg-elev)', border: '1px solid var(--line)', color: 'var(--fg-2)' }}>
              {t}
            </span>
          ))}
        </div>
      )}

      {/* AI Explain */}
      <div>
        <button onClick={explain} disabled={explaining} style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '7px 14px', borderRadius: 6,
          border: '1px solid var(--accent-line)', background: 'var(--accent-dim)',
          color: 'var(--accent-2)', fontSize: '12.5px', fontWeight: 500,
          cursor: 'default', opacity: explaining ? 0.6 : 1,
        }}>
          <span style={{ fontSize: 10 }}>◆</span>
          {explaining ? 'Explaining…' : explanation ? 'Re-explain with AI' : 'Explain with AI'}
        </button>
        {explanation && (
          <div style={{
            marginTop: 10, padding: '12px 14px', borderRadius: 6,
            background: 'var(--bg-elev)', border: '1px solid var(--line)',
            fontSize: '13px', lineHeight: 1.65, color: 'var(--fg-2)', whiteSpace: 'pre-wrap',
          }}>
            {explanation}
          </div>
        )}
      </div>

      {/* Footer meta */}
      <div style={{ fontSize: '11px', color: 'var(--fg-4)', paddingTop: 8, borderTop: '1px solid var(--line)' }}>
        Created {fmtDate(cmd.created_at)}
      </div>
    </div>
  )
}

// ── NewCommandModal ──────────────────────────────────────────────────────────

function NewCommandModal({ onClose, onCreate }: {
  onClose: () => void
  onCreate: (cmd: Command) => void
}) {
  const { projects } = useProjectStore()
  const { selectedProject } = useProjectStore()
  const proj = selectedProject()

  const [title,      setTitle]      = useState('')
  const [command,    setCommand]    = useState('')
  const [language,   setLanguage]   = useState('bash')
  const [description,setDesc]       = useState('')
  const [projectId,  setProjectId]  = useState<string>(proj?.id ?? '')
  const [tagsRaw,    setTagsRaw]    = useState('')
  const [isFav,      setIsFav]      = useState(false)
  const [namespace,  setNamespace]  = useState<'team' | 'personal'>('team')
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !command.trim()) { setError('Title and command are required.'); return }
    setSaving(true)
    try {
      const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean)
      const created = await commandsApi.create({
        title: title.trim(), command: command.trim(), language,
        description: description.trim(),
        project_id: projectId || null,
        tags, is_favorite: isFav, namespace,
      })
      onCreate(created)
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', background: 'var(--bg-elev)', border: '1px solid var(--line)',
    borderRadius: 6, padding: '7px 10px', color: 'var(--fg)', fontSize: '13px',
    boxSizing: 'border-box', outline: 'none',
  }

  const labelStyle: React.CSSProperties = {
    fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)',
    textTransform: 'uppercase', letterSpacing: '.07em', display: 'block', marginBottom: 5,
  }

  return (
    <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, backdropFilter: 'blur(4px)' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-cmd-dialog-title"
        className="modal-panel"
        style={{ width: 540, maxHeight: '85vh', display: 'flex', flexDirection: 'column', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 24px 60px rgba(0,0,0,.5)' }}
      >
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span id="new-cmd-dialog-title" style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg)' }}>New Command</span>
          <button onClick={onClose} aria-label="Close dialog" style={{ width: 24, height: 24, display: 'grid', placeItems: 'center', borderRadius: 4, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', fontSize: 14 }}>✕</button>
        </div>

        <form id="new-cmd-form" onSubmit={submit} style={{ padding: '16px 18px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
          <div>
            <label style={labelStyle}>Title *</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Start Dev Server" style={inputStyle} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Language</label>
              <select value={language} onChange={e => setLanguage(e.target.value)} style={{ ...inputStyle, cursor: 'default' }}>
                {[...SUPPORTED_LANGS, 'plaintext'].map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Project</label>
              <select value={projectId} onChange={e => setProjectId(e.target.value)} style={{ ...inputStyle, cursor: 'default' }}>
                <option value="">— Global —</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label style={labelStyle}>Command *</label>
            <textarea
              value={command}
              onChange={e => setCommand(e.target.value)}
              placeholder="e.g. npm run dev"
              rows={5}
              style={{ ...inputStyle, fontFamily: 'var(--font-mono)', fontSize: '12.5px', lineHeight: 1.65, resize: 'vertical' }}
            />
          </div>

          <div>
            <label style={labelStyle}>Description</label>
            <textarea value={description} onChange={e => setDesc(e.target.value)} placeholder="What does this command do?" rows={2} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} />
          </div>

          <div>
            <label style={labelStyle}>Tags (comma-separated)</label>
            <input value={tagsRaw} onChange={e => setTagsRaw(e.target.value)} placeholder="dev, server, docker" style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>Visibility</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['team', 'personal'] as const).map(ns => (
                <label key={ns} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'default', fontSize: '13px', color: namespace === ns ? 'var(--fg)' : 'var(--fg-3)', padding: '5px 12px', borderRadius: 5, border: `1px solid ${namespace === ns ? 'var(--accent)' : 'var(--line)'}`, background: namespace === ns ? 'var(--accent-dim)' : 'transparent', flex: 1, justifyContent: 'center' }}>
                  <input type="radio" name="namespace" value={ns} checked={namespace === ns} onChange={() => setNamespace(ns)} style={{ display: 'none' }} />
                  {ns === 'team' ? '👥 Team' : '🔒 Personal'}
                </label>
              ))}
            </div>
            <div style={{ marginTop: 4, fontSize: '11px', color: 'var(--fg-4)' }}>
              {namespace === 'team' ? 'Visible to all team members' : 'Visible only to you'}
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'default', fontSize: '13px', color: 'var(--fg-2)' }}>
            <input type="checkbox" checked={isFav} onChange={e => setIsFav(e.target.checked)} />
            Mark as favorite
          </label>
        </form>

        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--line)', display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
          {error && <span style={{ flex: 1, fontSize: '12px', color: '#EF4444' }}>{error}</span>}
          <button type="button" onClick={onClose} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-2)', fontSize: '13px', cursor: 'default' }}>Cancel</button>
          <button type="submit" form="new-cmd-form" disabled={saving} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', fontSize: '13px', cursor: 'default', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save Command'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── CommandPalette (Ctrl+K) ──────────────────────────────────────────────────

function CommandPalette({ onClose }: { onClose: () => void }) {
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

// ── CommandsPage ─────────────────────────────────────────────────────────────

const CMD_PAGE = 25

function parseShellFile(text: string): { title: string; command: string }[] {
  const results: { title: string; command: string }[] = []
  const lines = text.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i].trim()
    // Skip shebang and blank lines
    if (line.startsWith('#!') || line === '') { i++; continue }
    if (line.startsWith('#')) {
      const title = line.replace(/^#+\s*/, '').trim()
      i++
      const cmdLines: string[] = []
      while (i < lines.length) {
        const cl = lines[i]
        if (cl.trim() === '' || cl.trim().startsWith('#')) break
        cmdLines.push(cl)
        i++
      }
      if (cmdLines.length > 0 && title) {
        results.push({ title, command: cmdLines.join('\n').trimEnd() })
      }
    } else {
      i++
    }
  }
  return results
}

export function CommandsPage() {
  const hl = useHighlighter()
  const { selectedProject } = useProjectStore()
  const { toast } = useToast()
  const proj = selectedProject()
  const [searchParams, setSearchParams] = useSearchParams()

  const [commands,      setCommands]      = useState<Command[]>([])
  const [total,         setTotal]         = useState(0)
  const [nextOffset,    setNextOffset]    = useState(0)
  const [loading,       setLoading]       = useState(true)
  const [loadingMore,   setLoadingMore]   = useState(false)
  const [selectedId,    setSelectedId]    = useState<string | null>(searchParams.get('open'))
  const [search,        setSearch]        = useState('')
  const [langFilter,    setLangFilter]    = useState<string | null>(null)
  const [favFilter,     setFavFilter]     = useState(false)
  const [nsFilter,      setNsFilter]      = useState<'all' | 'personal' | 'team'>('all')
  const [showNew,       setShowNew]       = useState(false)
  const [paletteOpen,   setPaletteOpen]   = useState(false)
  const [importing,     setImporting]     = useState(false)
  const importRef = useRef<HTMLInputElement>(null)
  const loadAbortRef = useRef<AbortController | null>(null)

  const [selectedIds,   setSelectedIds]   = useState<Set<string>>(new Set())
  const [bulkWorking,   setBulkWorking]   = useState(false)
  const [confirmBulkDel, setConfirmBulkDel] = useState(false)
  const headerCheckboxRef = useRef<HTMLInputElement>(null)

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    setSelectedIds(prev => prev.size === commands.length ? new Set() : new Set(commands.map(c => c.id)))
  }, [commands])

  async function handleBulkFavorite(favorite: boolean) {
    setBulkWorking(true)
    try {
      await commandsApi.bulk([...selectedIds], 'favorite', favorite ? 'true' : 'false')
      setCommands(prev => prev.map(c => selectedIds.has(c.id) ? { ...c, is_favorite: favorite } : c))
      toast(`Updated ${selectedIds.size} command${selectedIds.size !== 1 ? 's' : ''}`, 'success')
      setSelectedIds(new Set())
    } catch {
      toast('Bulk update failed', 'error')
    } finally {
      setBulkWorking(false)
    }
  }

  async function handleBulkDelete() {
    setBulkWorking(true)
    try {
      await commandsApi.bulk([...selectedIds], 'delete')
      const count = selectedIds.size
      setCommands(prev => prev.filter(c => !selectedIds.has(c.id)))
      setTotal(t => t - count)
      if (selectedId && selectedIds.has(selectedId)) selectCommand(null)
      toast(`Deleted ${count} command${count !== 1 ? 's' : ''}`, 'success')
      setSelectedIds(new Set())
    } catch {
      toast('Bulk delete failed', 'error')
    } finally {
      setBulkWorking(false)
      setConfirmBulkDel(false)
    }
  }

  async function handleBulkTag(tag: string) {
    if (!tag.trim()) return
    setBulkWorking(true)
    try {
      await commandsApi.bulk([...selectedIds], 'tag', tag.trim())
      setCommands(prev => prev.map(c => {
        if (selectedIds.has(c.id)) {
          const newTags = c.tags.includes(tag.trim()) ? c.tags : [...c.tags, tag.trim()]
          return { ...c, tags: newTags }
        }
        return c
      }))
      toast(`Tagged ${selectedIds.size} command${selectedIds.size !== 1 ? 's' : ''}`, 'success')
      setSelectedIds(new Set())
    } catch {
      toast('Bulk tagging failed', 'error')
    } finally {
      setBulkWorking(false)
    }
  }

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = selectedIds.size > 0 && selectedIds.size < commands.length
    }
  }, [selectedIds, commands])

  // Inject Shiki CSS once
  useEffect(() => {
    const id = 'shiki-style'
    if (!document.getElementById(id)) {
      const style = document.createElement('style')
      style.id = id
      style.textContent = SHIKI_STYLE
      document.head.appendChild(style)
    }
  }, [])

  const load = useCallback(async (offset: number, append: boolean) => {
    if (!append) {
      loadAbortRef.current?.abort()
      loadAbortRef.current = new AbortController()
      setLoading(true)
      setSelectedIds(new Set())
    } else {
      setLoadingMore(true)
    }
    const signal = !append ? loadAbortRef.current?.signal : undefined
    try {
      const result = await commandsApi.list({
        projectId: proj?.id,
        search:    search || undefined,
        language:  langFilter ?? undefined,
        favorite:  favFilter || undefined,
        namespace: nsFilter !== 'all' ? nsFilter : undefined,
        limit:     CMD_PAGE,
        offset,
        signal,
      })
      setTotal(result.total)
      setCommands(prev => append ? [...prev, ...result.items] : result.items)
      setNextOffset(offset + result.items.length)
      setLoading(false)
      setLoadingMore(false)
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      if (!append) setCommands([])
      setLoading(false)
      setLoadingMore(false)
    }
  }, [proj?.id, search, langFilter, favFilter, nsFilter])

  useEffect(() => { load(0, false) }, [load])

  // Debounce search
  const [searchInput, setSearchInput] = useState('')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function handleSearchChange(v: string) {
    setSearchInput(v)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setSearch(v), 250)
  }

  const selected = useMemo(
    () => commands.find(c => c.id === selectedId) ?? null,
    [commands, selectedId]
  )

  const handleUpdate = useCallback(async (id: string, updates: Partial<CommandInput>) => {
    const updated = await commandsApi.update(id, updates)
    setCommands(prev => prev.map(c => c.id === id ? updated : c))
  }, [])

  // Keep ?open= URL param in sync with selected command
  const selectCommand = useCallback((id: string | null) => {
    setSelectedId(id)
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (id) next.set('open', id)
      else next.delete('open')
      return next
    }, { replace: true })
  }, [setSearchParams])

  const handleDelete = useCallback((id: string) => {
    commandsApi.remove(id).then(() => {
      setCommands(prev => prev.filter(c => c.id !== id))
      selectCommand(null)
    })
  }, [selectCommand])

  const handleFavToggle = useCallback((e: React.MouseEvent, cmd: Command) => {
    e.stopPropagation()
    commandsApi.update(cmd.id, { is_favorite: !cmd.is_favorite }).then(updated => {
      setCommands(prev => prev.map(c => c.id === cmd.id ? updated : c))
    })
  }, [])

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setImporting(true)
    try {
      const text = await file.text()
      const parsed = parseShellFile(text)
      if (parsed.length === 0) { toast('No parseable commands found (need # comment before each command)', 'error'); return }
      let created = 0
      for (const { title, command } of parsed) {
        await commandsApi.create({ title, command, language: 'bash', description: '', tags: [], is_favorite: false, namespace: 'team', project_id: proj?.id ?? null })
        created++
      }
      load(0, false)
      toast(`Imported ${created} command${created !== 1 ? 's' : ''}`, 'success')
    } catch {
      toast('Import failed', 'error')
    } finally {
      setImporting(false)
    }
  }

  const availableLangs = useMemo(
    () => [...new Set(commands.map(c => c.language))].sort(),
    [commands]
  )

  // Keyboard shortcut: N = new command
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); setShowNew(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <h1 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--fg)' }}>Commands</h1>
        {proj && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '11.5px', color: 'var(--fg-3)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: proj.color }} />
            {proj.name}
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          <button onClick={() => setPaletteOpen(true)} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 10px', borderRadius: 5, fontSize: '12px',
            border: '1px solid var(--line-2)', background: 'var(--bg-elev)',
            color: 'var(--fg-3)', cursor: 'default',
          }}>
            <span style={{ opacity: .6 }}>⌘</span> Quick copy
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', padding: '0 4px', border: '1px solid var(--line-2)', borderRadius: 3 }}>Ctrl+K</span>
          </button>
          <button
            onClick={() => importRef.current?.click()}
            disabled={importing}
            title="Import commands from a shell file (.sh, .bash, .zshrc)"
            style={{ padding: '5px 10px', borderRadius: 5, border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-3)', fontSize: '12px', cursor: 'default', opacity: importing ? 0.6 : 1 }}
          >
            {importing ? 'Importing…' : '↑ Import'}
          </button>
          <input
            ref={importRef}
            type="file"
            accept=".sh,.bash,.zshrc,.bashrc,.zsh,.profile"
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />
          <button onClick={() => setShowNew(true)} style={{ padding: '5px 12px', borderRadius: 5, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', fontSize: '12px', cursor: 'default' }}>
            + New
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Left: list */}
        <div style={{ width: 300, borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>
          {/* Search */}
          <div style={{ padding: '10px 10px 6px' }}>
            <input
              value={searchInput}
              onChange={e => handleSearchChange(e.target.value)}
              placeholder="Search…"
              style={{ width: '100%', background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 6, padding: '6px 10px', color: 'var(--fg)', fontSize: '12.5px', boxSizing: 'border-box', outline: 'none' }}
            />
          </div>

          {/* Filters */}
          <div style={{ padding: '0 10px 8px', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <button onClick={() => { setFavFilter(false); setLangFilter(null); setNsFilter('all') }} style={{ fontSize: '11px', padding: '2px 8px', borderRadius: 10, border: '1px solid var(--line)', background: !favFilter && !langFilter && nsFilter === 'all' ? 'var(--bg-elev-2)' : 'transparent', color: !favFilter && !langFilter && nsFilter === 'all' ? 'var(--fg)' : 'var(--fg-3)', cursor: 'default' }}>
              All
            </button>
            <button onClick={() => { setFavFilter(v => !v); setLangFilter(null) }} style={{ fontSize: '11px', padding: '2px 8px', borderRadius: 10, border: '1px solid var(--line)', background: favFilter ? '#F59E0B20' : 'transparent', color: favFilter ? '#F59E0B' : 'var(--fg-3)', cursor: 'default' }}>
              ★ Favorites
            </button>
            <button onClick={() => setNsFilter(v => v === 'team' ? 'all' : 'team')} style={{ fontSize: '11px', padding: '2px 8px', borderRadius: 10, border: `1px solid ${nsFilter === 'team' ? 'rgba(99,102,241,.5)' : 'var(--line)'}`, background: nsFilter === 'team' ? 'rgba(99,102,241,.15)' : 'transparent', color: nsFilter === 'team' ? 'var(--accent-2)' : 'var(--fg-3)', cursor: 'default' }}>
              👥 Team
            </button>
            <button onClick={() => setNsFilter(v => v === 'personal' ? 'all' : 'personal')} style={{ fontSize: '11px', padding: '2px 8px', borderRadius: 10, border: `1px solid ${nsFilter === 'personal' ? 'rgba(99,102,241,.5)' : 'var(--line)'}`, background: nsFilter === 'personal' ? 'rgba(99,102,241,.15)' : 'transparent', color: nsFilter === 'personal' ? 'var(--accent-2)' : 'var(--fg-3)', cursor: 'default' }}>
              🔒 Personal
            </button>
            {availableLangs.map(l => (
              <button key={l} onClick={() => setLangFilter(langFilter === l ? null : l)} style={{
                fontSize: '11px', padding: '2px 8px', borderRadius: 10,
                border: `1px solid ${langFilter === l ? langColor(l) + '60' : 'var(--line)'}`,
                background: langFilter === l ? langColor(l) + '20' : 'transparent',
                color: langFilter === l ? langColor(l) : 'var(--fg-3)', cursor: 'default',
              }}>
                {l}
              </button>
            ))}
          </div>

          {/* List */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 6px 8px' }}>
            {/* List header select all */}
            {!loading && commands.length > 0 && (
              <div style={{ padding: '6px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-elev-2)', margin: '0 6px 6px', borderRadius: 6 }}>
                <input
                  type="checkbox"
                  ref={headerCheckboxRef}
                  checked={commands.length > 0 && selectedIds.size === commands.length}
                  onChange={toggleSelectAll}
                  style={{ accentColor: 'var(--accent)', cursor: 'default', width: 14, height: 14 }}
                />
                <span style={{ fontSize: '11px', color: 'var(--fg-3)', fontWeight: 500 }}>
                  Select all
                </span>
              </div>
            )}

            {loading
              ? [1,2,3,4,5].map(i => <SkeletonRow key={i} cols={[140, 80, 50]} />)
              : commands.length === 0
                ? <div style={{ padding: '28px 16px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 38, height: 38, borderRadius: 8, background: 'var(--bg-elev)', border: '1px solid var(--line)', display: 'grid', placeItems: 'center', fontSize: 18, color: 'var(--fg-4)' }}>&gt;_</div>
                    <div style={{ fontSize: '12px', color: 'var(--fg-3)' }}>
                      {search ? `No commands matching "${search}"` : 'No commands yet'}
                    </div>
                    {!search && (
                      <button onClick={() => setShowNew(true)} style={{ fontSize: '11.5px', padding: '5px 12px', borderRadius: 5, border: '1px solid var(--accent)', background: 'var(--accent-dim)', color: 'var(--accent-2)' }}>
                        + Create your first command
                      </button>
                    )}
                  </div>
                : commands.map(cmd => (
                    <CommandCard
                      key={cmd.id}
                      cmd={cmd}
                      selected={cmd.id === selectedId}
                      onClick={() => selectCommand(cmd.id)}
                      onFavToggle={e => handleFavToggle(e, cmd)}
                      isChecked={selectedIds.has(cmd.id)}
                      onToggleSelect={toggleSelect}
                      hasSelection={selectedIds.size > 0}
                    />
                  ))
            }
            {!loading && commands.length < total && (
              <div style={{ padding: '8px', textAlign: 'center' }}>
                <button
                  onClick={() => load(nextOffset, true)}
                  disabled={loadingMore}
                  style={{ height: 24, padding: '0 12px', borderRadius: 'var(--radius)', border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-3)', fontSize: 11.5, opacity: loadingMore ? 0.6 : 1 }}
                >
                  {loadingMore ? 'Loading…' : `+${total - commands.length} more`}
                </button>
              </div>
            )}
          </div>

          <div style={{ padding: '8px 12px', borderTop: '1px solid var(--line)', fontSize: '11px', color: 'var(--fg-4)' }}>
            {total} command{total !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Right: detail */}
        {selected
          ? <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <CommandDetail
                key={selected.id}
                cmd={selected}
                hl={hl}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
              />
            </div>
          : <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: 'var(--fg-3)' }}>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--bg-elev)', border: '1px solid var(--line)', display: 'grid', placeItems: 'center', fontSize: '18px' }}>
                &gt;_
              </div>
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--fg-3)' }}>
                {commands.length > 0 ? 'Select a command to view it' : 'No commands yet — create one'}
              </p>
            </div>
        }
      </div>

      {showNew && (
        <NewCommandModal
          onClose={() => setShowNew(false)}
          onCreate={cmd => { setCommands(prev => [cmd, ...prev]); setSelectedId(cmd.id); setShowNew(false) }}
        />
      )}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}

      {/* Floating Action Bar */}
      {selectedIds.size > 0 && (
        <div style={{
          position: 'absolute',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--bg-elev-2)',
          border: '1px solid var(--accent-line)',
          borderRadius: 10,
          padding: '10px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
          zIndex: 100,
          animation: 'modal-in 0.15s ease',
        }}>
          <span style={{ fontSize: '12.5px', color: 'var(--fg-2)', fontWeight: 500, marginRight: 6 }}>
            {selectedIds.size} selected
          </span>

          <div style={{ display: 'flex', gap: 6 }}>
            {/* Tag Input */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 6, padding: '2px 8px' }}>
              <input
                placeholder="Add tag..."
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    handleBulkTag(e.currentTarget.value)
                    e.currentTarget.value = ''
                  }
                }}
                style={{ fontSize: '11.5px', color: 'var(--fg)', width: 85, background: 'none', border: 'none', outline: 'none' }}
              />
            </div>

            {/* Favorite toggle */}
            <button
              onClick={() => handleBulkFavorite(true)}
              disabled={bulkWorking}
              style={{
                fontSize: '11.5px',
                padding: '4px 12px',
                borderRadius: 6,
                border: '1px solid var(--line)',
                background: 'var(--bg-elev)',
                color: '#F59E0B',
                transition: 'all 0.15s',
              }}
            >
              ★ Favorite
            </button>
            <button
              onClick={() => handleBulkFavorite(false)}
              disabled={bulkWorking}
              style={{
                fontSize: '11.5px',
                padding: '4px 12px',
                borderRadius: 6,
                border: '1px solid var(--line)',
                background: 'var(--bg-elev)',
                color: 'var(--fg-3)',
                transition: 'all 0.15s',
              }}
            >
              ☆ Unfavorite
            </button>

            {/* Delete button with confirmation */}
            {!confirmBulkDel ? (
              <button
                onClick={() => setConfirmBulkDel(true)}
                disabled={bulkWorking}
                style={{
                  fontSize: '11.5px',
                  padding: '4px 12px',
                  borderRadius: 6,
                  border: '1px solid rgba(239,68,68,.4)',
                  background: 'rgba(239,68,68,.08)',
                  color: '#EF4444',
                  transition: 'all 0.15s',
                }}
              >
                Delete
              </button>
            ) : (
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  onClick={handleBulkDelete}
                  disabled={bulkWorking}
                  style={{
                    fontSize: '11.5px',
                    padding: '4px 12px',
                    borderRadius: 6,
                    border: 'none',
                    background: '#EF4444',
                    color: 'white',
                    fontWeight: 500,
                  }}
                >
                  {bulkWorking ? 'Deleting...' : 'Confirm'}
                </button>
                <button
                  onClick={() => setConfirmBulkDel(false)}
                  style={{
                    fontSize: '11.5px',
                    padding: '4px 10px',
                    borderRadius: 6,
                    border: '1px solid var(--line)',
                    background: 'var(--bg-elev)',
                    color: 'var(--fg-3)',
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          <div style={{ width: '1px', height: 16, background: 'var(--line-2)', margin: '0 4px' }} />

          <button
            onClick={() => setSelectedIds(new Set())}
            style={{
              fontSize: '12px',
              color: 'var(--fg-3)',
              background: 'none',
              border: 'none',
              padding: '4px 8px',
              borderRadius: 6,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--fg)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--fg-3)'}
          >
            Deselect all
          </button>
        </div>
      )}
    </div>
  )
}
