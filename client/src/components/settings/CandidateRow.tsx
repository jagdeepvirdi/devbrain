import { useState } from 'react'
import { projectsApi, type ScanCandidate, type Project } from '../../lib/api'
import { useToast } from '../Toast'

type LinkAction = 'idle' | 'linking' | 'creating'

interface CandidateRowProps {
  candidate: ScanCandidate
  projects:  Project[]
  onLinked:  (candidatePath: string) => void
}

export function CandidateRow({ candidate, projects, onLinked }: CandidateRowProps) {
  const { toast }          = useToast()
  const [action, setAction] = useState<LinkAction>('idle')
  const [ignored, setIgnored] = useState(false)

  if (ignored) return null

  async function linkTo(projectId: string) {
    setAction('linking')
    try {
      await projectsApi.link(projectId, candidate.path)
      toast(`Linked to project`)
      onLinked(candidate.path)
    } catch (err) {
      toast((err as Error).message, 'error')
      setAction('idle')
    }
  }

  async function createAndLink() {
    setAction('creating')
    try {
      const newProject = await projectsApi.create({
        name:       candidate.name,
        short_name: candidate.name.toLowerCase().replace(/\s+/g, '-').slice(0, 20),
        description: '',
        color:      '#6366F1',
        status:     'active',
        tech_stack: [],
        type:       'tool',
        repo_url:   '',
      })
      await projectsApi.link(newProject.id, candidate.path)
      toast(`Created and linked "${candidate.name}"`)
      onLinked(candidate.path)
    } catch (err) {
      toast((err as Error).message, 'error')
      setAction('idle')
    }
  }

  const busy = action !== 'idle'
  const pct  = candidate.overallPct

  return (
    <tr style={{ borderBottom: '1px solid var(--line)' }}>
      {/* Path */}
      <td style={{ padding: '8px 10px', fontSize: 11.5, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          title={candidate.path}>
        {candidate.path.split(/[\\/]/).slice(-2).join('/')}
      </td>

      {/* Detected name */}
      <td style={{ padding: '8px 10px', fontSize: 12.5, color: 'var(--fg)', fontWeight: 500 }}>
        {candidate.name}
      </td>

      {/* Last session */}
      <td style={{ padding: '8px 10px', fontSize: 12, color: 'var(--fg-4)', whiteSpace: 'nowrap' }}>
        {candidate.lastSessionDate
          ? new Date(candidate.lastSessionDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
          : '—'}
      </td>

      {/* Task % */}
      <td style={{ padding: '8px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 48, height: 4, background: 'var(--bg-elev-2)', borderRadius: 2, flexShrink: 0 }}>
            <div style={{
              height: '100%', borderRadius: 2,
              width: `${pct}%`,
              background: pct === 100 ? '#22C55E' : pct >= 50 ? '#6366F1' : '#F59E0B',
            }} />
          </div>
          <span style={{ fontSize: 11, color: 'var(--fg-4)', fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
        </div>
      </td>

      {/* Suggested match */}
      <td style={{ padding: '8px 10px', fontSize: 12, color: candidate.matchedProjectName ? '#818CF8' : 'var(--fg-4)' }}>
        {candidate.matchedProjectName ?? '—'}
      </td>

      {/* Actions */}
      <td style={{ padding: '8px 10px' }}>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
          {candidate.matchedProjectId && (
            <button
              disabled={busy}
              onClick={() => linkTo(candidate.matchedProjectId!)}
              style={{ height: 24, padding: '0 9px', borderRadius: 'var(--radius)', border: '1px solid rgba(99,102,241,.4)', background: 'rgba(99,102,241,.12)', color: '#818CF8', fontSize: 11.5, opacity: busy ? 0.5 : 1, cursor: busy ? 'default' : 'pointer', whiteSpace: 'nowrap' }}
            >
              {action === 'linking' ? 'Linking…' : `Link to ${candidate.matchedProjectName}`}
            </button>
          )}

          {/* Link to any project */}
          <select
            disabled={busy}
            defaultValue=""
            onChange={e => { if (e.target.value) linkTo(e.target.value) }}
            style={{ height: 24, padding: '0 6px', borderRadius: 'var(--radius)', border: '1px solid var(--line)', background: 'var(--bg-elev)', color: 'var(--fg-4)', fontSize: 11.5, opacity: busy ? 0.5 : 1 }}
          >
            <option value="">Link to…</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          <button
            disabled={busy}
            onClick={createAndLink}
            style={{ height: 24, padding: '0 9px', borderRadius: 'var(--radius)', border: '1px solid var(--line)', background: 'var(--bg-elev)', color: 'var(--fg-3)', fontSize: 11.5, opacity: busy ? 0.5 : 1, cursor: busy ? 'default' : 'pointer', whiteSpace: 'nowrap' }}
          >
            {action === 'creating' ? 'Creating…' : '+ New project'}
          </button>

          <button
            disabled={busy}
            onClick={() => setIgnored(true)}
            style={{ height: 24, padding: '0 7px', borderRadius: 'var(--radius)', border: '1px solid var(--line)', background: 'none', color: 'var(--fg-4)', fontSize: 11.5, opacity: busy ? 0.5 : 1 }}
          >
            Ignore
          </button>
        </div>
      </td>
    </tr>
  )
}
