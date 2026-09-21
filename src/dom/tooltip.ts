// ─── tooltip: what the pointer is resting on ────────────────────────────────
//
// One floating element, positioned near the thing it describes and kept inside the
// viewport. It never takes the pointer: a tooltip that can be hovered is a tooltip
// that flickers, because moving the mouse onto it leaves the thing that opened it.
//
// The content is deliberately plain text, not markup. A grammar supplies strings,
// those strings may be a font family called `<b>` or a value containing `#`, and a
// tooltip that rendered them as HTML would either mis-render the text or have to
// escape it — both wrong for text the user typed.

import type { HoverInfo } from '../core/types.js'

/** Where a floating element is allowed to sit. */
export interface TooltipAnchor {
  /** Distance from the positioning container's left edge. */
  x: number
  /** Distance from the positioning container's top edge. */
  y: number
  /** The height of the anchored line or range. */
  height: number
}

/** The hover tooltip. */
export class Tooltip {
  /** The tooltip element. */
  readonly element: HTMLDivElement
  private readonly document: Document
  private open = false

  /**
   * @param ownerDocument - the document to build in.
   */
  constructor(ownerDocument: Document) {
    this.document = ownerDocument
    this.element = ownerDocument.createElement('div')
    this.element.className = 'litearea-tooltip'
    this.element.setAttribute('role', 'tooltip')
    this.element.dataset.liteareaPart = 'tooltip'
    this.element.dataset.open = 'false'
  }

  /** Whether the tooltip is showing. */
  get isOpen(): boolean {
    return this.open
  }

  /**
   * Show a hover.
   * @param info - what to say.
   * @param anchor - where the thing being described is.
   * @param container - the element the tooltip is positioned against.
   * @param viewport - the visible area to stay inside.
   */
  show(
    info: HoverInfo,
    anchor: TooltipAnchor,
    container: HTMLElement,
    viewport: { width: number; height: number },
  ): void {
    const fragment = this.document.createDocumentFragment()
    if (info.title !== undefined) {
      const title = this.document.createElement('div')
      title.className = 'litearea-tooltipTitle'
      title.textContent = info.title
      fragment.appendChild(title)
    }
    if (info.detail !== undefined && info.detail !== '') {
      const detail = this.document.createElement('div')
      detail.className = 'litearea-tooltipDetail'
      detail.textContent = info.detail
      fragment.appendChild(detail)
    }
    if (info.body !== undefined && info.body !== '') {
      const body = this.document.createElement('div')
      body.className = 'litearea-tooltipBody'
      body.textContent = info.body
      fragment.appendChild(body)
    }
    this.element.replaceChildren(fragment)
    this.open = true
    this.element.dataset.open = 'true'

    const box = this.element.getBoundingClientRect()
    const containerBox = container.getBoundingClientRect()
    const gap = 6
    let top = anchor.y + anchor.height + gap
    if (containerBox.top + top + box.height > viewport.height - gap) {
      const above = anchor.y - box.height - gap
      top = containerBox.top + above >= gap ? above : Math.max(0, viewport.height - gap - box.height - containerBox.top)
    }
    let left = anchor.x
    const overflowRight = containerBox.left + left + box.width - (viewport.width - gap)
    if (overflowRight > 0) left = Math.max(0, left - overflowRight)
    this.element.style.top = `${String(Math.round(top))}px`
    this.element.style.left = `${String(Math.round(left))}px`
  }

  /** Hide the tooltip. */
  hide(): void {
    if (!this.open) return
    this.open = false
    this.element.dataset.open = 'false'
    this.element.replaceChildren()
  }

  /** Take the tooltip out of the document. */
  destroy(): void {
    this.element.remove()
    this.element.replaceChildren()
  }
}
