import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

type ToastType = 'success' | 'error' | 'info'
type ToastItem = { id: string; message: string; type: ToastType }
type ToastCtx  = { toast: (message: string, type?: ToastType) => void }

const ToastContext = createContext<ToastCtx>({ toast: () => {} })

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const toast = useCallback((message: string, type: ToastType = 'success') => {
    const id = Math.random().toString(36).slice(2)
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500)
  }, [])

  const BG: Record<ToastType, string> = {
    success: '#22C55E',
    error:   '#EF4444',
    info:    '#6366F1',
  }
  const BORDER: Record<ToastType, string> = {
    success: '#16A34A',
    error:   '#DC2626',
    info:    '#4F46E5',
  }

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div style={{
        position: 'fixed', bottom: 20, right: 20,
        display: 'flex', flexDirection: 'column', gap: 8,
        zIndex: 9999, pointerEvents: 'none',
      }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            padding: '9px 14px',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 500,
            color: '#fff',
            background: BG[t.type],
            border: `1px solid ${BORDER[t.type]}`,
            boxShadow: '0 4px 16px rgba(0,0,0,.45)',
            maxWidth: 340,
            pointerEvents: 'auto',
          }}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
