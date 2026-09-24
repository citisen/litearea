// ─── ghost: the inline preview of the row the list is on ─────────────────────
//
// A list tells the reader what COULD be typed; a ghost tells them what the thing they
// are already typing is about to become. The second one is a single line placed where
// the next character would land, so the reader sees `circle ` grow out of `cir`
// without looking away from the caret.
//
// The element is opaque on purpose. Ghost text stands where characters that are really
// in the document would stand, and a transparent overlay would put two texts on top of
// each other, at the same font, one legible and one not. An opaque chip covers the
// text it previews over and reads as one thing.
//
// Nothing here moves a glyph in the painted layer: the preview is its own element,
// positioned from a measurement of the caret, so the paint and the field keep agreeing
// character for character — which is the invariant the whole library is built on.

/** Where the preview belongs, relative to the wrapper. */
export interface GhostAnchor {
  /** The caret's left edge. The preview starts exactly there. */
  x: number
  /** The top of the caret's line. */
  y: number
  /** The height of the caret's line. */
  height: number
}

/**
 * The inline preview of one completion.
 *
 * One per editor, hidden until there is something to preview.
 */
export class Ghost {
  /** The preview element. */
  readonly element: HTMLDivElement

  /**
   * @param ownerDocument - the document to build in.
   */
  constructor(ownerDocument: Document) {
    this.element = ownerDocument.createElement('div')
    this.element.className = 'litearea-ghost'
    this.element.dataset.liteareaPart = 'ghost'
    // Hidden from assistive technology because it is a preview of an edit that has not
    // happened: the list already announces the same row through `aria-activedescendant`,
    // and a second reading of it would only be noise.
    this.element.setAttribute('aria-hidden', 'true')
    this.element.dataset.open = 'false'
  }

  /** Whether a preview is on screen. */
  get isOpen(): boolean {
    return this.element.dataset.open === 'true'
  }

  /**
   * Show the text that would be added at the caret.
   *
   * @param text - what the active row would write beyond what is already typed.
   * @param anchor - where the caret is, relative to the wrapper.
   */
  show(text: string, anchor: GhostAnchor): void {
    this.element.textContent = text
    this.element.style.left = `${String(Math.round(anchor.x))}px`
    this.element.style.top = `${String(Math.round(anchor.y))}px`
    // Written from the measurement rather than left to the stylesheet, because a row
    // that is a pixel taller than its line would push the caret's own line down.
    this.element.style.height = `${String(Math.round(anchor.height))}px`
    this.element.style.lineHeight = `${String(Math.round(anchor.height))}px`
    this.element.dataset.open = 'true'
  }

  /** Take the preview away. */
  hide(): void {
    if (this.element.dataset.open !== 'true') return
    this.element.dataset.open = 'false'
    this.element.textContent = ''
  }

  /** Take the preview out of the document. */
  destroy(): void {
    this.hide()
    this.element.remove()
  }
}
