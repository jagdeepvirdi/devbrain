import { useId } from 'react'

// Single-select feature/module tag (e.g. 'SAP', 'BPP', 'Payment') shared across
// documents, issues, tasks, releases, and commands — free text with autocomplete
// from whatever values already exist, same UX as the Documents component field.
export function ComponentInput({ value, onChange, onCommit, options, placeholder = 'Component (optional)' }: {
  value: string
  onChange: (value: string) => void
  /** Fires on blur or Enter — use for callers that persist on commit rather than every keystroke. Defaults to onChange. */
  onCommit?: (value: string) => void
  options: string[]
  placeholder?: string
}) {
  const listId = useId()

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <input
        list={listId}
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={e => onCommit?.(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') onCommit?.(e.currentTarget.value) }}
        placeholder={placeholder}
        style={{
          flex: 1, padding: '7px 8px', borderRadius: 6,
          border: '1px solid var(--line-2)', background: 'var(--bg)',
          color: 'var(--fg)', fontSize: '13px', outline: 'none',
        }}
      />
      <datalist id={listId}>
        {options.map(o => <option key={o} value={o} />)}
      </datalist>
      {value && (
        <button
          onClick={() => { onChange(''); onCommit?.('') }}
          title="Clear component"
          style={{ color: 'var(--fg-3)', fontSize: 11, background: 'none', border: 'none', cursor: 'default', padding: '0 4px' }}
        >
          ✕
        </button>
      )}
    </div>
  )
}
