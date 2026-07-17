/**
 * Optional LDAP authentication service.
 * Supports enterprise directory integration.
 */

import ldap from 'ldapjs'

export interface LdapConfig {
  url:         string
  bindDn:      string
  bindPassword: string
  searchBase:  string
  userAttr:    string
}

export interface LdapUser {
  username: string
  email:    string | null
  dn:       string
}

/**
 * Authenticates a user against an LDAP directory.
 * Returns LdapUser on success, null on failure.
 */
export async function ldapAuth(username: string, password: string, config: LdapConfig): Promise<LdapUser | null> {
  if (!config.url) return null

  return new Promise<LdapUser | null>((resolve) => {
    let client: ldap.Client
    try {
      client = ldap.createClient({ url: config.url })
    } catch (err) {
      console.error('LDAP client creation failed:', err)
      return resolve(null)
    }

    client.on('error', (err) => { 
      console.error('LDAP client error:', err.message)
      client.destroy()
      resolve(null) 
    })

    client.bind(config.bindDn, config.bindPassword, (err) => {
      if (err) { 
        console.error('LDAP bind failed:', err.message)
        client.destroy()
        resolve(null)
        return 
      }

      const searchFilter = `(${config.userAttr ?? 'uid'}=${username})`

      client.search(config.searchBase, { filter: searchFilter, scope: 'sub', attributes: ['dn', 'mail', config.userAttr] }, (searchErr, res) => {
        if (searchErr) { 
          console.error('LDAP search failed:', searchErr.message)
          client.destroy()
          resolve(null)
          return 
        }

        let userDn: string | null = null
        let email:  string | null = null

        res.on('searchEntry', (entry) => {
          userDn = entry.objectName as string
          const mailAttr = entry.attributes.find(a => a.type === 'mail')
          const mailValues = mailAttr ? mailAttr.values : undefined
          email = mailValues ? (Array.isArray(mailValues) ? mailValues[0] : mailValues) ?? null : null
        })

        res.on('error', (err) => { 
          console.error('LDAP search result error:', err.message)
          client.destroy()
          resolve(null) 
        })

        res.on('end', () => {
          if (!userDn) { 
            client.destroy()
            resolve(null)
            return 
          }

          client.bind(userDn, password, (bindErr) => {
            client.destroy()
            if (bindErr) { 
              console.warn('LDAP user bind failed:', bindErr.message)
              resolve(null)
              return 
            }
            resolve({ username, email, dn: userDn! })
          })
        })
      })
    })
  })
}
