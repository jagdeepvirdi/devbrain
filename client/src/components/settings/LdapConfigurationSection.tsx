import { useState, useEffect } from 'react'
import { settingsApi, type LdapSettings } from '../../lib/api'
import { useToast } from '../Toast'

export function LdapConfigurationSection() {
  const { toast } = useToast()
  const [cfg,      setCfg]      = useState<LdapSettings | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [testing,  setTesting]  = useState(false)

  const [form, setForm] = useState({
    url:          '',
    bindDn:       '',
    bindPassword: '',
    searchBase:   '',
    userAttr:     'uid'
  })

  const [testCreds, setTestCreds] = useState({ username: '', password: '' })
  const [showTest,  setShowTest]  = useState(false)

  useEffect(() => {
    settingsApi.getLdapSettings().then(d => {
      if (d) {
        setCfg(d)
        setForm({ url: d.url, bindDn: d.bindDn, searchBase: d.searchBase, userAttr: d.userAttr, bindPassword: '' })
      }
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await settingsApi.saveLdapSettings(form)
      const updated = await settingsApi.getLdapSettings()
      setCfg(updated)
      setForm(prev => ({ ...prev, bindPassword: '' }))
      toast('LDAP configuration saved')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleTest(e: React.FormEvent) {
    e.preventDefault()
    if (!testCreds.username || !testCreds.password) return
    setTesting(true)
    try {
      const res = await settingsApi.testLdap({ ...form, ...testCreds })
      toast(`Success! Authenticated as ${res.user.dn}`, 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setTesting(false)
    }
  }

  const inp: React.CSSProperties = { width: '100%', background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 5, padding: '5px 8px', color: 'var(--fg)', fontSize: 12.5, boxSizing: 'border-box', outline: 'none' }

  if (loading) return <div style={{ fontSize: 12, color: 'var(--fg-4)', padding: '4px 0' }}>Loading…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 8 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--fg-4)', marginBottom: 4 }}>Server URL</div>
            <input value={form.url} onChange={e => setForm(p => ({...p, url: e.target.value}))} placeholder="ldap://ldap.company.com" style={inp} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--fg-4)', marginBottom: 4 }}>User Attr</div>
            <input value={form.userAttr} onChange={e => setForm(p => ({...p, userAttr: e.target.value}))} placeholder="uid" style={inp} />
          </div>
        </div>

        <div>
          <div style={{ fontSize: 11, color: 'var(--fg-4)', marginBottom: 4 }}>Bind DN</div>
          <input value={form.bindDn} onChange={e => setForm(p => ({...p, bindDn: e.target.value}))} placeholder="cn=admin,dc=company,dc=com" style={inp} />
        </div>

        <div>
          <div style={{ fontSize: 11, color: 'var(--fg-4)', marginBottom: 4 }}>Bind Password {cfg?.hasPassword && '(already set)'}</div>
          <input type="password" value={form.bindPassword} onChange={e => setForm(p => ({...p, bindPassword: e.target.value}))} placeholder={cfg?.hasPassword ? '••••••••' : 'Password'} style={inp} />
        </div>

        <div>
          <div style={{ fontSize: 11, color: 'var(--fg-4)', marginBottom: 4 }}>Search Base</div>
          <input value={form.searchBase} onChange={e => setForm(p => ({...p, searchBase: e.target.value}))} placeholder="ou=users,dc=company,dc=com" style={inp} />
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button type="submit" disabled={saving} style={{ height: 30, padding: '0 15px', borderRadius: 4, border: 'none', background: 'var(--accent)', color: 'white', fontSize: 12.5, opacity: saving ? 0.6 : 1, cursor: 'default' }}>
            {saving ? 'Saving…' : 'Save Config'}
          </button>
          <button type="button" onClick={() => setShowTest(!showTest)} style={{ height: 30, padding: '0 12px', borderRadius: 4, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', fontSize: 12.5, cursor: 'default' }}>
            {showTest ? 'Hide Test' : 'Test Connection'}
          </button>
        </div>
      </form>

      {showTest && (
        <form onSubmit={handleTest} style={{ padding: 12, borderRadius: 6, border: '1px solid var(--accent-line)', background: 'var(--accent-dim)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-2)' }}>Test LDAP Authentication</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={testCreds.username} onChange={e => setTestCreds(p => ({...p, username: e.target.value}))} placeholder="LDAP Username" style={inp} />
            <input type="password" value={testCreds.password} onChange={e => setTestCreds(p => ({...p, password: e.target.value}))} placeholder="Password" style={inp} />
          </div>
          <button type="submit" disabled={testing || !testCreds.username || !testCreds.password} style={{ alignSelf: 'flex-end', height: 26, padding: '0 12px', borderRadius: 4, border: 'none', background: 'var(--accent)', color: 'white', fontSize: 11.5, opacity: testing ? 0.6 : 1, cursor: 'default' }}>
            {testing ? 'Testing…' : 'Test Bind'}
          </button>
        </form>
      )}
    </div>
  )
}
