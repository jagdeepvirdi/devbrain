import { Component, type ReactNode, type ErrorInfo } from 'react'

interface Props {
  children: ReactNode
  label?: string
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.label ?? 'unknown'}]`, error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 12,
          padding: 32, color: 'var(--fg-3)',
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#EF4444' }}>
            Something went wrong
          </div>
          <div style={{
            fontSize: 12, fontFamily: 'var(--font-mono)',
            background: 'var(--bg-elev)', border: '1px solid var(--line)',
            borderRadius: 6, padding: '8px 12px', maxWidth: 480,
            color: 'var(--fg-4)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {this.state.error.message}
          </div>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              padding: '5px 14px', borderRadius: 5,
              border: '1px solid var(--line-2)', background: 'var(--bg-elev)',
              color: 'var(--fg-2)', fontSize: 12.5, cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
