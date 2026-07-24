import { z } from 'zod'

const schema = z.object({
  DATABASE_URL:       z.string().url('DATABASE_URL must be a valid URL'),
  OLLAMA_URL:         z.string().url('OLLAMA_URL must be a valid URL').default('http://localhost:11434'),
  OLLAMA_CHAT_MODEL:  z.string().default('mistral'),
  PORT:               z.coerce.number().int().positive().default(3001),
  JWT_SECRET:         z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  // Separate from JWT_SECRET on purpose: this is the root key for encrypting stored secrets
  // (LDAP bind password, S3/SFTP credentials, integration tokens) at rest. Sharing one secret
  // for both session signing and encryption-at-rest means a leaked JWT_SECRET also decrypts
  // every stored credential, and rotating JWT_SECRET (e.g. to force logout) would silently
  // break decryption of everything else.
  ENCRYPTION_KEY:     z.string().min(16, 'ENCRYPTION_KEY must be at least 16 characters'),
  AUTH_PASSWORD:      z.string().optional(),
  AI_PROVIDER:        z.enum(['ollama', 'claude', 'gemini']).default('ollama'),
  ANTHROPIC_API_KEY:  z.string().optional(),
  GEMINI_API_KEY:     z.string().optional(),
  GEMINI_CHAT_MODEL:  z.string().default('gemini-2.0-flash'),
  NODE_ENV:           z.enum(['development', 'production', 'test']).default('development'),
  FORCE_HTTPS:        z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  // Comma-separated allowlist of origins allowed to call the API cross-origin (e.g.
  // "https://app.example.com,https://admin.example.com"). Unset = same-origin only in
  // production (the client is served from this same Express process there anyway);
  // in development, unset falls back to reflecting the request origin so the Vite dev
  // server (a different port) keeps working without extra config.
  CORS_ORIGINS:       z.string().optional().transform(v => v ? v.split(',').map(s => s.trim()).filter(Boolean) : undefined),
  // LDAP — all optional; set LDAP_URL to activate
  LDAP_URL:           z.string().optional(),
  LDAP_BIND_DN:       z.string().optional(),
  LDAP_BIND_PASSWORD: z.string().optional(),
  LDAP_SEARCH_BASE:   z.string().optional(),
  LDAP_USER_ATTR:     z.string().default('uid'),
}).superRefine((data, ctx) => {
  if (data.AI_PROVIDER === 'claude' && !data.ANTHROPIC_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'ANTHROPIC_API_KEY is required when AI_PROVIDER=claude',
      path: ['ANTHROPIC_API_KEY'],
    })
  }
  if (data.AI_PROVIDER === 'gemini' && !data.GEMINI_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'GEMINI_API_KEY is required when AI_PROVIDER=gemini',
      path: ['GEMINI_API_KEY'],
    })
  }
  if (data.NODE_ENV === 'production' && !data.AUTH_PASSWORD) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'AUTH_PASSWORD is required in production — server will not start without it',
      path: ['AUTH_PASSWORD'],
    })
  }
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌  Invalid environment variables:')
  for (const issue of parsed.error.issues) {
    console.error(`   ${issue.path.join('.')}: ${issue.message}`)
  }
  process.exit(1)
}

export const env = parsed.data
