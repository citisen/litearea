// ─── create: the one-line entry point ───────────────────────────────────────
//
// The class exists for a host that wants to hold the instance and drive it. This
// exists for the far more common case of wanting an editor in an element and not
// much else.

import { LiteArea, type LiteAreaOptions } from './editor.js'

/**
 * Build an editor and put it in an element.
 *
 * The `refresh` after mounting is not a formality. A textarea that is not in the
 * document has no layout, so it has no width, so nothing can be measured against it
 * — and a measurement taken then is not merely imprecise, it wraps the text at every
 * character and comes back several times too tall. The editor's own
 * `ResizeObserver` would correct it on the next frame, which means one frame of a box
 * at the wrong height. Measuring again here, synchronously, means the first frame is
 * already right.
 * @param target - where to mount it. Its contents are appended to, not replaced.
 * @param options - the grammar, the initial text, and the behaviour to use.
 * @returns the editor, so the caller can drive it.
 */
export function createEditor<State = unknown>(
  target: Element,
  options: LiteAreaOptions<State>,
): LiteArea<State> {
  const editor = new LiteArea(options)
  target.appendChild(editor.element)
  editor.refresh()
  return editor
}
