// @vitest-environment happy-dom
//
// The mirror's caret box, and the one thing about it that is easy to get wrong: it is the
// caret's LINE box, not the marker's own box.
//
// This test exists because that distinction has now caused two misalignments. A bounding
// rect on an inline element reports the font's CONTENT area — 15px for 13px monospace
// against a 20px line — so a caller that places one line of text against another lands a
// couple of pixels low, which is invisible under a popup and plainly visible in a chip of
// text that has to continue the word beside it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TextMirror } from '../../src/dom/mirror.js'

/** A rectangle, in the shape the DOM reports one. */
function rect(top: number, height: number, left = 0, width = 10): DOMRect {
  return {
    x: left,
    y: top,
    top,
    bottom: top + height,
    left,
    right: left + width,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect
}

/** A field with a declared line height, so the mirror takes the declared branch. */
function fieldOf(value: string): HTMLTextAreaElement {
  const field = document.createElement('textarea')
  field.value = value
  field.style.lineHeight = '20px'
  field.style.fontSize = '13px'
  field.style.padding = '6px'
  document.body.appendChild(field)
  return field
}

beforeEach(() => {
  // The marker reports the font's content area (top 106, 15px tall) inside a mirror whose
  // box starts at 100; the field's box starts at 50.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element,
  ): DOMRect {
    if (this.tagName === 'SPAN') return rect(106, 15, 12, 8)
    if (this.tagName === 'TEXTAREA') return rect(50, 40)
    return rect(100, 60)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('TextMirror.caretBox', () => {
  it('reports the line box, not the font’s content area', () => {
    const mirror = new TextMirror(document)
    const field = fieldOf('alpha')
    const box = mirror.caretBox(field, 3)
    expect(box).toBeDefined()
    // 106 - 100 = 6 from the mirror's top, minus half the leading (20 - 15) / 2 = 2.5.
    expect(box?.y).toBe(3.5)
    expect(box?.height).toBe(20)
    expect(box?.lineHeight).toBe(20)
    mirror.destroy()
  })

  it('reports the caret’s x as where the next glyph begins', () => {
    const mirror = new TextMirror(document)
    const field = fieldOf('alpha')
    // The marker holds the character after the caret, so its left edge is the caret.
    expect(mirror.caretBox(field, 3)?.x).toBe(12)
    mirror.destroy()
  })

  it('measures from the field’s border box, so a scrolled field moves it', () => {
    const mirror = new TextMirror(document)
    const field = fieldOf('alpha')
    field.scrollTop = 4
    field.scrollLeft = 2
    const box = mirror.caretBox(field, 3)
    expect(box?.y).toBe(-0.5)
    expect(box?.x).toBe(10)
    mirror.destroy()
  })

  it('stands in a zero-width space at the end of the document', () => {
    // There is no character after the caret there, and a collapsed marker would report
    // nothing at all — so the sentinel is what makes the box measureable.
    const mirror = new TextMirror(document)
    const field = fieldOf('alpha')
    expect(mirror.caretBox(field, 5)?.height).toBe(20)
    mirror.destroy()
  })
})
