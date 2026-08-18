import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { releasesApi, type Release } from '../../lib/api'
import { LinkedItems } from '../LinkedItems'
import { typeStyle, fmtDate, issueLabel } from './shared'

// ── ReleaseCard ──────────────────────────────────────────────────────────────

export function ReleaseCard({ release, onEdit, onDelete }: {
  release: Release
  onEdit: () => void
  onDelete: () => void
}) {
  const navigate = useNavigate()
  const [expanded,    setExpanded]    = useState(true)
  const [confirmDel,  setConfirmDel]  = useState(false)
  const [qaInput,     setQaInput]     = useState('')
  const [qaAnswer,    setQaAnswer]    = useState('')
  const [qaLoading,   setQaLoading]   = useState(false)

  async function askQa() {
    if (!qaInput.trim()) return
    setQaLoading(true)
    setQaAnswer('')
    try {
      const { answer } = await releasesApi.qa(release.id, qaInput.trim())
      setQaAnswer(answer)
    } catch {
      setQaAnswer('Failed to get an answer.')
    } finally {
      setQaLoading(false)
    }
  }

  const ts = typeStyle(release.type)
  const hasContent = release.features.length > 0 || release.fixes.length > 0 || release.breaking_changes.length > 0 || release.notes

  return (
    <div id={`release-${release.id}`} style={{ display: 'flex', gap: 0, marginBottom: 8 }}>
      {/* Timeline stem + dot */}
      <div style={{ width: 28, position: 'relative', flexShrink: 0 }}>
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 2, background: 'var(--line)', transform: 'translateX(-50%)' }} />
        <div style={{
          position: 'absolute', left: '50%', top: 14,
          transform: 'translateX(-50%)',
          width: 12, height: 12, borderRadius: '50%',
          background: ts.dot, border: '2px solid var(--bg)',
          boxShadow: `0 0 0 3px ${ts.dot}30`,
          zIndex: 1,
        }} />
      </div>

      {/* Card */}
      <div style={{ flex: 1, paddingLeft: 14, paddingBottom: 24 }}>
        {/* Card header */}
        <div
          onClick={() => setExpanded(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'default', marginBottom: expanded && hasContent ? 8 : 0, minHeight: 40 }}
        >
          {/* Version */}
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', fontWeight: 700, color: 'var(--fg)' }}>
            {release.version}
          </span>

          {/* Type badge */}
          <span style={{ fontSize: '10px', padding: '2px 7px', borderRadius: 10, background: ts.bg, color: ts.text, border: `1px solid ${ts.border}`, fontWeight: 600, letterSpacing: '.04em' }}>
            {release.type}
          </span>

          {/* Project pill (when viewing all projects) */}
          {release.project_name && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '11px', color: 'var(--fg-3)' }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: release.project_color }} />
              {release.project_name}
            </span>
          )}

          {/* Counts summary (when collapsed) */}
          {!expanded && hasContent && (
            <span style={{ fontSize: '11px', color: 'var(--fg-4)' }}>
              {[
                release.features.length     ? `${release.features.length} feature${release.features.length !== 1 ? 's' : ''}` : '',
                release.fixes.length        ? `${release.fixes.length} fix${release.fixes.length !== 1 ? 'es' : ''}` : '',
                release.breaking_changes.length ? `${release.breaking_changes.length} breaking` : '',
              ].filter(Boolean).join(' · ')}
            </span>
          )}

          {/* Date — right-aligned */}
          <span style={{ marginLeft: 'auto', fontSize: '11.5px', color: 'var(--fg-3)', flexShrink: 0 }}>
            {fmtDate(release.date)}
          </span>

          {/* Expand toggle */}
          <span style={{ fontSize: '11px', color: 'var(--fg-4)', marginLeft: 6 }}>
            {expanded ? '▴' : '▾'}
          </span>
        </div>

        {/* Card body */}
        {expanded && (
          <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Notes */}
            {release.notes && (
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--fg-2)', lineHeight: 1.6, fontStyle: 'italic' }}>
                {release.notes}
              </p>
            )}

            {/* Breaking changes — shown first and prominently */}
            {release.breaking_changes.length > 0 && (
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#EF4444', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span>⚠</span> Breaking Changes
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {release.breaking_changes.map((item, i) => (
                    <li key={i} style={{ fontSize: '13px', color: '#EF4444', lineHeight: 1.55 }}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Features */}
            {release.features.length > 0 && (
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#22C55E', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span>✦</span> Features
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {release.features.map((item, i) => (
                    <li key={i} style={{ fontSize: '13px', color: 'var(--fg-2)', lineHeight: 1.55 }}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Fixes */}
            {release.fixes.length > 0 && (
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span>○</span> Fixes
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {release.fixes.map((item, i) => (
                    <li key={i} style={{ fontSize: '13px', color: 'var(--fg-3)', lineHeight: 1.55 }}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Linked Issues */}
            {release.linked_issues.length > 0 && (
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6 }}>
                  Case / Issue
                </div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {release.linked_issues.map(id => {
                    const label = issueLabel(id, release.linked_issue_details)
                    return (
                      <button
                        key={id}
                        onClick={e => {
                          e.stopPropagation()
                          navigate('/issues?open=' + id)
                        }}
                        title={`Open issue ${id}${label !== `#${id.slice(0, 8)}` ? ` — ${label}` : ''}`}
                        style={{ fontSize: '11px', padding: '2px 8px', borderRadius: 4, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', border: '1px solid var(--accent-line)', background: 'var(--accent-dim)', color: 'var(--accent-2)', cursor: 'default' }}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* General cross-entity links (Tasks / Documents / Codes / Issues / Commands) */}
            <LinkedItems
              entityType="release"
              entityId={release.id}
              onNavigate={(route, id) => navigate(`${route}?open=${id}`)}
            />

            {/* Actions */}
            <div style={{ display: 'flex', gap: 6, paddingTop: hasContent ? 4 : 0, borderTop: hasContent ? '1px solid var(--line)' : 'none' }}>
              <button onClick={onEdit} style={{ fontSize: '11.5px', padding: '3px 10px', borderRadius: 4, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', cursor: 'default' }}>
                Edit
              </button>
              {!confirmDel
                ? <button onClick={() => setConfirmDel(true)} style={{ fontSize: '11.5px', padding: '3px 10px', borderRadius: 4, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-4)', cursor: 'default' }}>
                    Delete
                  </button>
                : <>
                    <button onClick={() => { onDelete(); setConfirmDel(false) }} style={{ fontSize: '11.5px', padding: '3px 10px', borderRadius: 4, border: '1px solid #EF4444', background: 'rgba(239,68,68,.1)', color: '#EF4444', cursor: 'default' }}>
                      Confirm delete
                    </button>
                    <button onClick={() => setConfirmDel(false)} style={{ fontSize: '11.5px', padding: '3px 10px', borderRadius: 4, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', cursor: 'default' }}>
                      Cancel
                    </button>
                  </>
              }
            </div>

            {/* Ask about this release */}
            <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  value={qaInput}
                  onChange={e => setQaInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); askQa() } }}
                  placeholder="Ask about this release…"
                  style={{
                    flex: 1, padding: '5px 9px', borderRadius: 5,
                    border: '1px solid var(--line)', background: 'var(--bg)',
                    color: 'var(--fg)', fontSize: '12px', outline: 'none',
                  }}
                />
                <button
                  onClick={askQa}
                  disabled={qaLoading || !qaInput.trim()}
                  title="Ask AI about this release"
                  style={{
                    width: 28, height: 28, borderRadius: 5, flexShrink: 0,
                    border: '1px solid var(--accent-line)', background: 'var(--accent-dim)',
                    color: 'var(--accent-2)', fontSize: '11px',
                    display: 'grid', placeItems: 'center',
                    cursor: qaLoading || !qaInput.trim() ? 'not-allowed' : 'default',
                    opacity: qaLoading || !qaInput.trim() ? 0.5 : 1,
                  }}
                >
                  {qaLoading ? '…' : '◆'}
                </button>
              </div>
              {qaAnswer && (
                <div style={{
                  padding: '8px 10px', borderRadius: 6,
                  border: '1px solid var(--line)', background: 'var(--bg)',
                  fontSize: '12.5px', color: 'var(--fg-2)', lineHeight: 1.6, whiteSpace: 'pre-wrap',
                }}>
                  {qaAnswer}
                </div>
              )}
            </div>

          </div>
        )}
      </div>
    </div>
  )
}
