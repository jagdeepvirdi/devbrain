import { useState, useEffect } from 'react'

// ── ItemList — editable bullet list ─────────────────────────────────────────

export function ItemList({ items, color, onChange }: {
  items: string[]
  color: string
  onChange: (items: string[]) => void
}) {
  const [drafts, setDrafts] = useState(items)
  const [newItem, setNewItem] = useState('')

  useEffect(() => setDrafts(items), [items])

  function commit(newDrafts: string[]) {
    setDrafts(newDrafts)
    onChange(newDrafts.filter(Boolean))
  }

  function update(i: number, v: string) {
    const next = [...drafts]; next[i] = v; commit(next)
  }

  function remove(i: number) {
    commit(drafts.filter((_, j) => j !== i))
  }

  function add() {
    if (!newItem.trim()) return
    commit([...drafts, newItem.trim()])
    setNewItem('')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {drafts.map((item, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
          <span style={{ color, marginTop: 3, flexShrink: 0, fontSize: 12 }}>•</span>
          <input
            value={item}
            onChange={e => update(i, e.target.value)}
            style={{ flex: 1, background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 4, padding: '3px 8px', color: 'var(--fg)', fontSize: '12.5px', outline: 'none' }}
          />
          <button onClick={() => remove(i)} style={{ fontSize: 12, color: 'var(--fg-4)', background: 'none', border: 'none', cursor: 'default', padding: '3px 4px', flexShrink: 0 }}>✕</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6 }}>
        <span style={{ color: 'var(--fg-4)', marginTop: 3, flexShrink: 0, fontSize: 12 }}>+</span>
        <input
          value={newItem}
          onChange={e => setNewItem(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder="Add item… (Enter to add)"
          style={{ flex: 1, background: 'transparent', border: '1px dashed var(--line)', borderRadius: 4, padding: '3px 8px', color: 'var(--fg-3)', fontSize: '12.5px', outline: 'none' }}
        />
      </div>
    </div>
  )
}
