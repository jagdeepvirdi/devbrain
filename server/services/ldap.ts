/**
 * Optional LDAP authentication service.
 * Activated when LDAP_URL is set in the environment.
 * Requires ldapjs:  npm install ldapjs @types/ldapjs
 * If ldapjs is not installed the service returns null (auth skipped).
 */

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ldap: any = null
  try {
    // Dynamic import — works even if ldapjs is not installed (returns null)
    // @ts-ignore — ldapjs is an optional runtime dep, may not be installed
    ldap = await import('ldapjs')
  } catch {
    console.warn('LDAP_URL is set but ldapjs is not installed. Run: npm install ldapjs @types/ldapjs')
    return null
  }

  return new Promise<LdapUser | null>((resolve) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client: any = ldap.createClient({ url: env.LDAP_URL! })

    client.on('error', () => { client.destroy(); resolve(null) })

    const bindDn  = env.LDAP_BIND_DN       ?? ''
    const bindPwd = env.LDAP_BIND_PASSWORD  ?? ''

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client.bind(bindDn, bindPwd, (err: any) => {
      if (err) { client.destroy(); resolve(null); return }

      const searchBase   = env.LDAP_SEARCH_BASE ?? ''
      const userAttr     = env.LDAP_USER_ATTR   ?? 'uid'
      const searchFilter = `(${userAttr}=${username})`

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client.search(searchBase, { filter: searchFilter, scope: 'sub', attributes: ['dn', 'mail', userAttr] }, (searchErr: any, res: any) => {
        if (searchErr) { client.destroy(); resolve(null); return }

        let userDn: string | null = null
        let email:  string | null = null

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        res.on('searchEntry', (entry: any) => {
          userDn = entry.objectName as string
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const mailAttr = entry.attributes.find((a: any) => a.type === 'mail')
          email = mailAttr ? (mailAttr.values[0] ?? null) : null
        })

        res.on('error', () => { client.destroy(); resolve(null) })

        res.on('end', () => {
          if (!userDn) { client.destroy(); resolve(null); return }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          client.bind(userDn, password, (bindErr: any) => {
            client.destroy()
            if (bindErr) { resolve(null); return }
            resolve({ username, email, dn: userDn! })
          })
        })
      })
    })
  })
}
