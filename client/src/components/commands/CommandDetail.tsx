import { useState, useEffect } from 'react'
import type { Highlighter } from 'shiki'
import { commandsApi, type Command, type CommandInput } from '../../lib/api'
import { useRecentlyViewed } from '../../hooks/useRecentlyViewed'
import { SUPPORTED_LANGS, langColor, fmtDate } from './highlighter'
import { CodeBlock } from './CodeBlock'
import { ComponentInput } from '../ComponentInput'

export function CommandDetail({ cmd, hl, onUpdate, onDelete }: {
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
  const [component, setComponent]   = useState(cmd.component ?? '')
  const [componentOptions, setComponentOptions] = useState<string[]>([])
  const { track } = useRecentlyViewed()

  useEffect(() => {
    setTitle(cmd.title)
    setDesc(cmd.description)
    setCommand(cmd.command)
    setEditCode(false)
    setExplain(cmd.explanation ?? null)
    setConfirmDel(false)
    setComponent(cmd.component ?? '')
    track({ id: cmd.id, type: 'command', title: cmd.title, projectName: cmd.project_name ?? undefined, projectColor: cmd.project_color ?? undefined })
  }, [cmd.id, track])

  useEffect(() => {
    commandsApi.components(cmd.project_id ?? undefined).then(setComponentOptions).catch(() => setComponentOptions([]))
  }, [cmd.project_id])

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

      {/* Component */}
      <div>
        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6 }}>
          Component
        </div>
        <ComponentInput
          value={component}
          onChange={setComponent}
          onCommit={v => { if (v.trim() !== (cmd.component ?? '')) onUpdate(cmd.id, { component: v.trim() || null }) }}
          options={componentOptions}
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
