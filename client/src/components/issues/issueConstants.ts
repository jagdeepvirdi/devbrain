export const PRIORITY_META = {
  critical: { label: 'Critical', color: '#F05A5A' },
  high:     { label: 'High',     color: '#FF9D4D' },
  medium:   { label: 'Medium',   color: '#E6C341' },
  low:      { label: 'Low',      color: '#60A5FA' },
} as const

export const STATUS_META = {
  open:          { label: 'Open',          color: 'var(--fg-3)' },
  investigating: { label: 'Investigating', color: '#FF9D4D' },
  resolved:      { label: 'Resolved',      color: '#4ADE80' },
  'wont-fix':    { label: "Won't Fix",     color: 'var(--fg-4)' },
} as const

export type Status   = keyof typeof STATUS_META
export type Priority = keyof typeof PRIORITY_META
export type View     = 'list' | 'detail' | 'new'
