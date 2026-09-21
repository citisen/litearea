// ─── popup: the completion list ─────────────────────────────────────────────
//
// Three parts, and the split between them is the whole design:
//
//     div.litearea-popup          the positioned container; scrolls NOTHING
//       div.litearea-list         the scroller, and the listbox role; holds rows only
//       div.litearea-docs         the documentation, pinned below the list
//
// The documentation used to be appended INSIDE the scrolling element, after the rows, and
// that made it unreachable in the one case it matters most: with a long list and a long
// explanation, the explanation sat at the end of the scroll range, so a keyboard user could
// never see it at all — the arrows move the active row, not the scrollbar — and a mouse user
// had to scroll down to read it and then back up to reach the next row. Pinning it outside the
// scroller fixes both, because the panel never moves when the list scrolls and never has to be
// scrolled to in the first place.
//
// Two interaction details are also deliberate. A pick must not blur the field: a click fires
// `mousedown` before `blur`, so the row listens for `mousedown`, cancels the default to keep
// the focus, and accepts — listening for `click` instead means the field is already blurred by
// the time the handler runs. And the list scrolls only as far as the active row needs, because
// a list that re-centres on every arrow press looks like it is jumping.

import type { CompletionRow, SuggestionItem } from '../core/types.js'
import { highlightSegments } from '../core/rank.js'

/** Where a floating element is allowed to sit. */
export interface AnchorBox {
  /** Distance from the positioning container's left edge. */
  x: number
  /** Distance from the positioning container's top edge. */
  y: number
  /** The height of the line the anchor sits on. */
  height: number
}

/** What the list tells its owner. */
export interface PopupHandlers {
  /** A row was chosen with the mouse. */
  accept(index: number): void
  /** The pointer moved over a row, which makes it active. */
  hover(index: number): void
}

/** The completion list, with its documentation panel. */
export class Popup {
  /** The positioned container. */
  readonly element: HTMLDivElement
  /** The scrolling element, which holds the rows and nothing else. */
  readonly list: HTMLDivElement
  private readonly document: Document
  private readonly handlers: PopupHandlers
  private rows: readonly CompletionRow[] = []
  private active = -1
  private open = false
  private showDocs = true
  private readonly docs: HTMLDivElement
  private readonly prefix: string

  /**
   * @param ownerDocument - the document to build in.
   * @param handlers - how to report a pick and a hover.
   * @param idPrefix - a stable prefix for row ids, so two editors do not collide.
   */
  constructor(ownerDocument: Document, handlers: PopupHandlers, idPrefix: string) {
    this.document = ownerDocument
    this.handlers = handlers
    this.prefix = idPrefix

    this.element = ownerDocument.createElement('div')
    this.element.className = 'litearea-popup'
    this.element.dataset.liteareaPart = 'popup'
    this.element.dataset.open = 'false'

    this.list = ownerDocument.createElement('div')
    this.list.className = 'litearea-list'
    this.list.setAttribute('role', 'listbox')
    this.list.id = `${idPrefix}-listbox`
    this.element.appendChild(this.list)

    this.docs = ownerDocument.createElement('div')
    this.docs.className = 'litearea-docs'
    this.docs.hidden = true
    this.element.appendChild(this.docs)

    // Bound to the list rather than to each row, so replacing every row on each keystroke does
    // not mean attaching and detaching listeners on every keystroke.
    this.list.addEventListener('mousedown', this.onMouseDown)
    this.list.addEventListener('mousemove', this.onMouseMove)
  }

  /** Whether the list is showing. */
  get isOpen(): boolean {
    return this.open
  }

  /** The active row's index, or -1. */
  get activeIndex(): number {
    return this.active
  }

  /** The rows currently shown. */
  get items(): readonly CompletionRow[] {
    return this.rows
  }

  /** The active row, when there is one. */
  get activeRow(): CompletionRow | undefined {
    return this.rows[this.active]
  }

  /** The id the field's `aria-controls` should name. It is the list, not the container. */
  get listId(): string {
    return this.list.id
  }

  /**
   * The id of the active row, for the field's `aria-activedescendant`.
   *
   * The list does not write that attribute itself: the field belongs to the editor, and a
   * floating list reaching out of its own subtree to find it is the kind of coupling that
   * breaks the moment the two are mounted somewhere unexpected.
   * @returns the row id, or undefined when no row is active.
   */
  get activeRowId(): string | undefined {
    return this.active >= 0 ? this.rowId(this.active) : undefined
  }

  /**
   * Show a list.
   * @param rows - the rows, already ranked.
   * @param active - the row to make active.
   * @param showDocs - whether to render the documentation panel.
   */
  show(rows: readonly CompletionRow[], active: number, showDocs: boolean): void {
    this.rows = rows
    this.active = active
    this.showDocs = showDocs
    this.open = true
    this.element.dataset.open = 'true'
    this.element.dataset.docs = showDocs ? 'true' : 'false'
    this.list.scrollTop = 0
    this.render()
  }

  /** Hide the list and forget its rows. */
  close(): void {
    if (!this.open) return
    this.open = false
    this.active = -1
    this.rows = []
    this.element.dataset.open = 'false'
    this.list.replaceChildren()
    this.docs.hidden = true
    this.docs.replaceChildren()
  }

  /**
   * Make a row active without rebuilding the list.
   * @param index - the row index.
   */
  setActive(index: number): void {
    if (index === this.active) return
    const previous = this.list.querySelector<HTMLElement>(`#${this.rowId(this.active)}`)
    if (previous !== null) previous.setAttribute('aria-selected', 'false')
    this.active = index
    const next = this.list.querySelector<HTMLElement>(`#${this.rowId(index)}`)
    if (next !== null) {
      next.setAttribute('aria-selected', 'true')
      // Only as far as needed, and only the LIST scrolls: the documentation panel is outside
      // this element, so moving the active row can never push the explanation out of sight.
      const top = next.offsetTop
      const bottom = top + next.offsetHeight
      if (top < this.list.scrollTop) this.list.scrollTop = top
      else if (bottom > this.list.scrollTop + this.list.clientHeight) {
        this.list.scrollTop = bottom - this.list.clientHeight
      }
    }
    this.renderDocs()
  }

  /**
   * Place the list under an anchor, flipping above it when there is no room below.
   *
   * The container's own box is what is measured, so the documentation panel counts towards the
   * height and a popup whose rows and explanation together would run off the bottom flips as a
   * whole rather than being cut in half.
   * @param anchor - the caret's box, in the container's coordinates.
   * @param container - the element the list is positioned against.
   * @param viewport - the visible area to stay inside.
   */
  place(anchor: AnchorBox, container: HTMLElement, viewport: { width: number; height: number }): void {
    const box = this.element.getBoundingClientRect()
    const containerBox = container.getBoundingClientRect()
    const gap = 4
    let top = anchor.y + anchor.height + gap
    if (containerBox.top + top + box.height > viewport.height - gap) {
      const above = anchor.y - box.height - gap
      // Flipping only helps if there is somewhere to flip TO; otherwise the list stays below
      // and is clamped by the max-heights in the stylesheet.
      if (containerBox.top + above >= gap) top = above
    }
    let left = anchor.x
    const maxLeft = containerBox.width - box.width
    if (left > maxLeft) left = Math.max(0, maxLeft)
    this.element.style.top = `${String(Math.round(top))}px`
    this.element.style.left = `${String(Math.round(left))}px`
  }

  /** Take the list out of the document. */
  destroy(): void {
    this.list.removeEventListener('mousedown', this.onMouseDown)
    this.list.removeEventListener('mousemove', this.onMouseMove)
    this.element.remove()
    this.list.replaceChildren()
    this.docs.replaceChildren()
  }

  /** The DOM id of a row, which `aria-activedescendant` points at. */
  rowId(index: number): string {
    return `${this.prefix}-row-${String(index)}`
  }

  // ── internals ────────────────────────────────────────────────────────────

  private render(): void {
    const fragment = this.document.createDocumentFragment()
    this.rows.forEach((row, index) => {
      const element = this.document.createElement('div')
      element.className = 'litearea-row'
      element.id = this.rowId(index)
      element.setAttribute('role', 'option')
      element.setAttribute('aria-selected', index === this.active ? 'true' : 'false')
      element.dataset.index = String(index)

      const kind = this.document.createElement('span')
      kind.className = `litearea-rowKind litearea-kind-${row.item.kind ?? 'value'}`
      element.appendChild(kind)

      const label = this.document.createElement('span')
      label.className = 'litearea-rowLabel'
      // Emphasised as segments rather than as markup: a font family may legitimately be called
      // `<b>`, and a list that built HTML from a label would either render it or have to escape
      // it, and both are wrong for text that came from the user's machine.
      for (const piece of highlightSegments(row.item.label, row.indices)) {
        if (piece.matched) {
          const mark = this.document.createElement('span')
          mark.className = 'litearea-rowMatch'
          mark.textContent = piece.text
          label.appendChild(mark)
        } else {
          label.appendChild(this.document.createTextNode(piece.text))
        }
      }
      element.appendChild(label)

      if (row.item.detail !== undefined) {
        const detail = this.document.createElement('span')
        detail.className = 'litearea-rowDetail'
        detail.textContent = row.item.detail
        element.appendChild(detail)
      }
      fragment.appendChild(element)
    })

    // Rows go in the list and nowhere else. The documentation is a sibling that is never
    // rebuilt here, so converting a long explanation cannot disturb the scroll position.
    this.list.replaceChildren(fragment)
    this.renderDocs()
  }

  /** Refresh the documentation panel from the active row. */
  private renderDocs(): void {
    const item: SuggestionItem | undefined = this.rows[this.active]?.item
    const hasDocs =
      this.showDocs &&
      this.open &&
      item !== undefined &&
      (item.documentation !== undefined || item.detail !== undefined)
    this.docs.hidden = !hasDocs
    if (!hasDocs || item === undefined) {
      this.docs.replaceChildren()
      return
    }
    const fragment = this.document.createDocumentFragment()
    const title = this.document.createElement('div')
    title.className = 'litearea-docsTitle'
    title.textContent = item.label
    fragment.appendChild(title)
    if (item.detail !== undefined) {
      const detail = this.document.createElement('div')
      detail.className = 'litearea-docsDetail'
      detail.textContent = item.detail
      fragment.appendChild(detail)
    }
    if (item.documentation !== undefined) {
      const body = this.document.createElement('div')
      body.className = 'litearea-docsBody'
      body.textContent = item.documentation
      fragment.appendChild(body)
    }
    this.docs.replaceChildren(fragment)
    // A new explanation is read from its beginning, which matters when the previous one was
    // long enough to have been scrolled.
    this.docs.scrollTop = 0
  }

  private readonly onMouseDown = (event: MouseEvent): void => {
    const row = (event.target as HTMLElement | null)?.closest<HTMLElement>('.litearea-row')
    if (row === null || row === undefined) return
    // Before blur, and cancelling the default is what keeps the field focused.
    event.preventDefault()
    const index = Number.parseInt(row.dataset.index ?? '-1', 10)
    if (Number.isInteger(index) && index >= 0) this.handlers.accept(index)
  }

  private readonly onMouseMove = (event: MouseEvent): void => {
    const row = (event.target as HTMLElement | null)?.closest<HTMLElement>('.litearea-row')
    if (row === null || row === undefined) return
    const index = Number.parseInt(row.dataset.index ?? '-1', 10)
    if (!Number.isInteger(index) || index < 0 || index === this.active) return
    this.handlers.hover(index)
  }
}
