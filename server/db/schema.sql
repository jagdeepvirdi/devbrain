-- DevBrain database schema
-- Requires: pgvector/pgvector:pg16 image
-- Run once against a fresh database. Idempotent (IF NOT EXISTS throughout).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ── Projects ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name        TEXT        NOT NULL,
  short_name  TEXT        NOT NULL UNIQUE,
  description TEXT        NOT NULL DEFAULT '',
  color       TEXT        NOT NULL DEFAULT '#6366F1',
  status      TEXT        NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'paused', 'planning')),
  tech_stack  TEXT[]      NOT NULL DEFAULT '{}',
  type        TEXT        NOT NULL DEFAULT 'web'
                CHECK (type IN ('mobile', 'web', 'desktop', 'fintech', 'tool')),
  repo_url    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Documents ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS documents (
  id           TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id   TEXT        REFERENCES projects(id) ON DELETE CASCADE,
  title        TEXT        NOT NULL,
  file_type    TEXT        NOT NULL
                 CHECK (file_type IN ('pdf', 'docx', 'md', 'txt', 'xlsx', 'url')),
  content      TEXT        NOT NULL DEFAULT '',
  tags         TEXT[]      NOT NULL DEFAULT '{}',
  source       TEXT        NOT NULL DEFAULT '',
  content_hash TEXT,                   -- SHA-256; used for deduplication (Phase 9)
  tsv          TSVECTOR    GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, ''))
  ) STORED,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS documents_tsv_idx      ON documents USING GIN (tsv);
CREATE INDEX IF NOT EXISTS documents_project_idx  ON documents (project_id);
CREATE INDEX IF NOT EXISTS documents_hash_idx     ON documents (content_hash) WHERE content_hash IS NOT NULL;

-- ── Document chunks (RAG) ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS document_chunks (
  id           TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  document_id  TEXT        NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  content      TEXT        NOT NULL,
  chunk_index  INTEGER     NOT NULL,
  -- nomic-embed-text → 768 dimensions
  embedding    VECTOR(768),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);

-- HNSW index: faster than IVFFlat for this scale, no minimum-rows requirement.
-- m=16 ef_construction=64 are good defaults; tune ef_search at query time.
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
  resolution          TEXT        NOT NULL DEFAULT '',
  tags                TEXT[]      NOT NULL DEFAULT '{}',
  tsv                 TSVECTOR    GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(resolution, ''))
  ) STORED,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS issues_tsv_idx      ON issues USING GIN (tsv);
CREATE INDEX IF NOT EXISTS issues_project_idx  ON issues (project_id);
CREATE INDEX IF NOT EXISTS issues_status_idx   ON issues (status);
CREATE INDEX IF NOT EXISTS issues_priority_idx ON issues (priority);

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
  tsv         TSVECTOR    GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(command, ''))
  ) STORED,
  last_used   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS commands_tsv_idx      ON commands USING GIN (tsv);
CREATE INDEX IF NOT EXISTS commands_project_idx  ON commands (project_id);
CREATE INDEX IF NOT EXISTS commands_fav_idx      ON commands (is_favorite) WHERE is_favorite = true;

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
  UNIQUE (project_id, version)
);

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
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS runbooks_project_idx ON runbooks (project_id);
