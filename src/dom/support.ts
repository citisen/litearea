// ─── support: what this browser can actually do ─────────────────────────────
//
// The engine is pure and needs nothing. This module is the only place that asks
// the environment a question, so the answer is in one place and the rest of the
// DOM layer can assume it.

/** Whether a document is available at all, so an import is safe under Node. */
export function hasDocument(): boolean {
  return typeof document !== 'undefined' && document !== null
}

/**
 * Whether the browser still offers `document.execCommand`.
 *
 * It is deprecated, and it is also the only way to change a textarea's value while
 * keeping the browser's own undo stack intact — no modern input API can be driven
 * from script, because a synthetic event is untrusted and the browser refuses to
 * treat it as a user edit. So the check is not "is this nice API available" but
 * "can this edit be undone", and the editor degrades honestly when the answer is
 * no: the edit still lands, and the history it should have joined does not.
 * @returns whether an undo-preserving edit is possible.
 */
export function canEditThroughPipeline(): boolean {
  return hasDocument() && typeof document.execCommand === 'function'
}

/** Whether `caretPositionFromPoint` or its WebKit spelling exists. */
export function hasCaretHitTest(): boolean {
  if (!hasDocument()) return false
  const probe = document as Document & {
    caretPositionFromPoint?: unknown
    caretRangeFromPoint?: unknown
  }
  return (
    typeof probe.caretPositionFromPoint === 'function' ||
    typeof probe.caretRangeFromPoint === 'function'
  )
}

/**
 * The character offset a point in the viewport falls on, according to the browser.
 *
 * The browser is asked rather than the editor computing it, because hit-testing
 * wrapped, proportional text is exactly the kind of geometry a hand-written
 * measurement gets subtly wrong. A textarea's transparent text still lays out
 * normally, so the caret APIs answer for it correctly.
 * @param x - viewport x.
 * @param y - viewport y.
 * @returns the offset, or undefined when the browser cannot say.
 */
export function offsetFromPoint(x: number, y: number): number | undefined {
  if (!hasDocument()) return undefined
  const probe = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  if (typeof probe.caretPositionFromPoint === 'function') {
    const position = probe.caretPositionFromPoint(x, y)
    if (position !== null && position !== undefined) return position.offset
    return undefined
  }
  if (typeof probe.caretRangeFromPoint === 'function') {
    const range = probe.caretRangeFromPoint(x, y)
    if (range !== null && range !== undefined) return range.startOffset
  }
  return undefined
}

/**
 * Merge partial option objects without letting an explicit `undefined` win.
 *
 * `{ ...defaults, ...given }` looks right and is wrong the moment a caller passes
 * an optional field it did not fill in: the key exists, so it overwrites the
 * default with `undefined`, and the editor then behaves as if the option had been
 * switched off. This copies only the keys that were actually provided.
 * @param defaults - the base.
 * @param given - the overrides, which may be undefined.
 * @returns the merged object.
 */
export function withDefaults<T extends object>(defaults: T, given: Partial<T> | undefined): T {
  if (given === undefined) return { ...defaults }
  const merged = { ...defaults }
  for (const key of Object.keys(given) as Array<keyof T>) {
    const value = given[key]
    if (value !== undefined) merged[key] = value as T[keyof T]
  }
  return merged
}
