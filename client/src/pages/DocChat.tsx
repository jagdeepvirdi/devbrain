import { useState, useRef, useEffect, useCallback } from 'react'
import { useProjectStore } from '../store/projectStore'
import { documentsApi, chatStream } from '../lib/api'
import type { DocMeta, ChatCitation, ChatScope } from '../lib/api'

// ── Types ─────────────────────────────────────────────────────────────────

type Message =
  | { role: 'user'; text: string }
  | { role: 'ai'; text: string; citations: ChatCitation[]; streaming: boolean }

// ── Markdown renderer (inline only, no dependencies) ─────────────────────

function renderMarkdownLite(text: string): React.ReactNode[] {
  return text.split('\n\n').map((block, bi) => {
    // Ordered list
    if (/^\d+\.\s/.test(block)) {
      const items = block.split('\n').filter(l => /^\d+\.\s/.test(l))
      return (
        <ol key={bi} style={{ margin: '6px 0 6px 18px', padding: 0 }}>
          {items.map((item, ii) => (
            <li key={ii} style={{ marginBottom: 2 }}
              dangerouslySetInnerHTML={{ __html: inlineMd(item.replace(/^\d+\.\s/, '')) }} />
          ))}
        </ol>
      )
    }
    // Unordered list
    if (/^[-*]\s/.test(block)) {
      const items = block.split('\n').filter(l => /^[-*]\s/.test(l))
      return (
        <ul key={bi} style={{ margin: '6px 0 6px 18px', padding: 0 }}>
          {items.map((item, ii) => (
            <li key={ii} style={{ marginBottom: 2 }}
              dangerouslySetInnerHTML={{ __html: inlineMd(item.replace(/^[-*]\s/, '')) }} />
          ))}
        </ul>
      )
    }
    // Heading
    if (/^#{1,3}\s/.test(block)) {
      const level = (block.match(/^#+/) ?? [''])[0].length
      const content = block.replace(/^#+\s/, '')
      const sizes = ['14px', '13px', '12.5px']
      return (
        <p key={bi} style={{ margin: '8px 0 4px', fontWeight: 600, fontSize: sizes[level - 1] ?? '13px' }}
          dangerouslySetInnerHTML={{ __html: inlineMd(content) }} />
      )
    }
    // Code block
    if (block.startsWith('```')) {
      const lines  = block.split('\n')
      const code   = lines.slice(1, lines[lines.length - 1] === '```' ? -1 : undefined).join('\n')
      return (
        <pre key={bi} style={{
          margin: '6px 0', padding: '8px 10px',
          background: 'var(--bg)', border: '1px solid var(--line)',
          borderRadius: 4, overflowX: 'auto',
          fontSize: '11.5px', fontFamily: 'var(--font-mono)', lineHeight: 1.55,
          color: 'var(--fg-2)',
        }}>
          <code>{code}</code>
        </pre>
      )
    }
    // Paragraph
    return (
      <p key={bi} style={{ margin: '4px 0', lineHeight: 1.6 }}
        dangerouslySetInnerHTML={{ __html: inlineMd(block) }} />
    )
  })
}

function inlineMd(text: string): string {
  return text
    .replace(/`([^`]+)`/g,   '<code style="background:var(--bg);padding:1px 4px;border-radius:3px;font-family:var(--font-mono);font-size:11px">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g,     '<em>$1</em>')
    .replace(/\[(\d+)\]/g,       '<span style="color:var(--accent-2);font-size:11px;font-weight:600">[$1]</span>')
}

// ── Sub-components ────────────────────────────────────────────────────────

function CitationCard({ c }: { c: ChatCitation }) {
  return (
    <details style={{
      marginTop: 6, borderRadius: 5,
      border: '1px solid var(--line)', background: 'var(--bg-elev)',
      fontSize: '12px',
    }}>
      <summary style={{
        padding: '5px 10px', cursor: 'default', listStyle: 'none',
        display: 'flex', alignItems: 'center', gap: 8, color: 'var(--fg-2)',
        userSelect: 'none',
      }}>
        <span style={{
          minWidth: 18, height: 18, borderRadius: 99,
          background: 'var(--accent)', color: 'white',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '10px', fontWeight: 700, flexShrink: 0,
        }}>
          {c.index}
        </span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {c.documentTitle}
        </span>
        <span style={{ color: 'var(--fg-4)', fontFamily: 'var(--font-mono)', fontSize: '10.5px', flexShrink: 0 }}>
          §{c.chunkIndex} · {Math.round(c.score * 100)}%
        </span>
      </summary>
      <div style={{
        padding: '8px 10px', borderTop: '1px solid var(--line)',
        color: 'var(--fg-3)', lineHeight: 1.55, whiteSpace: 'pre-wrap',
        fontFamily: 'var(--font-mono)', fontSize: '11.5px',
      }}>
        {c.excerpt}
      </div>
    </details>
  )
}

function AiMessage({ msg }: { msg: Extract<Message, { role: 'ai' }> }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 8,
        maxWidth: '88%',
      }}>
        <span style={{
          width: 20, height: 20, borderRadius: 99, flexShrink: 0, marginTop: 2,
          background: 'var(--accent)', color: 'white',
          display: 'grid', placeItems: 'center', fontSize: '10px', fontWeight: 700,
        }}>◆</span>
        <div style={{
          background: 'var(--bg-elev)', border: '1px solid var(--line)',
          borderRadius: '0 8px 8px 8px', padding: '10px 14px',
          fontSize: '13px', color: 'var(--fg)', lineHeight: 1.6,
        }}>
          {msg.text
            ? renderMarkdownLite(msg.text)
            : <span style={{ color: 'var(--fg-4)' }}>…</span>
          }
          {msg.streaming && (
            <span style={{
              display: 'inline-block', width: 7, height: 13, marginLeft: 2,
              background: 'var(--accent-2)', borderRadius: 1, verticalAlign: 'text-bottom',
              animation: 'cursor-blink 1s step-end infinite',
            }} />
          )}
        </div>
      </div>
      {msg.citations.length > 0 && !msg.streaming && (
        <div style={{ paddingLeft: 28, width: '88%' }}>
          {msg.citations.map(c => <CitationCard key={c.index} c={c} />)}
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────

export function DocChatPage() {
  const { selectedProject } = useProjectStore()
  const project = selectedProject()

  const [docs,       setDocs]       = useState<DocMeta[]>([])
  const [loadingDocs,setLoadingDocs] = useState(true)
  const [messages,   setMessages]   = useState<Message[]>([])
  const [input,      setInput]      = useState('')
  const [busy,       setBusy]       = useState(false)
  const [scope,      setScope]      = useState<ChatScope>('all')
  const [activeDoc,  setActiveDoc]  = useState<DocMeta | null>(null)

  const endRef      = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Load documents scoped to project (or all if no project selected)
  const loadDocs = useCallback(async () => {
    setLoadingDocs(true)
    try {
      const data = await documentsApi.list(project ? { projectId: project.id } : undefined)
      setDocs(data.items)
    } catch {
      setDocs([])
    } finally {
      setLoadingDocs(false)
    }
  }, [project])

  useEffect(() => { loadDocs() }, [loadDocs])

  // Auto-scroll to latest message
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Reset scope when active doc cleared
  useEffect(() => {
    if (!activeDoc && scope === 'document') setScope('all')
  }, [activeDoc, scope])

  function appendChunk(text: string) {
    setMessages(prev => {
      const last = prev[prev.length - 1]
      if (!last || last.role !== 'ai') return prev
      return [...prev.slice(0, -1), { ...last, text: last.text + text }]
    })
  }

  function finishStreaming() {
    setMessages(prev => {
      const last = prev[prev.length - 1]
      if (!last || last.role !== 'ai') return prev
      return [...prev.slice(0, -1), { ...last, streaming: false }]
    })
  }

  function setCitations(citations: ChatCitation[]) {
    setMessages(prev => {
      const last = prev[prev.length - 1]
      if (!last || last.role !== 'ai') return prev
      return [...prev.slice(0, -1), { ...last, citations }]
    })
  }

  async function send() {
    const q = input.trim()
    if (!q || busy) return

    setInput('')
    setBusy(true)

    const userMsg: Message = { role: 'user', text: q }
    const aiMsg: Message   = { role: 'ai', text: '', citations: [], streaming: true }
    setMessages(prev => [...prev, userMsg, aiMsg])

    try {
      await chatStream(
        q,
        scope,
        project?.id ?? null,
        activeDoc?.id ?? null,
        setCitations,
        appendChunk,
      )
    } catch (err) {
      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (!last || last.role !== 'ai') return prev
        return [...prev.slice(0, -1), {
          ...last,
          text: `Error: ${(err as Error).message}`,
          streaming: false,
        }]
      })
    } finally {
      finishStreaming()
      setBusy(false)
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const scopeLabel: Record<ChatScope, string> = {
    all:      'All docs',
    project:  project ? project.name : 'All docs',
    document: activeDoc?.title ?? 'This doc',
  }

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      {/* ── Document list panel ────────────────────────────────────────── */}
      <div style={{
        width: 260, flexShrink: 0, borderRight: '1px solid var(--line)',
        background: 'var(--panel)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Panel header */}
        <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
            Documents
          </div>
          {project && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: project.color, flexShrink: 0 }} />
              <span style={{ fontSize: '12px', color: 'var(--fg-3)' }}>{project.name}</span>
            </div>
          )}
        </div>

        {/* Doc list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 6px' }}>
          {loadingDocs ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--fg-4)', fontSize: '12px' }}>
              Loading…
            </div>
          ) : docs.length === 0 ? (
            <div style={{ padding: '20px 12px', textAlign: 'center', color: 'var(--fg-4)', fontSize: '12px', lineHeight: 1.6 }}>
              No documents yet.<br />
              Upload some in the Documents tab.
            </div>
          ) : (
            docs.map(doc => {
              const active = activeDoc?.id === doc.id
              return (
                <button
                  key={doc.id}
                  onClick={() => {
                    setActiveDoc(active ? null : doc)
                    if (!active) setScope('document')
                  }}
                  style={{
                    width: '100%', textAlign: 'left', padding: '7px 8px',
                    borderRadius: 'var(--radius)', marginBottom: 1,
                    background: active ? 'var(--bg-elev-2)' : 'transparent',
                    boxShadow: active ? 'inset 0 0 0 1px var(--accent)' : 'none',
                    display: 'flex', flexDirection: 'column', gap: 2,
                    cursor: 'default',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: '11px', color: 'var(--fg-4)', flexShrink: 0 }}>
                      {FILE_ICONS[doc.file_type] ?? '📄'}
                    </span>
                    <span style={{
                      fontSize: '12.5px', color: active ? 'var(--fg)' : 'var(--fg-2)',
                      fontWeight: active ? 500 : 400,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {doc.title}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, paddingLeft: 17 }}>
                    <span style={{ fontSize: '10.5px', color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>
                      {doc.chunk_count} chunk{doc.chunk_count !== 1 ? 's' : ''}
                    </span>
                    {doc.project_name && !project && (
                      <span style={{ fontSize: '10.5px', color: doc.project_color ?? 'var(--fg-4)' }}>
                        {doc.project_name}
                      </span>
                    )}
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* ── Chat area ─────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

        {/* Scope bar */}
        <div style={{
          padding: '8px 16px', borderBottom: '1px solid var(--line)',
          display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
          background: 'var(--bg-elev)',
        }}>
          <span style={{ fontSize: '11.5px', color: 'var(--fg-3)', flexShrink: 0 }}>Scope:</span>
          <div style={{ display: 'flex', gap: 3, background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 5, padding: 2 }}>
            {(['all', 'project', 'document'] as ChatScope[]).map(s => {
              const disabled = (s === 'project' && !project) || (s === 'document' && !activeDoc)
              return (
                <button
                  key={s}
                  onClick={() => !disabled && setScope(s)}
                  disabled={disabled}
                  style={{
                    padding: '3px 10px', borderRadius: 4, fontSize: '11.5px',
                    background: scope === s ? 'var(--accent)' : 'transparent',
                    color: scope === s ? 'white' : disabled ? 'var(--fg-4)' : 'var(--fg-2)',
                    cursor: disabled ? 'not-allowed' : 'default',
                    opacity: disabled ? 0.5 : 1,
                    transition: 'background .1s',
                  }}
                >
                  {scopeLabel[s]}
                </button>
              )
            })}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              fontSize: '10.5px', color: 'var(--fg-4)',
              background: 'var(--bg-elev-2)', border: '1px solid var(--line)',
              padding: '2px 8px', borderRadius: 99, fontFamily: 'var(--font-mono)',
            }}>
              ⚡ local
            </span>
            {messages.length > 0 && (
              <button
                onClick={() => setMessages([])}
                style={{ fontSize: '11px', color: 'var(--fg-4)', padding: '2px 6px', borderRadius: 4, cursor: 'default' }}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {messages.length === 0 && (
            <EmptyState docs={docs} loadingDocs={loadingDocs} />
          )}
          {messages.map((msg, i) => (
            msg.role === 'user' ? (
              <div key={i} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{
                  maxWidth: '80%', background: 'var(--accent)', color: 'white',
                  borderRadius: '8px 0 8px 8px', padding: '9px 14px',
                  fontSize: '13px', lineHeight: 1.55, whiteSpace: 'pre-wrap',
                }}>
                  {msg.text}
                </div>
              </div>
            ) : (
              <AiMessage key={i} msg={msg} />
            )
          ))}
          <div ref={endRef} />
        </div>

        {/* Composer */}
        <div style={{
          padding: '10px 14px 12px', borderTop: '1px solid var(--line)',
          background: 'var(--bg-elev)', flexShrink: 0,
        }}>
          <div style={{
            display: 'flex', gap: 8, alignItems: 'flex-end',
            background: 'var(--bg)', border: '1px solid var(--line-2)',
            borderRadius: 8, padding: '8px 10px',
          }}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Ask about ${scope === 'document' && activeDoc ? `"${activeDoc.title}"` : scope === 'project' && project ? `${project.name} docs` : 'your documents'}…`}
              rows={1}
              disabled={busy}
              style={{
                flex: 1, resize: 'none', background: 'transparent', border: 'none',
                outline: 'none', color: 'var(--fg)', fontSize: '13px', lineHeight: 1.55,
                fontFamily: 'inherit', maxHeight: 120, overflowY: 'auto',
                opacity: busy ? 0.6 : 1,
              }}
            />
            <button
              onClick={send}
              disabled={!input.trim() || busy}
              style={{
                width: 30, height: 30, borderRadius: 6, flexShrink: 0,
                background: !input.trim() || busy ? 'var(--bg-elev-2)' : 'var(--accent)',
                color: !input.trim() || busy ? 'var(--fg-4)' : 'white',
                display: 'grid', placeItems: 'center', fontSize: '13px',
                cursor: !input.trim() || busy ? 'not-allowed' : 'default',
                transition: 'background .1s, color .1s',
              }}
            >
              {busy ? '⏹' : '↑'}
            </button>
          </div>
          <div style={{ marginTop: 5, fontSize: '10.5px', color: 'var(--fg-4)', textAlign: 'center' }}>
            Enter to send · Shift+Enter for newline · Powered by Ollama (local)
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────

function EmptyState({ docs, loadingDocs }: { docs: DocMeta[]; loadingDocs: boolean }) {
  if (loadingDocs) return null
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 12, color: 'var(--fg-3)', padding: '40px 24px',
    }}>
      <div style={{
        width: 48, height: 48, borderRadius: 12,
        background: 'var(--accent-dim)', border: '1px solid var(--accent-line)',
        display: 'grid', placeItems: 'center', fontSize: '22px', color: 'var(--accent-2)',
      }}>
        ◆
      </div>
      <div style={{ textAlign: 'center' }}>
        <p style={{ margin: '0 0 4px', fontSize: '14px', color: 'var(--fg-2)', fontWeight: 500 }}>Ask your documents anything</p>
        <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--fg-3)', lineHeight: 1.6 }}>
          {docs.length === 0
            ? 'Upload documents first, then ask questions about them.'
            : `${docs.length} document${docs.length !== 1 ? 's' : ''} ready. Select a scope and ask away.`}
        </p>
      </div>
      {docs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', maxWidth: 380 }}>
          {EXAMPLE_QUESTIONS.map((q, i) => (
            <div key={i} style={{
              padding: '7px 12px', borderRadius: 6,
              border: '1px solid var(--line)', background: 'var(--bg-elev)',
              fontSize: '12.5px', color: 'var(--fg-3)',
              fontStyle: 'italic',
            }}>
              "{q}"
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const EXAMPLE_QUESTIONS = [
  'What are the key setup steps for this project?',
  'Summarize the main architecture decisions.',
  'What dependencies does this project use?',
]

const FILE_ICONS: Record<string, string> = {
  pdf:  '📕',
  docx: '📘',
  md:   '📝',
  txt:  '📄',
  xlsx: '📊',
  url:  '🔗',
}
