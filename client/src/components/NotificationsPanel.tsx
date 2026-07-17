import React, { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { notificationsApi, type Notification } from '../lib/api'
import { useProjectStore } from '../store/projectStore'

interface NotificationsPanelProps {
  open: boolean
  onClose: () => void
  onUnreadCountChange: (count: number) => void
  onNavigate: (route: 'issues' | 'projects') => void
}

export function NotificationsPanel({ open, onClose, onUnreadCountChange, onNavigate }: NotificationsPanelProps) {
  const [, setSearchParams] = useSearchParams()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(false)
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'default'
  )
  const [showPrompt, setShowPrompt] = useState(() => {
    return typeof window !== 'undefined' && !localStorage.getItem('devbrain:notifications-prompted')
  })

  // Fetch notifications list
  const fetchNotifications = async () => {
    try {
      setLoading(true)
      const res = await notificationsApi.list(100, 0)
      setNotifications(res.items)
      onUnreadCountChange(res.unread_count)
    } catch (err) {
      console.error('Failed to load notifications:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      fetchNotifications()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Periodic polling for badge count when panel is closed
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await notificationsApi.list(10, 0)
        onUnreadCountChange(res.unread_count)

        // If permission is granted and there are new unread notifications that we haven't seen, trigger browser notification
        if (permission === 'granted' && res.unread_count > 0) {
          // Find if there are unread notifications in the fresh batch that are very recent
          const now = Date.now()
          const freshUnread = res.items.filter(
            item => !item.read && (now - new Date(item.created_at).getTime()) < 10000 // created in the last 10s
          )

          for (const item of freshUnread) {
            new window.Notification(item.title, {
              body: item.body,
              tag: item.id
            })
          }
        }
      } catch {
        // ignore errors on background fetch
      }
    }, 30000) // Poll every 30s

    return () => clearInterval(interval)
  }, [onUnreadCountChange, permission])

  const handleRequestPermission = async () => {
    if ('Notification' in window) {
      const perm = await Notification.requestPermission()
      setPermission(perm)
      localStorage.setItem('devbrain:notifications-prompted', 'true')
      setShowPrompt(false)
    }
  }

  const handleDismissPrompt = () => {
    localStorage.setItem('devbrain:notifications-prompted', 'true')
    setShowPrompt(false)
  }

  const handleMarkRead = async (id: string) => {
    try {
      await notificationsApi.markRead(id)
      // Update local state
      setNotifications(prev =>
        prev.map(item => (item.id === id ? { ...item, read: true } : item))
      )
      // Refetch stats/count
      const res = await notificationsApi.list(10, 0)
      onUnreadCountChange(res.unread_count)
    } catch (err) {
      console.error('Failed to mark read:', err)
    }
  }

  const handleMarkAllRead = async () => {
    try {
      await notificationsApi.markAllRead()
      setNotifications(prev => prev.map(item => ({ ...item, read: true })))
      onUnreadCountChange(0)
    } catch (err) {
      console.error('Failed to mark all read:', err)
    }
  }

  const handleItemClick = async (item: Notification) => {
    // Mark read
    if (!item.read) {
      await handleMarkRead(item.id)
    }

    // Navigate to entity
    if (item.entity_type === 'issue' && item.entity_id) {
      setSearchParams({ open: item.entity_id }, { replace: true })
      onNavigate('issues')
      onClose()
    } else if (item.entity_type === 'project' && item.entity_id) {
      useProjectStore.getState().setSelectedId(item.entity_id)
      onNavigate('projects')
      onClose()
    }
  }

  const getRelativeTime = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffSec = Math.floor(diffMs / 1000)
    const diffMin = Math.floor(diffSec / 60)
    const diffHr = Math.floor(diffMin / 60)
    const diffDays = Math.floor(diffHr / 24)

    if (diffSec < 60) return 'just now'
    if (diffMin < 60) return `${diffMin}m ago`
    if (diffHr < 24) return `${diffHr}h ago`
    if (diffDays === 1) return 'yesterday'
    return `${diffDays}d ago`
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'stale_issue':
        return '⚠️'
      case 'sync_complete':
        return '🔄'
      case 'ai_task_done':
        return '✦'
      default:
        return '🔔'
    }
  }

  const getTypeStyle = (type: string): React.CSSProperties => {
    const base: React.CSSProperties = {
      width: 28, height: 28, borderRadius: '50%',
      display: 'grid', placeItems: 'center', fontSize: 13, flexShrink: 0
    }
    switch (type) {
      case 'stale_issue':
        return { ...base, background: 'rgba(239, 68, 68, 0.08)', color: '#EF4444', border: '1px solid rgba(239, 68, 68, 0.15)' }
      case 'sync_complete':
        return { ...base, background: 'rgba(59, 130, 246, 0.08)', color: '#3B82F6', border: '1px solid rgba(59, 130, 246, 0.15)' }
      case 'ai_task_done':
        return { ...base, background: 'rgba(139, 92, 246, 0.08)', color: '#8B5CF6', border: '1px solid rgba(139, 92, 246, 0.15)' }
      default:
        return { ...base, background: 'rgba(255, 255, 255, 0.05)', color: 'var(--fg-3)', border: '1px solid var(--line-2)' }
    }
  }

  // Grouping
  const todayNotifications: Notification[] = []
  const earlierNotifications: Notification[] = []

  const todayDate = new Date()
  notifications.forEach(item => {
    const itemDate = new Date(item.created_at)
    const isToday =
      itemDate.getDate() === todayDate.getDate() &&
      itemDate.getMonth() === todayDate.getMonth() &&
      itemDate.getFullYear() === todayDate.getFullYear()

    if (isToday) {
      todayNotifications.push(item)
    } else {
      earlierNotifications.push(item)
    }
  })

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.3)', backdropFilter: 'blur(4px)',
          zIndex: 100, transition: 'opacity 0.2s ease-in-out'
        }}
      />

      {/* Slide-in Panel */}
      <div
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: '380px', maxWidth: '100%',
          background: 'var(--panel, #1E1E24)',
          borderLeft: '1px solid var(--line, rgba(255,255,255,0.08))',
          boxShadow: '-8px 0 32px rgba(0, 0, 0, 0.4)',
          zIndex: 101, display: 'flex', flexDirection: 'column',
          animation: 'slideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
        }}
      >
        <style dangerouslySetInnerHTML={{ __html: `
          @keyframes slideIn {
            from { transform: translateX(100%); }
            to { transform: translateX(0); }
          }
        `}} />

        {/* Panel Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid var(--line)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between'
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--fg)' }}>Notifications</h2>
            <div style={{ fontSize: '12px', color: 'var(--fg-4)', marginTop: 2 }}>
              {notifications.filter(n => !n.read).length} unread
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {notifications.some(n => !n.read) && (
              <button
                onClick={handleMarkAllRead}
                style={{
                  background: 'none', border: 'none', color: 'var(--accent, #6366F1)',
                  fontSize: '12px', fontWeight: 500, cursor: 'pointer', padding: '4px 8px',
                  borderRadius: 4, transition: 'background 0.2s'
                }}
                onMouseOver={e => (e.currentTarget.style.background = 'rgba(99, 102, 241, 0.08)')}
                onMouseOut={e => (e.currentTarget.style.background = 'none')}
              >
                Mark all read
              </button>
            )}
            <button
              onClick={onClose}
              style={{
                background: 'none', border: 'none', color: 'var(--fg-3)',
                fontSize: '18px', cursor: 'pointer', width: 28, height: 28,
                borderRadius: '50%', display: 'grid', placeItems: 'center'
              }}
              onMouseOver={e => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)')}
              onMouseOut={e => (e.currentTarget.style.background = 'none')}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Browser Notification Opt-in Prompt */}
        {showPrompt && permission === 'default' && (
          <div style={{
            background: 'var(--accent-dim, rgba(99, 102, 241, 0.08))',
            borderBottom: '1px solid var(--accent-line, rgba(99, 102, 241, 0.15))',
            padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 8
          }}>
            <div style={{ fontSize: '12.5px', color: 'var(--fg-2)', lineHeight: 1.4 }}>
              Enable browser notifications to stay alerted in real-time when issues go stale or AI tasks complete.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleRequestPermission}
                style={{
                  background: 'var(--accent, #6366F1)', color: 'white', border: 'none',
                  borderRadius: 4, padding: '4px 12px', fontSize: '12px', fontWeight: 500,
                  cursor: 'pointer'
                }}
              >
                Enable
              </button>
              <button
                onClick={handleDismissPrompt}
                style={{
                  background: 'none', border: '1px solid var(--line-2)', color: 'var(--fg-3)',
                  borderRadius: 4, padding: '4px 12px', fontSize: '12px', fontWeight: 500,
                  cursor: 'pointer'
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Panel Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 0' }}>
          {loading && notifications.length === 0 ? (
            <div style={{ display: 'grid', placeItems: 'center', height: '100px', fontSize: 13, color: 'var(--fg-4)' }}>
              Loading notifications…
            </div>
          ) : notifications.length === 0 ? (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              height: '80%', color: 'var(--fg-4)', gap: 8, padding: 24, textAlign: 'center'
            }}>
              <span style={{ fontSize: '28px' }}>🔔</span>
              <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--fg-3)' }}>All caught up!</div>
              <div style={{ fontSize: '12px' }}>You have no new notifications.</div>
            </div>
          ) : (
            <>
              {/* Today */}
              {todayNotifications.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <h3 style={{
                    fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.06em',
                    color: 'var(--fg-4)', margin: '0 20px 8px 20px', fontWeight: 600
                  }}>Today</h3>
                  {todayNotifications.map(item => renderNotificationItem(item))}
                </div>
              )}

              {/* Earlier */}
              {earlierNotifications.length > 0 && (
                <div>
                  <h3 style={{
                    fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.06em',
                    color: 'var(--fg-4)', margin: '0 20px 8px 20px', fontWeight: 600
                  }}>Earlier</h3>
                  {earlierNotifications.map(item => renderNotificationItem(item))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )

  function renderNotificationItem(item: Notification) {
    const isClickable = (item.entity_type === 'issue' || item.entity_type === 'project') && item.entity_id

    return (
      <div
        key={item.id}
        onClick={() => handleItemClick(item)}
        style={{
          display: 'flex', gap: 12, padding: '12px 20px',
          borderBottom: '1px solid var(--line, rgba(255,255,255,0.04))',
          background: item.read ? 'transparent' : 'rgba(99, 102, 241, 0.02)',
          cursor: isClickable ? 'pointer' : 'default',
          transition: 'background 0.2s', position: 'relative'
        }}
        onMouseOver={e => {
          if (isClickable) e.currentTarget.style.background = 'rgba(255,255,255,0.02)'
        }}
        onMouseOut={e => {
          e.currentTarget.style.background = item.read ? 'transparent' : 'rgba(99, 102, 241, 0.02)'
        }}
      >
        {/* Unread blue dot */}
        {!item.read && (
          <span style={{
            position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)',
            width: 6, height: 6, borderRadius: '50%', background: 'var(--accent, #6366F1)'
          }} />
        )}

        {/* Type Icon */}
        <div style={getTypeStyle(item.type)}>
          {getTypeIcon(item.type)}
        </div>

        {/* Text Details */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: '13px', fontWeight: item.read ? 500 : 600,
            color: 'var(--fg-2)', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8
          }}>
            <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
              {item.title}
            </span>
            <span style={{ fontSize: '11px', color: 'var(--fg-4)', fontWeight: 400, flexShrink: 0 }}>
              {getRelativeTime(item.created_at)}
            </span>
          </div>

          <div style={{ fontSize: '12px', color: 'var(--fg-3)', marginTop: 4, lineHeight: 1.35 }}>
            {item.body}
          </div>

          {isClickable && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: '11px', color: 'var(--accent, #6366F1)', marginTop: 6, fontWeight: 500
            }}>
              View {item.entity_type} →
            </span>
          )}
        </div>
      </div>
    )
  }
}
