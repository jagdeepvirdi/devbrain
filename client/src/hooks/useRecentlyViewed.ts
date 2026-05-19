import { useCallback } from 'react'

export type RecentlyViewedEntry = {
  id: string
  type: 'issue' | 'command' | 'document' | 'runbook'
  title: string
  projectName?: string
  projectColor?: string
  viewedAt: string
}

const STORAGE_KEY = 'devbrain:recently-viewed'
const MAX_ITEMS = 10

function loadEntries(): RecentlyViewedEntry[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
  } catch {
    return []
  }
}

function saveEntries(items: RecentlyViewedEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

export function useRecentlyViewed() {
  const track = useCallback((entry: Omit<RecentlyViewedEntry, 'viewedAt'>) => {
    const items = loadEntries().filter(i => !(i.id === entry.id && i.type === entry.type))
    items.unshift({ ...entry, viewedAt: new Date().toISOString() })
    saveEntries(items.slice(0, MAX_ITEMS))
  }, [])

  const getRecent = useCallback((): RecentlyViewedEntry[] => loadEntries(), [])

  return { track, getRecent }
}
