import { describe, it, expect, vi } from 'vitest'

// Mock env before the module loads
vi.mock('../../lib/env.js', () => ({
  env: {
    ENCRYPTION_KEY: 'test-encryption-key-32-chars-long-at-least',
  },
}))

// Import after mocks are registered
const { encrypt, decrypt } = await import('../../services/crypto.js')

describe('Crypto Service', () => {
  it('should encrypt and decrypt text correctly', () => {
    const text = 'secret-api-token-123'
    const encrypted = encrypt(text)
    
    expect(encrypted).toBeDefined()
    expect(encrypted).not.toBe(text)
    
    const decrypted = decrypt(encrypted)
    expect(decrypted).toBe(text)
  })

  it('should produce different ciphertexts for the same input (IV randomization)', () => {
    const text = 'constant-text'
    const enc1 = encrypt(text)
    const enc2 = encrypt(text)
    
    expect(enc1).not.toBe(enc2)
    expect(decrypt(enc1)).toBe(text)
    expect(decrypt(enc2)).toBe(text)
  })

  it('should fail to decrypt tampered data', () => {
    const text = 'valid-data'
    const encrypted = encrypt(text)
    
    // Flip a character in the hex string
    const tampered = encrypted.slice(0, -1) + (encrypted.endsWith('a') ? 'b' : 'a')
    
    expect(() => decrypt(tampered)).toThrow()
  })

  it('should handle empty strings', () => {
    const text = ''
    const encrypted = encrypt(text)
    expect(decrypt(encrypted)).toBe('')
  })
})
