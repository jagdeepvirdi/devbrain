import { describe, it, expect, vi } from 'vitest'

const envMock = vi.hoisted(() => ({ AI_PROVIDER: 'ollama' as string }))
vi.mock('../../lib/env.js', () => ({ env: envMock }))

import { requireLocalAI, LocalAIRequiredError } from '../../lib/requireLocalAI.js'

describe('requireLocalAI', () => {
  it('passes for the ollama provider', () => {
    envMock.AI_PROVIDER = 'ollama'
    expect(() => requireLocalAI()).not.toThrow()
  })

  it.each(['claude', 'gemini'])('rejects the %s cloud provider', provider => {
    envMock.AI_PROVIDER = provider
    expect(() => requireLocalAI()).toThrow(LocalAIRequiredError)
    expect(() => requireLocalAI()).toThrow(provider)
  })
})
