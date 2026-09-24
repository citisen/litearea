// @vitest-environment happy-dom
//
// The strip's wiring, with a layout invented rather than measured.
//
// `happy-dom` lays nothing out, so every rectangle in it is a zero, and the two
// claims that matter here — that a header which has scrolled out of sight is copied
// into the strip, and that a nested block stacks a row below its parent — need a page
// that has geometry. Rather than fake a renderer, this file replaces the two
// rectangle readings the strip makes with a line model: line `n` sits at
// `top + n * lineHeight`, and every element reports a fixed box. What is then under
// test is exactly what this repository owns — which rows are built, in what order,
// with what offsets — and not the browser's layout, which
// `scripts/browser-check.mjs` covers.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEditor } from '../../src/dom/create.js'
import type { LiteArea } from '../../src/dom/editor.js'
import { defineGrammar } from '../../src/core/grammar.js'
import type { Decoration } from '../../src/core/types.js'

/** The document under the layout, and where its lines begin. */
const TEXT = 'alpha\nbravo\ncharlie\ndelta\necho'

/** Where a line's box is, and where the visible area starts. */
interface Layout {
  /** The top of line 0. */
  top: number
  /** The height of one line. */
  lineHeight: number
  /** The top of the layer, which is what "scrolled out of sight" is measured against. */
  viewTop: number
  /** The bottom of the layer. */
  viewBottom: number
}

let layout: Layout

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

/**
 * The line a range begins on, read back out of the paint.
 *
 * This is what a browser does with a laid-out document and what this file has to
 * derive: the characters before the range's start, counted by their newlines.
 */
function lineOf(range: Range): number {
  const node = range.startContainer
  const paint = node.parentElement?.closest('.litearea-paint') ?? null
  if (paint === null) return 0
  const walker = document.createTreeWalker(paint, 4)
  let before = ''
  let current = walker.nextNode()
  while (current !== null) {
    if (current === node) {
      before += (current.textContent ?? '').slice(0, range.startOffset)
      break
    }
    before += current.textContent ?? ''
    current = walker.nextNode()
  }
  return (before.match(/\n/g) ?? []).length
}

/** Install the invented layout. */
function measure(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() =>
    rect(layout.viewTop, layout.viewBottom),
  )
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Range,
  ): DOMRect {
    const top = layout.top + lineOf(this) * layout.lineHeight
    return rect(top, top + layout.lineHeight)
  })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400)
}

/** A grammar whose only interest is the blocks it declares. */
function grammar(decorate: () => readonly Decoration[]) {
  return defineGrammar({
    id: 'sticky-test',
    rules: [{ kind: 'match', scope: 'word', pattern: /\w+/ }],
    decorate,
  })
}

/** A block covering the whole document, and one nested inside it. */
const NESTED = (): readonly Decoration[] => [
  { kind: 'block', from: 0, to: TEXT.length },
  { kind: 'block', from: 6, to: TEXT.length },
]

/** Mount an editor over the fixture text. */
function mount(
  decorate: () => readonly Decoration[] = NESTED,
  sticky: { kinds: string[] } | false = { kinds: ['block'] },
): LiteArea {
  const host = document.createElement('div')
  document.body.appendChild(host)
  return createEditor(host, { grammar: grammar(decorate), value: TEXT, sticky })
}

/** The pinned rows, in the order they were built. */
function rows(editor: LiteArea): HTMLElement[] {
  return [...editor.element.querySelectorAll<HTMLElement>('.litearea-stickyRow')]
}

/** A row's declared top offset, in pixels. */
function topOf(row: HTMLElement): number {
  return Number.parseFloat(row.style.top)
}

beforeEach(() => {
  layout = { top: 40, lineHeight: 20, viewTop: 100, viewBottom: 300 }
  measure()
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('sticky headers', () => {
  it('builds no strip unless blocks are declared', () => {
    const editor = mount(NESTED, { kinds: [] })
    expect(editor.element.querySelector('.litearea-sticky')).toBeNull()
    editor.destroy()
  })

  it('pins the header of a block that has scrolled out of sight', () => {
    // Line 0 is at 40, the visible top is 100: it is above the fold, and the block it
    // names runs to line 4 at 120, so the reader is still inside it.
    const editor = mount(() => [{ kind: 'block', from: 0, to: TEXT.length }])
    const pinned = rows(editor)
    expect(pinned).toHaveLength(1)
    expect(pinned[0]?.textContent).toBe('alpha')
    expect(topOf(pinned[0] as HTMLElement)).toBe(0)
    editor.destroy()
  })

  it('stacks a row per level of nesting', () => {
    const editor = mount()
    const pinned = rows(editor)
    expect(pinned).toHaveLength(2)
    expect(pinned.map((row) => row.textContent)).toEqual(['alpha', 'bravo'])
    // One line lower for the inner block, and a row is exactly one line tall — which
    // is what keeps a stack of headers from covering the text it describes.
    expect(topOf(pinned[1] as HTMLElement) - topOf(pinned[0] as HTMLElement)).toBe(
      Number.parseFloat((pinned[0] as HTMLElement).style.height),
    )
    editor.destroy()
  })

  it('copies the painted colours of the line it pins', () => {
    // The copy is taken from the paint rather than re-derived from tokens, so the row
    // carries the same scope classes as the line it stands in for.
    const editor = mount(() => [{ kind: 'block', from: 0, to: TEXT.length }])
    const span = rows(editor)[0]?.querySelector('span')
    expect(span?.className).toContain('litearea-scope-word')
    editor.destroy()
  })

  it('leaves a header alone while it is still on screen', () => {
    layout = { ...layout, viewTop: 20, viewBottom: 200 }
    const editor = mount(() => [{ kind: 'block', from: 0, to: TEXT.length }])
    expect(rows(editor)).toHaveLength(0)
    editor.destroy()
  })

  it('removes the rows when the block scrolls past', () => {
    const editor = mount()
    expect(rows(editor)).toHaveLength(2)
    // Past line 4's bottom at 140, so the block the headers name is over.
    layout = { ...layout, viewTop: 150 }
    editor.input.dispatchEvent(new Event('scroll'))
    expect(rows(editor)).toHaveLength(0)
    editor.destroy()
  })

  it('ignores decorations of a kind that was not declared', () => {
    const editor = mount(() => [{ kind: 'note', from: 0, to: TEXT.length }])
    expect(rows(editor)).toHaveLength(0)
    editor.destroy()
  })

  it('takes the strip with it when the editor is destroyed', () => {
    const editor = mount()
    const strip = editor.element.querySelector('.litearea-sticky')
    expect(strip).not.toBeNull()
    editor.destroy()
    expect(document.querySelector('.litearea-sticky')).toBeNull()
  })
})
