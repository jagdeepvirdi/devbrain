import { useState } from 'react'
import { authApi, type AuthUser } from '../lib/api'

export function LoginPage({ onLogin }: { onLogin: (user: AuthUser) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { user } = await authApi.login(username, password)
      onLogin(user)
    } catch (err) {
      setError((err as Error).message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const inp: React.CSSProperties = {
    width: '100%', padding: '8px 10px', boxSizing: 'border-box',
    background: 'var(--bg)', border: '1px solid var(--line-2)',
    borderRadius: 'var(--radius)', color: 'var(--fg)', fontSize: 13,
    outline: 'none', transition: 'border-color .15s',
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ width: 320, padding: '32px', background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 24px 64px rgba(0,0,0,.45)' }}>

        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
          <div style={{ width: 32, height: 32, background: 'var(--accent)', borderRadius: 8, display: 'grid', placeItems: 'center', boxShadow: '0 0 0 1px rgba(99,102,241,.25), 0 0 16px rgba(99,102,241,.35)' }}>
            <svg width="16" height="16" viewBox="0 0 12 12" fill="none">
              <rect x="1" y="1" width="4" height="4" rx="1" fill="white" fillOpacity=".9"/>
              <rect x="7" y="1" width="4" height="4" rx="1" fill="white" fillOpacity=".5"/>
              <rect x="1" y="7" width="4" height="4" rx="1" fill="white" fillOpacity=".5"/>
              <rect x="7" y="7" width="4" height="4" rx="1" fill="white" fillOpacity=".9"/>
            </svg>
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>
              <b style={{ color: 'var(--fg)' }}>Dev</b><span style={{ color: 'var(--fg-3)', fontWeight: 500 }}>Brain</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg-4)' }}>Knowledge Base</div>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--fg-3)', display: 'block', marginBottom: 6 }}>Username</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="username"
              autoFocus
              autoComplete="username"
              style={inp}
              onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
              onBlur={e  => (e.target.style.borderColor = 'var(--line-2)')}
            />
          </div>

          <div>
            <label style={{ fontSize: 12, color: 'var(--fg-3)', display: 'block', marginBottom: 6 }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="password"
              autoComplete="current-password"
              style={inp}
              onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
              onBlur={e  => (e.target.style.borderColor = 'var(--line-2)')}
            />
          </div>

          {error && (
            <div style={{ fontSize: 12, color: '#F8A8A8', padding: '7px 10px', background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)', borderRadius: 4 }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            style={{ width: '100%', height: 34, marginTop: 4, background: 'var(--accent)', color: 'white', border: 'none', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 600, cursor: 'default', opacity: loading || !password ? 0.55 : 1, boxShadow: '0 0 0 1px rgba(99,102,241,.3), 0 0 18px rgba(99,102,241,.2)' }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
