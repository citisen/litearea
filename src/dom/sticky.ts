// ─── sticky: drawing the pinned header rows ─────────────────────────────────
//
// This is the half that measures. It reads the painted layer — which is the one
// element in the tree that already wraps exactly like the field — to find where a
// line landed, and it decides nothing about WHICH headers should pin: that answer
// comes from `planStickyHeaders` in the core, which needs only the boxes this module
// measured. The split is what makes the interesting half testable without layout.
//
// Why the painted layer and not the field: a textarea cannot be asked where its
// fifth line is. Its own geometry is opaque, which is the same reason the mirror
// exists for the caret. The paint is not opaque — it is ordinary spans laid out with
// the field's typography, so a `Range` over one line's characters reports that
// line's box directly, and the clone of that range is the row the reader sees.
//
// One thing this module deliberately does NOT do is take the pointer. The strip is
// painted between the layer and the field, so a pinned row is visible through the
// transparent text just as the ordinary paint is, and a click inside it still places
// the caret where the reader clicked. Putting it above the field would buy a
// click-to-scroll affordance at the price of the commonest gesture in the editor,
// which is the wrong trade.

import { lineStarts } from '../core/text.js'
import {
  planStickyHeaders,
  type StickyBlock,
  type StickyBox,
} from '../core/sticky.js'

/** What the strip needs to draw one frame of pinned headers. */
export interface StickyRenderInput {
  /** The document, as the field holds it. */
  text: string
  /** The element the spans were painted into. */
  paint: HTMLElement
  /**
   * The element the strip is positioned against — the box the field sits in.
   *
   * The row's offset is computed against this rather than being copied from the
   * layer, because `offsetParent` changes the moment a host wraps the editor in
   * something positioned, and a pinned row must not notice that.
   */
  container: HTMLElement
  /** The visible strip of the layer, in client coordinates. */
  view: StickyBox
  /** The blocks, resolved to lines by the core. */
  blocks: readonly StickyBlock[]
  /** The line height in force, in pixels. */
  lineHeight: number
}

/** A run of characters in the paint, with the offset it starts at. */
interface PaintedRun {
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
 * The strip of pinned header rows.
 *
 * One per editor. It is a sibling of the painted layer rather than a child of it, so
 * that pinning a row does not scroll with the text it is pinned over.
 */
export class StickyHeaders {
  /** The strip. Positioned absolutely inside the box. */
  readonly element: HTMLDivElement
  private readonly document: Document
  /** The paint the cached runs were read from, so a different one rebuilds. */
  private indexedPaint: HTMLElement | undefined
  /** The text the cached runs were read from. */
  private indexedText: string | undefined
  private runs: PaintedRun[] = []

  /**
   * @param ownerDocument - the document to build in.
   */
  constructor(ownerDocument: Document) {
    this.document = ownerDocument
    this.element = ownerDocument.createElement('div')
    this.element.className = 'litearea-sticky'
    this.element.setAttribute('aria-hidden', 'true')
    this.element.dataset.liteareaPart = 'sticky'
  }

  /**
   * Forget the cached character runs.
   *
   * Called whenever the paint is rebuilt. The runs are cheap to find but not free —
   * one walk of every text node — and a scroll frame must not pay for a walk it has
   * already paid for.
   */
  invalidate(): void {
    this.indexedPaint = undefined
    this.indexedText = undefined
    this.runs = []
  }

  /** Remove every row, leaving the strip in place. */
  clear(): void {
    this.element.replaceChildren()
  }

  /**
   * Draw the headers that should be pinned, and remove the rest.
   *
   * @param input - the text, the paint, the blocks, and where the visible area is.
   * @returns how many rows were drawn, which is what the tests assert on.
   */
  render(input: StickyRenderInput): number {
    const { text, paint, container, view, blocks, lineHeight } = input
    if (blocks.length === 0) {
      this.clear()
      return 0
    }

    const runs = this.runsOf(paint, text)
    const starts = lineStarts(text)
    const boxes: (StickyBox | undefined)[] = []
    const measured = measure(blocks, boxes, runs, starts, text, this.document)
    const placed = planStickyHeaders(blocks, measured, view)
    if (placed.length === 0) {
      this.clear()
      return 0
    }

    const containerTop = container.getBoundingClientRect().top
    const fragment = this.document.createDocumentFragment()

    for (const placement of placed) {
      const block = blocks[placement.block]
      if (block === undefined) continue
      const row = this.row(block, runs, starts, text)
      if (row === undefined) continue
      // The stacked row sits one line lower per level of nesting, which is what makes
      // a reader inside three blocks see three headers rather than the innermost one
      // alone.
      const top = view.top + placement.depth * lineHeight
      row.style.top = `${String(Math.round(top - containerTop))}px`
      row.style.height = `${String(Math.round(lineHeight))}px`
      row.style.lineHeight = `${String(Math.round(lineHeight))}px`
      fragment.appendChild(row)
    }

    this.element.replaceChildren(fragment)
    return this.element.childElementCount
  }

  /** Take the strip out of the document. */
  destroy(): void {
    this.element.remove()
    this.clear()
  }

  // ── internals ────────────────────────────────────────────────────────────

  /**
   * The character runs of the paint, cached until the paint changes.
   *
   * @param paint - the element the spans were written into.
   * @param text - the text those spans were built from.
   * @returns every text node, in document order, with the offset it starts at.
   */
  private runsOf(paint: HTMLElement, text: string): PaintedRun[] {
    if (this.indexedPaint === paint && this.indexedText === text) return this.runs
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
    this.indexedPaint = paint
    this.indexedText = text
    this.runs = runs
    return runs
  }

  /**
   * Build one pinned row, as a copy of the header line as it was painted.
   *
   * The line is rebuilt from the painted runs — one span per run, carrying that run's
   * own classes — rather than cloned as a `Range`. A range clone is the obvious way to
   * copy a line and it is wrong in the commonest case: a line that lies wholly inside
   * one painted span is a PARTIALLY selected node, and `cloneContents` copies a partial
   * node's text without its element, so the row would come out in the strip's colour
   * instead of the line's. Rebuilding from the runs cannot lose a class, and it trims
   * the newline off the end as a side effect of working in offsets.
   *
   * @param block - the block whose header is being pinned.
   * @param runs - the character runs of the paint.
   * @param starts - the offset each line starts at.
   * @param text - the document.
   * @returns the row, or `undefined` when the line has nothing painted to copy.
   */
  private row(
    block: StickyBlock,
    runs: readonly PaintedRun[],
    starts: readonly number[],
    text: string,
  ): HTMLDivElement | undefined {
    const bounds = lineBounds(block.startLine, starts, text)
    if (bounds === undefined) return undefined
    const row = this.document.createElement('div')
    row.className = 'litearea-stickyRow'
    row.dataset.block = block.id
    for (const run of runs) {
      const from = Math.max(bounds.from, run.start)
      const to = Math.min(bounds.to, run.end)
      if (to <= from) continue
      const painted = run.node.parentElement
      const span = this.document.createElement('span')
      if (painted?.className !== undefined && painted.className !== '') {
        span.className = painted.className
      }
      span.textContent = run.node.data.slice(from - run.start, to - run.start)
      row.appendChild(span)
    }
    return row
  }
}

/**
 * Measure the lines the blocks begin and end on.
 *
 * Only those lines are measured. A document of ten thousand lines with two blocks
 * needs four boxes, and measuring every line to answer a question about four would
 * make scrolling cost more the longer the document is.
 *
 * @param blocks - the blocks to measure for.
 * @param boxes - the sparse array to fill, indexed by line number.
 * @param runs - the character runs of the paint.
 * @param starts - the offset each line starts at.
 * @param text - the document.
 * @param document - the document to build ranges in.
 * @returns the same array, for the caller to pass straight to the planner.
 */
function measure(
  blocks: readonly StickyBlock[],
  boxes: (StickyBox | undefined)[],
  runs: readonly PaintedRun[],
  starts: readonly number[],
  text: string,
  document: Document,
): (StickyBox | undefined)[] {
  for (const block of blocks) {
    for (const line of [block.startLine, block.endLine]) {
      if (boxes[line] !== undefined) continue
      const range = lineRange(line, runs, starts, text, document)
      boxes[line] = range === undefined ? undefined : boxOf(range)
    }
  }
  return boxes
}

/**
 * The box a range covers, or `undefined` when it has no height.
 *
 * A collapsed range — an empty header line, or a line whose characters were never
 * painted — reports a zero-height box at some position, and a zero-height box is not
 * a line. Treating it as one would pin a row against a position that means nothing,
 * so it is reported as unmeasured and the planner skips the block.
 *
 * @param range - a range over the line's characters.
 * @returns the line's box.
 */
function boxOf(range: Range): StickyBox | undefined {
  const rect = range.getBoundingClientRect()
  if (!(rect.height > 0)) return undefined
  return { top: rect.top, bottom: rect.bottom }
}

/**
 * A range over the characters of one line.
 *
 * @param line - the zero-based line number.
 * @param runs - the character runs of the paint.
 * @param starts - the offset each line starts at.
 * @param text - the document the line numbers were computed from.
 * @param document - the document to build the range in.
 * @returns the range, or `undefined` when either end is outside the paint.
 */
function lineRange(
  line: number,
  runs: readonly PaintedRun[],
  starts: readonly number[],
  text: string,
  document: Document,
): Range | undefined {
  const bounds = lineBounds(line, starts, text)
  if (bounds === undefined) return undefined
  const start = locate(runs, bounds.from)
  const end = locate(runs, bounds.to)
  if (start === undefined || end === undefined) return undefined
  const range = document.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset)
  return range
}

/**
 * The characters of one line, without its terminator.
 *
 * The terminator belongs to the line it ends rather than to the line it starts, and a
 * line's own text excludes it for the same reason {@link lineStarts} excludes it: a
 * newline has no column and nothing to copy into a pinned row.
 *
 * @param line - the zero-based line number.
 * @param starts - the offset each line starts at.
 * @param text - the document.
 * @returns the half-open range of the line's characters.
 */
function lineBounds(
  line: number,
  starts: readonly number[],
  text: string,
): { from: number; to: number } | undefined {
  const from = starts[line]
  if (from === undefined) return undefined
  const next = starts[line + 1]
  return { from, to: next === undefined ? text.length : Math.max(from, next - 1) }
}

/**
 * Where a character offset falls in the paint.
 *
 * A boundary offset belongs to two runs — the end of one and the start of the next —
 * and either answers the same question, so the first match wins. An offset past the
 * end of the paint is not found at all, which is what keeps a stale text out of a
 * measurement made for a new one.
 *
 * @param runs - the character runs of the paint.
 * @param offset - a character offset.
 * @returns the text node and the offset inside it.
 */
function locate(runs: readonly PaintedRun[], offset: number): PaintedPoint | undefined {
  for (const run of runs) {
    if (offset >= run.start && offset <= run.end) {
      return { node: run.node, offset: offset - run.start }
    }
  }
  return undefined
}
