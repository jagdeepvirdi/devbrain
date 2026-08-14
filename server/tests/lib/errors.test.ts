import { describe, it, expect, vi } from 'vitest'
import type { Response } from 'express'

// Mocked to 'production' so this file exercises the message-masking branch;
// the passthrough (non-production) branch is already exercised by the many
// route tests that call serverError() against the real (test-mode) env.
vi.mock('../../lib/env.js', () => ({ env: { NODE_ENV: 'production' } }))

const { serverError } = await import('../../lib/errors.js')

function fakeRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response
}

describe('serverError (production)', () => {
  it('masks a real Error message behind a generic string', () => {
    const res = fakeRes()
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    serverError(res, new Error('sensitive db details'))

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' })
    errSpy.mockRestore()
  })

  it('still masks a non-Error thrown value', () => {
    const res = fakeRes()
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    serverError(res, 'plain string failure')

    expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' })
    errSpy.mockRestore()
  })
})
