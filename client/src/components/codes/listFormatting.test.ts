import { describe, it, expect } from 'vitest'
import { EditorState, EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { toggleListPrefix, handleListEnter } from './listFormatting'

function makeView(doc: string, ranges: { anchor: number; head?: number }[]): EditorView {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.create(ranges.map(r => EditorSelection.range(r.anchor, r.head ?? r.anchor))),
  })
  const view = new EditorView({ state })
  document.body.appendChild(view.dom)
  return view
}

function text(view: EditorView): string {
  return view.state.doc.toString()
}

describe('toggleListPrefix', () => {
  it('inserts a bullet on the cursor line when nothing is selected', () => {
    const view = makeView('foo\nbar', [{ anchor: 0 }])
    toggleListPrefix(view, 'bullet')
    expect(text(view)).toBe('- foo\nbar')
  })

  it('applies bullets to every line touched by a multi-line selection', () => {
    const view = makeView('foo\nbar', [{ anchor: 0, head: 6 }])
    toggleListPrefix(view, 'bullet')
    expect(text(view)).toBe('- foo\n- bar')
  })

  it('strips the marker when every touched line already has it (toggle off)', () => {
    const view = makeView('- foo\n- bar', [{ anchor: 0, head: 11 }])
    toggleListPrefix(view, 'bullet')
    expect(text(view)).toBe('foo\nbar')
  })

  it('applies the marker instead of stripping when only some touched lines have it', () => {
    const view = makeView('foo\n- bar', [{ anchor: 0, head: 9 }])
    toggleListPrefix(view, 'bullet')
    expect(text(view)).toBe('- foo\n- bar')
  })

  it('switches bulleted lines to a sequentially-numbered list', () => {
    const view = makeView('- foo\n- bar', [{ anchor: 0, head: 11 }])
    toggleListPrefix(view, 'numbered')
    expect(text(view)).toBe('1. foo\n2. bar')
  })

  it('preserves indentation when toggling', () => {
    const view = makeView('  foo', [{ anchor: 2 }])
    toggleListPrefix(view, 'bullet')
    expect(text(view)).toBe('  - foo')
  })
})

describe('handleListEnter', () => {
  it('continues a bullet list onto the next line', () => {
    const view = makeView('- foo', [{ anchor: 5 }])
    const handled = handleListEnter(view)
    expect(handled).toBe(true)
    expect(text(view)).toBe('- foo\n- ')
    expect(view.state.selection.main.head).toBe(text(view).length)
  })

  it('increments the number when continuing a numbered list', () => {
    const view = makeView('1. foo', [{ anchor: 6 }])
    handleListEnter(view)
    expect(text(view)).toBe('1. foo\n2. ')
  })

  it('ends the list when Enter is pressed on an empty list item', () => {
    const view = makeView('- foo\n- ', [{ anchor: 8 }])
    const handled = handleListEnter(view)
    expect(handled).toBe(true)
    expect(text(view)).toBe('- foo\n')
    expect(view.state.selection.main.head).toBe(6)
  })

  it('leaves non-list lines alone and defers to the default Enter behavior', () => {
    const view = makeView('hello', [{ anchor: 5 }])
    const handled = handleListEnter(view)
    expect(handled).toBe(false)
    expect(text(view)).toBe('hello')
  })

  it('defers to the default Enter behavior for multi-line selections', () => {
    const view = makeView('- foo\n- bar', [{ anchor: 0, head: 11 }])
    const handled = handleListEnter(view)
    expect(handled).toBe(false)
    expect(text(view)).toBe('- foo\n- bar')
  })
})
