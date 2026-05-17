/**
 * Optional LDAP authentication service.
 * Activated when LDAP_URL is set in the environment.
 * ldapjs is now a declared dependency; this module is always importable.
 */

import ldap from 'ldapjs'
import { env } from '../lib/env.js'

export interface LdapUser {
  username: string
  email:    string | null
  dn:       string
}

export function ldapEnabled(): boolean {
  return !!env.LDAP_URL
}

export async function ldapAuth(username: string, password: string): Promise<LdapUser | null> {
  if (!env.LDAP_URL) return null

  return new Promise<LdapUser | null>((resolve) => {
    const client = ldap.createClient({ url: env.LDAP_URL! })

    client.on('error', () => { client.destroy(); resolve(null) })

    const bindDn  = env.LDAP_BIND_DN       ?? ''
    const bindPwd = env.LDAP_BIND_PASSWORD  ?? ''

    client.bind(bindDn, bindPwd, (err) => {
      if (err) { client.destroy(); resolve(null); return }

      const searchBase   = env.LDAP_SEARCH_BASE ?? ''
      const userAttr     = env.LDAP_USER_ATTR   ?? 'uid'
      const searchFilter = `(${userAttr}=${username})`

      client.search(searchBase, { filter: searchFilter, scope: 'sub', attributes: ['dn', 'mail', userAttr] }, (searchErr, res) => {
        if (searchErr) { client.destroy(); resolve(null); return }

        let userDn: string | null = null
        let email:  string | null = null

        res.on('searchEntry', (entry) => {
          userDn = entry.objectName as string
          const mailAttr = entry.attributes.find(a => a.type === 'mail')
          email = mailAttr ? (mailAttr.values[0] ?? null) : null
        })

        res.on('error', () => { client.destroy(); resolve(null) })

        res.on('end', () => {
          if (!userDn) { client.destroy(); resolve(null); return }

          client.bind(userDn, password, (bindErr) => {
            client.destroy()
            if (bindErr) { resolve(null); return }
            resolve({ username, email, dn: userDn! })
          })
        })
      })
    })
  })
}
