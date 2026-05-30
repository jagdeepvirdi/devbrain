import { useState, useEffect } from 'react'
import { gitApi, issuesApi, type GitCommit, type Issue } from '../../lib/api'
import { useToast } from '../Toast'

interface GitTabProps {
  projectId: string
}

export default function GitTab({ projectId }: GitTabProps) {
  const { toast } = useToast()
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [issues, setIssues]   = useState<Issue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [currentBranch, setCurrentBranch] = useState<string>('')
  const [linkingSha, setLinkingSha] = useState<string | null>(null)
  const [selectedIssue, setSelectedIssue] = useState<string>('')

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [cData, bData, iData] = await Promise.all([
          gitApi.listCommits(projectId),
          gitApi.getBranches(projectId).catch(() => ({ branches: [], current: '' })),
          issuesApi.list({ projectId, status: 'open', limit: 100 })
        ])
        setCommits(cData)
        setCurrentBranch(bData.current)
        setIssues(iData.items)
        setError(null)
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [projectId])

  async function handleLink() {
    if (!linkingSha || !selectedIssue) return
    try {
      await gitApi.link(projectId, linkingSha, selectedIssue)
      toast('Commit linked to issue')
      setLinkingSha(null)
      setSelectedIssue('')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  if (loading) return <div style={{ fontSize: 12, color: 'var(--fg-4)', padding: 20, textAlign: 'center' }}>Loading git history...</div>
  
  if (error) return <div style={{ fontSize: 12, color: '#F8A8A8', padding: 20, textAlign: 'center' }}>{error}</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {currentBranch && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--bg-elev-2)', borderRadius: 6, border: '1px solid var(--line)' }}>
          <span style={{ fontSize: 11, color: 'var(--fg-4)' }}>Branch:</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#818CF8', fontFamily: 'var(--font-mono)' }}>{currentBranch}</span>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {commits.map(c => (
          <div key={c.sha} style={{ padding: '10px 0', borderBottom: '1px solid var(--line-2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--fg)', lineHeight: 1.4, flex: 1, fontWeight: 500 }}>{c.message}</span>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                <a 
                  href={c.url} 
                  target="_blank" 
                  rel="noreferrer"
                  style={{ fontSize: 11, color: '#818CF8', fontFamily: 'var(--font-mono)', textDecoration: 'none', background: 'rgba(99,102,241,.1)', padding: '1px 5px', borderRadius: 4, border: '1px solid rgba(99,102,241,.2)' }}
                >
                  {c.sha}
                </a>
                <button 
                  onClick={() => setLinkingSha(c.full_sha)}
                  style={{ fontSize: 10, background: 'none', border: 'none', color: 'var(--fg-4)', padding: 0, cursor: 'pointer', textDecoration: 'underline' }}
                >
                  Link issue
                </button>
              </div>
            </div>
            
            {linkingSha === c.full_sha && (
              <div style={{ marginTop: 8, padding: 10, background: 'var(--bg-elev-3)', borderRadius: 6, border: '1px solid var(--line-3)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600 }}>Link to issue:</span>
                <select 
                  value={selectedIssue}
                  onChange={e => setSelectedIssue(e.target.value)}
                  style={{ width: '100%', fontSize: 12, background: 'var(--bg)', border: '1px solid var(--line-2)', color: 'var(--fg)', padding: '4px 6px', borderRadius: 4 }}
                >
                  <option value="">Select an issue...</option>
                  {issues.map(i => (
                    <option key={i.id} value={i.id}>#{i.id.slice(0,4)} {i.title}</option>
                  ))}
                </select>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button 
                    onClick={() => setLinkingSha(null)}
                    style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-3)' }}
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleLink}
                    disabled={!selectedIssue}
                    style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: 'none', background: 'var(--accent)', color: 'white', opacity: selectedIssue ? 1 : 0.6 }}
                  >
                    Link
                  </button>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--fg-4)' }}>
              <span>{c.author}</span>
              <span>•</span>
              <span>{new Date(c.date).toLocaleDateString()}</span>
            </div>
          </div>
        ))}
        {commits.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg-4)', fontSize: 12 }}>
            No commits found.
          </div>
        )}
      </div>
    </div>
  )
}
