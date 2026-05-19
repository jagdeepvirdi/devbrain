import { useEffect, useRef, useState } from 'react'
import { claudeProjectsApi, type TaskTreeData, type TaskPhaseData, type TaskItemData } from '../../lib/api'

interface Props {
  projectId: string
}

// ── Item row ──────────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: TaskItemData['status'] }) {
  const cls = {
    done:        'bg-green-500',
    in_progress: 'bg-yellow-400',
    blocked:     'bg-red-500',
    todo:        'bg-slate-600',
  }[status]
  return <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${cls}`} />
}

function ItemRow({ item }: { item: TaskItemData }) {
  return (
    <li className="flex items-start gap-2 py-0.5 text-sm">
      <StatusDot status={item.status} />
      <span className={item.status === 'done' ? 'text-slate-500 line-through' : 'text-slate-300'}>
        {item.text}
      </span>
      {item.doneDate && (
        <span className="ml-auto text-xs text-slate-600 flex-shrink-0">{item.doneDate}</span>
      )}
    </li>
  )
}

// ── Phase accordion ───────────────────────────────────────────────────────────

function PhaseAccordion({ phase }: { phase: TaskPhaseData }) {
  const [open, setOpen] = useState(phase.pct < 100)

  const barColor =
    phase.pct === 100 ? 'bg-green-500'
    : phase.pct >= 50  ? 'bg-indigo-500'
    : 'bg-yellow-400'

  return (
    <div className="border border-white/[0.06] rounded-md overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-3 py-2.5 bg-[#1A1A26] hover:bg-[#1e1e2e] transition-colors text-left"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-slate-400 text-xs select-none">{open ? '▾' : '▸'}</span>
        <span className="flex-1 text-sm font-medium text-slate-200 truncate">{phase.name}</span>
        <span className="text-xs text-slate-500 flex-shrink-0">{phase.done}/{phase.total}</span>
        <div className="w-16 h-1.5 bg-slate-700 rounded-full flex-shrink-0">
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${phase.pct}%` }}
          />
        </div>
        <span className="text-xs text-slate-500 w-8 text-right flex-shrink-0">{phase.pct}%</span>
      </button>

      {open && phase.items.length > 0 && (
        <ul className="px-4 py-2 bg-[#12121A] space-y-0.5">
          {phase.items.map((item, i) => (
            <ItemRow key={i} item={item} />
          ))}
        </ul>
      )}

      {open && phase.items.length === 0 && (
        <p className="px-4 py-2 text-xs text-slate-600 bg-[#12121A]">No items in this phase.</p>
      )}
    </div>
  )
}

// ── Overall progress bar ──────────────────────────────────────────────────────

function OverallBar({ tree }: { tree: TaskTreeData }) {
  return (
    <div className="flex items-center gap-3 px-1 mb-4">
      <div className="flex-1 h-2 bg-slate-700 rounded-full">
        <div
          className="h-full rounded-full bg-indigo-500 transition-all"
          style={{ width: `${tree.overallPct}%` }}
        />
      </div>
      <span className="text-sm text-slate-400 flex-shrink-0">
        {tree.totalDone}/{tree.totalItems} ({tree.overallPct}%)
      </span>
      {tree.lastUpdated && (
        <span className="text-xs text-slate-600 flex-shrink-0">
          updated {tree.lastUpdated.slice(0, 10)}
        </span>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TasksTab({ projectId }: Props) {
  const [tree, setTree]       = useState<TaskTreeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const unsubRef              = useRef<(() => void) | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)

    claudeProjectsApi.getTasks(projectId)
      .then(data => { setTree(data); setLoading(false) })
      .catch(err  => { setError((err as Error).message); setLoading(false) })

    // Live SSE updates
    unsubRef.current = claudeProjectsApi.watchTasks(projectId, updated => setTree(updated))

    return () => { unsubRef.current?.(); unsubRef.current = null }
  }, [projectId])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="text-slate-500 text-sm">Loading tasks…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-md bg-red-900/20 border border-red-800/40 p-4 text-sm text-red-400">
        {error}
      </div>
    )
  }

  if (!tree || tree.phases.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-500">
        <span className="text-2xl">📋</span>
        <p className="text-sm">No TASKS.md found in the linked project folder.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <OverallBar tree={tree} />
      {tree.phases.map((phase, i) => (
        <PhaseAccordion key={i} phase={phase} />
      ))}
    </div>
  )
}
