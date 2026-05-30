import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock ldapjs
const mockBind = vi.fn()
const mockSearch = vi.fn()
const mockDestroy = vi.fn()

vi.mock('ldapjs', () => ({
  default: {
    createClient: vi.fn(() => ({
      on: vi.fn(),
      bind: mockBind,
      search: mockSearch,
      destroy: mockDestroy,
    })),
  }
}))

import { ldapAuth, type LdapConfig } from '../../services/ldap.js'
import ldap from 'ldapjs'

describe('LDAP Service', () => {
  const config: LdapConfig = {
    url: 'ldap://localhost:389',
    bindDn: 'cn=admin',
    bindPassword: 'password',
    searchBase: 'ou=users',
    userAttr: 'uid'
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return null if url is missing', async () => {
    const result = await ldapAuth('user', 'pass', { ...config, url: '' })
    expect(result).toBeNull()
  })

  it('should authenticate correctly on successful bind and search', async () => {
    // 1. Admin bind success
    mockBind.mockImplementationOnce((dn, pwd, cb) => cb(null))
    
    // 2. Search success
    mockSearch.mockImplementationOnce((base, opts, cb) => {
      const res = {
        on: vi.fn((event, handler) => {
          if (event === 'searchEntry') {
            handler({ objectName: 'uid=testuser,ou=users', attributes: [{ type: 'mail', values: ['test@example.com'] }] })
          }
          if (event === 'end') handler()
        })
      }
      cb(null, res)
    })

    // 3. User bind success
    mockBind.mockImplementationOnce((dn, pwd, cb) => cb(null))

    const result = await ldapAuth('testuser', 'secret', config)

    expect(result).toEqual({
      username: 'testuser',
      email: 'test@example.com',
      dn: 'uid=testuser,ou=users'
    })
    expect(mockDestroy).toHaveBeenCalled()
  })

  it('should return null if admin bind fails', async () => {
    mockBind.mockImplementationOnce((dn, pwd, cb) => cb(new Error('Invalid admin credentials')))
    
    const result = await ldapAuth('user', 'pass', config)
    expect(result).toBeNull()
    expect(mockDestroy).toHaveBeenCalled()
  })

  it('should return null if user search finds no entries', async () => {
    mockBind.mockImplementationOnce((dn, pwd, cb) => cb(null))
    mockSearch.mockImplementationOnce((base, opts, cb) => {
      const res = {
        on: vi.fn((event, handler) => {
          if (event === 'end') handler()
        })
      }
      cb(null, res)
    })

    const result = await ldapAuth('unknown', 'pass', config)
    expect(result).toBeNull()
  })
})
