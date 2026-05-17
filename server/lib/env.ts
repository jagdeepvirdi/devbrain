import { z } from 'zod'

const schema = z.object({
  DATABASE_URL:       z.string().url('DATABASE_URL must be a valid URL'),
  OLLAMA_URL:         z.string().url('OLLAMA_URL must be a valid URL').default('http://localhost:11434'),
  OLLAMA_CHAT_MODEL:  z.string().default('mistral'),
  PORT:               z.coerce.number().int().positive().default(3001),
  JWT_SECRET:         z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  AUTH_PASSWORD:      z.string().optional(),
  USE_CLAUDE:         z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  ANTHROPIC_API_KEY:  z.string().optional(),
  NODE_ENV:           z.enum(['development', 'production', 'test']).default('development'),
  // LDAP — all optional; set LDAP_URL to activate
  LDAP_URL:           z.string().optional(),
  LDAP_BIND_DN:       z.string().optional(),
  LDAP_BIND_PASSWORD: z.string().optional(),
  LDAP_SEARCH_BASE:   z.string().optional(),
  LDAP_USER_ATTR:     z.string().default('uid'),
}).superRefine((data, ctx) => {
  if (data.USE_CLAUDE && !data.ANTHROPIC_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'ANTHROPIC_API_KEY is required when USE_CLAUDE=true',
      path: ['ANTHROPIC_API_KEY'],
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
