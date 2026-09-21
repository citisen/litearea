// ─── editing: changing a textarea without breaking its history ──────────────
//
// This is the module the whole library exists to get right.
//
// A textarea owns its own undo stack, and that stack is maintained by the
// browser's editing pipeline — not by the value property. Assigning to
// `field.value` replaces the text and DESTROYS the history, which is why a
// controlled component that round-trips every keystroke through React state (or a
// state setter of any kind) has no working Ctrl+Z. It also resets the caret to the
// end, which is the other half of the same mistake.
//
// So the editor never writes `value` for an edit the user could have made. It
// moves the selection and asks the browser to insert text, which the browser
// records as one undoable edit:
//
//     field.setSelectionRange(from, to)
//     document.execCommand('insertText', false, text)   // ← undoable
//
// `execCommand` is deprecated, and there is no replacement. A synthetic
// `beforeinput` or `InputEvent` is untrusted, so the browser will not run it
// through the editing pipeline; `setRangeText` is the standard API and bypasses
// the history entirely. Every editor that supports undo on a textarea uses this
// call. Where it is missing the edit still happens through `setRangeText`, and the
// caller is told plainly that the history did not get it, so a host can decide
// whether that matters.

import { clamp } from '../core/text.js'
import { canEditThroughPipeline } from './support.js'

/** A caret or selection, as offsets into the value. */
export interface TextSelection {
  /** The anchor end. Equal to `end` for a caret. */
  start: number
  /** The moving end. */
  end: number
}

/**
 * How an edit reached the document.
 *
 * `pipeline` means the browser recorded it and Ctrl+Z will undo it. `direct` means
 * the text changed and the history did not, which only happens where
 * `document.execCommand` is unavailable — a test environment, or a browser that
 * has finally removed it.
 */
export type EditOutcome = 'pipeline' | 'direct' | 'unchanged'

/** Read the caret or selection out of a field. */
export function readSelection(field: HTMLTextAreaElement): TextSelection {
  const start = field.selectionStart ?? 0
  const end = field.selectionEnd ?? start
  return { start, end }
}

/**
 * Put a caret or selection into a field.
 *
 * Setting a selection moves the caret and nothing else: it does not touch the
 * value, so it cannot disturb the undo stack. This is what the editor uses instead
 * of re-rendering text to reposition the caret — the re-render was the bug.
 *
 * A range given the wrong way round is ordered rather than collapsed. `start` and
 * `end` are named for a caret and a selection, and a caller that computes them from a
 * backwards drag has still asked for that text to be selected; quietly selecting
 * nothing at the far end would be a silent wrong answer.
 * @param field - the textarea.
 * @param start - the anchor offset.
 * @param end - the moving offset; defaults to `start`.
 */
export function writeSelection(
  field: HTMLTextAreaElement,
  start: number,
  end: number = start,
): void {
  const length = field.value.length
  const from = clamp(Math.min(start, end), 0, length)
  const to = clamp(Math.max(start, end), from, length)
  field.setSelectionRange(from, to)
}

/** The line height in force on a field, falling back to the computed font size. */
export function fieldLineHeight(field: HTMLTextAreaElement): number {
  const styles = field.ownerDocument.defaultView?.getComputedStyle(field)
  if (styles === null || styles === undefined) return 0
  const lineHeight = Number.parseFloat(styles.lineHeight)
  if (Number.isFinite(lineHeight)) return lineHeight
  const fontSize = Number.parseFloat(styles.fontSize)
  return Number.isFinite(fontSize) ? fontSize * 1.2 : 0
}

/**
 * Replace a range through the browser's editing pipeline, so it can be undone.
 *
 * The field is focused first because the pipeline only runs on the focused
 * element, and a completion accepted by mouse click would otherwise arrive after
 * the click had already blurred the field.
 * @param field - the textarea.
 * @param from - the first offset to replace.
 * @param to - the offset after the last.
 * @param text - what to put there. The empty string deletes.
 * @returns how the edit landed.
 */
export function replaceThroughPipeline(
  field: HTMLTextAreaElement,
  from: number,
  to: number,
  text: string,
): EditOutcome {
  const start = clamp(Math.min(from, to), 0, field.value.length)
  const end = clamp(Math.max(from, to), start, field.value.length)
  if (start === end && text === '') return 'unchanged'

  if (field.ownerDocument.activeElement !== field) field.focus({ preventScroll: true })
  writeSelection(field, start, end)

  const before = field.value
  if (canEditThroughPipeline()) {
    try {
      field.ownerDocument.execCommand('insertText', false, text)
    } catch {
      // Firefox throws rather than returning false for some input types. Falling
      // through to the direct path is the right answer either way.
    }
    // The return value is not trustworthy across browsers, and it does not need to
    // be: the VALUE decides. A change we did not make ourselves is one the
    // browser's history already knows about, which is the whole point.
    if (field.value !== before) return 'pipeline'
  }

  field.setRangeText(text, start, end, 'end')
  if (field.value === before) return 'unchanged'
  dispatchInput(field, text)
  return 'direct'
}

/**
 * Fire the event the browser would have fired, for the direct path only.
 *
 * The pipeline path needs no help: the browser dispatches `input` itself, which is
 * exactly why the editor can treat both paths the same way downstream.
 * @param field - the textarea.
 * @param text - what was written.
 */
export function dispatchInput(field: HTMLTextAreaElement, text: string): void {
  const view = field.ownerDocument.defaultView
  const InputEventCtor = view === null ? undefined : (view as Window & { InputEvent?: typeof InputEvent }).InputEvent
  if (typeof InputEventCtor === 'function') {
    field.dispatchEvent(
      new InputEventCtor('input', { bubbles: true, inputType: 'insertText', data: text }),
    )
    return
  }
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

/**
 * Undo, through the browser's own history.
 *
 * Exposed so a host can offer a button without reimplementing a stack, and so the
 * browser harness can drive the same path a keyboard shortcut drives.
 * @param field - the textarea.
 * @returns whether the call was possible at all. It cannot report whether anything
 *   was actually undone, because no browser exposes that.
 */
export function undoField(field: HTMLTextAreaElement): boolean {
  if (!canEditThroughPipeline()) return false
  if (field.ownerDocument.activeElement !== field) field.focus({ preventScroll: true })
  try {
    return field.ownerDocument.execCommand('undo')
  } catch {
    return false
  }
}

/**
 * Redo, through the browser's own history.
 * @param field - the textarea.
 * @returns whether the call was possible at all.
 */
export function redoField(field: HTMLTextAreaElement): boolean {
  if (!canEditThroughPipeline()) return false
  if (field.ownerDocument.activeElement !== field) field.focus({ preventScroll: true })
  try {
    return field.ownerDocument.execCommand('redo')
  } catch {
    return false
  }
}

/**
 * Write a whole document into a field.
 *
 * Two paths, and the difference matters. `preserveHistory` selects everything and
 * inserts through the pipeline, so the replacement is one undoable edit and Ctrl+Z
 * brings the previous text back — the right behaviour for a Reset button. Without
 * it the value property is assigned, which is faster and clears the history, which
 * is the right behaviour when a host is loading a different document entirely.
 * @param field - the textarea.
 * @param next - the new text.
 * @param preserveHistory - whether the change should be undoable.
 * @returns how the write landed.
 */
export function writeDocument(
  field: HTMLTextAreaElement,
  next: string,
  preserveHistory = false,
): EditOutcome {
  if (field.value === next) return 'unchanged'
  if (preserveHistory) return replaceThroughPipeline(field, 0, field.value.length, next)
  field.value = next
  writeSelection(field, next.length, next.length)
  return 'direct'
}
