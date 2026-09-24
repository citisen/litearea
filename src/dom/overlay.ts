// ─── overlay: the painted layer behind the field ────────────────────────────
//
// The layer draws the same characters as the textarea, in colour, and it is
// positioned to share the field's box exactly. It never measures anything: the
// segments come out of `buildSegments` in document order and are appended back to
// back, so the browser's own text layout puts every character where the field put
// it. The only thing this module does besides writing DOM is keep the layer
// scrolled with the field.

import type { SegmentInput } from '../core/segments.js'
import { buildSegments, segmentClasses } from '../core/segments.js'

/** How the layer turns a scope, a decoration, or a severity into a class. */
export interface OverlayClassNames {
  scope: (scope: string) => string
  decoration: (kind: string) => string
  severity: (severity: string) => string
}

/** The painted layer and the element that holds the paint. */
export class Overlay {
  /** The scroll container. Same box as the field. */
  readonly element: HTMLDivElement
  /** The element the spans are written into. */
  private readonly paint: HTMLDivElement
  private readonly document: Document
  private readonly classNames: OverlayClassNames
  /** What was painted last, so an unchanged document is not repainted. */
  private paintedText: string | undefined
  private paintedKey = ''

  /**
   * @param ownerDocument - the document to build in.
   * @param classNames - the three class-name mappings.
   */
  constructor(ownerDocument: Document, classNames: OverlayClassNames) {
    this.document = ownerDocument
    this.classNames = classNames
    this.element = ownerDocument.createElement('div')
    this.element.className = 'litearea-layer'
    this.element.setAttribute('aria-hidden', 'true')
    this.element.dataset.liteareaPart = 'layer'
    this.paint = ownerDocument.createElement('div')
    this.paint.className = 'litearea-paint'
    this.element.appendChild(this.paint)
  }

  /**
   * The element the spans are written into.
   *
   * Exposed because the paint is the only element that has already laid the document
   * out exactly as the field did, so it is the one place a line's box can be measured
   * from — which is what the sticky rows need.
   */
  get paintElement(): HTMLDivElement {
    return this.paint
  }

  /**
   * Paint a document.
   *
   * `key` is whatever the caller knows changed. When it and the text both match
   * the last call the work is skipped, which is what keeps a caret move or a
   * mouse hover from rebuilding every span on the page.
   * @param text - the document.
   * @param input - the tokens, decorations, and diagnostics.
   * @param key - a cheap signature of everything that affects the paint.
   * @param fallbackScope - the scope for characters no token covers.
   */
  render(text: string, input: SegmentInput, key: string, fallbackScope = 'text'): void {
    if (this.paintedText === text && this.paintedKey === key) return
    const segments = buildSegments(text, input, fallbackScope)
    const fragment = this.document.createDocumentFragment()
    for (const segment of segments) {
      const span = this.document.createElement('span')
      span.className = segmentClasses(
        segment,
        this.classNames.scope,
        this.classNames.decoration,
        this.classNames.severity,
      ).join(' ')
      if (segment.title !== undefined) span.title = segment.title
      span.textContent = segment.text
      fragment.appendChild(span)
    }
    this.paint.replaceChildren(fragment)
    // A document that ends in a newline has a LAST LINE that is empty, and a textarea
    // lays it out: that is a line the reader can put the caret on, and it is part of
    // the field's scrollable height. A div with `white-space: pre-wrap` does not lay it
    // out — the newline breaks the line and nothing follows it — so `min-height: 100%`
    // covers only the case where the content fits the box. When it does not fit, which
    // is exactly when there is a scrollbar, the field scrolls one line further than the
    // paint and the caret walks away from the text under it.
    //
    // A `<br>` gives that line a box and contributes NO characters, so the layer still
    // reproduces the document exactly — which is why this is an element and not a
    // zero-width space in the text.
    if (text.endsWith('\n') || text.endsWith('\r')) {
      this.paint.appendChild(this.document.createElement('br'))
    }
    this.paintedText = text
    this.paintedKey = key
  }

  /**
   * Follow the field's scroll position.
   *
   * The layer is `overflow: hidden` and its content is taller than its box exactly
   * when the field is: an auto-grown field has nothing to scroll and a field
   * clamped to its maximum height has everything to scroll. Copying the offset is
   * therefore enough, and it is more reliable than a transform, which can leave
   * the text on a half pixel.
   * @param field - the textarea.
   */
  syncScroll(field: HTMLTextAreaElement): void {
    if (this.element.scrollTop !== field.scrollTop) this.element.scrollTop = field.scrollTop
    if (this.element.scrollLeft !== field.scrollLeft) this.element.scrollLeft = field.scrollLeft
  }

  /** Forget what was painted, so the next render rebuilds. */
  invalidate(): void {
    this.paintedText = undefined
    this.paintedKey = ''
  }

  /** Take the layer out of the document. */
  destroy(): void {
    this.element.remove()
    this.paint.replaceChildren()
  }
}
