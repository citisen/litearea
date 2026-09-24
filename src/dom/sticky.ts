// ─── sticky: drawing the pinned header rows ─────────────────────────────────
//
// This is the half that draws. It decides nothing about WHICH headers should pin — that
// answer comes from `planStickyHeaders` in the core, which needs only line boxes — and it
// measures nothing itself: where a line is in the paint is `PaintReader`'s question, and
// the inline preview asks it too. What is left here is the rows.
//
// One thing this module deliberately does NOT do is take the pointer. The strip is
// painted between the layer and the field, so a pinned row is visible through the
// transparent text just as the ordinary paint is, and a click inside it still places
// the caret where the reader clicked. Putting it above the field would buy a
// click-to-scroll affordance at the price of the commonest gesture in the editor,
// which is the wrong trade.

import { planStickyHeaders, type StickyBlock, type StickyBox } from '../core/sticky.js'
import { lineBounds, type PaintReader, type PaintedRun } from './paint.js'
import { paddingBoxOf } from './support.js'

/** What the strip needs to draw one frame of pinned headers. */
export interface StickyRenderInput {
  /** The document, as the field holds it. */
  text: string
  /** The reader that knows where the painted lines are. */
  reader: PaintReader
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

  /** Remove every row, leaving the strip in place. */
  clear(): void {
    this.element.replaceChildren()
  }

  /**
   * Draw the headers that should be pinned, and remove the rest.
   *
   * @param input - the text, the reader, the blocks, and where the visible area is.
   * @returns how many rows were drawn, which is what the tests assert on.
   */
  render(input: StickyRenderInput): number {
    const { text, reader, container, view, blocks, lineHeight } = input
    if (blocks.length === 0) {
      this.clear()
      return 0
    }

    const runs = reader.paintedRuns
    const starts = reader.lineOffsets
    const boxes: (StickyBox | undefined)[] = []
    const measured = measure(blocks, boxes, reader)
    const placed = planStickyHeaders(blocks, measured, view)
    if (placed.length === 0) {
      this.clear()
      return 0
    }

    const containerTop = paddingBoxOf(container).top
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
    const bounds = lineBounds(text, starts, block.startLine)
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
 * Measure the boxes of the lines the blocks begin and end on.
 *
 * Only those lines are measured. A document of ten thousand lines with two blocks needs
 * four boxes, and measuring every line to answer a question about four would make
 * scrolling cost more the longer the document is.
 *
 * @param blocks - the blocks to measure for.
 * @param boxes - the sparse array to fill, indexed by line number.
 * @param reader - the reader that knows where the painted lines are.
 * @returns the same array, for the caller to pass straight to the planner.
 */
function measure(
  blocks: readonly StickyBlock[],
  boxes: (StickyBox | undefined)[],
  reader: PaintReader,
): (StickyBox | undefined)[] {
  for (const block of blocks) {
    for (const line of [block.startLine, block.endLine]) {
      if (boxes[line] !== undefined) continue
      const box = reader.lineBox(line)
      boxes[line] = box === undefined ? undefined : { top: box.top, bottom: box.bottom }
    }
  }
  return boxes
}
