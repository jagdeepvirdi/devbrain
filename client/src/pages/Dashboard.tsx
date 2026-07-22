import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProjectStore } from '../store/projectStore'
import { dashboardApi, commandsApi, gitApi, documentsApi, issuesApi } from '../lib/api'
import type { DashboardData, DashboardIssue, DashboardCommand, DashboardRelease, DashboardProject, DashboardActivity, DashboardStatsV2, DashboardActivityDay, IssueThroughputWeek, EmbeddingHealthSnapshot, GitCommit } from '../lib/api'
import { useRecentlyViewed, type RecentlyViewedEntry } from '../hooks/useRecentlyViewed'

// ── Constants ─────────────────────────────────────────────────────────────

const PRIORITY_META: Record<string, { label: string; color: string }> = {
  critical: { label: 'Critical', color: '#F05A5A' },
  high:     { label: 'High',     color: '#FF9D4D' },
  medium:   { label: 'Medium',   color: '#E6C341' },
  low:      { label: 'Low',      color: '#60A5FA' },
}

const RELEASE_COLOR: Record<string, string> = {
  major: '#EF4444', minor: '#818CF8', patch: '#22C55E', hotfix: '#F59E0B',
}

const STATUS_COLOR: Record<string, string> = {
  active: '#22C55E', paused: '#F59E0B', planning: '#60A5FA',
}

const LANG_COLOR: Record<string, string> = {
  bash: '#2ECC71', powershell: '#8B5CF6', python: '#3B82F6',
  typescript: '#818CF8', javascript: '#FBBF24', dart: '#06B6D4',
  sql: '#F59E0B', yaml: '#EC4899', plaintext: '#64748B',
}

// ── Sub-components ────────────────────────────────────────────────────────

function StatCard({ value, label, color, sub }: { value: number; label: string; color: string; sub?: string }) {
  return (
    <div style={{
      flex: 1, minWidth: 90, padding: '14px 16px', borderRadius: 8,
      background: 'var(--bg-elev)', border: '1px solid var(--line)',
    }}>
      <div style={{ fontSize: '26px', fontWeight: 700, color, fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontSize: '11px', color: 'var(--fg-3)', marginTop: 5 }}>{label}</div>
      {sub && <div style={{ fontSize: '10.5px', color: 'var(--fg-4)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
      <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
        {title}
      </span>
      {count !== undefined && (
        <span style={{ fontSize: '10.5px', color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>
          {count}
        </span>
      )}
    </div>
  )
}

function IssueRow({ issue }: { issue: DashboardIssue }) {
  const pm = PRIORITY_META[issue.priority] ?? { label: issue.priority, color: 'var(--fg-3)' }
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 9,
      padding: '8px 12px', borderBottom: '1px solid var(--line)',
    }}>
      <span style={{
        fontSize: '10.5px', padding: '1px 7px', borderRadius: 4, flexShrink: 0,
        background: `${pm.color}18`, color: pm.color, border: `1px solid ${pm.color}40`,
      }}>
        {pm.label}
      </span>
      <span style={{ flex: 1, fontSize: '12.5px', color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {issue.title}
      </span>
      {issue.project_name && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '10.5px', color: 'var(--fg-4)', flexShrink: 0 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: issue.project_color ?? 'var(--fg-4)' }} />
          {issue.project_name}
        </span>
      )}
      {issue.step_count > 0 && (
        <span style={{ fontSize: '10.5px', color: 'var(--fg-4)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
          {issue.step_count}s
        </span>
      )}
    </div>
  )
}

function CommandPill({ cmd }: { cmd: DashboardCommand }) {
  const [copied, setCopied] = useState(false)
  const color = LANG_COLOR[cmd.language] ?? '#64748B'

  function copy() {
    navigator.clipboard.writeText(cmd.command).then(() => {
      commandsApi.use(cmd.id).catch(() => {})
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div style={{
      padding: '9px 12px', borderRadius: 7,
      background: 'var(--bg-elev)', border: '1px solid var(--line)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
        <span style={{
          fontSize: '10px', padding: '0 5px', borderRadius: 3, flexShrink: 0,
          background: `${color}20`, color, border: `1px solid ${color}40`,
          fontFamily: 'var(--font-mono)',
        }}>
          {cmd.language}
        </span>
        <span style={{ flex: 1, fontSize: '12.5px', fontWeight: 500, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {cmd.title}
        </span>
        {cmd.project_name && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '10px', color: 'var(--fg-4)' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: cmd.project_color ?? 'var(--fg-4)' }} />
            {cmd.project_name}
          </span>
        )}
        <button
          onClick={copy}
          style={{
            fontSize: '11px', padding: '2px 8px', borderRadius: 4, flexShrink: 0, cursor: 'default',
            border: `1px solid ${copied ? 'rgba(34,197,94,.4)' : 'var(--line)'}`,
            background: copied ? 'rgba(34,197,94,.12)' : 'var(--bg)',
            color: copied ? '#22C55E' : 'var(--fg-3)',
          }}
        >
          {copied ? '✓' : 'Copy'}
        </button>
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {cmd.command.split('\n')[0]}
      </div>
    </div>
  )
}

function ReleaseRow({ r }: { r: DashboardRelease }) {
  const color = RELEASE_COLOR[r.type] ?? 'var(--fg-3)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 12px', borderBottom: '1px solid var(--line)' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--fg)', flexShrink: 0 }}>
        {r.version}
      </span>
      <span style={{ fontSize: '10.5px', padding: '1px 6px', borderRadius: 4, background: `${color}18`, color, border: `1px solid ${color}40`, flexShrink: 0 }}>
        {r.type}
      </span>
      <span style={{ flex: 1 }} />
      {r.feature_count > 0 && <span style={{ fontSize: '10.5px', color: '#22C55E', flexShrink: 0 }}>+{r.feature_count}</span>}
      {r.fix_count > 0 && <span style={{ fontSize: '10.5px', color: 'var(--fg-4)', flexShrink: 0 }}>{r.fix_count} fixes</span>}
      {r.project_name && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '10.5px', color: 'var(--fg-4)', flexShrink: 0 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: r.project_color }} />
          {r.project_name}
        </span>
      )}
      <span style={{ fontSize: '10.5px', color: 'var(--fg-4)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
        {new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
      </span>
    </div>
  )
}

function ProjectCard({ p }: { p: DashboardProject }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      style={{
        padding: '14px 16px', borderRadius: 8,
        background: 'var(--bg-elev)',
        border: `1px solid ${hovered ? p.color + '60' : 'var(--line)'}`,
        display: 'flex', flexDirection: 'column', gap: 10,
        transition: 'border-color .15s',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {p.name}
        </span>
        <span style={{
          fontSize: '10px', padding: '1px 6px', borderRadius: 3, flexShrink: 0,
          background: `${STATUS_COLOR[p.status] ?? 'var(--fg-4)'}18`,
          color: STATUS_COLOR[p.status] ?? 'var(--fg-4)',
        }}>
          {p.status}
        </span>
      </div>

      <div style={{
        fontSize: '11.5px', color: 'var(--fg-3)', lineHeight: 1.5,
        display: '-webkit-box',
        WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>
        {p.description}
      </div>

      <div style={{ display: 'flex', gap: 12, fontSize: '11px', color: 'var(--fg-4)' }}>
        <span>{p.doc_count} docs</span>
        {p.open_issue_count > 0
          ? <span style={{ color: '#FF9D4D' }}>{p.open_issue_count} open</span>
          : <span>0 issues</span>
        }
        <span>{p.command_count} cmds</span>
        <span>{p.release_count} releases</span>
      </div>
    </div>
  )
}

// ── Activity feed ─────────────────────────────────────────────────────────

const ACTIVITY_META: Record<string, { icon: string; color: string }> = {
  doc:     { icon: '📄', color: '#60A5FA' },
  issue:   { icon: '⚠',  color: '#FF9D4D' },
  command: { icon: '>',  color: '#2ECC71' },
  release: { icon: '🏷', color: '#818CF8' },
  runbook: { icon: '▶',  color: '#F59E0B' },
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

function ActivityRow({ item }: { item: DashboardActivity }) {
  const meta = ACTIVITY_META[item.type] ?? { icon: '·', color: 'var(--fg-4)' }
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '7px 14px', borderBottom: '1px solid var(--line)',
    }}>
      <span style={{ fontSize: 12, color: meta.color, width: 16, textAlign: 'center', flexShrink: 0 }}>{meta.icon}</span>
      {item.project_color && (
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: item.project_color, flexShrink: 0 }} />
      )}
      <span style={{ flex: 1, fontSize: 12.5, color: 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {item.label}
      </span>
      {item.project_name && (
        <span style={{ fontSize: 11, color: 'var(--fg-4)', flexShrink: 0 }}>{item.project_name}</span>
      )}
      <span style={{ fontSize: 11, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)', flexShrink: 0, minWidth: 48, textAlign: 'right' }}>
        {relativeTime(item.created_at)}
      </span>
    </div>
  )
}

const RECENT_TYPE_META: Record<RecentlyViewedEntry['type'], { icon: string; color: string; route: string }> = {
  issue:    { icon: '⚠',  color: '#FF9D4D', route: '/issues'   },
  command:  { icon: '>',  color: '#2ECC71', route: '/commands' },
  document: { icon: '📄', color: '#60A5FA', route: '/docs'     },
  runbook:  { icon: '▶',  color: '#F59E0B', route: '/runbooks' },
}

function relativeTimeShort(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

// ── Phase 22: Analytics widgets ──────────────────────────────────────────

function AnalyticsWidget({
  title, onRefresh, children,
}: { title: string; onRefresh?: () => void; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--bg-elev)', border: '1px solid var(--line)',
      borderRadius: 8, overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '11px 14px 10px', borderBottom: '1px solid var(--line)',
      }}>
        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
          {title}
        </span>
        {onRefresh && (
          <button
            onClick={onRefresh}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-4)', fontSize: 13, lineHeight: 1, padding: 2 }}
            title="Refresh"
          >↻</button>
        )}
      </div>
      <div style={{ padding: '14px' }}>{children}</div>
    </div>
  )
}

function WidgetEmpty({ text }: { text: string }) {
  return (
    <div style={{ padding: '12px 0', textAlign: 'center', fontSize: '12px', color: 'var(--fg-4)' }}>
      {text}
    </div>
  )
}

function OpenIssuesByProject({ data }: { data: DashboardStatsV2['openByProject'] }) {
  const max = Math.max(...data.map(d => d.open_count), 1)
  const active = data.filter(d => d.open_count > 0)
  return (
    <AnalyticsWidget title="Open Issues by Project">
      {active.length === 0
        ? <WidgetEmpty text="No open issues" />
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {active.map(d => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 72, fontSize: '11px', color: 'var(--fg-3)', flexShrink: 0,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right',
                }}>
                  {d.name}
                </span>
                <div style={{ flex: 1, height: 14, background: 'var(--bg)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    width: `${(d.open_count / max) * 100}%`,
                    height: '100%', background: d.color, opacity: 0.8,
                    borderRadius: 3, transition: 'width .4s ease',
                  }} />
                </div>
                <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--fg-3)', width: 20, textAlign: 'right', flexShrink: 0 }}>
                  {d.open_count}
                </span>
              </div>
            ))}
          </div>
        )
      }
    </AnalyticsWidget>
  )
}

function AvgResolutionTime({ data }: { data: DashboardStatsV2['avgResolution'] }) {
  const max = Math.max(...data.map(d => d.avg_days), 1)
  return (
    <AnalyticsWidget title="Avg Resolution Time (30d)">
      {data.length === 0
        ? <WidgetEmpty text="No resolved issues in the last 30 days" />
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {data.map(d => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 72, fontSize: '11px', color: 'var(--fg-3)', flexShrink: 0,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right',
                }}>
                  {d.name}
                </span>
                <div style={{ flex: 1, height: 14, background: 'var(--bg)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    width: `${(d.avg_days / max) * 100}%`,
                    height: '100%', background: d.color, opacity: 0.65,
                    borderRadius: 3, transition: 'width .4s ease',
                  }} />
                </div>
                <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--fg-3)', width: 32, textAlign: 'right', flexShrink: 0 }}>
                  {d.avg_days}d
                </span>
              </div>
            ))}
          </div>
        )
      }
    </AnalyticsWidget>
  )
}

function ActivityHeatmap({ data }: { data: DashboardActivityDay[] }) {
  const byDate = new Map(data.map(d => [d.date, d]))
  const max = Math.max(...data.map(d => d.total), 1)

  // Build 35-cell grid aligned to weeks (Sun=0 … Sat=6)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const todayDow = today.getDay() // 0=Sun
  // Start from the most recent Sunday - 4 weeks
  const gridStart = new Date(today)
  gridStart.setDate(today.getDate() - todayDow - 28)

  const cells = Array.from({ length: 35 }, (_, i) => {
    const d = new Date(gridStart); d.setDate(gridStart.getDate() + i)
    const dateStr = d.toISOString().split('T')[0]
    const entry = byDate.get(dateStr)
    return { dateStr, total: entry?.total ?? 0, future: d > today, entry }
  })

  const DOW_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

  return (
    <AnalyticsWidget title="Activity Heatmap (5 weeks)">
      <div style={{ display: 'flex', gap: 6 }}>
        {/* Day-of-week labels */}
        <div style={{ display: 'grid', gridTemplateRows: 'repeat(7, 14px)', gap: 3, paddingTop: 1 }}>
          {DOW_LABELS.map((l, i) => (
            <span key={i} style={{ fontSize: '9px', color: 'var(--fg-4)', lineHeight: '14px', textAlign: 'right', width: 10 }}>{l}</span>
          ))}
        </div>
        {/* 5-week grid: 7 rows × 5 columns, column-major fill */}
        <div style={{
          display: 'grid',
          gridTemplateRows: 'repeat(7, 14px)',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gridAutoFlow: 'column',
          gap: 3, flex: 1,
        }}>
          {cells.map(({ dateStr, total, future }) => {
            const opacity = future ? 0 : total === 0 ? 0.07 : 0.15 + (total / max) * 0.85
            return (
              <div
                key={dateStr}
                title={`${dateStr}: ${total} event${total !== 1 ? 's' : ''}`}
                style={{
                  borderRadius: 2,
                  background: future ? 'transparent' : `rgba(99, 102, 241, ${opacity})`,
                  border: future ? 'none' : '1px solid rgba(99,102,241,0.12)',
                  cursor: total > 0 ? 'default' : 'default',
                }}
              />
            )
          })}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 10, justifyContent: 'flex-end' }}>
        <span style={{ fontSize: '9px', color: 'var(--fg-4)' }}>Less</span>
        {[0.07, 0.3, 0.55, 0.8, 1].map(op => (
          <div key={op} style={{ width: 10, height: 10, borderRadius: 2, background: `rgba(99,102,241,${op})` }} />
        ))}
        <span style={{ fontSize: '9px', color: 'var(--fg-4)' }}>More</span>
      </div>
    </AnalyticsWidget>
  )
}

function EmbeddingHealth({
  data, onRetryAll,
}: { data: DashboardStatsV2['embeddingHealth']; onRetryAll: () => void }) {
  const total = data.done + data.pending + data.failed
  return (
    <AnalyticsWidget title="Embedding Health">
      <div style={{ display: 'flex', gap: 16, marginBottom: data.failed > 0 ? 12 : 0 }}>
        {[
          { label: 'Done',    count: data.done,    color: '#22C55E' },
          { label: 'Pending', count: data.pending, color: '#F59E0B' },
          { label: 'Failed',  count: data.failed,  color: '#EF4444' },
        ].map(({ label, count, color }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
            <span style={{ fontSize: '12px', color: 'var(--fg-2)', fontFamily: 'var(--font-mono)' }}>{count}</span>
            <span style={{ fontSize: '11px', color: 'var(--fg-4)' }}>{label}</span>
          </div>
        ))}
        {total > 0 && (
          <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--fg-4)' }}>{total} total</span>
        )}
      </div>
      {data.failed > 0 && (
        <button
          onClick={onRetryAll}
          style={{
            fontSize: '11.5px', padding: '5px 12px', borderRadius: 5, cursor: 'pointer',
            background: 'rgba(239,68,68,0.1)', color: '#EF4444',
            border: '1px solid rgba(239,68,68,0.3)',
          }}
        >
          Retry all failed ({data.failed})
        </button>
      )}
      {total === 0 && <WidgetEmpty text="No documents" />}
    </AnalyticsWidget>
  )
}

function IssueThroughputChart({ data }: { data: IssueThroughputWeek[] }) {
  const max = Math.max(...data.map(d => Math.max(d.opened, d.resolved)), 1)
  const hasActivity = data.some(d => d.opened > 0 || d.resolved > 0)
  return (
    <AnalyticsWidget title="Issue Throughput (12 weeks)">
      {!hasActivity
        ? <WidgetEmpty text="No issues opened or resolved in the last 12 weeks" />
        : (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 90 }}>
              {data.map(d => (
                <div key={d.week} style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 2, height: '100%' }}>
                  <div
                    title={`Week of ${d.week}: ${d.opened} opened`}
                    style={{
                      flex: 1, height: `${(d.opened / max) * 100}%`, minHeight: d.opened > 0 ? 2 : 0,
                      background: '#FF9D4D', borderRadius: '2px 2px 0 0',
                    }}
                  />
                  <div
                    title={`Week of ${d.week}: ${d.resolved} resolved`}
                    style={{
                      flex: 1, height: `${(d.resolved / max) * 100}%`, minHeight: d.resolved > 0 ? 2 : 0,
                      background: '#22C55E', borderRadius: '2px 2px 0 0',
                    }}
                  />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 14, marginTop: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#FF9D4D' }} />
                <span style={{ fontSize: '11px', color: 'var(--fg-4)' }}>Opened</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22C55E' }} />
                <span style={{ fontSize: '11px', color: 'var(--fg-4)' }}>Resolved</span>
              </div>
            </div>
          </>
        )
      }
    </AnalyticsWidget>
  )
}

function EmbeddingHealthTrendChart({ data }: { data: EmbeddingHealthSnapshot[] }) {
  if (data.length < 2) {
    return (
      <AnalyticsWidget title="Embedding Health Trend (30d)">
        <WidgetEmpty text="Not enough history yet — check back after a few hours" />
      </AnalyticsWidget>
    )
  }

  const W = 300, H = 80, PAD = 4
  const max = Math.max(...data.map(d => Math.max(d.pending, d.failed)), 1)
  const toPoints = (key: 'pending' | 'failed') =>
    data.map((d, i) => {
      const x = (i / (data.length - 1)) * (W - PAD * 2) + PAD
      const y = H - PAD - (d[key] / max) * (H - PAD * 2)
      return `${x},${y}`
    }).join(' ')

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

  return (
    <AnalyticsWidget title="Embedding Health Trend (30d)">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, display: 'block' }} preserveAspectRatio="none">
        <polyline points={toPoints('pending')} fill="none" stroke="#F59E0B" strokeWidth="1.5" />
        <polyline points={toPoints('failed')} fill="none" stroke="#EF4444" strokeWidth="1.5" />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--fg-4)', marginTop: 4 }}>
        <span>{fmtDate(data[0].captured_at)}</span>
        <span>{fmtDate(data[data.length - 1].captured_at)}</span>
      </div>
      <div style={{ display: 'flex', gap: 14, marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#F59E0B' }} />
          <span style={{ fontSize: '11px', color: 'var(--fg-4)' }}>Pending</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#EF4444' }} />
          <span style={{ fontSize: '11px', color: 'var(--fg-4)' }}>Failed</span>
        </div>
      </div>
    </AnalyticsWidget>
  )
}

function StaleIssues({
  issues, onMarkInvestigating,
}: {
  issues: DashboardStatsV2['staleIssues']
  onMarkInvestigating: (id: string) => void
}) {
  return (
    <AnalyticsWidget title="Stale Issues (>14 days, no activity)">
      {issues.length === 0
        ? <WidgetEmpty text="No stale issues" />
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {issues.map(issue => {
              const pm = PRIORITY_META[issue.priority] ?? { label: issue.priority, color: 'var(--fg-3)' }
              const daysOpen = Math.floor((Date.now() - new Date(issue.created_at).getTime()) / 86400000)
              return (
                <div key={issue.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 0', borderBottom: '1px solid var(--line)',
                }}>
                  <span style={{
                    fontSize: '10px', padding: '1px 6px', borderRadius: 4, flexShrink: 0,
                    background: `${pm.color}18`, color: pm.color, border: `1px solid ${pm.color}40`,
                  }}>
                    {pm.label}
                  </span>
                  <span style={{ flex: 1, fontSize: '12px', color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {issue.title}
                  </span>
                  <span style={{ fontSize: '10.5px', color: 'var(--fg-4)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                    {daysOpen}d
                  </span>
                  <button
                    onClick={() => onMarkInvestigating(issue.id)}
                    style={{
                      fontSize: '10.5px', padding: '2px 8px', borderRadius: 4, cursor: 'pointer', flexShrink: 0,
                      background: 'rgba(99,102,241,0.1)', color: 'var(--accent)',
                      border: '1px solid rgba(99,102,241,0.3)',
                    }}
                  >
                    Investigating
                  </button>
                </div>
              )
            })}
          </div>
        )
      }
    </AnalyticsWidget>
  )
}

// ── Dashboard page ────────────────────────────────────────────────────────

export function DashboardPage() {
  const { selectedProject } = useProjectStore()
  const project = selectedProject()
  const navigate = useNavigate()
  const { getRecent } = useRecentlyViewed()

  const [data,         setData]         = useState<DashboardData | null>(null)
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState('')
  const [commits,      setCommits]      = useState<GitCommit[]>([])
  const [commitsLoaded,setCommitsLoaded]= useState(false)
  const [recentItems,  setRecentItems]  = useState<RecentlyViewedEntry[]>([])
  const [statsV2,      setStatsV2]      = useState<DashboardStatsV2 | null>(null)
  const [activityData, setActivityData] = useState<DashboardActivityDay[]>([])
  const [throughputData,   setThroughputData]   = useState<IssueThroughputWeek[]>([])
  const [embeddingTrendData, setEmbeddingTrendData] = useState<EmbeddingHealthSnapshot[]>([])

  useEffect(() => {
    setLoading(true)
    setError('')
    setData(null)
    dashboardApi.get(project?.id)
      .then(setData)
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [project?.id])

  const loadAnalytics = useCallback(() => {
    dashboardApi.statsV2(project?.id).then(setStatsV2).catch(() => {})
    dashboardApi.activity(project?.id).then(setActivityData).catch(() => {})
    dashboardApi.issueThroughput(project?.id).then(setThroughputData).catch(() => {})
    dashboardApi.embeddingHealthTrend().then(setEmbeddingTrendData).catch(() => {})
  }, [project?.id])

  useEffect(() => { loadAnalytics() }, [loadAnalytics])

  useEffect(() => {
    if (!project?.id) { setCommits([]); setCommitsLoaded(false); return }
    setCommitsLoaded(false)
    gitApi.listCommits(project.id, 10)
      .then(c => { setCommits(c); setCommitsLoaded(true) })
      .catch(() => { setCommits([]); setCommitsLoaded(true) })
  }, [project?.id])

  useEffect(() => {
    setRecentItems(getRecent())
  }, [getRecent])

  if (loading) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-4)', fontSize: '13px' }}>
      Loading…
    </div>
  )

  if (error || !data) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#EF4444', fontSize: '13px' }}>
      {error || 'Failed to load dashboard'}
    </div>
  )

  const { stats, openIssues, favoriteCommands, recentReleases, projects, activity } = data

  async function handleRetryAllFailed() {
    if (!statsV2) return
    // One bulk request (phase-separated batch server-side), not N concurrent
    // /reembed calls — firing embedDocument() per doc concurrently is the GPU
    // model-swap thrashing pattern documented in TASKS.md Known Issues.
    await documentsApi.bulk(statsV2.embeddingHealth.failedIds, 're-embed')
    loadAnalytics()
  }

  async function handleMarkInvestigating(issueId: string) {
    await issuesApi.update(issueId, { status: 'investigating' }).catch(() => {})
    loadAnalytics()
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Header */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {project && <span style={{ width: 10, height: 10, borderRadius: '50%', background: project.color }} />}
          <h1 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--fg)' }}>
            {project ? project.name : 'All Projects'}
          </h1>
          {project && (
            <span style={{ fontSize: '10.5px', padding: '2px 7px', borderRadius: 4, background: `${STATUS_COLOR[project.status] ?? 'var(--fg-4)'}18`, color: STATUS_COLOR[project.status] ?? 'var(--fg-4)' }}>
              {project.status}
            </span>
          )}
        </div>
        {project?.description && (
          <p style={{ margin: '6px 0 0', fontSize: '12.5px', color: 'var(--fg-3)', lineHeight: 1.5 }}>
            {project.description}
          </p>
        )}
        {project && project.tech_stack && project.tech_stack.length > 0 && (
          <div style={{ display: 'flex', gap: 5, marginTop: 8, flexWrap: 'wrap' }}>
            {project.tech_stack.map(t => (
              <span key={t} style={{ fontSize: '10.5px', padding: '1px 7px', borderRadius: 3, background: 'var(--bg-elev)', border: '1px solid var(--line)', color: 'var(--fg-3)' }}>
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <StatCard value={stats.docs}       label="Documents"   color="#60A5FA" />
        <StatCard value={stats.openIssues} label="Open Issues" color={stats.openIssues > 0 ? '#FF9D4D' : 'var(--fg-3)'}
                  sub={stats.totalIssues > 0 ? `${stats.totalIssues} total` : undefined} />
        <StatCard value={stats.commands}   label="Commands"    color="#2ECC71" />
        <StatCard value={stats.releases}   label="Releases"    color="#818CF8" />
        <StatCard value={stats.runbooks}   label="Runbooks"    color="#F59E0B" />
      </div>

      {/* Analytics widgets — Phase 22 */}
      {statsV2 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16 }}>
          <OpenIssuesByProject data={statsV2.openByProject} />
          <AvgResolutionTime   data={statsV2.avgResolution} />
          {activityData.length > 0 && <ActivityHeatmap data={activityData} />}
          {throughputData.length > 0 && <IssueThroughputChart data={throughputData} />}
          <EmbeddingHealth
            data={statsV2.embeddingHealth}
            onRetryAll={handleRetryAllFailed}
          />
          <EmbeddingHealthTrendChart data={embeddingTrendData} />
          <StaleIssues
            issues={statsV2.staleIssues}
            onMarkInvestigating={handleMarkInvestigating}
          />
        </div>
      )}

      {/* Main two-column grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>

        {/* Open Issues */}
        <div>
          <SectionHeader title="Open Issues" count={openIssues.length} />
          <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
            {openIssues.length === 0
              ? <div style={{ padding: '20px', textAlign: 'center', fontSize: '12.5px', color: 'var(--fg-4)' }}>
                  No open issues
                </div>
              : openIssues.map(i => <IssueRow key={i.id} issue={i} />)
            }
          </div>
        </div>

        {/* Pinned Commands */}
        <div>
          <SectionHeader title="Pinned Commands" count={favoriteCommands.length} />
          {favoriteCommands.length === 0
            ? <div style={{ padding: '20px', textAlign: 'center', fontSize: '12.5px', color: 'var(--fg-4)', background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 8 }}>
                No pinned commands — star some in Commands
              </div>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {favoriteCommands.map(c => <CommandPill key={c.id} cmd={c} />)}
              </div>
          }
        </div>
      </div>

      {/* Recent Commits — only when a project with a GitHub repo is selected */}
      {project && commitsLoaded && commits.length > 0 && (
        <div>
          <SectionHeader title="Recent Commits" count={commits.length} />
          <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
            {commits.map(c => (
              <div key={c.sha} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '1px solid var(--line)', fontSize: 12.5 }}>
                <code style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--accent-2)', flexShrink: 0, minWidth: 52 }}>
                  {c.sha}
                </code>
                <span style={{ flex: 1, color: 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.message}
                </span>
                <span style={{ fontSize: 11, color: 'var(--fg-4)', flexShrink: 0 }}>{c.author}</span>
                <a href={c.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: 'var(--fg-4)', flexShrink: 0, textDecoration: 'none' }}>↗</a>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Releases */}
      {recentReleases.length > 0 && (
        <div>
          <SectionHeader title="Recent Releases" count={recentReleases.length} />
          <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
            {recentReleases.map(r => <ReleaseRow key={r.id} r={r} />)}
          </div>
        </div>
      )}

      {/* Recent Activity */}
      {activity.length > 0 && (
        <div>
          <SectionHeader title="Recent Activity" count={activity.length} />
          <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
            {activity.map((item, i) => <ActivityRow key={`${item.type}-${item.id}-${i}`} item={item} />)}
          </div>
        </div>
      )}

      {/* Recently Viewed */}
      {recentItems.length > 0 && (
        <div>
          <SectionHeader title="Recently Viewed" count={recentItems.length} />
          <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
            {recentItems.slice(0, 8).map(item => {
              const meta = RECENT_TYPE_META[item.type]
              return (
                <button
                  key={`${item.type}-${item.id}`}
                  onClick={() => navigate(`${meta.route}?open=${item.id}`)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 14px', borderBottom: '1px solid var(--line)',
                    width: '100%', textAlign: 'left', background: 'none',
                  }}
                >
                  <span style={{ fontSize: 11, color: meta.color, width: 16, textAlign: 'center', flexShrink: 0 }}>{meta.icon}</span>
                  {item.projectColor && <span style={{ width: 6, height: 6, borderRadius: '50%', background: item.projectColor, flexShrink: 0 }} />}
                  <span style={{ flex: 1, fontSize: 12.5, color: 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.title}
                  </span>
                  {item.projectName && <span style={{ fontSize: 11, color: 'var(--fg-4)', flexShrink: 0 }}>{item.projectName}</span>}
                  <span style={{ fontSize: 11, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)', flexShrink: 0, minWidth: 28, textAlign: 'right' }}>
                    {relativeTimeShort(item.viewedAt)}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Projects grid — global view only */}
      {!project && projects.length > 0 && (
        <div>
          <SectionHeader title="Projects" count={projects.length} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
            {projects.map(p => <ProjectCard key={p.id} p={p} />)}
          </div>
        </div>
      )}
    </div>
  )
}
