// @vitest-environment happy-dom
//
// The inline preview's wiring: which rows get one, what it says, and when it goes away.
//
// Where the chip LANDS is a question about the caret's geometry, and happy-dom lays
// nothing out — that half is asserted in `scripts/browser-check.mjs`, where a real
// renderer answers it. What is here is every decision around it: the suffix is computed
// from the same `applyCompletion` the accept uses, a fuzzy row has no suffix to show,
// and the preview never outlives the list.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEditor } from '../../src/dom/create.js'
import type { LiteArea } from '../../src/dom/editor.js'
import { defineGrammar } from '../../src/core/grammar.js'

/** A rectangle, in the shape the DOM reports one. */
function rect(top: number, bottom: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    bottom,
    left: 0,
    right: 400,
    width: 400,
    height: bottom - top,
    toJSON: () => ({}),
  } as DOMRect
}

/** Enough of a layout for the mirror and the caret measurement to answer. */
function measure(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => rect(100, 300))
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400)
}

/** A grammar offering two words, one of which the fixture document does not prefix. */
function grammar() {
  return defineGrammar({
    id: 'ghost-test',
    rules: [{ kind: 'match', scope: 'word', pattern: /[a-z]+/ }],
    compose: [
      {
        id: 'words',
        range: (context: { word: { from: number; to: number } }) => context.word,
        items: () => [
          { label: 'circle', append: ' ' },
          { label: 'rounded' },
        ],
      },
    ],
  })
}

/** Mount an editor over `value`, with the list opened at the caret. */
function mount(value: string, inline: boolean): LiteArea {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const editor = createEditor(host, {
    grammar: grammar(),
    value,
    completion: { inline },
  })
  editor.focus()
  editor.setSelection(value.length)
  editor.showCompletions()
  return editor
}

/** The preview element. */
function ghostOf(editor: LiteArea): HTMLElement | null {
  return editor.element.querySelector<HTMLElement>('.litearea-ghost')
}

/** Press a key on the field, as the browser would. */
function press(editor: LiteArea, key: string): void {
  editor.input.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  )
}

beforeEach(() => {
  measure()
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('the inline preview', () => {
  it('builds no element unless the option asks for one', () => {
    const editor = mount('cir', false)
    expect(ghostOf(editor)).toBeNull()
    editor.destroy()
  })

  it('previews the part of the active row that is not typed yet', () => {
    // `circle` plus its append, minus the `cir` already in the document.
    const editor = mount('cir', true)
    const ghost = ghostOf(editor)
    expect(ghost?.dataset.open).toBe('true')
    expect(ghost?.textContent).toBe('cle ')
    editor.destroy()
  })

  it('previews the whole insertion over an empty word', () => {
    const editor = mount('', true)
    expect(ghostOf(editor)?.textContent).toBe('circle ')
    editor.destroy()
  })

  it('shows nothing for a row whose insertion is not a suffix of what is typed', () => {
    // `rounded` matches `rd` fuzzily, so the row is offered — and there is no honest
    // suffix to draw, because the characters would not be appended in that order.
    const editor = mount('rd', true)
    expect(ghostOf(editor)?.dataset.open).toBe('false')
    editor.destroy()
  })

  it('takes the preview away when the caret leaves the range', () => {
    const editor = mount('cir', true)
    expect(ghostOf(editor)?.dataset.open).toBe('true')
    press(editor, 'Escape')
    expect(ghostOf(editor)?.dataset.open).toBe('false')
    expect(ghostOf(editor)?.textContent).toBe('')
    editor.destroy()
  })

  it('writes the position it was given, so the chip cannot drift from the caret', () => {
    const editor = mount('cir', true)
    const ghost = ghostOf(editor) as HTMLElement
    expect(ghost.style.left).toMatch(/px$/)
    expect(ghost.style.top).toMatch(/px$/)
    expect(Number.parseFloat(ghost.style.height)).toBeGreaterThan(0)
    editor.destroy()
  })

  it('takes the preview out of the document with the editor', () => {
    const editor = mount('cir', true)
    expect(document.querySelector('.litearea-ghost')).not.toBeNull()
    editor.destroy()
    expect(document.querySelector('.litearea-ghost')).toBeNull()
  })
})
