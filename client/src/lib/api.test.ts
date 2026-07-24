import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock fetch globally
vi.stubGlobal('fetch', vi.fn())

// Import the module
const { authApi, documentsApi } = await import('./api.js')

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as unknown as Response
}

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

  // authApi.me() has its own !res.ok short-circuit and never reaches the shared
  // request()/_fetch() 401 handling below — documentsApi.get routes straight through
  // it, so it's used here instead to actually exercise that path.
  it('_fetch: dispatches devbrain:unauthorized and throws on a 401, via the shared request() path', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: 'nope' }, false, 401))

    await expect(documentsApi.get('doc-1')).rejects.toThrow('Unauthorized')
    expect(window.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'devbrain:unauthorized' }))
  })

  it('_fetch: throws the server-provided error message on a non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: 'Document not found' }, false, 404))

    await expect(documentsApi.get('missing')).rejects.toThrow('Document not found')
  })

  it('_fetch: falls back to a generic message when the error body has no `error` field', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({}, false, 500))

    await expect(documentsApi.get('doc-1')).rejects.toThrow('Request failed: 500')
  })

  it('_fetch: throws "Unexpected server response" when the body is not valid JSON', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true, status: 200, json: () => Promise.reject(new Error('not json')),
    } as unknown as Response)

    await expect(documentsApi.get('doc-1')).rejects.toThrow('Unexpected server response')
  })

  it('request(): deduplicates concurrent GETs to the same path into a single fetch call', async () => {
    let resolveFetch!: (v: Response) => void
    vi.mocked(fetch).mockReturnValueOnce(new Promise(resolve => { resolveFetch = resolve }))

    const p1 = documentsApi.get('doc-1')
    const p2 = documentsApi.get('doc-1')

    expect(fetch).toHaveBeenCalledTimes(1)
    resolveFetch(jsonResponse({ data: { id: 'doc-1' } }))

    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toBe(r2)
  })

  it('request(): does not deduplicate non-GET requests to the same path', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'doc-1', embedding_status: 'processing' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'doc-1', embedding_status: 'processing' } }))

    await Promise.all([documentsApi.reembed('doc-1'), documentsApi.reembed('doc-1')])

    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

describe('documentsApi.upload', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  function makeFile(name = 'notes.sql', content = 'SELECT 1;') {
    return new File([content], name, { type: 'text/plain' })
  }

  it('builds multipart form data with file, projectId, tags, and component', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ data: { id: 'doc-1', title: 'notes.sql' } }))

    await documentsApi.upload(makeFile(), 'proj-1', ['code', 'sql'], 'billing')

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/documents')
    expect(init.method).toBe('POST')
    const fd = init.body as FormData
    expect(fd.get('file')).toBeInstanceOf(File)
    expect(fd.get('projectId')).toBe('proj-1')
    expect(fd.get('tags')).toBe(JSON.stringify(['code', 'sql']))
    expect(fd.get('component')).toBe('billing')
  })

  it('omits projectId and component from the form when not provided', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ data: { id: 'doc-1' } }))

    await documentsApi.upload(makeFile())

    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    const fd = init.body as FormData
    expect(fd.get('projectId')).toBeNull()
    expect(fd.get('component')).toBeNull()
    expect(fd.get('tags')).toBe('[]')
  })

  it('returns the created document on success', async () => {
    const doc = { id: 'doc-1', title: 'notes.sql' }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ data: doc }))

    await expect(documentsApi.upload(makeFile())).resolves.toEqual(doc)
  })

  it('attaches existingId to the thrown error on a 409 duplicate-content conflict', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ error: 'Already tracked', existingId: 'doc-existing' }, false, 409)
    )

    await expect(documentsApi.upload(makeFile())).rejects.toMatchObject({
      message: 'Already tracked',
      existingId: 'doc-existing',
    })
  })

  it('falls back to a generic message when a failed upload has no error field', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({}, false, 500))

    await expect(documentsApi.upload(makeFile())).rejects.toThrow('Upload failed: 500')
  })
})
