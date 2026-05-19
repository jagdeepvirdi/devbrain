import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { View } from '../components/issues/issueConstants'
import { NewIssueModal } from '../components/issues/NewIssueModal'
import { IssueDetail } from '../components/issues/IssueDetail'
import { IssuesList } from '../components/issues/IssuesList'

export function IssuesPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [view,     setView]     = useState<View>('list')
  const [showNew,  setShowNew]  = useState(false)
  const [listKey,  setListKey]  = useState(0)

  // Keyboard shortcut: N = new issue (only when viewing list, not typing)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return
      if ((e.key === 'n' || e.key === 'N') && view === 'list') { e.preventDefault(); setShowNew(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view])

  const activeId = searchParams.get('open')

  function openIssue(id: string) {
    setView('detail')
    setSearchParams({ open: id }, { replace: true })
  }
  function backToList() {
    setView('list')
    setSearchParams({}, { replace: true })
  }

  // Sync URL param to view state on mount / param change
  useEffect(() => {
    if (activeId) setView('detail')
    else setView('list')
  }, [activeId])

  // Fallback: legacy event from Releases (removed soon)
  useEffect(() => {
    function onOpenIssue(e: Event) { openIssue((e as CustomEvent<string>).detail) }
    window.addEventListener('devbrain:open-issue', onOpenIssue)
    return () => window.removeEventListener('devbrain:open-issue', onOpenIssue)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {view === 'list' && (
        <IssuesList
          key={listKey}
          onOpen={openIssue}
          onNew={() => setShowNew(true)}
        />
      )}
      {view === 'detail' && activeId && (
        <IssueDetail
          issueId={activeId}
          onBack={backToList}
          onDeleted={() => { setListKey(k => k + 1); backToList() }}
        />
      )}
      {showNew && (
        <NewIssueModal
          onClose={() => setShowNew(false)}
          onCreate={issue => { setShowNew(false); setListKey(k => k + 1); openIssue(issue.id) }}
        />
      )}
    </div>
  )
}
