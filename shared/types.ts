// Shared type definitions — consumed by both client and server.
// Source of truth for all data models in DevBrain.

export type ProjectStatus = 'active' | 'paused' | 'planning'
export type ProjectType   = 'mobile' | 'web' | 'desktop' | 'fintech' | 'tool'

export interface Project {
  id: string
  name: string
  shortName: string
  description: string
  color: string
  status: ProjectStatus
  techStack: string[]
  type: ProjectType
  repoUrl?: string
  createdAt: Date
}

export type FileType = 'pdf' | 'docx' | 'md' | 'txt' | 'xlsx' | 'url'

export interface Document {
  id: string
  projectId?: string
  title: string
  fileType: FileType
  content: string
  tags: string[]
  source: string
  createdAt: Date
}

export interface DocumentChunk {
  id: string
  documentId: string
  content: string
  embedding: number[]
  chunkIndex: number
}

export type IssueStatus   = 'open' | 'investigating' | 'resolved' | 'wont-fix'
export type IssuePriority = 'low' | 'medium' | 'high' | 'critical'

export interface InvestigationStep {
  order: number
  instruction: string
  done: boolean
}

export interface IssueNote {
  id: string
  content: string
  createdAt: Date
}

export interface Issue {
  id: string
  projectId?: string
  title: string
  description: string
  status: IssueStatus
  priority: IssuePriority
  investigationSteps: InvestigationStep[]
  notes: IssueNote[]
  linkedDocs: string[]
  linkedCommands: string[]
  resolution: string
  tags: string[]
  createdAt: Date
  resolvedAt?: Date
}

export type CommandLanguage = 'bash' | 'python' | 'dart' | 'sql' | 'powershell' | 'yaml' | 'typescript'

export interface Command {
  id: string
  projectId?: string
  title: string
  command: string
  language: CommandLanguage
  description: string
  tags: string[]
  isFavorite: boolean
  lastUsed?: Date
}

export type ReleaseType = 'major' | 'minor' | 'patch' | 'hotfix'

export interface Release {
  id: string
  projectId: string
  version: string
  date: Date
  type: ReleaseType
  fixes: string[]
  features: string[]
  breakingChanges: string[]
  notes: string
  linkedIssues: string[]
}

export interface RunbookStep {
  order: number
  instruction: string
  command?: string
  note?: string
}

export interface Runbook {
  id: string
  projectId?: string
  title: string
  steps: RunbookStep[]
  tags: string[]
  lastUsedAt?: Date
}

// API response wrappers
export interface ApiOk<T> {
  data: T
}

export interface ApiError {
  error: string
  code?: string
}
