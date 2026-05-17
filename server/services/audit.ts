import { pool } from '../db/pool.js'

export type AuditAction     = 'create' | 'update' | 'delete'
export type AuditEntityType = 'project' | 'document' | 'issue' | 'command' | 'release' | 'runbook' | 'task' | 'user'

export interface AuditEvent {
  id:          string
  user_id:     string | null
  username:    string | null
  entity_type: AuditEntityType
  entity_id:   string
  entity_name: string | null
  action:      AuditAction
  metadata:    Record<string, unknown> | null
  created_at:  string
}

export async function logAudit(
  userId:     string | null | undefined,
  username:   string | null | undefined,
  entityType: AuditEntityType,
  entityId:   string,
  entityName: string | null | undefined,
  action:     AuditAction,
  metadata?:  Record<string, unknown>,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_events (user_id, username, entity_type, entity_id, entity_name, action, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId ?? null, username ?? null, entityType, entityId, entityName ?? null, action, metadata ? JSON.stringify(metadata) : null],
    )
  } catch {
    // Audit failures are non-fatal — log and continue
  }
}
