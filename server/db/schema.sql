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
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

-- ── Documents ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS documents (
  id               TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id       TEXT        REFERENCES projects(id) ON DELETE CASCADE,
  title            TEXT        NOT NULL,
  file_type        TEXT        NOT NULL
                     CHECK (file_type IN ('pdf', 'docx', 'md', 'txt', 'xlsx', 'url')),
  content          TEXT        NOT NULL DEFAULT '',
  tags             TEXT[]      NOT NULL DEFAULT '{}',
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

-- ── Document chunks (RAG) ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS document_chunks (
  id           TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  document_id  TEXT        NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  content      TEXT        NOT NULL,
  chunk_index  INTEGER     NOT NULL,
  -- nomic-embed-text -> 768 dimensions
  embedding    VECTOR(768),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);

-- HNSW index: faster than IVFFlat for this scale, no minimum-rows requirement.
CREATE INDEX IF NOT EXISTS document_chunks_hnsw_idx
  ON document_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS document_chunks_doc_idx ON document_chunks (document_id);

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
VALUES ('backup_settings', '{"path": null, "schedule": "off", "last_backup_at": null}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Phase 23: AI Enhancements — persistent explanation and summary fields
ALTER TABLE commands ADD COLUMN IF NOT EXISTS explanation TEXT;
ALTER TABLE issues   ADD COLUMN IF NOT EXISTS summary     TEXT;
