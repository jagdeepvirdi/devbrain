import crypto from 'node:crypto'
import { env } from '../lib/env.js'

// AES-256-GCM encryption — key derived from JWT_SECRET
function key(): Buffer {
  return crypto.createHash('sha256').update(env.JWT_SECRET).digest()
}

export function encrypt(plaintext: string): string {
  const iv  = crypto.randomBytes(12)
  const c   = crypto.createCipheriv('aes-256-gcm', key(), iv)
  const enc = Buffer.concat([c.update(plaintext, 'utf8'), c.final()])
  const tag = c.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

export function decrypt(b64: string): string {
  const buf = Buffer.from(b64, 'base64')
  const iv  = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const enc = buf.subarray(28)
  const d   = crypto.createDecipheriv('aes-256-gcm', key(), iv)
  d.setAuthTag(tag)
  return d.update(enc).toString('utf8') + d.final('utf8')
}
