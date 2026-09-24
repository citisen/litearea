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

/**
 * A painted line, for the tests that need the preview to read the paint.
 *
 * The glyph box is deliberately SHORTER than the line: that is the whole bug this stubs,
 * since a font's content box is not the line box it sits in.
 */
function measurePaint(glyph: { top: number; bottom: number; left: number; right: number }): void {
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(
    () =>
      ({
        x: glyph.left,
        y: glyph.top,
        top: glyph.top,
        bottom: glyph.bottom,
        left: glyph.left,
        right: glyph.right,
        width: glyph.right - glyph.left,
        height: glyph.bottom - glyph.top,
        toJSON: () => ({}),
      }) as DOMRect,
  )
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

  it('sits on the painted LINE, not on the font’s box', () => {
    // The report this test exists for: the preview looked one or two pixels low. The chip
    // was placed from the mirror — the field's predicted caret — while the text it has to
    // continue is painted by a different element, and the two disagree by a pixel. It was
    // also given the glyph box's height (15) instead of the line's (20), so its background
    // was short as well as low.
    //
    // The paint is 20px lines of 16px glyphs whose box starts at 110, inside a box whose
    // top is 100 and whose 1px border puts its PADDING box — what an absolutely
    // positioned child is offset from — at 101. So the line box begins at 108 and the
    // chip belongs at 7px, not 8: that pixel is the border, and forgetting it is the same
    // bug in the other direction.
    measurePaint({ top: 110, bottom: 126, left: 40, right: 60 })
    const editor = mount('cir', true)
    const ghost = ghostOf(editor) as HTMLElement
    expect(ghost.dataset.open).toBe('true')
    expect(ghost.style.top).toBe('7px')
    expect(ghost.style.height).toBe('20px')
    // The x is where the glyph AFTER the caret begins, which is the right edge of the
    // painted prefix, not its left.
    expect(ghost.style.left).toBe('59px')
    editor.destroy()
  })

  it('falls back to the field’s caret when the line has nothing painted', () => {
    // A line with no glyphs has no box to read, and the preview must still appear: the
    // mirror's prediction is the only measurement there is. This stubs empty ranges, so
    // the fallback is what puts the chip at the field's own content edge rather than on a
    // painted line — and the height is the line height either way.
    vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ height: 0, width: 0, top: 0, bottom: 0, left: 0, right: 0, toJSON: () => ({}) }) as DOMRect,
    )
    const editor = mount('cir', true)
    const ghost = ghostOf(editor) as HTMLElement
    expect(ghost.dataset.open).toBe('true')
    expect(ghost.style.top).toBe('-1px')
    expect(ghost.style.height).toBe('20px')
    editor.destroy()
  })

  it('takes the preview out of the document with the editor', () => {
    const editor = mount('cir', true)
    expect(document.querySelector('.litearea-ghost')).not.toBeNull()
    editor.destroy()
    expect(document.querySelector('.litearea-ghost')).toBeNull()
  })
})
