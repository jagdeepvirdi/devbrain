export function StepText({ text }: { text: string }) {
  const parts: React.ReactNode[] = []
  const re = /`([^`]+)`/g
  let last = 0, m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    parts.push(
      <code key={m.index} style={{
        fontFamily: 'var(--font-mono)', fontSize: 11.5,
        background: 'var(--bg-elev-2)', border: '1px solid var(--line)',
        padding: '1px 5px', borderRadius: 4,
      }}>{m[1]}</code>
    )
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}
