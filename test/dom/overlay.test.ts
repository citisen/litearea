// @vitest-environment happy-dom
//
// The painter's one layout obligation to the field: a document that ends in a newline
// has a final EMPTY line, and the paint has to lay that line out.
//
// This is the smallest test in the suite and it guards the ugliest failure in the
// library. A textarea lays the empty last line out; a `pre-wrap` div does not. The paint
// is therefore one line shorter than the field, which nobody notices until the content
// is tall enough to scroll — and then the field scrolls one line further than the text
// and the caret appears to detach from its line. It cannot be caught in `happy-dom` by
// measuring, so what is asserted here is the mechanism that makes the difference
// measurable in a real browser.

import { describe, expect, it } from 'vitest'
import { Overlay } from '../../src/dom/overlay.js'

/** An overlay wired to the class names the editor passes in. */
function overlay(): Overlay {
  return new Overlay(document, {
    scope: (scope) => `litearea-scope-${scope}`,
    decoration: (kind) => `litearea-dec-${kind}`,
    severity: (severity) => `litearea-diag-${severity}`,
  })
}

/** Paint a document and hand back the paint element. */
function painted(text: string): HTMLElement {
  const instance = overlay()
  instance.render(text, { tokens: [], decorations: [], diagnostics: [] }, text)
  return instance.paintElement
}

/** How many `br` elements the paint ends with. */
function trailingBreaks(paint: HTMLElement): number {
  let count = 0
  for (let at = paint.children.length - 1; at >= 0; at -= 1) {
    if (paint.children[at]?.tagName !== 'BR') break
    count += 1
  }
  return count
}

describe('Overlay.render', () => {
  it('lays out the empty last line of a document that ends in a newline', () => {
    expect(trailingBreaks(painted('alpha\n'))).toBe(1)
  })

  it('does not add a line to a document that ends in a character', () => {
    // The other direction is just as wrong and much easier to spot: an extra line box
    // would make the paint taller than the field, and the text would drift the other way.
    expect(trailingBreaks(painted('alpha'))).toBe(0)
    expect(trailingBreaks(painted('alpha\nbeta'))).toBe(0)
  })

  it('adds exactly one line, however many newlines run to the end', () => {
    // One newline leaves one empty line, and a run of them leaves a run of them: a div
    // lays all but the LAST one out itself, because each newline breaks a line and only
    // the final one has nothing after it. One `br` is therefore the whole correction,
    // and adding one per newline would grow the paint instead.
    expect(trailingBreaks(painted('alpha\n'))).toBe(1)
    expect(trailingBreaks(painted('alpha\n\n'))).toBe(1)
    expect(trailingBreaks(painted('alpha\n\n\n'))).toBe(1)
  })

  it('keeps the painted text exactly the document', () => {
    // The whole point of a `br` rather than a zero-width space: it earns the line box
    // without contributing a character, so the invariant the layer alignment rests on —
    // that the paint reproduces the field's text character for character — still holds.
    const withNewline = painted('alpha\n')
    expect(withNewline.textContent).toBe('alpha\n')
    expect(withNewline.querySelectorAll('br')).toHaveLength(1)
  })

  it('handles a carriage return as the terminator', () => {
    expect(trailingBreaks(painted('alpha\r'))).toBe(1)
  })

  it('paints nothing at all for an empty document', () => {
    const empty = painted('')
    expect(empty.textContent).toBe('')
    expect(trailingBreaks(empty)).toBe(0)
  })

  it('does not double up when the same document is painted twice', () => {
    // The paint is skipped entirely when text and key are unchanged, so the render is
    // idempotent; a second call with a new key must still leave one line, not two.
    const instance = overlay()
    instance.render('alpha\n', { tokens: [], decorations: [], diagnostics: [] }, 'a')
    instance.render('alpha\n', { tokens: [], decorations: [], diagnostics: [] }, 'b')
    expect(trailingBreaks(instance.paintElement)).toBe(1)
    expect(instance.paintElement.textContent).toBe('alpha\n')
  })
})
