import { EditorView, keymap } from '@codemirror/view'
import { Prec, type ChangeSpec, type Extension } from '@codemirror/state'

// Bullet/numbered-list editing for the Notes editor (CodeEditor + CodeEditorOverlay).
// Lists are plain markdown text (`- ` / `1. `) — no rich-list model, no rendering layer.

export type ListKind = 'bullet' | 'numbered'

const BULLET_RE   = /^(\s*)([-*+])(\s+)(.*)$/
const NUMBERED_RE = /^(\s*)(\d+)\.(\s+)(.*)$/

type LineMarker = { kind: ListKind; indent: string; content: string; num?: number }

function lineMarker(text: string): LineMarker | null {
  const bullet = BULLET_RE.exec(text)
  if (bullet) return { kind: 'bullet', indent: bullet[1], content: bullet[4] }
  const numbered = NUMBERED_RE.exec(text)
  if (numbered) return { kind: 'numbered', indent: numbered[1], content: numbered[4], num: Number(numbered[2]) }
  return null
}

function touchedLineNumbers(view: EditorView): number[] {
  const lines = new Set<number>()
  for (const range of view.state.selection.ranges) {
    const fromLine = view.state.doc.lineAt(range.from).number
    const toLine   = view.state.doc.lineAt(range.to).number
    for (let n = fromLine; n <= toLine; n++) lines.add(n)
  }
  return [...lines].sort((a, b) => a - b)
}

// Toggles a bullet/numbered marker on every line touched by the current selection (or just
// the cursor's line, if the selection is empty). If every touched line already carries the
// target kind's marker, strips it from all of them; otherwise applies it to all of them,
// renumbering sequentially from 1 in the numbered case.
export function toggleListPrefix(view: EditorView, kind: ListKind): void {
  const lines = touchedLineNumbers(view).map(n => view.state.doc.line(n))
  if (lines.length === 0) return

  const allMarked = lines.every(line => lineMarker(line.text)?.kind === kind)

  const changes: ChangeSpec[] = []
  let counter = 1
  for (const line of lines) {
    const marker = lineMarker(line.text)

    if (allMarked) {
      changes.push({ from: line.from, to: line.to, insert: marker!.indent + marker!.content })
      continue
    }

    const indent  = marker?.indent ?? (line.text.match(/^\s*/)?.[0] ?? '')
    const content = marker?.content ?? line.text.slice(indent.length)
    const prefix  = kind === 'bullet' ? '- ' : `${counter}. `
    if (kind === 'numbered') counter++
    changes.push({ from: line.from, to: line.to, insert: indent + prefix + content })
  }

  view.dispatch({ changes })
  view.focus()
}

// Exported (in addition to the keymap extension below) so it can be unit-tested directly
// against an EditorView, without simulating DOM keydown events.
export function handleListEnter(view: EditorView): boolean {
  const { state } = view
  if (state.selection.ranges.length !== 1 || !state.selection.main.empty) return false

  const line   = state.doc.lineAt(state.selection.main.head)
  const marker = lineMarker(line.text)
  if (!marker) return false

  if (marker.content.trim() === '') {
    // Enter on an empty list item ends the list, like Notion/Obsidian.
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: marker.indent },
      selection: { anchor: line.from + marker.indent.length },
    })
    return true
  }

  const nextMarker = marker.kind === 'bullet' ? '- ' : `${(marker.num ?? 0) + 1}. `
  view.dispatch(state.replaceSelection('\n' + marker.indent + nextMarker))
  return true
}

// Note-only Enter-key continuation. Highest precedence so it runs before the default
// insertNewlineAndIndent binding from CodeMirror's basicSetup; falls through to it
// (returns false) whenever the cursor isn't on a list line.
export const listEnterKeymap: Extension = Prec.highest(
  keymap.of([{ key: 'Enter', run: handleListEnter }])
)
