import { useState, useEffect } from 'react'
import { useProjectStore } from '../store/projectStore'
import { searchApi } from '../lib/api'
import type { SavedFilter } from '../lib/api'
import { useToast } from './Toast'

export interface FilterState {
  projectIds: string[]
  status: string[]
  priority: string[]
  tags: string[]
  dateFrom: string
  dateTo: string
  fileType: string[]
}

export const initialFilterState: FilterState = {
  projectIds: [],
  status: [],
  priority: [],
  tags: [],
  dateFrom: '',
  dateTo: '',
  fileType: [],
}

interface FilterBarProps {
  entityType: 'issues' | 'documents'
  filters: FilterState
  onChange: (filters: FilterState) => void
}

export function FilterBar({ entityType, filters, onChange }: FilterBarProps) {
  const { projects } = useProjectStore()
  const { toast } = useToast()

  const [isOpen, setIsOpen] = useState(false)
  const [presets, setPresets] = useState<SavedFilter[]>([])
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [newPresetName, setNewPresetName] = useState('')
  const [isSavingPreset, setIsSavingPreset] = useState(false)

  // Tag input state
  const [tagInput, setTagInput] = useState('')

  // Load presets on mount
  const loadPresets = async () => {
    try {
      const res = await searchApi.getFilters()
      setPresets(res.filter(p => p.entity_type === entityType))
    } catch (err) {
      console.error('Failed to load filter presets:', err)
    }
  }

  useEffect(() => {
    loadPresets()
  }, [entityType])

  // Helper to check if any filters are active
  const hasActiveFilters = () => {
    return (
      filters.projectIds.length > 0 ||
      filters.status.length > 0 ||
      filters.priority.length > 0 ||
      filters.tags.length > 0 ||
      filters.dateFrom !== '' ||
      filters.dateTo !== '' ||
      filters.fileType.length > 0
    )
  }

  const handleClearAll = () => {
    onChange(initialFilterState)
  }

  const toggleStatus = (val: string) => {
    const next = filters.status.includes(val)
      ? filters.status.filter(v => v !== val)
      : [...filters.status, val]
    onChange({ ...filters, status: next })
  }

  const togglePriority = (val: string) => {
    const next = filters.priority.includes(val)
      ? filters.priority.filter(v => v !== val)
      : [...filters.priority, val]
    onChange({ ...filters, priority: next })
  }

  const toggleFileType = (val: string) => {
    const next = filters.fileType.includes(val)
      ? filters.fileType.filter(v => v !== val)
      : [...filters.fileType, val]
    onChange({ ...filters, fileType: next })
  }

  const toggleProject = (val: string) => {
    const next = filters.projectIds.includes(val)
      ? filters.projectIds.filter(v => v !== val)
      : [...filters.projectIds, val]
    onChange({ ...filters, projectIds: next })
  }

  const handleAddTag = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && tagInput.trim()) {
      e.preventDefault()
      const newTag = tagInput.trim().toLowerCase()
      if (!filters.tags.includes(newTag)) {
        onChange({ ...filters, tags: [...filters.tags, newTag] })
      }
      setTagInput('')
    }
  }

  const handleRemoveTag = (tag: string) => {
    onChange({ ...filters, tags: filters.tags.filter(t => t !== tag) })
  }

  const handleSavePreset = async () => {
    if (!newPresetName.trim()) {
      toast('Please enter a name for the filter preset', 'error')
      return
    }
    setIsSavingPreset(true)
    try {
      await searchApi.saveFilter(newPresetName.trim(), entityType, filters)
      toast('Filter preset saved successfully', 'success')
      setNewPresetName('')
      setShowSaveModal(false)
      loadPresets()
    } catch (err) {
      toast('Failed to save filter preset', 'error')
    } finally {
      setIsSavingPreset(false)
    }
  }

  const handleDeletePreset = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await searchApi.deleteFilter(id)
      toast('Filter preset deleted', 'success')
      loadPresets()
    } catch (err) {
      toast('Failed to delete preset', 'error')
    }
  }

  const applyPreset = (preset: SavedFilter) => {
    // Merge initialFilterState to make sure all properties are present
    const loadedFilters = { ...initialFilterState, ...preset.filter_json }
    onChange(loadedFilters)
    toast(`Applied filter preset "${preset.name}"`, 'success')
  }

  return (
    <div style={{ padding: '8px 20px', borderBottom: '1px solid var(--line)', background: 'var(--bg-elev)', display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
      {/* Trigger & Presets Row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '5px 10px',
            borderRadius: 6,
            background: isOpen ? 'var(--bg-elev-2)' : 'transparent',
            border: '1px solid var(--line-2)',
            fontSize: '12.5px',
            fontWeight: 500,
            color: 'var(--fg)',
            transition: 'all 0.15s ease',
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease' }}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          Filters
        </button>

        {/* Saved Presets */}
        {presets.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '11px', color: 'var(--fg-3)', marginRight: 2 }}>Presets:</span>
            {presets.map(p => (
              <div
                key={p.id}
                onClick={() => applyPreset(p)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '3px 8px',
                  borderRadius: 99,
                  background: 'var(--bg-elev-2)',
                  border: '1px solid var(--line-2)',
                  fontSize: '11.5px',
                  color: 'var(--fg-2)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                className="hover:border-accent-line hover:text-fg"
              >
                <span>{p.name}</span>
                <button
                  onClick={(e) => handleDeletePreset(p.id, e)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    fontSize: '9px',
                    color: 'var(--fg-3)',
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    lineHeight: 1,
                  }}
                  className="hover:bg-red hover:text-white"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {hasActiveFilters() && (
          <button
            onClick={() => setShowSaveModal(true)}
            style={{
              marginLeft: 'auto',
              padding: '4px 10px',
              borderRadius: 6,
              background: 'var(--accent-dim)',
              border: '1px solid var(--accent-line)',
              color: 'var(--accent-2)',
              fontSize: '11.5px',
              fontWeight: 500,
            }}
          >
            Save Preset
          </button>
        )}
      </div>

      {/* Collapsible Panel */}
      {isOpen && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 16,
            padding: '12px 10px',
            background: 'var(--bg)',
            borderRadius: 8,
            border: '1px solid var(--line)',
            marginTop: 4,
          }}
        >
          {/* Project Multi-select */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Projects</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 120, overflowY: 'auto', paddingRight: 4 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '12px', color: 'var(--fg-2)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={filters.projectIds.includes('global')}
                  onChange={() => toggleProject('global')}
                  style={{ accentColor: 'var(--accent)' }}
                />
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#7A7A8A' }} />
                <span>Global / No Project</span>
              </label>
              {projects.map(p => (
                <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '12px', color: 'var(--fg-2)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={filters.projectIds.includes(p.id)}
                    onChange={() => toggleProject(p.id)}
                    style={{ accentColor: 'var(--accent)' }}
                  />
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color }} />
                  <span>{p.name}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Status (Issues only) */}
          {entityType === 'issues' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {[
                  { value: 'open', label: 'Open', color: 'var(--green)' },
                  { value: 'investigating', label: 'Investigating', color: 'var(--orange)' },
                  { value: 'resolved', label: 'Resolved', color: 'var(--blue)' },
                  { value: 'wont-fix', label: 'Wont Fix', color: 'var(--fg-3)' },
                ].map(s => {
                  const isActive = filters.status.includes(s.value)
                  return (
                    <button
                      key={s.value}
                      onClick={() => toggleStatus(s.value)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 12,
                        background: isActive ? 'var(--bg-elev-2)' : 'transparent',
                        border: `1px solid ${isActive ? s.color : 'var(--line-2)'}`,
                        fontSize: '11.5px',
                        color: isActive ? 'var(--fg)' : 'var(--fg-3)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.color }} />
                      {s.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Priority (Issues only) */}
          {entityType === 'issues' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Priority</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {[
                  { value: 'low', label: 'Low', color: 'var(--fg-3)' },
                  { value: 'medium', label: 'Medium', color: 'var(--yellow)' },
                  { value: 'high', label: 'High', color: 'var(--orange)' },
                  { value: 'critical', label: 'Critical', color: 'var(--red)' },
                ].map(p => {
                  const isActive = filters.priority.includes(p.value)
                  return (
                    <button
                      key={p.value}
                      onClick={() => togglePriority(p.value)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 12,
                        background: isActive ? 'var(--bg-elev-2)' : 'transparent',
                        border: `1px solid ${isActive ? p.color : 'var(--line-2)'}`,
                        fontSize: '11.5px',
                        color: isActive ? 'var(--fg)' : 'var(--fg-3)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: p.color }} />
                      {p.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* File Type (Documents only) */}
          {entityType === 'documents' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>File Type</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {[
                  { value: 'pdf', label: 'PDF' },
                  { value: 'docx', label: 'Word (DOCX)' },
                  { value: 'md', label: 'Markdown' },
                  { value: 'txt', label: 'Text' },
                  { value: 'xlsx', label: 'Excel (XLSX)' },
                  { value: 'url', label: 'URL / Link' },
                ].map(ft => {
                  const isActive = filters.fileType.includes(ft.value)
                  return (
                    <button
                      key={ft.value}
                      onClick={() => toggleFileType(ft.value)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 12,
                        background: isActive ? 'var(--accent-dim)' : 'transparent',
                        border: `1px solid ${isActive ? 'var(--accent)' : 'var(--line-2)'}`,
                        fontSize: '11.5px',
                        color: isActive ? 'var(--accent-2)' : 'var(--fg-3)',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {ft.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Tags */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tags</span>
            <input
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={handleAddTag}
              placeholder="Type tag and press Enter"
              style={{
                padding: '6px 10px',
                borderRadius: 6,
                border: '1px solid var(--line-2)',
                background: 'var(--bg-elev-2)',
                color: 'var(--fg)',
                fontSize: '12px',
              }}
            />
            {filters.tags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                {filters.tags.map(t => (
                  <span
                    key={t}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '2px 8px',
                      borderRadius: 4,
                      background: 'var(--bg-elev-2)',
                      border: '1px solid var(--line-2)',
                      fontSize: '11px',
                      color: 'var(--fg-2)',
                    }}
                  >
                    #{t}
                    <button onClick={() => handleRemoveTag(t)} style={{ color: 'var(--fg-3)', border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}>×</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Date Range */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Created Date Range</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="date"
                value={filters.dateFrom}
                onChange={e => onChange({ ...filters, dateFrom: e.target.value })}
                style={{
                  padding: '4px 6px',
                  borderRadius: 6,
                  border: '1px solid var(--line-2)',
                  background: 'var(--bg-elev-2)',
                  color: 'var(--fg)',
                  fontSize: '12px',
                  flex: 1,
                  colorScheme: 'dark',
                }}
              />
              <span style={{ color: 'var(--fg-3)', fontSize: '11px' }}>to</span>
              <input
                type="date"
                value={filters.dateTo}
                onChange={e => onChange({ ...filters, dateTo: e.target.value })}
                style={{
                  padding: '4px 6px',
                  borderRadius: 6,
                  border: '1px solid var(--line-2)',
                  background: 'var(--bg-elev-2)',
                  color: 'var(--fg)',
                  fontSize: '12px',
                  flex: 1,
                  colorScheme: 'dark',
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Active Filters Summary */}
      {hasActiveFilters() && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', paddingTop: 4 }}>
          <span style={{ fontSize: '11px', color: 'var(--fg-3)' }}>Active:</span>

          {/* Project Pills */}
          {filters.projectIds.map(pid => {
            const p = projects.find(pr => pr.id === pid)
            const name = pid === 'global' ? 'Global' : (p ? p.name : pid)
            return (
              <span
                key={pid}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 8px',
                  borderRadius: 12,
                  background: 'var(--bg-elev-2)',
                  border: '1px solid var(--line-2)',
                  fontSize: '11px',
                  color: 'var(--fg)',
                }}
              >
                Project: {name}
                <button onClick={() => toggleProject(pid)} style={{ color: 'var(--fg-3)', fontSize: 12 }}>✕</button>
              </span>
            )
          })}

          {/* Status Pills */}
          {filters.status.map(s => (
            <span
              key={s}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 8px',
                borderRadius: 12,
                background: 'var(--bg-elev-2)',
                border: '1px solid var(--line-2)',
                fontSize: '11px',
                color: 'var(--fg)',
              }}
            >
              Status: {s}
              <button onClick={() => toggleStatus(s)} style={{ color: 'var(--fg-3)', fontSize: 12 }}>✕</button>
            </span>
          ))}

          {/* Priority Pills */}
          {filters.priority.map(p => (
            <span
              key={p}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 8px',
                borderRadius: 12,
                background: 'var(--bg-elev-2)',
                border: '1px solid var(--line-2)',
                fontSize: '11px',
                color: 'var(--fg)',
              }}
            >
              Priority: {p}
              <button onClick={() => togglePriority(p)} style={{ color: 'var(--fg-3)', fontSize: 12 }}>✕</button>
            </span>
          ))}

          {/* File Type Pills */}
          {filters.fileType.map(ft => (
            <span
              key={ft}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 8px',
                borderRadius: 12,
                background: 'var(--bg-elev-2)',
                border: '1px solid var(--line-2)',
                fontSize: '11px',
                color: 'var(--fg)',
              }}
            >
              Type: {ft}
              <button onClick={() => toggleFileType(ft)} style={{ color: 'var(--fg-3)', fontSize: 12 }}>✕</button>
            </span>
          ))}

          {/* Tag Pills */}
          {filters.tags.map(t => (
            <span
              key={t}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 8px',
                borderRadius: 12,
                background: 'var(--bg-elev-2)',
                border: '1px solid var(--line-2)',
                fontSize: '11px',
                color: 'var(--fg)',
              }}
            >
              Tag: #{t}
              <button onClick={() => handleRemoveTag(t)} style={{ color: 'var(--fg-3)', fontSize: 12 }}>✕</button>
            </span>
          ))}

          {/* Date Pills */}
          {filters.dateFrom && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 8px',
                borderRadius: 12,
                background: 'var(--bg-elev-2)',
                border: '1px solid var(--line-2)',
                fontSize: '11px',
                color: 'var(--fg)',
              }}
            >
              From: {filters.dateFrom}
              <button onClick={() => onChange({ ...filters, dateFrom: '' })} style={{ color: 'var(--fg-3)', fontSize: 12 }}>✕</button>
            </span>
          )}

          {filters.dateTo && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 8px',
                borderRadius: 12,
                background: 'var(--bg-elev-2)',
                border: '1px solid var(--line-2)',
                fontSize: '11px',
                color: 'var(--fg)',
              }}
            >
              To: {filters.dateTo}
              <button onClick={() => onChange({ ...filters, dateTo: '' })} style={{ color: 'var(--fg-3)', fontSize: 12 }}>✕</button>
            </span>
          )}

          <button
            onClick={handleClearAll}
            style={{
              fontSize: '11.5px',
              color: 'var(--accent-2)',
              marginLeft: 4,
              textDecoration: 'underline',
              cursor: 'pointer',
              background: 'none',
              border: 'none',
            }}
          >
            Clear all
          </button>
        </div>
      )}

      {/* Save Preset Modal */}
      {showSaveModal && (
        <div
          className="modal-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={e => e.target === e.currentTarget && setShowSaveModal(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="modal-panel"
            style={{
              background: 'var(--bg-elev)',
              border: '1px solid var(--line-2)',
              borderRadius: 10,
              width: 380,
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              boxShadow: '0 20px 60px rgba(0,0,0,.5)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--fg)' }}>Save Filter Preset</h3>
              <button onClick={() => setShowSaveModal(false)} style={{ fontSize: 18, color: 'var(--fg-3)', lineHeight: 1 }}>✕</button>
            </div>

            <input
              value={newPresetName}
              onChange={e => setNewPresetName(e.target.value)}
              placeholder="e.g. High Priority Open Issues"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleSavePreset()}
              style={{
                padding: '8px 10px',
                borderRadius: 6,
                border: '1px solid var(--line-2)',
                background: 'var(--bg)',
                color: 'var(--fg)',
                fontSize: '13px',
                outline: 'none',
              }}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button
                onClick={() => setShowSaveModal(false)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--line-2)',
                  background: 'transparent',
                  color: 'var(--fg-3)',
                  fontSize: '12.5px',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSavePreset}
                disabled={isSavingPreset}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  background: 'var(--accent)',
                  color: 'white',
                  fontSize: '12.5px',
                  fontWeight: 500,
                }}
              >
                {isSavingPreset ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
