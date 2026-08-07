import { useState, useEffect } from 'react'
import { settingsApi, type NotificationRules } from '../../lib/api'
import { useToast } from '../Toast'

export function NotificationRulesSection({ isAdmin }: { isAdmin: boolean }) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [rules, setRules] = useState<NotificationRules>({
    stale_threshold_days: 14,
    stale_issues_enabled: true,
    sync_alerts_enabled: true,
    ai_task_alerts_enabled: true
  })

  useEffect(() => {
    settingsApi.getNotificationRules()
      .then(r => setRules(r))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!isAdmin) return
    setSaving(true)
    try {
      const updated = await settingsApi.saveNotificationRules(rules)
      setRules(updated)
      toast('Notification rules saved')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div style={{ fontSize: 12, color: 'var(--fg-4)', padding: '4px 0' }}>Loading…</div>

  return (
    <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 4 }}>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--fg-3)', marginBottom: 6 }}>
          <span>Stale issue threshold</span>
          <span style={{ fontWeight: 600, color: 'var(--fg-2)' }}>{rules.stale_threshold_days} days</span>
        </div>
        <input
          type="range"
          min="1"
          max="30"
          value={rules.stale_threshold_days}
          disabled={!isAdmin}
          onChange={e => setRules(p => ({ ...p, stale_threshold_days: Number(e.target.value) }))}
          style={{ width: '100%', cursor: isAdmin ? 'pointer' : 'not-allowed' }}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            id="rule-stale-issues"
            checked={rules.stale_issues_enabled}
            disabled={!isAdmin}
            onChange={e => setRules(p => ({ ...p, stale_issues_enabled: e.target.checked }))}
            style={{ cursor: isAdmin ? 'pointer' : 'not-allowed' }}
          />
          <label htmlFor="rule-stale-issues" style={{ fontSize: 13, color: 'var(--fg-2)', cursor: isAdmin ? 'pointer' : 'default' }}>
            Stale issues alert
          </label>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            id="rule-sync-events"
            checked={rules.sync_alerts_enabled}
            disabled={!isAdmin}
            onChange={e => setRules(p => ({ ...p, sync_alerts_enabled: e.target.checked }))}
            style={{ cursor: isAdmin ? 'pointer' : 'not-allowed' }}
          />
          <label htmlFor="rule-sync-events" style={{ fontSize: 13, color: 'var(--fg-2)', cursor: isAdmin ? 'pointer' : 'default' }}>
            Sync events alert
          </label>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            id="rule-ai-tasks"
            checked={rules.ai_task_alerts_enabled}
            disabled={!isAdmin}
            onChange={e => setRules(p => ({ ...p, ai_task_alerts_enabled: e.target.checked }))}
            style={{ cursor: isAdmin ? 'pointer' : 'not-allowed' }}
          />
          <label htmlFor="rule-ai-tasks" style={{ fontSize: 13, color: 'var(--fg-2)', cursor: isAdmin ? 'pointer' : 'default' }}>
            AI task completion alert
          </label>
        </div>
      </div>

      {isAdmin && (
        <button
          type="submit"
          disabled={saving}
          style={{ height: 32, padding: '0 14px', borderRadius: 'var(--radius)', border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', fontSize: 12.5, opacity: saving ? 0.6 : 1, cursor: 'pointer', alignSelf: 'flex-start' }}
        >
          {saving ? 'Saving…' : 'Save Rules'}
        </button>
      )}
    </form>
  )
}
