import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: {
    query: vi.fn(),
  },
}))

vi.mock('../../services/crypto.js', () => ({
  encrypt: vi.fn(s => `enc:${s}`),
  decrypt: vi.fn(s => s.replace('enc:', '')),
}))

import router from '../../routes/auth.js'
import { pool } from '../../db/pool.js'

const mockQuery = vi.mocked(pool.query)

describe('User Registration with Tokens', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  it('POST /register — validates invite token correctly', async () => {
    // 1. Not first run
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 1 }] } as any)
    
    // 2. Token lookup success
    mockQuery.mockResolvedValueOnce({ 
      rows: [{ email: 'new@org.com', role: 'member' }] 
    } as any)

    // 3. Invite deletion
    mockQuery.mockResolvedValueOnce({ rowCount: 1 } as any)

    // 4. User creation success
    mockQuery.mockResolvedValueOnce({ 
      rows: [{ id: 'u1', username: 'newuser', role: 'member' }] 
    } as any)

    const req = { 
      body: { username: 'newuser', password: 'password123', token: 'valid-token' } 
    }
    const res = { 
      json: vi.fn(), 
      status: vi.fn().mockReturnThis(),
      cookie: vi.fn()
    }

    const handler = router.stack.find(s => s.route?.path === '/register' && s.route?.methods.post)?.route.stack[0].handle
    await handler(req as any, res as any, () => {})

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('FROM user_invites'),
      expect.any(Array)
    )
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO users'),
      expect.arrayContaining(['newuser', 'new@org.com', 'member'])
    )
    expect(res.status).toHaveBeenCalledWith(201)
  })

  it('POST /register — fails on expired/invalid token', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 1 }] } as any)
    mockQuery.mockResolvedValueOnce({ rows: [] } as any) // Token not found

    const req = { body: { username: 'newuser', password: 'password123', token: 'bad-token' } }
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    const handler = router.stack.find(s => s.route?.path === '/register' && s.route?.methods.post)?.route.stack[0].handle
    await handler(req as any, res as any, () => {})

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired invite token' })
  })
})
