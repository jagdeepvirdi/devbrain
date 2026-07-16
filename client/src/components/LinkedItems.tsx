import { useState, useEffect, useCallback } from 'react'
import {
  linksApi, tasksApi, documentsApi, issuesApi, releasesApi, commandsApi,
  type LinkEntityType, type EntityLink,
} from '../lib/api'
import { useToast } from './Toast'

// ── Type metadata ────────────────────────────────────────────────────────

export const ENTITY_META: Record<LinkEntityType, { label: string; icon: string; color: string }> = {
  task:     { label: 'Task',     icon: '☑', color: '#22C55E' },
  document: { label: 'Document', icon: '📄', color: '#6366F1' },
  issue:    { label: 'Issue',    icon: '⚠', color: '#F59E0B' },
  release:  { label: 'Release',  icon: '🏷', color: '#EC4899' },
  command:  { label: 'Command',  icon: '>', color: '#818CF8' },
}

const LINKABLE_TYPES: LinkEntityType[] = ['task', 'document', 'issue', 'release', 'command']

// Codes and Documents share the `document` link type (same underlying table,
// distinguished by file_type, which we store as the link's `subtitle`) — so
// navigation has to branch on that rather than on type alone.
export function routeForLink(link: { type: LinkEntityType; subtitle: string | null }): string {
  if (link.type === 'document') return link.subtitle === 'code' ? '/codes' : '/docs'
  return { task: '/tasks', issue: '/issues', release: '/releases', command: '/commands' }[link.type] as string
}

type Candidate = { id: string; label: string; sub: string }

async function fetchCandidates(type: LinkEntityType): Promise<Candidate[]> {
  switch (type) {
    case 'task': {
      const items = await tasksApi.list()
      return items.map(t => ({ id: t.id, label: t.title, sub: t.status }))
    }
    case 'document': {
      const result = await documentsApi.list({ limit: 100 })
      return result.items.map(d => ({ id: d.id, label: d.title, sub: d.file_type === 'code' ? `code · ${d.language ?? ''}` : d.file_type }))
    }
    case 'issue': {
      const result = await issuesApi.list({ limit: 100 })
      return result.items.map(i => ({ id: i.id, label: i.title, sub: i.status }))
    }
    case 'release': {
      const items = await releasesApi.list()
      return items.map(r => ({ id: r.id, label: `${r.project_name} v${r.version}`, sub: r.type }))
    }
    case 'command': {
      const result = await commandsApi.list({ limit: 100 })
      return result.items.map(c => ({ id: c.id, label: c.title, sub: c.language }))
    }
  }
}

// ── Picker modal ──────────────────────────────────────────────────────────

function LinkPickerModal({ entityType, entityId, existingIds, onLinked, onClose }: {
  entityType:  LinkEntityType
  entityId:    string
  existingIds: Set<string>
  onLinked:    () => void
  onClose:     () => void
}) {
  const { toast } = useToast()
  const [targetType, setTargetType] = useState<LinkEntityType>(LINKABLE_TYPES.find(t => t !== entityType) ?? 'issue')
  const [candidates,  setCandidates]  = useState<Candidate[]>([])
  const [loading,     setLoading]     = useState(true)
  const [search,      setSearch]      = useState('')
  const [linking,     setLinking]     = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    fetchCandidates(targetType).then(setCandidates).catch(() => setCandidates([])).finally(() => setLoading(false))
  }, [targetType])

  async function handleLink(id: string) {
    setLinking(id)
    try {
      await linksApi.create(entityType, entityId, targetType, id)
      onLinked()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setLinking(null)
    }
  }

  const visible = candidates
    .filter(c => !(targetType === entityType && c.id === entityId))
    .filter(c => !existingIds.has(c.id))
    .filter(c => !search.trim() || c.label.toLowerCase().includes(search.trim().toLowerCase()))

  const inp: React.CSSProperties = { width: '100%', background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 5, padding: '6px 9px', color: 'var(--fg)', fontSize: 12.5, boxSizing: 'border-box', outline: 'none' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(5,5,10,.65)', backdropFilter: 'blur(4px)', zIndex: 400, display: 'grid', placeItems: 'center' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-elev)', border: '1px solid var(--line-3)', borderRadius: 10, padding: 18, width: 380, maxHeight: '70vh', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', flex: 1 }}>Link an item</span>
          <button onClick={onClose} style={{ color: 'var(--fg-3)', fontSize: 13, padding: '2px 6px', borderRadius: 'var(--radius)' }}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {LINKABLE_TYPES.map(t => (
            <button
              key={t}
              onClick={() => setTargetType(t)}
              style={{
                fontSize: 11, padding: '4px 9px', borderRadius: 5,
                border: `1px solid ${targetType === t ? ENTITY_META[t].color : 'var(--line-2)'}`,
                background: targetType === t ? `${ENTITY_META[t].color}18` : 'var(--bg-elev-2)',
                color: targetType === t ? ENTITY_META[t].color : 'var(--fg-3)',
                cursor: 'default', fontWeight: 500,
              }}
            >
              {ENTITY_META[t].icon} {ENTITY_META[t].label}
            </button>
          ))}
        </div>

        <input value={search} onChange={e => setSearch(e.target.value)} placeholder={`Search ${ENTITY_META[targetType].label.toLowerCase()}s…`} style={inp} autoFocus />

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, minHeight: 120 }}>
          {loading && <div style={{ fontSize: 12, color: 'var(--fg-4)', padding: '10px 0', textAlign: 'center' }}>Loading…</div>}
          {!loading && visible.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--fg-4)', padding: '10px 0', textAlign: 'center' }}>No matching items.</div>
          )}
          {!loading && visible.map(c => (
            <button
              key={c.id}
              onClick={() => handleLink(c.id)}
              disabled={linking === c.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
                padding: '7px 9px', borderRadius: 6, border: '1px solid var(--line)',
                background: 'var(--bg)', color: 'var(--fg-2)', cursor: 'default',
                opacity: linking === c.id ? 0.6 : 1,
              }}
            >
              <span style={{ fontSize: 12.5, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</span>
              <span style={{ fontSize: 10.5, color: 'var(--fg-4)', flexShrink: 0 }}>{linking === c.id ? 'Linking…' : c.sub}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Linked items section ────────────────────────────────────────────────

export function LinkedItems({ entityType, entityId, onNavigate }: {
  entityType: LinkEntityType
  entityId:   string
  onNavigate: (route: string, id: string) => void
}) {
  const { toast } = useToast()
  const [links,      setLinks]      = useState<EntityLink[]>([])
  const [loading,    setLoading]    = useState(true)
  const [showPicker, setShowPicker] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    linksApi.list(entityType, entityId).then(setLinks).catch(() => setLinks([])).finally(() => setLoading(false))
  }, [entityType, entityId])

  useEffect(() => { load() }, [load])

  async function handleRemove(linkId: string) {
    try {
      await linksApi.remove(linkId)
      setLinks(prev => prev.filter(l => l.linkId !== linkId))
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.07em' }}>Linked Items</span>
        <button
          onClick={() => setShowPicker(true)}
          style={{ marginLeft: 'auto', fontSize: 11, padding: '3px 9px', borderRadius: 5, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', cursor: 'default' }}
        >
          + Link item
        </button>
      </div>

      {loading && <div style={{ fontSize: 12, color: 'var(--fg-4)' }}>Loading…</div>}

      {!loading && links.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--fg-4)' }}>Nothing linked yet.</div>
      )}

      {!loading && links.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {links.map(l => {
            const meta = ENTITY_META[l.type]
            return (
              <div
                key={l.linkId}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '4px 6px 4px 9px', borderRadius: 6,
                  border: `1px solid ${meta.color}30`, background: `${meta.color}12`,
                  fontSize: 12, cursor: 'default',
                }}
              >
                <span
                  onClick={() => onNavigate(routeForLink(l), l.id)}
                  style={{ color: meta.color, display: 'flex', alignItems: 'center', gap: 5, cursor: 'default' }}
                  title={`${meta.label}${l.subtitle ? ` · ${l.subtitle}` : ''}`}
                >
                  <span style={{ fontSize: 10 }}>{meta.icon}</span>
                  <span style={{ color: 'var(--fg-2)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.title}</span>
                </span>
                <button
                  onClick={() => handleRemove(l.linkId)}
                  title="Unlink"
                  style={{ color: 'var(--fg-4)', fontSize: 11, padding: '0 3px', opacity: 0.7 }}
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>
      )}

      {showPicker && (
        <LinkPickerModal
          entityType={entityType}
          entityId={entityId}
          existingIds={new Set(links.map(l => l.id))}
          onLinked={() => { load(); setShowPicker(false) }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  )
}
