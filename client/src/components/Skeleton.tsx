const keyframes = `
@keyframes skeleton-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: .4; }
}
`

let injected = false
function injectStyles() {
  if (injected || typeof document === 'undefined') return
  injected = true
  const s = document.createElement('style')
  s.textContent = keyframes
  document.head.appendChild(s)
}

export function SkeletonBar({
  width = '100%',
  height = 12,
  radius = 4,
}: {
  width?: string | number
  height?: number
  radius?: number
}) {
  injectStyles()
  return (
    <div style={{
      width, height, borderRadius: radius,
      background: 'var(--bg-elev-2)',
      border: '1px solid var(--line)',
      animation: 'skeleton-pulse 1.4s ease-in-out infinite',
    }} />
  )
}

export function SkeletonRow({ cols }: { cols?: number[] }) {
  const widths = cols ?? [40, 200, 100, 80]
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 20px', borderBottom: '1px solid var(--line)',
    }}>
      {widths.map((w, i) => (
        <SkeletonBar key={i} width={w} height={11} />
      ))}
      <SkeletonBar width={60} height={11} />
    </div>
  )
}
