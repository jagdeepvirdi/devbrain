import { useState, useEffect } from 'react'
import { apiTokensApi, type ApiToken } from '../../lib/api'
import { useToast } from '../Toast'

export function ApiTokensSection() {
  const { toast } = useToast()
  const [tokens,   setTokens]   = useState<ApiToken[]>([])
  const [loading,  setLoading]  = useState(true)
  const [showAdd,  setShowAdd]  = useState(false)
  const [creating, setCreating] = useState(false)
  const [form,     setForm]     = useState({ name: '', expiresInDays: '' })
  const [justCreated, setJustCreated] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    apiTokensApi.list().then(setTokens).catch(() => {}).finally(() => setLoading(false))
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return
    setCreating(true)
    try {
      const days = form.expiresInDays.trim() ? Number(form.expiresInDays) : undefined
      const result = await apiTokensApi.create({ name: form.name.trim(), expiresInDays: days })
      setTokens(prev => [result, ...prev])
      setJustCreated(result.token)
      setCopied(false)
      setForm({ name: '', expiresInDays: '' })
      setShowAdd(false)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke(id: string, name: string) {
    if (!confirm(`Revoke token "${name}"? Anything using it will stop working immediately.`)) return
    try {
      await apiTokensApi.revoke(id)
      setTokens(prev => prev.filter(t => t.id !== id))
      toast('Token revoked')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  function copyToken() {
    if (!justCreated) return
    navigator.clipboard.writeText(justCreated).then(() => setCopied(true)).catch(() => {})
  }

  const inp: React.CSSProperties = { background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 5, padding: '5px 8px', color: 'var(--fg)', fontSize: 12.5, boxSizing: 'border-box', outline: 'none' }

  if (loading) return <div style={{ fontSize: 12, color: 'var(--fg-4)', padding: '4px 0' }}>Loading tokens…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--fg-4)' }}>
        Personal access tokens authenticate curl/script requests to the API without a browser session — e.g. <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>Authorization: Bearer dbrn_...</code>. They carry your account's role.
      </div>

      {justCreated && (
        <div style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid var(--accent-line)', background: 'var(--accent-dim)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--accent-2)' }}>Copy this token now — it won't be shown again</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <code style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--fg)', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 4, padding: '5px 8px', overflowX: 'auto', whiteSpace: 'nowrap' }}>
              {justCreated}
            </code>
            <button onClick={copyToken} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 4, border: '1px solid var(--accent)', background: copied ? 'var(--accent)' : 'none', color: copied ? 'white' : 'var(--accent-2)', cursor: 'default', whiteSpace: 'nowrap' }}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <button onClick={() => setJustCreated(null)} style={{ alignSelf: 'flex-start', fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', cursor: 'default' }}>
            Done
          </button>
        </div>
      )}

      {tokens.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {tokens.map(t => {
            const expired = t.expires_at ? new Date(t.expires_at) < new Date() : false
            return (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 6, border: '1px solid var(--line)', background: 'var(--bg)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--fg)' }}>{t.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                    {t.token_prefix}… · created {new Date(t.created_at).toLocaleDateString()}
                    {t.last_used_at && <> · last used {new Date(t.last_used_at).toLocaleDateString()}</>}
                    {t.expires_at && <> · {expired ? 'expired' : 'expires'} {new Date(t.expires_at).toLocaleDateString()}</>}
                  </div>
                </div>
                {expired && (
                  <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, border: '1px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.08)', color: '#EF4444', fontWeight: 600, textTransform: 'uppercase' }}>
                    Expired
                  </span>
                )}
                <button onClick={() => handleRevoke(t.id, t.name)} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 4, border: '1px solid rgba(239,68,68,.3)', background: 'none', color: '#EF4444', cursor: 'default' }}>
                  Revoke
                </button>
              </div>
            )
          })}
        </div>
      )}

      {showAdd ? (
        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px', borderRadius: 6, border: '1px solid var(--accent-line)', background: 'var(--accent-dim)' }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--accent-2)' }}>Generate Token</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. reembed script" style={{ ...inp, flex: 1 }} autoFocus />
            <input value={form.expiresInDays} onChange={e => setForm(p => ({ ...p, expiresInDays: e.target.value }))} placeholder="Expires in days (optional)" type="number" min={1} style={{ ...inp, width: 190 }} />
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="submit" disabled={creating || !form.name.trim()} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 4, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', cursor: 'default', opacity: creating ? 0.6 : 1 }}>
              {creating ? 'Generating…' : 'Generate'}
            </button>
            <button type="button" onClick={() => setShowAdd(false)} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 4, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', cursor: 'default' }}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button onClick={() => setShowAdd(true)} style={{ fontSize: 12, padding: '5px 12px', borderRadius: 5, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', cursor: 'default', alignSelf: 'flex-start' }}>
          + Generate token
        </button>
      )}
    </div>
  )
}
