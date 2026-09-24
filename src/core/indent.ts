// ─── indent: adding and removing one level, for a caret or for a block ──────
//
// Four commands come out of this module, and they are four because the two
// questions they answer are independent:
//
//   - does the caret get an indent unit typed at it, or do whole LINES move?
//   - which way?
//
// `indent` and `outdent` decide the first question from the selection: a caret
// gets a unit at the caret, a selection moves the lines it touches. `indentLines`
// and `outdentLines` always move lines, including the caret's own — which is what
// an editor bound to "indent the line I am on" wants. Naming both is cheaper than
// one command with a flag, because a keymap reads better than a predicate.
//
// Two properties matter more than the arithmetic, and both are the reason this is
// one edit and not a loop:
//
//   - **A block indent is ONE edit.** The whole run is written as a single range
//     replacement, so one Ctrl+Z takes back all of it. Indenting ten lines one
//     line at a time would be ten undo steps, which is not what any reader means
//     by "undo that".
//   - **The selection survives.** Indenting a block keeps the same lines selected,
//     moved by the units that were inserted; outdenting moves it back by what was
//     actually removed, and never before the start of a line. An implementation
//     that collapses the selection to a caret leaves the reader to re-select what
//     they were about to indent again.
//
// Nothing here touches a DOM, a key, or a unit that was not handed in.

import { clamp, lineAt, lineIndexAt, lineStarts } from './text.js'
import type { PendingEdit } from './pairs.js'

/** Which way an indent command moves the text. */
export type IndentDirection = 'in' | 'out'

/** Every four commands, as one type, for a host that wants to switch on them. */
export type IndentCommand = 'indent' | 'outdent' | 'indentLines' | 'outdentLines'

/** What an indent command reads. */
export interface IndentRequest {
  /** The document. */
  text: string
  /** The selection's anchor. */
  from: number
  /** The selection's moving end; equal to `from` for a caret. */
  to: number
  /**
   * One level, as the characters to write.
   *
   * A string rather than a number, because a tab-indented document is indented with
   * a tab and "four" does not name a character. `resolveIndentUnit` turns the option
   * a host writes into one of these.
   */
  unit: string
  /** Which way. */
  direction: IndentDirection
  /**
   * Whether whole lines always move, whatever the selection is.
   *
   * `false` (or absent) is the contextual command: a caret gets a unit typed at it.
   * `true` is the line command, where a caret moves its own line.
   */
  lines?: boolean
}

/**
 * The characters one level of indentation is, from what a host configured.
 *
 * `2` and `'  '` mean the same thing, and a host that writes nothing gets two
 * spaces. The option is a preference and not a language fact, which is why it is not
 * on the grammar: two hosts may read the same file with different tastes, and a file
 * does not care.
 * @param value - the configured unit: a width in spaces, the characters themselves,
 *   or nothing.
 * @returns the characters to write for one level. Empty only if a host asked for that.
 */
export function resolveIndentUnit(value: string | number | undefined): string {
  if (typeof value === 'number') return ' '.repeat(Math.max(0, Math.floor(value)))
  if (typeof value === 'string') return value
  return '  '
}

/**
 * Plan an indent command.
 *
 * @param request - the document, the selection, the unit, and which command.
 * @returns the edit, or `undefined` when the command would change nothing — which is
 *   how the caller knows to let the key fall through to the browser instead of
 *   swallowing it. Outdenting a block that is already flush with the margin is the
 *   case that matters.
 */
export function planIndent(request: IndentRequest): PendingEdit | undefined {
  const { text, unit, direction } = request
  if (unit === '') return undefined
  const starts = lineStarts(text)
  const from = clamp(Math.min(request.from, request.to), 0, text.length)
  const to = clamp(Math.max(request.from, request.to), from, text.length)
  const caret = to === from

  if (caret && request.lines !== true) {
    if (direction === 'in') return planCaretIn(from, unit)
    return planCaretOutdent(text, from, unit, starts)
  }

  return planLines(text, from, to, unit, direction, starts, caret)
}

/**
 * Insert a level at the caret.
 *
 * At the CARET and not at the line's start: a reader who presses Tab in the middle of
 * a line is asking for an indent unit there, which is what every editor does and what
 * makes Tab usable as a typing key.
 */
function planCaretIn(from: number, unit: string): PendingEdit {
  const at = from + unit.length
  return { from, to: from, text: unit, selection: { from: at, to: at } }
}

/**
 * Remove up to one level of indentation around a caret.
 *
 * Three shapes, because a caret has three places to be:
 *
 *   - **Strictly inside the leading whitespace**: remove what fits BEFORE the caret, so
 *     the character the reader is standing on is not the one that disappears.
 *   - **At the line's start, or after its content**: remove the line's leading level.
 *     The caret comes back with it, stopping at the start of the line rather than above
 *     it — outdenting a line never moves text above its own first character.
 *
 * Nothing removable means no edit at all. A key that does nothing silently is worse
 * than a key that falls through, because the reader cannot tell a broken binding from a
 * line that was already at the margin.
 */
function planCaretOutdent(
  text: string,
  caret: number,
  unit: string,
  starts: readonly number[],
): PendingEdit | undefined {
  const line = lineAt(text, caret, starts)
  const whitespace = leadingWhitespace(line.text)
  const width = removalFor(whitespace, unit)
  if (width === 0) return undefined
  const column = caret - line.from

  if (column > 0 && column < whitespace.length) {
    const remove = Math.min(width, column)
    const at = caret - remove
    return { from: at, to: caret, text: '', selection: { from: at, to: at } }
  }

  const at = Math.max(line.from, caret - width)
  return { from: line.from, to: line.from + width, text: '', selection: { from: at, to: at } }
}

/**
 * Move whole lines by one level.
 *
 * The affected lines are the ones the selection touches. A selection that ends exactly
 * where a line BEGINS does not touch that line, which is the difference between
 * selecting two lines and selecting two lines and the start of a third.
 */
function planLines(
  text: string,
  from: number,
  to: number,
  unit: string,
  direction: IndentDirection,
  starts: readonly number[],
  caret: boolean,
): PendingEdit | undefined {
  const first = lineIndexAt(starts, from)
  let last = lineIndexAt(starts, Math.max(from, to))
  if (!caret && last > first && (starts[last] ?? 0) === to) last -= 1

  const lines: { from: number; to: number; body: string; width: number }[] = []
  for (let line = first; line <= last; line += 1) {
    const info = lineAt(text, starts[line] ?? 0, starts)
    lines.push({
      from: info.from,
      to: info.to,
      body: info.text,
      width: direction === 'in' ? unit.length : removalFor(leadingWhitespace(info.text), unit),
    })
  }

  const changed = lines.filter((line) => (direction === 'in' ? true : line.width > 0))
  if (changed.length === 0) return undefined

  // The run is rebuilt with its own terminators copied through, so a document written
  // with CRLF keeps it — the same rule the comment toggle follows, and for the same
  // reason: this code writes line prefixes, not line endings.
  const blockFrom = lines[0]?.from ?? from
  const blockTo = lines[lines.length - 1]?.to ?? to
  let written = ''
  let cursor = blockFrom
  for (const line of lines) {
    written += text.slice(cursor, line.from)
    // `width` is exactly how many leading whitespace characters this line loses: it was
    // computed from that whitespace, and it never exceeds it.
    written += direction === 'in' ? unit + line.body : line.body.slice(line.width)
    cursor = line.to
  }

  const shifted = (offset: number): number => {
    let shift = 0
    for (const line of lines) {
      if (direction === 'in') {
        // An anchor sitting exactly at a line's start does NOT move: the unit inserted
        // there lands inside the selection. That is what keeps three Tab presses on a
        // selected block from walking the selection further into the indentation on
        // every press, and it is what a reader expects to see — the indent they just
        // added is part of what is selected.
        if (line.from < offset) shift += unit.length
        continue
      }
      if (line.width === 0) continue
      const end = line.from + line.width
      if (end <= offset) shift -= line.width
      else if (offset > line.from) shift -= offset - line.from
    }
    const moved = offset + shift
    return clamp(moved, blockFrom, blockFrom + written.length)
  }

  const nextFrom = shifted(from)
  const nextTo = Math.max(nextFrom, shifted(to))
  return {
    from: blockFrom,
    to: blockTo,
    text: written,
    selection: { from: nextFrom, to: nextTo },
  }
}

/** The leading spaces and tabs of a line. */
function leadingWhitespace(line: string): string {
  let at = 0
  while (at < line.length && (line.charAt(at) === ' ' || line.charAt(at) === '\t')) at += 1
  return line.slice(0, at)
}

/**
 * How much of a line's leading whitespace one outdent removes.
 *
 * A tab goes first and on its own, because a tab is a level in the documents that use
 * them. Otherwise it is up to one level's worth of SPACES, which is why a line indented
 * by two spaces outdents fully under a four-space unit: removing four would eat the
 * first two characters of the line, and removing none would report "nothing to do"
 * about a line that is visibly indented.
 */
function removalFor(whitespace: string, unit: string): number {
  if (whitespace === '') return 0
  if (whitespace.charAt(0) === '\t') return 1
  const wanted = unit.charAt(0) === '\t' ? 1 : unit.length
  return Math.min(whitespace.length, wanted)
}
