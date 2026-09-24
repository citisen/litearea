// @vitest-environment happy-dom
//
// Reading the painted layer's geometry: which line a caret is on, where its glyphs are,
// and where the next glyph would start.
//
// `happy-dom` lays nothing out, so the rectangles are stubbed. What is being tested is
// not the browser's layout — that is `scripts/browser-check.mjs` — but WHICH rectangle the
// reader asks for and how it reads it, which is where the two bugs that made the inline
// preview a pixel low actually lived: an inline box's rect is the font's content area and
// not the line box, and a range that cannot be built at all has to be answered rather than
// guessed at.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lineBounds, PaintReader } from '../../src/dom/paint.js'

/** A rectangle, in the shape the DOM reports one. */
function rect(left: number, right: number, top = 10, height = 15): DOMRect {
  return {
    x: left,
    y: top,
    top,
    bottom: top + height,
    left,
    right,
    width: right - left,
    height,
    toJSON: () => ({}),
  } as DOMRect
}

/** A paint element holding one text node per argument. */
function paintOf(...runs: string[]): HTMLElement {
  const paint = document.createElement('div')
  paint.className = 'litearea-paint'
  for (const run of runs) paint.appendChild(document.createTextNode(run))
  return paint
}

/** A reader pointed at a paint, with a document whose line height is known. */
function readerFor(paint: HTMLElement, text: string): PaintReader {
  const reader = new PaintReader(document)
  reader.read(paint, text)
  return reader
}

beforeEach(() => {
  // Every range reports the same stripe, so an assertion says WHICH end was read: the
  // right edge is 100 and the left edge 40, and they cannot be confused for each other.
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(() => rect(40, 100))
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => rect(30, 200, 0, 100))
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('PaintReader', () => {
  it('answers a caret after some characters with the right edge of them', () => {
    // Where the NEXT character goes, having written some: the end of what is there.
    const reader = readerFor(paintOf('alpha\nbeta'), 'alpha\nbeta')
    expect(reader.caretX(3)).toBe(100)
  })

  it('answers a caret at the start of a line with the left edge of the next glyph', () => {
    // There is nothing before it on the line, so the only thing that can say where it is
    // is the glyph that comes after.
    const reader = readerFor(paintOf('alpha\nbeta'), 'alpha\nbeta')
    expect(reader.caretX(6)).toBe(40)
  })

  it('answers a caret with nothing painted on its line with the paint’s content edge', () => {
    // An empty line has no glyphs to measure, so the answer is where that line's first
    // character would go. `undefined` here would leave the preview unplaced on exactly the
    // document a caller is most likely to ask for suggestions in — an empty one.
    const reader = readerFor(paintOf('alpha'), 'alpha\n\nbeta')
    // The paint's box starts at 30 (the stub) and this test injects no stylesheet, so its
    // content edge is the box edge: 30.
    expect(reader.caretX(6)).toBe(30)
    const empty = readerFor(paintOf(), '')
    expect(empty.caretX(0)).toBe(30)
  })

  it('reports a line box only when the line has glyphs', () => {
    const reader = readerFor(paintOf('alpha\nbeta'), 'alpha\nbeta')
    expect(reader.lineBox(0)).toEqual({ top: 10, bottom: 25 })
    vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(() => rect(0, 0, 0, 0))
    expect(reader.lineBox(0)).toBeUndefined()
  })

  it('reports no box for a line past the end of the document', () => {
    const reader = readerFor(paintOf('alpha'), 'alpha')
    expect(reader.lineBox(9)).toBeUndefined()
  })

  it('caches the walk until the paint or the text changes', () => {
    const reader = new PaintReader(document)
    const first = paintOf('alpha')
    reader.read(first, 'alpha')
    expect(reader.paintedRuns).toHaveLength(1)
    // The same pair does not re-walk.
    reader.read(first, 'alpha')
    expect(reader.paintedRuns).toHaveLength(1)
    // A different text does.
    const second = paintOf('alpha', ' beta')
    reader.read(second, 'alpha beta')
    expect(reader.paintedRuns).toHaveLength(2)
    reader.invalidate()
    expect(reader.paintedRuns).toHaveLength(0)
  })
})

describe('lineBounds', () => {
  it('excludes the terminator, whatever it is', () => {
    const text = 'alpha\nbeta\r\ngamma'
    expect(lineBounds(text, [0, 6, 12], 0)).toEqual({ from: 0, to: 5 })
    expect(lineBounds(text, [0, 6, 12], 1)).toEqual({ from: 6, to: 10 })
    expect(lineBounds(text, [0, 6, 12], 2)).toEqual({ from: 12, to: 17 })
  })
})
