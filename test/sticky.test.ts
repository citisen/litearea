import { describe, expect, it } from 'vitest'
import { buildStickyBlocks, planStickyHeaders } from '../src/core/sticky.js'
import type { StickyBox } from '../src/core/sticky.js'
import { lineStarts } from '../src/core/text.js'

/*
 * The document every case is measured against, and what its lines are:
 *
 *   offset  0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 … 18
 *   line    0     1        2           3           4
 *   text    a  \n  b  b  \n  c  c  c  \n  d  d  d  d  \n  e  e  e  e  e
 *
 * A newline belongs to the line it ends, so offset 4 is on line 1 and offset 2 — the
 * character after the first newline — starts line 1 as well.
 */
const source = 'a\nbb\nccc\ndddd\neeeee'

/** The blocks of a document, from ranges written as `[from, to]` pairs. */
function blocksOf(text: string, ranges: readonly (readonly [number, number])[]) {
  return buildStickyBlocks(
    // The id is derived from the range rather than from the arrival position, so that
    // two orders of the same input are comparable value for value.
    ranges.map(([from, to]) => ({ id: `${String(from)}-${String(to)}`, from, to })),
    lineStarts(text),
  )
}

/** One box per line, laid out top-down from `top`. */
function boxesFrom(lines: number, top: number, lineHeight = 20): (StickyBox | undefined)[] {
  const boxes: (StickyBox | undefined)[] = []
  for (let line = 0; line < lines; line += 1) {
    const lineTop = top + line * lineHeight
    boxes.push({ top: lineTop, bottom: lineTop + lineHeight })
  }
  return boxes
}

describe('buildStickyBlocks', () => {
  it('returns nothing when there are no ranges', () => {
    expect(buildStickyBlocks([], lineStarts(source))).toEqual([])
  })

  it('resolves offsets to whole lines', () => {
    // `bb\nccc` starts on line 1 and its last character is on line 2.
    expect(blocksOf(source, [[2, 7]])).toEqual([{ id: '2-7', startLine: 1, endLine: 2, depth: 0 }])
  })

  it('treats an empty range as the one line it sits on, not as none', () => {
    // A heading marked with a range that starts and ends at its first character is the
    // natural way to say "this line is a block", and it must not span nothing.
    expect(blocksOf(source, [[3, 3]])).toEqual([{ id: '3-3', startLine: 1, endLine: 1, depth: 0 }])
  })

  it('accepts a range written backwards', () => {
    // A host that computed a block from a backwards drag has still asked for those
    // lines, and quietly reading it as an empty range would be a silent wrong answer.
    const shape = (ranges: readonly (readonly [number, number])[]) =>
      blocksOf(source, ranges).map((block) => [block.startLine, block.endLine, block.depth])
    expect(shape([[7, 2]])).toEqual(shape([[2, 7]]))
  })

  it('sorts ranges before nesting them', () => {
    // Handed over innermost-first, which is what a scan that walks a tree can produce;
    // a depth read off the arrival order would depend on that order.
    const expected = blocksOf(source, [
      [0, 18],
      [2, 7],
    ])
    const shuffled = blocksOf(source, [
      [2, 7],
      [0, 18],
    ])
    expect(shuffled).toEqual(expected)
    expect(shuffled.map((block) => block.depth)).toEqual([0, 1])
  })

  it('stacks a block inside a block, and unwinds it again', () => {
    const blocks = blocksOf(source, [
      [0, 18],
      [2, 11],
      [12, 18],
    ])
    expect(blocks.map((block) => [block.startLine, block.endLine, block.depth])).toEqual([
      [0, 4, 0],
      [1, 3, 1],
      [3, 4, 1],
    ])
  })

  it('treats two blocks that begin on the same line as siblings', () => {
    // The second does not deepen the first: one is not inside the other, and a stack
    // that counted them as nested would pin two rows where the reader is in one block.
    expect(blocksOf(source, [
      [2, 4],
      [2, 7],
    ]).map((block) => block.depth)).toEqual([0, 0])
  })

  it('clamps a range that points past the end of the document', () => {
    // `lineIndexAt` clamps, so an offset past the end resolves to the last line rather
    // than to a line that does not exist.
    expect(blocksOf(source, [[0, 1000]])).toEqual([
      { id: '0-1000', startLine: 0, endLine: 4, depth: 0 },
    ])
  })
})

describe('planStickyHeaders', () => {
  // Line 0 at 100, line 1 at 120, and so on; the visible strip begins at 140, so line 0
  // has scrolled out of sight and line 2 is the first line still entirely inside.
  const view: StickyBox = { top: 140, bottom: 240 }

  it('pins a header that has scrolled above the visible top', () => {
    // Lines 0–2, whose last line ends at 160 and so is still on screen.
    const blocks = blocksOf(source, [[0, 7]])
    expect(planStickyHeaders(blocks, boxesFrom(5, 100), view)).toEqual([
      { block: 0, depth: 0 },
    ])
  })

  it('leaves a header alone while it is still visible', () => {
    expect(planStickyHeaders(blocksOf(source, [[5, 9]]), boxesFrom(5, 100), view)).toEqual([])
  })

  it('unpins a header once the block it names has scrolled past', () => {
    // Line 1 alone, whose box is 120–140: the whole block is above the visible top.
    expect(planStickyHeaders(blocksOf(source, [[2, 4]]), boxesFrom(5, 100), view)).toEqual([])
  })

  it('keeps a header while any part of the block’s last line is visible', () => {
    // Line 1's box is 140–150 and the visible top is 140, so the last line is on screen
    // while its top is not. Comparing tops would unpin here, one line early.
    const boxes = boxesFrom(3, 130, 10)
    expect(planStickyHeaders(blocksOf(source, [[0, 2]]), boxes, view)).toEqual([
      { block: 0, depth: 0 },
    ])
  })

  it('reports the depth, so nested blocks stack', () => {
    const blocks = blocksOf(source, [
      [0, 18],
      [2, 11],
    ])
    expect(planStickyHeaders(blocks, boxesFrom(5, 100), view)).toEqual([
      { block: 0, depth: 0 },
      { block: 1, depth: 1 },
    ])
  })

  it('skips a block whose lines were never measured', () => {
    // No measurement means no layout to place a row against, and a row placed from
    // nothing would sit at the top of a box that has not been laid out.
    const blocks = blocksOf(source, [[0, 7]])
    expect(planStickyHeaders(blocks, [], view)).toEqual([])
  })

  it('skips only the block that is missing a measurement', () => {
    // An outer block and an inner one that both qualify, with the inner one's header
    // line left unmeasured: the outer header is still pinned.
    const blocks = blocksOf(source, [
      [0, 7],
      [2, 18],
    ])
    const boxes = boxesFrom(5, 100)
    boxes[1] = undefined
    expect(planStickyHeaders(blocks, boxes, view)).toEqual([{ block: 0, depth: 0 }])
  })
})
