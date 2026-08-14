import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// env.ts runs schema.safeParse(process.env) at import time and calls
// process.exit(1) on failure — each scenario needs a fresh module instance
// (vi.resetModules) with process.exit/console.error mocked before import.
describe('env', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('exits with a logged error when a required var is missing/invalid', async () => {
    vi.stubEnv('DATABASE_URL', 'not-a-url')
    const exitSpy  = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit') }) as never)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(import('../../lib/env.js')).rejects.toThrow('exit')

    expect(errorSpy).toHaveBeenCalledWith('❌  Invalid environment variables:')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('requires ANTHROPIC_API_KEY when AI_PROVIDER=claude', async () => {
    vi.stubEnv('AI_PROVIDER', 'claude')
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    const exitSpy  = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit') }) as never)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(import('../../lib/env.js')).rejects.toThrow('exit')

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('ANTHROPIC_API_KEY is required when AI_PROVIDER=claude'),
    )
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('requires GEMINI_API_KEY when AI_PROVIDER=gemini', async () => {
    vi.stubEnv('AI_PROVIDER', 'gemini')
    vi.stubEnv('GEMINI_API_KEY', '')
    const exitSpy  = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit') }) as never)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(import('../../lib/env.js')).rejects.toThrow('exit')

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('GEMINI_API_KEY is required when AI_PROVIDER=gemini'),
    )
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('requires AUTH_PASSWORD in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('AUTH_PASSWORD', '')
    const exitSpy  = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit') }) as never)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(import('../../lib/env.js')).rejects.toThrow('exit')

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('AUTH_PASSWORD is required in production'),
    )
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('parses successfully with a valid, complete environment', async () => {
    const { env } = await import('../../lib/env.js')

    expect(env.DATABASE_URL).toBe('postgresql://test:test@localhost:5432/test')
    expect(env.AI_PROVIDER).toBe('ollama')
  })

  it('coerces TRUST_PROXY "true" to a boolean', async () => {
    vi.stubEnv('TRUST_PROXY', 'true')
    const { env } = await import('../../lib/env.js')
    expect(env.TRUST_PROXY).toBe(true)
  })

  it('coerces a numeric TRUST_PROXY string to a number (hop count)', async () => {
    vi.stubEnv('TRUST_PROXY', '2')
    const { env } = await import('../../lib/env.js')
    expect(env.TRUST_PROXY).toBe(2)
  })

  it('passes a non-boolean, non-numeric TRUST_PROXY through unchanged (e.g. "loopback")', async () => {
    vi.stubEnv('TRUST_PROXY', 'loopback')
    const { env } = await import('../../lib/env.js')
    expect(env.TRUST_PROXY).toBe('loopback')
  })

  it('splits and trims CORS_ORIGINS into a filtered list', async () => {
    vi.stubEnv('CORS_ORIGINS', 'https://a.example.com, https://b.example.com,')
    const { env } = await import('../../lib/env.js')
    expect(env.CORS_ORIGINS).toEqual(['https://a.example.com', 'https://b.example.com'])
  })
})
