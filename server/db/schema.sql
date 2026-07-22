-- DevBrain database schema — consolidated source of truth
-- Requires: pgvector/pgvector:pg16 image
-- Run via: npx tsx server/db/setup.ts
-- Idempotent (IF NOT EXISTS throughout).
-- Table order: users -> projects -> documents -> document_chunks ->
--              issues -> commands -> releases -> runbooks -> tasks ->
--              project_members -> audit_events -> app_settings

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ── Trigger: auto-update updated_at ───────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ── Users (defined first — referenced by commands.created_by) ─────────────

CREATE TABLE IF NOT EXISTS users (
  id            TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  username      TEXT        NOT NULL UNIQUE,
  email         TEXT,
  password_hash TEXT,                    -- NULL for LDAP-only users
  role          TEXT        NOT NULL DEFAULT 'editor'
                  CHECK (role IN ('admin', 'editor', 'viewer')),
  ldap_dn       TEXT,                    -- LDAP distinguished name if LDAP user
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Idempotent backfill for databases created before is_active was introduced
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

CREATE OR REPLACE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Projects ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS projects (
  id               TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name             TEXT        NOT NULL,
  short_name       TEXT        NOT NULL UNIQUE,
  description      TEXT        NOT NULL DEFAULT '',
  color            TEXT        NOT NULL DEFAULT '#6366F1',
  status           TEXT        NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'paused', 'planning')),
  tech_stack       TEXT[]      NOT NULL DEFAULT '{}',
  type             TEXT        NOT NULL DEFAULT 'web'
                     CHECK (type IN ('mobile', 'web', 'desktop', 'fintech', 'tool', 'integration')),
  repo_url         TEXT,
  -- Git integration (Phase 12)
  github_pat_enc   TEXT,
  -- Extended project metadata
  kind             TEXT        NOT NULL DEFAULT 'personal',
  git_type         TEXT,
  repo_path        TEXT,
  claude_code_safe BOOLEAN     NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Phase 18: linked filesystem path for Claude Code integration
ALTER TABLE projects ADD COLUMN IF NOT EXISTS fs_path TEXT;

-- Phase 27: add updated_at to projects (trigger was added but column may be missing on existing DBs)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ── Documents ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS documents (
  id               TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id       TEXT        REFERENCES projects(id) ON DELETE CASCADE,
  title            TEXT        NOT NULL,
  file_type        TEXT        NOT NULL
                     CHECK (file_type IN ('pdf', 'docx', 'md', 'txt', 'xlsx', 'url', 'code')),
  content          TEXT        NOT NULL DEFAULT '',
  tags             TEXT[]      NOT NULL DEFAULT '{}',
  -- Single-select feature/module grouping, e.g. 'SAP', 'BPP', 'Payment' — distinct from tags (multi-select).
  component        TEXT,
  -- Set only when file_type = 'code' — source language, e.g. 'typescript', 'python'.
  language         TEXT,
  -- AI-generated explanation, populated on demand via POST /:id/explain (code files only).
  explanation      TEXT,
  -- content_hash at the moment `explanation` was generated — lets the API report
  -- explanation_stale when content_hash has since moved on (see update-content route).
  explanation_hash TEXT,
  -- AI-generated Mermaid diagram definition, populated on demand via POST /:id/diagram
  -- (code files only). diagram_hash mirrors explanation_hash's staleness pattern.
  diagram          TEXT,
  diagram_hash     TEXT,
  -- Set when this doc was generated FROM another doc (e.g. "Save as document" on a
  -- code file's explanation) — points at the source, not the other way round.
  source_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  -- Set when this doc is the generated overview for a whole `component` group of
  -- code files (POST /documents/component-overview) — no single source_document_id
  -- since it's built from many files, so this + project_id is the idempotency key
  -- instead (regenerating updates the same row rather than piling up duplicates).
  source_component TEXT,
  source           TEXT        NOT NULL DEFAULT '',
  content_hash     TEXT,
  -- 'pending' | 'processing' | 'done' | 'failed'
  embedding_status TEXT        NOT NULL DEFAULT 'pending'
                     CHECK (embedding_status IN ('pending', 'processing', 'done', 'failed')),
  tsv              TSVECTOR    GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, ''))
  ) STORED,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER trg_documents_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS documents_tsv_idx        ON documents USING GIN (tsv);
CREATE INDEX IF NOT EXISTS documents_project_idx    ON documents (project_id);
CREATE INDEX IF NOT EXISTS documents_hash_idx       ON documents (content_hash) WHERE content_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS documents_emb_status_idx ON documents (embedding_status) WHERE embedding_status != 'done';
CREATE INDEX IF NOT EXISTS documents_component_idx  ON documents (project_id, component) WHERE component IS NOT NULL;
CREATE INDEX IF NOT EXISTS documents_source_doc_idx  ON documents (source_document_id) WHERE source_document_id IS NOT NULL;

-- ── Document chunks (RAG) ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS document_chunks (
  id           TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  document_id  TEXT        NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  content      TEXT        NOT NULL,
  chunk_index  INTEGER     NOT NULL,
  -- nomic-embed-text -> 768 dimensions
  embedding    VECTOR(768),
  -- Full-text ranking must happen at chunk granularity, not whole-document —
  -- used for hybrid search (fused with vector similarity via RRF).
  tsv          TSVECTOR    GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);

-- HNSW index: faster than IVFFlat for this scale, no minimum-rows requirement.
CREATE INDEX IF NOT EXISTS document_chunks_hnsw_idx
  ON document_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS document_chunks_doc_idx ON document_chunks (document_id);
CREATE INDEX IF NOT EXISTS document_chunks_tsv_idx ON document_chunks USING GIN (tsv);

-- ── Chat sessions & messages (DocChat conversation memory) ────────────────

CREATE TABLE IF NOT EXISTS chat_sessions (
  id         TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id    TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT        REFERENCES projects(id) ON DELETE CASCADE,
  component  TEXT,
  title      TEXT        NOT NULL DEFAULT 'New chat',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER trg_chat_sessions_updated_at
  BEFORE UPDATE ON chat_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS chat_sessions_user_idx ON chat_sessions (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  session_id TEXT        NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role       TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
  content    TEXT        NOT NULL DEFAULT '',
  citations  JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_messages_session_idx ON chat_messages (session_id, created_at);

-- ── Issues ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS issues (
  id                  TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id          TEXT        REFERENCES projects(id) ON DELETE CASCADE,
  title               TEXT        NOT NULL,
  description         TEXT        NOT NULL DEFAULT '',
  status              TEXT        NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'investigating', 'resolved', 'wont-fix')),
  priority            TEXT        NOT NULL DEFAULT 'medium'
                        CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  -- [{order, instruction, done}]
  investigation_steps JSONB       NOT NULL DEFAULT '[]',
  -- [{id, content, createdAt}]
  notes               JSONB       NOT NULL DEFAULT '[]',
  linked_docs         TEXT[]      NOT NULL DEFAULT '{}',
  linked_commands     TEXT[]      NOT NULL DEFAULT '{}',
  -- Git integration (Phase 12)
  linked_commits      TEXT[]      NOT NULL DEFAULT '{}',
  pr_url              TEXT,
  resolution          TEXT        NOT NULL DEFAULT '',
  tags                TEXT[]      NOT NULL DEFAULT '{}',
  -- Semantic search embedding
  embedding           VECTOR(768),
  -- 'pending' | 'processing' | 'done' | 'failed'
  embedding_status    TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (embedding_status IN ('pending', 'processing', 'done', 'failed')),
  tsv                 TSVECTOR    GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(resolution, ''))
  ) STORED,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at         TIMESTAMPTZ
);

CREATE OR REPLACE TRIGGER trg_issues_updated_at
  BEFORE UPDATE ON issues
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS issues_tsv_idx          ON issues USING GIN (tsv);
CREATE INDEX IF NOT EXISTS issues_project_idx      ON issues (project_id);
CREATE INDEX IF NOT EXISTS issues_status_idx       ON issues (status);
CREATE INDEX IF NOT EXISTS issues_priority_idx     ON issues (priority);
CREATE INDEX IF NOT EXISTS issues_emb_status_idx   ON issues (embedding_status) WHERE embedding_status != 'done';
CREATE INDEX IF NOT EXISTS issues_embedding_hnsw_idx
  ON issues USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ── Issue steps (normalized from investigation_steps JSONB) ──────────────────

CREATE TABLE IF NOT EXISTS issue_steps (
  id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  issue_id    TEXT        NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  "order"     INTEGER     NOT NULL DEFAULT 0,
  instruction TEXT        NOT NULL,
  done        BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS issue_steps_issue_idx ON issue_steps (issue_id, "order");

-- ── Issue notes (normalized from notes JSONB) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS issue_notes (
  id         TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  issue_id   TEXT        NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  content    TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS issue_notes_issue_idx ON issue_notes (issue_id, created_at);

-- ── Commands ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS commands (
  id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id  TEXT        REFERENCES projects(id) ON DELETE CASCADE,
  title       TEXT        NOT NULL,
  command     TEXT        NOT NULL,
  language    TEXT        NOT NULL DEFAULT 'bash',
  description TEXT        NOT NULL DEFAULT '',
  tags        TEXT[]      NOT NULL DEFAULT '{}',
  is_favorite BOOLEAN     NOT NULL DEFAULT false,
  -- Org v2: ownership and visibility
  namespace   TEXT        NOT NULL DEFAULT 'team'
                CHECK (namespace IN ('personal', 'team')),
  created_by  TEXT        REFERENCES users(id) ON DELETE SET NULL,
  -- Semantic search embedding
  embedding   VECTOR(768),
  tsv         TSVECTOR    GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(command, ''))
  ) STORED,
  last_used   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER trg_commands_updated_at
  BEFORE UPDATE ON commands
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS commands_tsv_idx            ON commands USING GIN (tsv);
CREATE INDEX IF NOT EXISTS commands_project_idx        ON commands (project_id);
CREATE INDEX IF NOT EXISTS commands_fav_idx            ON commands (is_favorite) WHERE is_favorite = true;
CREATE INDEX IF NOT EXISTS commands_embedding_hnsw_idx
  ON commands USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ── Releases ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS releases (
  id               TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id       TEXT        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version          TEXT        NOT NULL,
  date             DATE        NOT NULL,
  type             TEXT        NOT NULL DEFAULT 'patch'
                     CHECK (type IN ('major', 'minor', 'patch', 'hotfix')),
  fixes            TEXT[]      NOT NULL DEFAULT '{}',
  features         TEXT[]      NOT NULL DEFAULT '{}',
  breaking_changes TEXT[]      NOT NULL DEFAULT '{}',
  notes            TEXT        NOT NULL DEFAULT '',
  linked_issues    TEXT[]      NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, version)
);

CREATE OR REPLACE TRIGGER trg_releases_updated_at
  BEFORE UPDATE ON releases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS releases_project_idx ON releases (project_id);
CREATE INDEX IF NOT EXISTS releases_date_idx    ON releases (date DESC);

-- ── Runbooks ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS runbooks (
  id           TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id   TEXT        REFERENCES projects(id) ON DELETE CASCADE,
  title        TEXT        NOT NULL,
  -- [{order, instruction, command?, note?}]
  steps        JSONB       NOT NULL DEFAULT '[]',
  tags         TEXT[]      NOT NULL DEFAULT '{}',
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER trg_runbooks_updated_at
  BEFORE UPDATE ON runbooks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS runbooks_project_idx ON runbooks (project_id);

-- ── Tasks ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id  TEXT        REFERENCES projects(id) ON DELETE CASCADE,
  title       TEXT        NOT NULL,
  description TEXT        NOT NULL DEFAULT '',
  status      TEXT        NOT NULL DEFAULT 'todo'
                CHECK (status IN ('todo', 'in_progress', 'done', 'cancelled')),
  priority    TEXT        NOT NULL DEFAULT 'medium'
                CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  due_date    DATE,
  tags        TEXT[]      NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_at     TIMESTAMPTZ
);

CREATE OR REPLACE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS tasks_project_idx  ON tasks (project_id);
CREATE INDEX IF NOT EXISTS tasks_status_idx   ON tasks (status);
CREATE INDEX IF NOT EXISTS tasks_priority_idx ON tasks (priority);

-- ── Project members (Org v2) ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS project_members (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'editor'
               CHECK (role IN ('admin', 'editor', 'viewer')),
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, project_id)
);

-- ── Audit events (Org v2) ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_events (
  id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id     TEXT        REFERENCES users(id) ON DELETE SET NULL,
  username    TEXT,
  entity_type TEXT        NOT NULL,
  entity_id   TEXT        NOT NULL,
  entity_name TEXT,
  action      TEXT        NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_entity_idx  ON audit_events (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_user_idx    ON audit_events (user_id);
CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_events (created_at DESC);

-- ── App settings (Phase 12) ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Default settings rows (idempotent — ON CONFLICT DO NOTHING)
INSERT INTO app_settings (key, value)
VALUES ('claude_scan_root', '{"scan_root": null}'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_settings (key, value)
VALUES ('antigravity_scan_root', '{"scan_root": null}'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_settings (key, value)
VALUES ('backup_settings', '{"path": null, "schedule": "off", "last_backup_at": null, "retention_count": null}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Phase 23: AI Enhancements — persistent explanation and summary fields
ALTER TABLE commands ADD COLUMN IF NOT EXISTS explanation TEXT;
ALTER TABLE issues   ADD COLUMN IF NOT EXISTS summary     TEXT;

-- Phase 24: Git Integration
CREATE TABLE IF NOT EXISTS issue_commits (
  issue_id   TEXT        NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  sha        TEXT        NOT NULL,
  project_id TEXT        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  linked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (issue_id, sha)
);
CREATE INDEX IF NOT EXISTS issue_commits_issue_idx ON issue_commits (issue_id);

-- Phase 25: External Issue Sync
ALTER TABLE issues ADD COLUMN IF NOT EXISTS source      TEXT NOT NULL DEFAULT 'devbrain';
ALTER TABLE issues ADD COLUMN IF NOT EXISTS external_id TEXT;
CREATE INDEX IF NOT EXISTS issues_external_id_idx ON issues (external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS integrations (
  id                  TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  provider            TEXT        NOT NULL,
  project_id          TEXT        REFERENCES projects(id) ON DELETE CASCADE,
  external_project_id TEXT,
  token_enc           TEXT,
  last_synced_at      TIMESTAMPTZ,
  config              JSONB       NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE OR REPLACE TRIGGER trg_integrations_updated_at
  BEFORE UPDATE ON integrations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS integrations_project_provider_idx ON integrations (project_id, provider);

-- Phase 28.1: Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id         TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT        NOT NULL,
  title           TEXT        NOT NULL,
  body            TEXT        NOT NULL DEFAULT '',
  entity_type     TEXT,
  entity_id       TEXT,
  read            BOOLEAN     NOT NULL DEFAULT false,
  channel         TEXT        NOT NULL DEFAULT 'in_app',
  delivery_status TEXT        NOT NULL DEFAULT 'delivered',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_read_idx ON notifications (user_id, read);
CREATE INDEX IF NOT EXISTS notifications_created_at_idx ON notifications (created_at DESC);

INSERT INTO app_settings (key, value)
VALUES ('notification_rules', '{"stale_threshold_days": 14, "sync_alerts_enabled": true, "ai_task_alerts_enabled": true}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Phase 28.5: Notification Hub (Apprise)
CREATE TABLE IF NOT EXISTS notification_channels (
  id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id     TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  apprise_url TEXT        NOT NULL,
  enabled     BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notification_channels_user_idx ON notification_channels (user_id);

CREATE TABLE IF NOT EXISTS project_notification_prefs (
  project_id TEXT        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  channel_id TEXT        NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
  enabled    BOOLEAN     NOT NULL DEFAULT true,
  PRIMARY KEY (project_id, channel_id)
);

INSERT INTO app_settings (key, value)
VALUES ('digest_settings', '{"enabled": false, "time": "09:00"}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Phase 28.2: Advanced Search & Filtering
CREATE TABLE IF NOT EXISTS saved_filters (
  id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id     TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  entity_type TEXT        NOT NULL,
  filter_json JSONB       NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saved_filters_user_idx ON saved_filters (user_id);

CREATE TABLE IF NOT EXISTS search_history (
  id         TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id    TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query      TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS search_history_user_idx ON search_history (user_id);

-- Phase 28.3: Templates
CREATE TABLE IF NOT EXISTS templates (
  id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id  TEXT        REFERENCES projects(id) ON DELETE CASCADE,
  type        TEXT        NOT NULL CHECK (type IN ('issue', 'runbook', 'document')),
  name        TEXT        NOT NULL,
  description TEXT        NOT NULL DEFAULT '',
  body        JSONB       NOT NULL,
  is_builtin  BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS templates_project_idx ON templates (project_id);

-- Phase 26: User invites
CREATE TABLE IF NOT EXISTS user_invites (
  id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email       TEXT        NOT NULL UNIQUE,
  role        TEXT        NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member', 'viewer')),
  token_hash  TEXT        NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  TEXT        REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS user_invites_token_idx ON user_invites (token_hash);

-- ── Entity links (general cross-entity linking) ───────────────────────────
-- Polymorphic, undirected many-to-many links between Tasks, Documents
-- (Codes included — they're documents with file_type='code'), Issues,
-- Releases, and Commands. No FK to the underlying tables is possible since
-- the id can point into any of five different tables depending on *_type —
-- routes are responsible for validating the referenced row exists on
-- create, and for calling deleteLinksFor() when an entity is deleted.
-- The pair is stored in a canonical (a <= b) order so a link created as
-- (issue, X) -> (document, Y) and one created as (document, Y) -> (issue, X)
-- collapse to the same row instead of duplicating.

CREATE TABLE IF NOT EXISTS entity_links (
  id         TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  a_type     TEXT        NOT NULL CHECK (a_type IN ('task', 'document', 'issue', 'release', 'command')),
  a_id       TEXT        NOT NULL,
  b_type     TEXT        NOT NULL CHECK (b_type IN ('task', 'document', 'issue', 'release', 'command')),
  b_id       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (a_type, a_id, b_type, b_id)
);
CREATE INDEX IF NOT EXISTS entity_links_a_idx ON entity_links (a_type, a_id);
CREATE INDEX IF NOT EXISTS entity_links_b_idx ON entity_links (b_type, b_id);

-- ── API tokens ─────────────────────────────────────────────────────────────
-- Long-lived personal access tokens for scripting/curl against the API,
-- generated from Settings > Account. Only the sha256 hash is stored —
-- the raw token is shown once at creation time, same pattern as user_invites.

CREATE TABLE IF NOT EXISTS api_tokens (
  id           TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id      TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  token_hash   TEXT        NOT NULL UNIQUE,
  token_prefix TEXT        NOT NULL,  -- first 8 chars of the raw token, for display in the list
  last_used_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,           -- NULL = never expires
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_tokens_user_idx ON api_tokens (user_id);
CREATE INDEX IF NOT EXISTS api_tokens_hash_idx ON api_tokens (token_hash);

-- ── Embedding health snapshots ────────────────────────────────────────────
-- Periodic (hourly) global count of documents.embedding_status, captured by
-- services/embeddingHealthSnapshot.ts's scheduler — current status alone
-- can't show a trend, only right-now. Global rather than per-project: the
-- GPU-thrashing failure mode this exists to catch (see TASKS.md Known
-- Issues, 2026-07-15) is a system-wide Ollama problem, not a per-project one.
-- Pruned to a 30-day rolling window by the same scheduler.

CREATE TABLE IF NOT EXISTS embedding_health_snapshots (
  id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  pending     INTEGER     NOT NULL,
  processing  INTEGER     NOT NULL,
  done        INTEGER     NOT NULL,
  failed      INTEGER     NOT NULL
);
CREATE INDEX IF NOT EXISTS embedding_health_snapshots_captured_idx
  ON embedding_health_snapshots (captured_at);



