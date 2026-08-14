import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('loadXlsx', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doUnmock('xlsx')
  })

  it('returns the module as-is when the full API (readFile/write) is already at the top level', async () => {
    vi.doMock('xlsx', () => ({ readFile: vi.fn(), write: vi.fn(), utils: {} }))
    const { loadXlsx } = await import('../../lib/xlsxCompat.js')

    const mod = await loadXlsx()

    expect(typeof (mod as unknown as { readFile: unknown }).readFile).toBe('function')
  })

  it('falls back to .default when the top level is missing the full API', async () => {
    const fullApi = { readFile: vi.fn(), write: vi.fn(), utils: {} }
    vi.doMock('xlsx', () => ({ readFile: undefined, write: undefined, default: fullApi }))
    const { loadXlsx } = await import('../../lib/xlsxCompat.js')

    const mod = await loadXlsx()

    expect(mod).toBe(fullApi)
  })

  it('falls back to the bare module when neither the top level nor .default has the full API', async () => {
    const marker = {}
    vi.doMock('xlsx', () => ({ readFile: undefined, write: undefined, default: undefined, utils: marker }))
    const { loadXlsx } = await import('../../lib/xlsxCompat.js')

    const mod = await loadXlsx()

    expect((mod as unknown as { utils: unknown }).utils).toBe(marker)
  })
})
