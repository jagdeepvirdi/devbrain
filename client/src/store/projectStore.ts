import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Project } from '../lib/api'

interface ProjectStore {
  projects:          Project[]
  selectedId:        string | null   // null = "All Projects"
  setProjects:       (p: Project[]) => void
  setSelectedId:     (id: string | null) => void
  selectedProject:   () => Project | null
}

export const useProjectStore = create<ProjectStore>()(
  persist(
    (set, get) => ({
      projects:      [],
      selectedId:    null,
      setProjects:   (projects) => set({ projects }),
      setSelectedId: (id) => set({ selectedId: id }),
      selectedProject: () => {
        const { projects, selectedId } = get()
        return projects.find(p => p.id === selectedId) ?? null
      },
    }),
    {
      name:    'devbrain-project',
      partialize: (s) => ({ selectedId: s.selectedId }),
    }
  )
)
