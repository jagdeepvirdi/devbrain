import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useProjectStore } from '../store/projectStore'
import { tasksApi } from '../lib/api'
import type { Task, TaskInput } from '../lib/api'
import { LinkedItems } from '../components/LinkedItems'

// ── Constants ─────────────────────────────────────────────────────────────

const PRIORITY_META = {
  critical: { label: 'Critical', color: '#F05A5A' },
  high:     { label: 'High',     color: '#FF9D4D' },
  medium:   { label: 'Medium',   color: '#E6C341' },
  low:      { label: 'Low',      color: '#60A5FA' },
} as const

const STATUS_COLS = [
  { key: 'in_progress' as const, label: 'In Progress', color: '#FF9D4D' },
  { key: 'todo'        as const, label: 'To Do',       color: 'var(--fg-3)' },
  { key: 'done'        as const, label: 'Done',        color: '#4ADE80' },
  { key: 'cancelled'   as const, label: 'Cancelled',   color: 'var(--fg-4)' },
]

type Priority = keyof typeof PRIORITY_META
type Status   = Task['status']

// ── Quick-add row ─────────────────────────────────────────────────────────

function QuickAdd({ projectId, onAdded }: { projectId?: string | null; onAdded: (t: Task) => void }) {
  const [text,     setText]     = useState('')
  const [priority, setPriority] = useState<Priority>('medium')
  const [saving,   setSaving]   = useState(false)

  async function add() {
    const title = text.trim()
    if (!title || saving) return
    setSaving(true)
    try {
      const task = await tasksApi.create({ title, description: '', status: 'todo', priority, tags: [], project_id: projectId ?? null })
      onAdded(task)
      setText('')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 12px', borderRadius: 8,
      border: '1px solid var(--line-2)', background: 'var(--bg-elev)',
      marginBottom: 16,
    }}>
      <span style={{ color: 'var(--fg-4)', fontSize: 16, flexShrink: 0 }}>+</span>
      <input
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') add() }}
        placeholder="Add a task… (Enter to save)"
        style={{
          flex: 1, background: 'transparent', border: 'none', outline: 'none',
          fontSize: '13px', color: 'var(--fg)', fontFamily: 'inherit',
        }}
      />
      {/* Priority picker */}
      <div style={{ display: 'flex', gap: 3, background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 5, padding: 2 }}>
        {(Object.keys(PRIORITY_META) as Priority[]).map(p => (
          <button key={p}
            onClick={() => setPriority(p)}
            title={PRIORITY_META[p].label}
            style={{
              width: 20, height: 20, borderRadius: 3,
              background: priority === p ? `${PRIORITY_META[p].color}30` : 'transparent',
              border: priority === p ? `1.5px solid ${PRIORITY_META[p].color}` : '1.5px solid transparent',
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: PRIORITY_META[p].color, display: 'block', margin: 'auto' }} />
          </button>
        ))}
      </div>
      <button
        onClick={add}
        disabled={!text.trim() || saving}
        style={{
          padding: '4px 10px', borderRadius: 5, fontSize: '12px',
          background: text.trim() && !saving ? 'var(--accent)' : 'var(--bg-elev-2)',
          color: text.trim() && !saving ? 'white' : 'var(--fg-4)',
          cursor: text.trim() && !saving ? 'default' : 'not-allowed',
        }}
      >
        Add
      </button>
    </div>
  )
}

// ── Task card ─────────────────────────────────────────────────────────────

function TaskCard({
  task, onUpdate, onDelete, onExpand,
}: {
  task:     Task
  onUpdate: (id: string, updates: Partial<TaskInput>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onExpand: (task: Task) => void
}) {
  const pm = PRIORITY_META[task.priority]
  const done = task.status === 'done'

  async function toggleDone() {
    await onUpdate(task.id, { status: done ? 'todo' : 'done' })
  }

  return (
    <div style={{
      background: 'var(--bg-elev)', border: '1px solid var(--line)',
      borderRadius: 7, padding: '9px 12px',
      display: 'flex', alignItems: 'flex-start', gap: 9,
      transition: 'border-color .1s',
      opacity: task.status === 'cancelled' ? 0.5 : 1,
    }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--line-2)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--line)')}
    >
      {/* Done checkbox */}
      <button
        onClick={toggleDone}
        style={{
          width: 17, height: 17, borderRadius: 4, flexShrink: 0, marginTop: 1,
          border: `1.5px solid ${done ? 'var(--accent)' : 'var(--line-3)'}`,
          background: done ? 'var(--accent)' : 'transparent',
          display: 'grid', placeItems: 'center', cursor: 'default',
          transition: 'background .1s, border-color .1s',
        }}
      >
        {done && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><path d="M5 12l4 4 10-10"/></svg>}
      </button>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          onClick={() => onExpand(task)}
          style={{
            fontSize: '13px', color: done ? 'var(--fg-4)' : 'var(--fg)',
            textDecoration: done ? 'line-through' : 'none',
            lineHeight: 1.4, cursor: 'default',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {task.title}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          {/* Priority dot */}
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: '10.5px', color: pm.color,
          }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: pm.color }} />
            {pm.label}
          </span>
          {/* Project */}
          {task.project_name && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '10.5px', color: 'var(--fg-4)' }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: task.project_color ?? 'var(--fg-4)' }} />
              {task.project_name}
            </span>
          )}
          {/* Due date */}
          {task.due_date && (
            <span style={{ fontSize: '10.5px', color: 'var(--fg-4)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' }}>
              {new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>
      </div>

      {/* Delete */}
      <button
        onClick={() => onDelete(task.id)}
        style={{ color: 'var(--fg-4)', fontSize: '14px', flexShrink: 0, opacity: 0, cursor: 'default', transition: 'opacity .1s' }}
        onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
        onMouseLeave={e => (e.currentTarget.style.opacity = '0')}
      >×</button>
    </div>
  )
}

// ── Task detail panel ─────────────────────────────────────────────────────

function TaskPanel({ task, onClose, onUpdate }: { task: Task; onClose: () => void; onUpdate: (t: Task) => void }) {
  const navigate = useNavigate()
  const { projects } = useProjectStore()
  const [form, setForm] = useState({ ...task })
  const [saving, setSaving] = useState(false)

  async function save(updates: Partial<TaskInput>) {
    setSaving(true)
    try {
      const updated = await tasksApi.update(task.id, updates)
      onUpdate(updated)
      setForm(updated)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: 'var(--bg-elev)', border: '1px solid var(--line-2)',
        borderRadius: 10, width: 500, maxHeight: '80vh', overflow: 'auto',
        display: 'flex', flexDirection: 'column', gap: 0,
        boxShadow: '0 20px 60px rgba(0,0,0,.5)',
      }}>
        {/* Header */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--fg)', flex: 1 }}>Task details</h3>
          {saving && <span style={{ fontSize: '11px', color: 'var(--fg-4)' }}>saving…</span>}
          <button onClick={onClose} style={{ fontSize: 18, color: 'var(--fg-3)', lineHeight: 1 }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Title */}
          <input
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            onBlur={e => { if (e.target.value.trim() !== task.title) save({ title: e.target.value.trim() }) }}
            style={{
              fontSize: '15px', fontWeight: 500, color: 'var(--fg)',
              background: 'transparent', border: 'none', outline: 'none',
              borderBottom: '1px solid var(--line)', padding: '4px 0', width: '100%',
            }}
          />

          {/* Status + Priority row */}
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '11px', color: 'var(--fg-3)', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.05em' }}>Status</label>
              <select
                value={form.status}
                onChange={e => { const s = e.target.value as Status; setForm(f => ({ ...f, status: s })); save({ status: s }) }}
                style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--line-2)', background: 'var(--bg)', color: 'var(--fg)', fontSize: '13px' }}
              >
                {STATUS_COLS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '11px', color: 'var(--fg-3)', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.05em' }}>Priority</label>
              <select
                value={form.priority}
                onChange={e => { const p = e.target.value as Priority; setForm(f => ({ ...f, priority: p })); save({ priority: p }) }}
                style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--line-2)', background: 'var(--bg)', color: 'var(--fg)', fontSize: '13px' }}
              >
                {(Object.keys(PRIORITY_META) as Priority[]).map(p => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
              </select>
            </div>
          </div>

          {/* Project + Due date */}
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '11px', color: 'var(--fg-3)', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.05em' }}>Project</label>
              <select
                value={form.project_id ?? ''}
                onChange={e => { const v = e.target.value || null; setForm(f => ({ ...f, project_id: v })); save({ project_id: v }) }}
                style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--line-2)', background: 'var(--bg)', color: 'var(--fg)', fontSize: '13px' }}
              >
                <option value="">No project</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '11px', color: 'var(--fg-3)', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.05em' }}>Due date</label>
              <input
                type="date"
                value={form.due_date ?? ''}
                onChange={e => { setForm(f => ({ ...f, due_date: e.target.value || null })); save({ due_date: e.target.value || null }) }}
                style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--line-2)', background: 'var(--bg)', color: 'var(--fg)', fontSize: '13px', boxSizing: 'border-box' }}
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label style={{ fontSize: '11px', color: 'var(--fg-3)', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.05em' }}>Description</label>
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              onBlur={e => { if (e.target.value !== task.description) save({ description: e.target.value }) }}
              placeholder="Notes, links, context…"
              rows={4}
              style={{
                width: '100%', padding: '8px 10px', borderRadius: 6,
                border: '1px solid var(--line-2)', background: 'var(--bg)',
                color: 'var(--fg)', fontSize: '13px', resize: 'vertical',
                fontFamily: 'inherit', lineHeight: 1.6, boxSizing: 'border-box',
              }}
            />
          </div>

          {/* General cross-entity links (Documents / Codes / Issues / Releases / Commands) */}
          <LinkedItems
            entityType="task"
            entityId={task.id}
            onNavigate={(route, id) => navigate(`${route}?open=${id}`)}
          />

          {/* Meta */}
          <div style={{ fontSize: '11px', color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>
            Created {new Date(task.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
            {task.done_at && ` · Done ${new Date(task.done_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Column ────────────────────────────────────────────────────────────────

function Column({ col, tasks, onUpdate, onDelete, onExpand }: {
  col:      typeof STATUS_COLS[number]
  tasks:    Task[]
  onUpdate: (id: string, u: Partial<TaskInput>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onExpand: (t: Task) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* Column header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: col.color, flexShrink: 0 }} />
        <span style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--fg-2)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
          {col.label}
        </span>
        <span style={{ fontSize: '11px', color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>
          {tasks.length}
        </span>
      </div>

      {tasks.length === 0 && (
        <div style={{ padding: '16px 12px', borderRadius: 7, border: '1px dashed var(--line)', textAlign: 'center', fontSize: '12px', color: 'var(--fg-4)' }}>
          Empty
        </div>
      )}

      {tasks.map(task => (
        <TaskCard key={task.id} task={task} onUpdate={onUpdate} onDelete={onDelete} onExpand={onExpand} />
      ))}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────

export function TasksPage() {
  const { selectedProject } = useProjectStore()
  const project = selectedProject()
  const [searchParams, setSearchParams] = useSearchParams()

  const [tasks,    setTasks]    = useState<Task[]>([])
  const [loading,  setLoading]  = useState(true)
  const [expanded, setExpanded] = useState<Task | null>(null)
  const [filterPriority, setFilterPriority] = useState('')
  const [showDone, setShowDone] = useState(true)
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await tasksApi.list({ projectId: project?.id, priority: filterPriority || undefined })
      setTasks(data)
    } finally {
      setLoading(false)
    }
  }, [project, filterPriority])

  useEffect(() => { load() }, [load])

  // Deep-link support (?open=<id>) — fetches directly by id so a task linked
  // from a different project still opens, regardless of the current filter.
  useEffect(() => {
    const openId = searchParams.get('open')
    if (!openId || expanded?.id === openId) return
    tasksApi.get(openId).then(setExpanded).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  async function handleUpdate(id: string, updates: Partial<TaskInput>) {
    const updated = await tasksApi.update(id, updates)
    setTasks(prev => prev.map(t => t.id === id ? updated : t))
    if (expanded?.id === id) setExpanded(updated)
  }

  async function handleDelete(id: string) {
    await tasksApi.remove(id)
    setTasks(prev => prev.filter(t => t.id !== id))
    if (expanded?.id === id) setExpanded(null)
  }

  function handleAdded(task: Task) {
    setTasks(prev => [task, ...prev])
  }

  function handlePanelUpdate(updated: Task) {
    setTasks(prev => prev.map(t => t.id === updated.id ? updated : t))
    setExpanded(updated)
  }

  async function handleImport(file: File) {
    setImporting(true)
    setImportMsg('')
    try {
      const content = await file.text()
      const result = await tasksApi.importMd(content, project?.id)
      setImportMsg(`Imported ${result.created} task${result.created !== 1 ? 's' : ''} (${result.skipped} skipped)`)
      load()
    } catch (e) {
      setImportMsg((e as Error).message)
    } finally {
      setImporting(false)
    }
  }

  const activeTasks   = tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled')
  const completedCount = tasks.filter(t => t.status === 'done').length

  const visibleCols = showDone ? STATUS_COLS : STATUS_COLS.filter(c => c.key !== 'done' && c.key !== 'cancelled')

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--fg)' }}>Tasks</h1>
          {!loading && (
            <div style={{ fontSize: '11.5px', color: 'var(--fg-3)', marginTop: 2 }}>
              {activeTasks.length} active · {completedCount} done{project ? ` · ${project.name}` : ''}
            </div>
          )}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Priority filter */}
          <select
            value={filterPriority}
            onChange={e => setFilterPriority(e.target.value)}
            style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--line-2)', background: 'var(--bg-elev-2)', color: filterPriority ? 'var(--fg)' : 'var(--fg-3)', fontSize: '12.5px' }}
          >
            <option value="">All priorities</option>
            {(Object.keys(PRIORITY_META) as Priority[]).map(p => (
              <option key={p} value={p}>{PRIORITY_META[p].label}</option>
            ))}
          </select>
          {/* Import .md */}
          <input ref={fileRef} type="file" accept=".md" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) { handleImport(f); e.target.value = '' } }}
          />
          <button onClick={() => fileRef.current?.click()} disabled={importing}
            style={{ padding: '5px 10px', borderRadius: 6, fontSize: '12.5px', border: '1px solid var(--line-2)', background: 'var(--bg-elev-2)', color: 'var(--fg-3)', cursor: 'default', opacity: importing ? 0.6 : 1 }}>
            {importing ? 'Importing…' : '↑ Import .md'}
          </button>
          {importMsg && (
            <span style={{ fontSize: '11.5px', color: importMsg.startsWith('Imported') ? '#22C55E' : '#EF4444' }}>
              {importMsg}
            </span>
          )}
          {/* Show/hide done */}
          <button
            onClick={() => setShowDone(v => !v)}
            style={{
              padding: '5px 10px', borderRadius: 6, fontSize: '12.5px',
              border: '1px solid var(--line-2)',
              background: showDone ? 'var(--accent-dim)' : 'var(--bg-elev-2)',
              color: showDone ? 'var(--accent-2)' : 'var(--fg-3)',
            }}
          >
            {showDone ? 'Hide done' : 'Show done'}
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {/* Quick add */}
        <QuickAdd projectId={project?.id} onAdded={handleAdded} />

        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--fg-4)', fontSize: '13px', paddingTop: 40 }}>Loading…</div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${visibleCols.length}, 1fr)`,
            gap: 16,
            alignItems: 'start',
          }}>
            {visibleCols.map(col => (
              <Column
                key={col.key}
                col={col}
                tasks={tasks.filter(t => t.status === col.key)}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
                onExpand={setExpanded}
              />
            ))}
          </div>
        )}
      </div>

      {/* Detail panel */}
      {expanded && (
        <TaskPanel
          task={expanded}
          onClose={() => { setExpanded(null); if (searchParams.get('open')) setSearchParams({}, { replace: true }) }}
          onUpdate={handlePanelUpdate}
        />
      )}
    </div>
  )
}
