import { pool } from '../db/pool.js'
import { aiEmbed } from './ai.js'

// Shared by routes/issues.ts and its sub-routers (issues-notes.ts, issues-ai.ts) — split out
// so those files don't have to import from each other (avoids a circular-import risk between
// sibling route modules) and so the query shape stays single-sourced.

// Returns all issue columns with investigation_steps and notes aggregated from relational
// tables (replacing the legacy JSONB columns).
export const ISSUE_COLS = `
  i.id, i.project_id, i.title, i.description, i.status, i.priority,
  i.linked_docs, i.linked_commands, i.pr_url,
  i.resolution, i.tags, i.component, i.embedding_status, i.summary,
  i.source, i.external_id,
  i.created_at, i.updated_at, i.resolved_at,
  p.name  AS project_name,
  p.color AS project_color,
  COALESCE(
    json_agg(
      DISTINCT jsonb_build_object('id', s.id, 'order', s."order", 'instruction', s.instruction, 'done', s.done)
    ) FILTER (WHERE s.id IS NOT NULL),
    '[]'::json
  ) AS investigation_steps,
  COALESCE(
    json_agg(
      DISTINCT jsonb_build_object('id', n.id, 'content', n.content, 'created_at', n.created_at)
    ) FILTER (WHERE n.id IS NOT NULL),
    '[]'::json
  ) AS notes,
  COALESCE(
    (SELECT json_agg(sha) FROM issue_commits ic WHERE ic.issue_id = i.id),
    '[]'::json
  ) AS linked_commits
`

export const ISSUE_JOINS = `
  LEFT JOIN projects    p ON p.id = i.project_id
  LEFT JOIN issue_steps s ON s.issue_id = i.id
  LEFT JOIN issue_notes n ON n.issue_id = i.id
`

export function embedIssueAsync(id: string, title: string, description: string): void {
  const text = [title, description].filter(Boolean).join('. ')
  pool.query(`UPDATE issues SET embedding_status = 'processing' WHERE id = $1`, [id]).catch(() => {})
  aiEmbed(text)
    .then(vec => pool.query(
      `UPDATE issues SET embedding = $2, embedding_status = 'done' WHERE id = $1`,
      [id, `[${vec.join(',')}]`]
    ))
    .catch(() => pool.query(`UPDATE issues SET embedding_status = 'failed' WHERE id = $1`, [id]).catch(() => {}))
}
