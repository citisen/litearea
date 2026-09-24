// ─── sticky: which block headers stay pinned while their block is on screen ──
//
// A long block that has scrolled past its own header is a block the reader can no
// longer name. The header is still in the document — it is simply above the visible
// area — so the fix is to draw a second copy of that one line at the top of the box
// for as long as the block it belongs to is the block the reader is inside.
//
// Everything in this module is arithmetic on numbers the DOM layer measured, and
// that split is deliberate rather than tidy-minded. `happy-dom` has no layout, so a
// planner that reached for `getBoundingClientRect` itself could not be tested at
// all; one that is handed the boxes can be tested exactly, including the cases a
// browser makes awkward to stage — a block whose end has scrolled past its own
// header, a depth three levels down, a range that arrives out of order.
//
// The two questions are answered separately on purpose:
//
//   - `buildStickyBlocks` turns ranges into lines and works out how deeply each
//     block is nested, which is what decides how many rows stack up.
//   - `planStickyHeaders` decides which of those blocks, given where the lines
//     actually landed, has a header that has scrolled out of sight.

import { lineIndexAt } from './text.js'

/**
 * A block, as a host declares it: one range, and a name to keep it stable by.
 *
 * `to` is the offset of the character AFTER the block's last one, like every other
 * range here, so a block that ends at the end of the document ends at
 * `text.length`. A block whose two offsets are equal spans the one line they sit on
 * rather than none, because a decoration marking a heading is naturally expressed
 * as an empty range at the heading's start.
 */
export interface StickyRangeInput {
  /** An identity for the block. The editor reuses it to keep a row's identity across repaints. */
  id: string
  /** The first character of the block, inclusive. */
  from: number
  /** The character after the block's last one, exclusive. */
  to: number
}

/** A block resolved to whole lines, with the depth it is nested at. */
export interface StickyBlock {
  /** The identity the range arrived with. */
  id: string
  /** The zero-based line the header sits on. */
  startLine: number
  /** The zero-based line the block ends on, inclusive. */
  endLine: number
  /** How many other blocks enclose this one. `0` is an outermost block. */
  depth: number
}

/**
 * A vertical strip, in whatever coordinates the caller measures in.
 *
 * The planner never compares a box against anything but another box, so the units
 * are the caller's: the DOM layer works in client coordinates and the tests work in
 * plain numbers.
 */
export interface StickyBox {
  /** The top edge. */
  top: number
  /** The bottom edge. */
  bottom: number
}

/** A header that should be drawn pinned, and how far down it stacks. */
export interface StickyPlacement {
  /** An index into the array of blocks the plan was made from. */
  block: number
  /** The block's own depth, copied out so the caller does not have to look it up. */
  depth: number
}

/**
 * Resolve declared ranges into blocks of whole lines, and nest them.
 *
 * Ranges are sorted before nesting, so a host may hand them over in whatever order
 * its own scan produced them — a depth computed from unsorted input would depend on
 * the order the grammar happened to walk its tokens in.
 *
 * Nesting is what makes a stack rather than a single row: the depth of a block is
 * the number of blocks that are still open when it begins. A block that has already
 * ended is closed before the next one is measured, and two blocks that share a
 * start line are siblings, not parent and child — the second one does not deepen
 * the first.
 *
 * @param ranges - the blocks, by offset.
 * @param starts - the result of {@link lineStarts} for the same text.
 * @returns one block per range that spans at least one line, in start order.
 */
export function buildStickyBlocks(
  ranges: readonly StickyRangeInput[],
  starts: readonly number[],
): StickyBlock[] {
  if (ranges.length === 0 || starts.length === 0) return []

  const resolved = ranges
    .map((range) => {
      const startLine = lineIndexAt(starts, Math.min(range.from, range.to))
      const endLine = lineIndexAt(starts, Math.max(range.from, range.to))
      return { id: range.id, startLine, endLine }
    })
    .sort((left, right) => left.startLine - right.startLine || left.endLine - right.endLine)

  const blocks: StickyBlock[] = []
  // The end line of every block that is still open, innermost last. The length of
  // this stack IS the depth of the block being measured, which is why it is kept
  // rather than counted from the blocks already emitted.
  const open: number[] = []

  for (const range of resolved) {
    while (open.length > 0 && (open[open.length - 1] ?? 0) <= range.startLine) open.pop()

    blocks.push({
      id: range.id,
      startLine: range.startLine,
      endLine: range.endLine,
      depth: open.length,
    })

    // Pushed in descending order of end line, so the innermost block — the one that
    // ends first — is always on top of the stack and is the first to close.
    let at = open.length
    while (at > 0 && (open[at - 1] ?? 0) < range.endLine) at -= 1
    open.splice(at, 0, range.endLine)
  }

  return blocks
}

/**
 * Decide which headers to pin.
 *
 * A header pins while its block is the one under the reader's eye, which is two
 * conditions and not one:
 *
 *   - the header line has scrolled ABOVE the visible top, or there would be nothing
 *     to replace; and
 *   - the block's last line has not, or a header would stay pinned over the text
 *     that follows the block it names.
 *
 * The end is compared by its BOTTOM rather than its top, so the header stays for as
 * long as any part of the block's last line is still visible. Comparing tops would
 * unpin a header one line early and make the header of the next block flash into
 * place while the previous block's last line is still on screen.
 *
 * A block with no measured box is skipped rather than guessed at: an unmeasured line
 * means the caller has no layout yet, and a row pinned from nothing would sit at
 * the top of a box that has not been laid out.
 *
 * @param blocks - the result of {@link buildStickyBlocks}.
 * @param boxes - the measured box of each line, indexed by line number; `undefined`
 *   where a line was not measured.
 * @param view - the visible strip, in the same coordinates as `boxes`.
 * @returns the headers to pin, in block order, each with its depth.
 */
export function planStickyHeaders(
  blocks: readonly StickyBlock[],
  boxes: readonly (StickyBox | undefined)[],
  view: StickyBox,
): StickyPlacement[] {
  const placements: StickyPlacement[] = []

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (block === undefined) continue
    const header = boxes[block.startLine]
    const end = boxes[block.endLine]
    if (header === undefined || end === undefined) continue
    if (header.top < view.top && end.bottom > view.top) {
      placements.push({ block: index, depth: block.depth })
    }
  }

  return placements
}
