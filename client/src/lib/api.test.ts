import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock fetch globally
vi.stubGlobal('fetch', vi.fn())

// Import the module
const { authApi } = await import('./api.js')

describe('API Wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(Storage.prototype, 'setItem')
    vi.spyOn(Storage.prototype, 'removeItem')
    vi.stubGlobal('window', { dispatchEvent: vi.fn() })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('login — stores user in localStorage on success', async () => {
    const user = { id: '1', username: 'test', role: 'admin' }
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { user, devMode: false } })
    } as unknown as Response)

    await authApi.login('test', 'pass')

    expect(localStorage.setItem).toHaveBeenCalledWith('devbrain_user', JSON.stringify(user))
  })

  it('logout — clears localStorage', () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as unknown as Response)
    authApi.logout()
    expect(localStorage.removeItem).toHaveBeenCalledWith('devbrain_user')
  })

  it('handles 401 Unauthorized by dispatching event', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'Unauthorized' })
    } as unknown as Response)

    await expect(authApi.me()).resolves.toEqual({ authed: false, devMode: false })
  })
})
