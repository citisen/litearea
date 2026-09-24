// ─── mirror: measuring text the textarea will not tell us ───────────────────
//
// A textarea can report its `scrollHeight` and its selection offsets, and that is
// the whole of it. It cannot say where the caret is on screen, and its
// `scrollHeight` cannot be trusted while its own height is being changed — asking
// for it means first collapsing the element, which reflows the page and makes the
// box flicker on every keystroke.
//
// So a second element is kept offscreen with the field's exact typography and the
// same box, and the question is asked of IT. Two jobs come out of the same
// element: where the caret is, and how tall the content is. Both are pure
// measurements of text, both need the same copied styles, and both are wrong in
// the same way if a single property is missed — which is why there is one mirror
// and not two.
//
// `visibility: hidden` rather than `display: none`, because a hidden element still
// lays out and a removed one does not.

import { clamp } from '../core/text.js'

/**
 * The properties that decide where a glyph lands.
 *
 * Anything in this list that the mirror does not copy makes every measurement
 * wrong by a little, and the failures are not obvious: a missing
 * `letter-spacing` moves the caret a fraction of a character per character, so the
 * popup drifts further off the longer the line is. The list is deliberately
 * exhaustive rather than "the ones that seemed to matter".
 */
const COPIED_PROPERTIES = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'fontStretch',
  'fontVariantLigatures',
  'fontKerning',
  'fontFeatureSettings',
  'lineHeight',
  'letterSpacing',
  'wordSpacing',
  'textTransform',
  'textIndent',
  'textAlign',
  'direction',
  'tabSize',
  'whiteSpace',
  'overflowWrap',
  'wordBreak',
  'hyphens',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderTopStyle',
  'borderRightStyle',
  'borderBottomStyle',
  'borderLeftStyle',
  'boxSizing',
] as const

/** Where the caret is, in pixels relative to the field's border box. */
export interface CaretBox {
  /** Distance from the field's left border edge to the caret. */
  x: number
  /** Distance from the field's top border edge to the caret's line box. */
  y: number
  /** The height of the caret's line. */
  height: number
  /** The line height in force, whether or not it was declared. */
  lineHeight: number
}

/** A zero-width space: content that draws nothing and occupies a line. */
const SENTINEL = '\u200b'

/**
 * An offscreen element that lays text out exactly as a given textarea does.
 *
 * One instance per field is enough; the editor owns exactly one.
 */
export class TextMirror {
  /** The measuring element. Kept out of the document's flow by `position: fixed`. */
  readonly element: HTMLDivElement
  private readonly document: Document
  private readonly view: Window | undefined
  /** The field this mirror is currently shaped like. */
  private adopted: HTMLTextAreaElement | undefined
  /** The line height measured with the field, or 0 before the first measurement. */
  private measuredLineHeight = 0

  /**
   * @param ownerDocument - the document to create the element in.
   */
  constructor(ownerDocument: Document) {
    this.document = ownerDocument
    this.view = ownerDocument.defaultView ?? undefined
    this.element = ownerDocument.createElement('div')
    this.element.setAttribute('aria-hidden', 'true')
    this.element.dataset.liteareaPart = 'mirror'
    // `white-space: pre-wrap` is the one property both jobs depend on absolutely:
    // a newline has to break the line in the mirror exactly as it does in the
    // field, and a run of spaces has to survive.
    this.element.style.cssText = [
      'position:fixed',
      'top:0',
      'left:0',
      'visibility:hidden',
      'pointer-events:none',
      'z-index:-1',
      'margin:0',
      'overflow:hidden',
      'white-space:pre-wrap',
      'overflow-wrap:break-word',
      'word-break:break-word',
      'box-sizing:border-box',
    ].join(';')
  }

  /** Whether the mirror is in a document. */
  get mounted(): boolean {
    return this.element.isConnected
  }

  /**
   * Mount the mirror, once, so measurements have a layout to read.
   * @param parent - where to mount it. The body is right unless the document has none.
   */
  mount(parent?: Element): void {
    if (this.mounted) return
    const host = parent ?? this.document.body ?? this.document.documentElement
    if (host === null || host === undefined) return
    host.appendChild(this.element)
  }

  /**
   * Shape the mirror like a field.
   *
   * The width is the interesting part. It has to be the field's CONTENT width, or
   * text wraps in one and not the other — and the field's `clientWidth` is its
   * content plus padding but NOT its border, while the mirror is `border-box`. So
   * the borders are added back, and what is deliberately left out is the
   * scrollbar: a field clamped to its maximum height has one, and the text wraps
   * inside the narrower area above it.
   * @param field - the textarea to imitate.
   */
  adopt(field: HTMLTextAreaElement): void {
    this.mount()
    this.adopted = field
    const view = this.view
    if (view === null || view === undefined) return
    const styles = view.getComputedStyle(field)
    for (const property of COPIED_PROPERTIES) {
      this.element.style.setProperty(
        property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
        styles.getPropertyValue(property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)),
      )
    }
    const borderLeft = Number.parseFloat(styles.borderLeftWidth) || 0
    const borderRight = Number.parseFloat(styles.borderRightWidth) || 0
    this.element.style.width = `${String(field.clientWidth + borderLeft + borderRight)}px`
    this.measuredLineHeight = 0
  }

  /**
   * The line height in force, measured rather than assumed.
   *
   * `line-height: normal` is a real value and a common one, and it cannot be read
   * as a number — `parseFloat('normal')` is `NaN`. So it is measured by laying one
   * line of text out and taking the height, which is also the only way to be right
   * about a font whose normal leading is not 1.2.
   * @param field - the field to measure against.
   * @returns the line height in pixels.
   */
  lineHeight(field: HTMLTextAreaElement): number {
    if (this.measuredLineHeight > 0) return this.measuredLineHeight
    const view = this.view
    if (view === null || view === undefined) return 0
    const styles = view.getComputedStyle(field)
    const declared = Number.parseFloat(styles.lineHeight)
    if (Number.isFinite(declared) && declared > 0) {
      this.measuredLineHeight = declared
      return declared
    }
    this.adopt(field)
    this.setText('M')
    const padding = this.verticalPadding()
    const height = this.element.getBoundingClientRect().height - padding
    // A font that reports nothing usable still needs an answer, and 1.2 × the font
    // size is what `normal` means for essentially every font in practice.
    const fontSize = Number.parseFloat(styles.fontSize)
    const fallback = (Number.isFinite(fontSize) ? fontSize : 16) * 1.2
    this.measuredLineHeight = height > 0 ? height : fallback
    return this.measuredLineHeight
  }

  /** The mirror's vertical padding plus border, which every height includes. */
  verticalPadding(): number {
    const view = this.view
    if (view === null || view === undefined) return 0
    const styles = view.getComputedStyle(this.element)
    const sum =
      (Number.parseFloat(styles.paddingTop) || 0) +
      (Number.parseFloat(styles.paddingBottom) || 0) +
      (Number.parseFloat(styles.borderTopWidth) || 0) +
      (Number.parseFloat(styles.borderBottomWidth) || 0)
    return sum
  }

  /**
   * Put text in the mirror with nothing else in it.
   * @param text - the content.
   */
  setText(text: string): void {
    this.element.textContent = text
  }

  /**
   * The height a field needs to show a document without scrolling.
   *
   * The trailing-newline problem is handled here. A div with `white-space:
   * pre-wrap` and content ending in `\n` does not lay out a final empty line — the
   * newline breaks the line but nothing follows it — so the measured height comes
   * back one line short and the field grows a scrollbar exactly when the user
   * presses Enter at the end. A zero-width space after the newline gives that last
   * line something to be.
   * @param field - the field being sized.
   * @param value - the text it holds.
   * @returns the border-box height the content requires.
   */
  contentHeight(field: HTMLTextAreaElement, value: string): number {
    this.adopt(field)
    const needsSentinel = value === '' || value.endsWith('\n') || value.endsWith('\r')
    this.setText(needsSentinel ? `${value}${SENTINEL}` : value)
    return this.element.getBoundingClientRect().height
  }

  /**
   * Where the caret sits, in pixels relative to the field's border box.
   *
   * The trick is a marker element holding the character AFTER the caret, measured
   * against the mirror. Everything before the caret lays out normally, so the
   * marker lands exactly where the next glyph will be — which is where the caret
   * is. At the end of the document there is no next character, so a zero-width
   * space stands in for it.
   *
   * The box returned is the caret's LINE box, not the marker's own box, and the
   * difference is not academic. A bounding rect on an inline element reports the font's
   * CONTENT area — about 15px for 13px monospace — while the line it sits in is the line
   * height, 20px, with the leading split above and below. A caller drawing one line of
   * text against another needs the line box: given the content box it lands a couple of
   * pixels low, which is invisible under a popup placed below the caret and plainly
   * visible in a chip of text that has to line up with the text beside it.
   *
   * The field's own scroll offset is subtracted, because the caret's position on
   * screen is what the popup has to be placed against, and a scrolled field moves
   * its text without moving its border box.
   *
   * @param field - the field the caret is in.
   * @param offset - the caret's character offset.
   * @returns the caret box, or undefined when there is no layout to measure.
   */
  caretBox(field: HTMLTextAreaElement, offset: number): CaretBox | undefined {
    const view = this.view
    if (view === null || view === undefined) return undefined
    this.adopt(field)
    const value = field.value
    const position = clamp(offset, 0, value.length)
    const before = value.slice(0, position)
    const after = value.slice(position)
    const next = after === '' ? SENTINEL : after.charAt(0)

    // Rebuilt rather than patched: the mirror is offscreen and measuring it is
    // cheap, while keeping incremental DOM in step with a fast typist is not.
    this.element.textContent = ''
    this.element.appendChild(this.document.createTextNode(before))
    const marker = this.document.createElement('span')
    marker.textContent = next
    // A span that can wrap would let the marker jump to the next line on its own,
    // which is exactly the wrong answer for a caret at a line end.
    marker.style.whiteSpace = 'pre'
    this.element.appendChild(marker)
    this.element.appendChild(this.document.createTextNode(after.slice(next.length)))

    const mirrorRect = this.element.getBoundingClientRect()
    const markerRect = marker.getBoundingClientRect()
    const lineHeight = this.lineHeight(field)
    const glyphs = markerRect.height > 0 ? markerRect.height : lineHeight
    const lead = Math.max(0, lineHeight - glyphs) / 2
    return {
      x: markerRect.left - mirrorRect.left - field.scrollLeft,
      y: markerRect.top - mirrorRect.top - field.scrollTop - lead,
      height: lineHeight,
      lineHeight,
    }
  }

  /** Take the mirror out of the document. */
  destroy(): void {
    this.element.remove()
    this.adopted = undefined
  }

  /**
   * The field this mirror was last shaped like.
   * @returns the field, or undefined before {@link adopt}.
   */
  get field(): HTMLTextAreaElement | undefined {
    return this.adopted
  }
}
