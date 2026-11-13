import { useState, useEffect, useCallback } from 'react'
import { timeApi } from '../../lib/api'
import type { TimeRule, TimeRuleKind } from '../../lib/api'

const KINDS: { value: TimeRuleKind; label: string; hint: string }[] = [
  { value: 'editor_project', label: 'Editor project', hint: 'exact VS Code workspace name, e.g. devbrain' },
  { value: 'app',            label: 'App',            hint: 'exact app name, e.g. Android Studio' },
  { value: 'title',          label: 'Window title',   hint: 'text the window title contains' },
  { value: 'path',           label: 'Path',           hint: 'text the file path or title contains, e.g. D:/Project/devbrain' },
]

const field = {
  background: 'var(--bg)', color: 'var(--fg)', border: '1px solid var(--line)', borderRadius: 4,
  padding: '3px 6px', fontSize: '11.5px',
} as const

export function TimeMappingRules({ projects, onChanged }: {
  projects: { id: string; name: string }[]
  onChanged: () => void
}) {
  const [rules, setRules]     = useState<TimeRule[] | null>(null)
  const [error, setError]     = useState('')
  const [projectId, setProjectId] = useState('')
  const [kind, setKind]       = useState<TimeRuleKind>('editor_project')
  const [pattern, setPattern] = useState('')
  const [priority, setPriority] = useState('0')

  const load = useCallback(() => {
    timeApi.rules().then(setRules).catch(e => setError((e as Error).message))
  }, [])
  useEffect(() => { load() }, [load])

  const effectiveProject = projectId || projects[0]?.id || ''
  const hint = KINDS.find(k => k.value === kind)?.hint

  async function add() {
    setError('')
    try {
      await timeApi.addRule({ project_id: effectiveProject, kind, pattern: pattern.trim(), priority: Number(priority) || 0 })
      setPattern('')
      load()
      onChanged()
    } catch (e) { setError((e as Error).message) }
  }

  async function remove(id: string) {
    setError('')
    try { await timeApi.deleteRule(id); load(); onChanged() }
    catch (e) { setError((e as Error).message) }
  }

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
      <div style={{ fontSize: '11px', color: 'var(--fg-4)', marginBottom: 8, lineHeight: 1.5 }}>
        Rules decide which project ActivityWatch time belongs to. Highest priority wins; time no rule matches is shown as Unassigned.
        Re-run Import after changing rules.
      </div>

      {error && <div role="alert" style={{ fontSize: '11.5px', color: '#EF4444', marginBottom: 6 }}>{error}</div>}

      {rules === null ? null : rules.length === 0 ? (
        <div style={{ fontSize: '11.5px', color: 'var(--fg-4)', marginBottom: 8 }}>No rules yet.</div>
      ) : (
        <ul style={{ listStyle: 'none', margin: '0 0 8px', padding: 0 }}>
          {rules.map(r => (
            <li key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '11.5px', padding: '3px 0', color: 'var(--fg-2)' }}>
              <span style={{ color: 'var(--fg-4)', fontFamily: 'var(--font-mono)', minWidth: 28 }}>{r.priority}</span>
              <span style={{ color: 'var(--fg-3)' }}>{KINDS.find(k => k.value === r.kind)?.label ?? r.kind}</span>
              <code style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.pattern}</code>
              <span>→ {r.project_name}</span>
              <button aria-label={`Delete rule ${r.pattern}`} onClick={() => remove(r.id)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-4)' }}>✕</button>
            </li>
          ))}
        </ul>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <select aria-label="Rule kind" value={kind} onChange={e => setKind(e.target.value as TimeRuleKind)} style={field}>
          {KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
        <input aria-label="Rule pattern" value={pattern} onChange={e => setPattern(e.target.value)}
               placeholder={hint} style={{ ...field, flex: 1, minWidth: 140 }} />
        <select aria-label="Rule project" value={effectiveProject} onChange={e => setProjectId(e.target.value)} style={field}>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input aria-label="Rule priority" type="number" value={priority} onChange={e => setPriority(e.target.value)}
               style={{ ...field, width: 56 }} title="Priority (higher wins)" />
        <button onClick={add} disabled={!pattern.trim() || !effectiveProject}
          style={{
            fontSize: '10.5px', padding: '3px 10px', borderRadius: 4, cursor: 'pointer',
            background: 'rgba(99,102,241,0.1)', color: 'var(--accent)', border: '1px solid rgba(99,102,241,0.3)',
          }}>Add rule</button>
      </div>
    </div>
  )
}
