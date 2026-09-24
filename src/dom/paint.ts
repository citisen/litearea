// ─── paint: reading the geometry of the painted layer ───────────────────────
//
// Two features need to know where a line of the painted document actually is: the sticky
// header rows, which copy a line to the top of the box, and the inline completion
// preview, which draws text where the next character would land. Both must agree with
// the PAINT, and not with a prediction of it.
//
// That distinction cost a bug. The preview used to be placed from the mirror — the
// offscreen element that predicts where the FIELD will put the caret — and the field and
// the paint do not quite agree: measured in Chrome, the painted prefix's glyphs sit at
// 832.19 and the mirror's marker at 833.19. One pixel is invisible under a popup placed
// below the caret, which is what the mirror was built for, and plainly visible in a chip
// of text that has to continue the painted word. So anything that has to sit ON the paint
// is measured FROM the paint.
//
// The measurement is a `Range` over the characters of a line, which works because the
// paint is ordinary laid-out DOM: one span per segment, in document order, holding exactly
// the document's characters. It is also why this module is the only place that walks the
// painted text nodes — one walk, cached until the paint changes, shared by both features.

import { lineAt, lineIndexAt, lineStarts } from '../core/text.js'

/** A vertical strip, in client coordinates. */
export interface PaintBox {
  /** The top of the glyphs' box. */
  top: number
  /** The bottom of the glyphs' box. */
  bottom: number
}

/** A run of characters in the paint, with the offset it starts at. */
export interface PaintedRun {
  node: Text
  start: number
  end: number
}

/** Where in the paint a character offset falls. */
interface PaintedPoint {
  node: Text
  offset: number
}

/**
 * Reads line boxes and caret positions out of a painted layer.
 *
 * One per editor. `read` is called with the paint and the text before any question, and
 * repeats of the same pair are free.
 */
export class PaintReader {
  private readonly document: Document
  /** The paint and the text the cached runs were read from. */
  private paint: HTMLElement | undefined
  private text: string | undefined
  private runs: PaintedRun[] = []
  private starts: number[] = []

  /**
   * @param ownerDocument - the document to build ranges in.
   */
  constructor(ownerDocument: Document) {
    this.document = ownerDocument
  }

  /**
   * Point the reader at a paint and the document it was built from.
   *
   * @param paint - the element the spans were written into.
   * @param text - the text those spans were built from.
   */
  read(paint: HTMLElement, text: string): void {
    if (this.paint === paint && this.text === text) return
    const runs: PaintedRun[] = []
    const walker = this.document.createTreeWalker(
      paint,
      this.document.defaultView?.NodeFilter?.SHOW_TEXT ?? 4,
    )
    let offset = 0
    let node = walker.nextNode()
    while (node !== null) {
      const content = node.textContent ?? ''
      runs.push({ node: node as Text, start: offset, end: offset + content.length })
      offset += content.length
      node = walker.nextNode()
    }
    this.paint = paint
    this.text = text
    this.runs = runs
    this.starts = lineStarts(text)
  }

  /** Forget what was read, so the next question re-walks. */
  invalidate(): void {
    this.paint = undefined
    this.text = undefined
    this.runs = []
    this.starts = []
  }

  /** The painted runs, in document order. Read-only: the cache belongs to this reader. */
  get paintedRuns(): readonly PaintedRun[] {
    return this.runs
  }

  /** The offset each line starts at, for callers that work in lines. */
  get lineOffsets(): readonly number[] {
    return this.starts
  }

  /**
   * The box of a line's glyphs, in client coordinates.
   *
   * A union over the whole line, so a line that wrapped reports the strip it occupies
   * rather than its first visual line. `undefined` when the line has nothing painted —
   * an empty line, or a line past the end of the document — because a box derived from
   * nothing would be a position that means nothing.
   *
   * @param line - the zero-based line number.
   * @returns the box, or undefined.
   */
  lineBox(line: number): PaintBox | undefined {
    const range = this.rangeOf(line, line)
    if (range === undefined) return undefined
    const rect = range.getBoundingClientRect()
    if (!(rect.height > 0)) return undefined
    return { top: rect.top, bottom: rect.bottom }
  }

  /**
   * The box of the line an offset sits on.
   *
   * @param offset - a character offset.
   * @returns the box, or undefined when that line is not painted.
   */
  lineBoxAt(offset: number): PaintBox | undefined {
    if (this.starts.length === 0) return undefined
    return this.lineBox(lineIndexAt(this.starts, Math.min(offset, this.text?.length ?? offset)))
  }

  /**
   * Where the glyph after an offset begins, in client coordinates.
   *
   * Two shapes, because a caret can be at either end of a glyph: after some characters,
   * the answer is the right edge of the text before it; at the start of a line, it is the
   * left edge of the text after it. A line with nothing painted answers with the paint's
   * own left content edge, which is where that line's first character will go.
   *
   * @param offset - a character offset.
   * @returns the x, or undefined when there is no paint to measure.
   */
  caretX(offset: number): number | undefined {
    const text = this.text
    if (text === undefined || this.paint === undefined) return undefined
    const position = Math.max(0, Math.min(offset, text.length))
    const line = lineIndexAt(this.starts, position)
    const from = this.starts[line] ?? 0
    const next = this.starts[line + 1]
    const to = next === undefined ? text.length : Math.max(from, next - 1)

    if (position > from) {
      const range = this.rangeBetween(from, position)
      if (range !== undefined) {
        const rect = range.getBoundingClientRect()
        if (rect.width > 0 || rect.height > 0) return rect.right
      }
    }
    if (position < to) {
      const range = this.rangeBetween(position, position + 1)
      if (range !== undefined) {
        const rect = range.getBoundingClientRect()
        if (rect.width > 0 || rect.height > 0) return rect.left
      }
    }
    // Nothing painted on this line: the caret goes where the line's first character would,
    // which is the paint's content edge.
    const paintRect = this.paint.getBoundingClientRect()
    const view = this.document.defaultView
    const padding = view === null || view === undefined ? 0 : Number.parseFloat(view.getComputedStyle(this.paint).paddingLeft) || 0
    return paintRect.left + padding
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** A range over the characters of one line, terminator excluded. */
  private rangeOf(first: number, last: number): Range | undefined {
    const from = this.starts[first]
    if (from === undefined) return undefined
    const next = this.starts[last + 1]
    const to = next === undefined ? (this.text ?? '').length : Math.max(from, next - 1)
    return this.rangeBetween(from, to)
  }

  /** A range over a half-open offset pair. */
  private rangeBetween(from: number, to: number): Range | undefined {
    const start = this.locate(from)
    const end = this.locate(to)
    if (start === undefined || end === undefined) return undefined
    const range = this.document.createRange()
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset)
    return range
  }

  /**
   * Where a character offset falls in the paint.
   *
   * A boundary offset belongs to two runs — the end of one and the start of the next —
   * and either answers the same question, so the first match wins. An offset past the
   * end of the paint is not found at all, which is what keeps a stale text out of a
   * measurement made for a new one.
   *
   * @param offset - a character offset.
   * @returns the text node and the offset inside it.
   */
  private locate(offset: number): PaintedPoint | undefined {
    for (const run of this.runs) {
      if (offset >= run.start && offset <= run.end) {
        return { node: run.node, offset: offset - run.start }
      }
    }
    return undefined
  }
}

/**
 * The bounds of one line, terminator excluded.
 *
 * Kept beside the reader because the two questions are always asked together: a caller
 * that has an offset wants its line's box AND the line's characters to copy.
 *
 * @param text - the document.
 * @param starts - the result of {@link lineStarts}, or the reader's `lineOffsets`.
 * @param line - the zero-based line number.
 * @returns the half-open bounds of the line's text.
 */
export function lineBounds(
  text: string,
  starts: readonly number[],
  line: number,
): { from: number; to: number } {
  const info = lineAt(text, starts[line] ?? text.length, starts)
  return { from: info.from, to: info.to }
}
