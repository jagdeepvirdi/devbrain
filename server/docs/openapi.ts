/**
 * OpenAPI 3.0 specification for the DevBrain API.
 * Served as interactive docs at GET /api/docs
 */

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title:       'DevBrain API',
    version:     '2.0.0',
    description: 'Private developer knowledge base — documents, issues, commands, releases, runbooks, and AI-powered Q&A via local Ollama.',
    contact:     { name: 'DevBrain' },
  },
  servers: [
    { url: '/api', description: 'Local dev server' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      cookieAuth: { type: 'apiKey', in: 'cookie', name: 'devbrain_token' },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['error'],
        properties: { error: { type: 'string' } },
      },
      Project: {
        type: 'object',
        properties: {
          id:            { type: 'string', format: 'uuid' },
          name:          { type: 'string' },
          short_name:    { type: 'string' },
          description:   { type: 'string' },
          color:         { type: 'string', example: '#6366F1' },
          status:        { type: 'string', enum: ['active', 'paused', 'planning'] },
          tech_stack:    { type: 'array', items: { type: 'string' } },
          type:          { type: 'string', enum: ['mobile', 'web', 'desktop', 'fintech', 'tool'] },
          repo_url:      { type: 'string' },
          fs_path:       { type: 'string', nullable: true },
          doc_count:     { type: 'integer' },
          issue_count:   { type: 'integer' },
          command_count: { type: 'integer' },
          release_count: { type: 'integer' },
          created_at:    { type: 'string', format: 'date-time' },
        },
      },
      Issue: {
        type: 'object',
        properties: {
          id:          { type: 'string', format: 'uuid' },
          project_id:  { type: 'string', nullable: true },
          title:       { type: 'string' },
          description: { type: 'string' },
          status:      { type: 'string', enum: ['open', 'investigating', 'resolved', 'wont-fix'] },
          priority:    { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          tags:        { type: 'array', items: { type: 'string' } },
          created_at:  { type: 'string', format: 'date-time' },
        },
      },
      Command: {
        type: 'object',
        properties: {
          id:          { type: 'string', format: 'uuid' },
          project_id:  { type: 'string', nullable: true },
          title:       { type: 'string' },
          command:     { type: 'string' },
          language:    { type: 'string', example: 'bash' },
          description: { type: 'string' },
          tags:        { type: 'array', items: { type: 'string' } },
          is_favorite: { type: 'boolean' },
          created_at:  { type: 'string', format: 'date-time' },
        },
      },
      Document: {
        type: 'object',
        properties: {
          id:               { type: 'string', format: 'uuid' },
          project_id:       { type: 'string', nullable: true },
          title:            { type: 'string' },
          file_type:        { type: 'string', enum: ['pdf', 'docx', 'md', 'txt', 'xlsx', 'url'] },
          tags:             { type: 'array', items: { type: 'string' } },
          source:           { type: 'string' },
          embedding_status: { type: 'string', enum: ['pending', 'processing', 'done', 'failed'] },
          chunk_count:      { type: 'integer' },
          created_at:       { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  paths: {

    // ── Health ──────────────────────────────────────────────────────────────
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Health check',
        description: 'Returns DB and Ollama connectivity status. No auth required.',
        security: [],
        responses: {
          200: {
            description: 'System healthy or degraded',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status:  { type: 'string', enum: ['ok', 'degraded', 'error'] },
                    ts:      { type: 'string', format: 'date-time' },
                    checks:  { type: 'object', properties: { db: { type: 'string' }, ollama: { type: 'string' } } },
                    config:  { type: 'object' },
                  },
                },
              },
            },
          },
        },
      },
    },

    // ── Auth ────────────────────────────────────────────────────────────────
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['username', 'password'],
                properties: {
                  username: { type: 'string' },
                  password: { type: 'string', format: 'password' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Login successful — JWT set as HttpOnly cookie and returned in body' },
          401: { description: 'Invalid credentials', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          429: { description: 'Rate limit exceeded (10 attempts / 15 min)' },
        },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Logout — clears the auth cookie',
        responses: { 200: { description: 'Logged out' } },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Return the currently authenticated user',
        responses: {
          200: { description: 'Current user' },
          401: { description: 'Not authenticated' },
        },
      },
    },

    // ── Projects ────────────────────────────────────────────────────────────
    '/projects': {
      get: {
        tags: ['Projects'],
        summary: 'List all projects with counts',
        responses: {
          200: {
            description: 'Project list',
            content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Project' } } } } } },
          },
        },
      },
      post: {
        tags: ['Projects'],
        summary: 'Create a project',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'short_name', 'color', 'status', 'type'],
                properties: {
                  name:       { type: 'string' },
                  short_name: { type: 'string', pattern: '^[a-z0-9-]+$' },
                  color:      { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
                  status:     { type: 'string', enum: ['active', 'paused', 'planning'] },
                  type:       { type: 'string', enum: ['mobile', 'web', 'desktop', 'fintech', 'tool'] },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Created project' },
          400: { description: 'Validation error' },
        },
      },
    },
    '/projects/{id}': {
      get: {
        tags: ['Projects'],
        summary: 'Get a project by ID',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Project detail' }, 404: { description: 'Not found' } },
      },
      put: {
        tags: ['Projects'],
        summary: 'Update a project',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Updated project' } },
      },
      delete: {
        tags: ['Projects'],
        summary: 'Delete a project and all its data',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Deleted' } },
      },
    },
    '/projects/{id}/link': {
      put: {
        tags: ['Projects'],
        summary: 'Link or unlink a local filesystem path for Claude Code integration',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { fs_path: { type: 'string', nullable: true } } } } },
        },
        responses: { 200: { description: 'Updated project' }, 422: { description: 'Path does not exist on disk' } },
      },
    },

    // ── Documents ───────────────────────────────────────────────────────────
    '/documents': {
      get: {
        tags: ['Documents'],
        summary: 'List documents',
        parameters: [
          { name: 'projectId', in: 'query', schema: { type: 'string' } },
          { name: 'search',    in: 'query', schema: { type: 'string' } },
          { name: 'limit',     in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'offset',    in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: { 200: { description: 'Document list with pagination' } },
      },
      post: {
        tags: ['Documents'],
        summary: 'Upload a document (multipart/form-data) or import a URL',
        requestBody: {
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  file:      { type: 'string', format: 'binary' },
                  projectId: { type: 'string' },
                  tags:      { type: 'string', description: 'Comma-separated tags' },
                },
              },
            },
            'application/json': {
              schema: {
                type: 'object',
                required: ['url'],
                properties: { url: { type: 'string', format: 'uri' }, projectId: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } },
              },
            },
          },
        },
        responses: { 201: { description: 'Document created and embedding queued' }, 422: { description: 'SSRF / unsupported type' } },
      },
    },
    '/documents/{id}': {
      get:    { tags: ['Documents'], summary: 'Get document with full content', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Document detail' } } },
      delete: { tags: ['Documents'], summary: 'Delete document', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Deleted' } } },
    },

    // ── Issues ──────────────────────────────────────────────────────────────
    '/issues': {
      get: {
        tags: ['Issues'],
        summary: 'List issues',
        parameters: [
          { name: 'projectId', in: 'query', schema: { type: 'string' } },
          { name: 'status',    in: 'query', schema: { type: 'string' } },
          { name: 'priority',  in: 'query', schema: { type: 'string' } },
          { name: 'search',    in: 'query', schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Issue list' } },
      },
      post: {
        tags: ['Issues'],
        summary: 'Create an issue',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['title'], properties: { title: { type: 'string' }, description: { type: 'string' }, priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] }, projectId: { type: 'string' } } } } },
        },
        responses: { 201: { description: 'Created issue' } },
      },
    },
    '/issues/{id}': {
      get:    { tags: ['Issues'], summary: 'Get issue detail', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Issue detail with steps and notes' } } },
      put:    { tags: ['Issues'], summary: 'Update issue', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Updated' } } },
      delete: { tags: ['Issues'], summary: 'Delete issue', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Deleted' } } },
    },

    // ── Commands ────────────────────────────────────────────────────────────
    '/commands': {
      get: {
        tags: ['Commands'],
        summary: 'List commands/snippets',
        parameters: [
          { name: 'projectId', in: 'query', schema: { type: 'string' } },
          { name: 'search',    in: 'query', schema: { type: 'string' } },
          { name: 'language',  in: 'query', schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Command list' } },
      },
      post: {
        tags: ['Commands'],
        summary: 'Create a command',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['title', 'command', 'language'], properties: { title: { type: 'string' }, command: { type: 'string' }, language: { type: 'string' }, description: { type: 'string' }, projectId: { type: 'string' } } } } },
        },
        responses: { 201: { description: 'Created command' } },
      },
    },

    // ── Search ──────────────────────────────────────────────────────────────
    '/search': {
      get: {
        tags: ['Search'],
        summary: 'Hybrid semantic + full-text search across all content',
        parameters: [
          { name: 'q',         in: 'query', required: true, schema: { type: 'string' } },
          { name: 'projectId', in: 'query', schema: { type: 'string' } },
          { name: 'limit',     in: 'query', schema: { type: 'integer', default: 10, maximum: 50 } },
        ],
        responses: {
          200: {
            description: 'Search results grouped by type',
            content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'object', properties: { documents: { type: 'array' }, issues: { type: 'array' }, commands: { type: 'array' } } } } } } },
          },
        },
      },
    },

    // ── Claude Integration ──────────────────────────────────────────────────
    '/claude-projects/scan': {
      post: {
        tags: ['Claude Integration'],
        summary: 'Scan the configured root for Claude Code projects',
        description: 'Searches up to 3 levels deep for folders containing CLAUDE.md, TASKS.md, or sessions/. Requires claude_scan_root to be configured in Settings.',
        responses: {
          200: { description: 'Array of discovered project candidates with task completion stats' },
          422: { description: 'No scan root configured' },
        },
      },
    },
    '/claude-projects/{id}/tasks': {
      get: {
        tags: ['Claude Integration'],
        summary: 'Parse TASKS.md from the linked project folder',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Task tree with phases and completion stats' }, 422: { description: 'Project has no linked fs_path' } },
      },
    },
    '/claude-projects/{id}/sessions': {
      get: {
        tags: ['Claude Integration'],
        summary: 'List Claude Code sessions for the linked project',
        parameters: [
          { name: 'id',     in: 'path',  required: true, schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'completed'] } },
          { name: 'q',      in: 'query', schema: { type: 'string' } },
          { name: 'page',   in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit',  in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: { 200: { description: 'Paginated session summaries' } },
      },
    },
  },
}
