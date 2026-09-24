// ─── pairs: the edits an editor makes on the reader's behalf while typing ────
//
// Every other module here answers a question about a document. This one answers a
// question about a KEYSTROKE: given what the reader just typed and where the caret is,
// should the editor write something other than that one character?
//
// Three such edits, all of them older than any editor that has them:
//
//   - an opening delimiter closes itself, so `(` writes `()` and leaves the caret
//     between them;
//   - a closing delimiter that is already there is skipped over rather than doubled;
//   - typing around a selection wraps it instead of replacing it.
//
// And two that are not about a delimiter at all but belong beside them, because they
// are the same kind of decision made at the same moment: Enter between a pair opens an
// indented line, and the comment toggle adds or removes a language's comment markers.
//
// All of it is pure. The decision is this module's; performing the edit through the
// browsing pipeline — so Ctrl+Z still undoes it as one edit — is the DOM layer's job.
// That split is what lets every rule below be tested in plain Node, including the ones
// a browser makes awkward to stage: a caret inside a string, a selection that is already
// commented, an opener typed in front of a word.

import { clamp, isWordChar, lineIndexAt, lineStarts } from './text.js'
import type { AutoPair, CommentSyntax, Scope } from './types.js'

/**
 * An edit the editor will make, in the coordinates it was planned in.
 *
 * `from` and `to` are offsets in the ORIGINAL document and `selection` is in the NEW
 * one, which is the shape `replaceThroughPipeline` wants: write one range, then place
 * the caret. The whole document is never reassigned, because doing so would destroy the
 * browser's undo history.
 */
export interface PendingEdit {
  /** The first character to replace, inclusive. */
  from: number
  /** The character after the last one to replace, exclusive. */
  to: number
  /** What to write there. */
  text: string
  /** Where the selection belongs afterwards, in the new document. */
  selection: { from: number; to: number }
}

/** What one keystroke should do. */
export type PairAction =
  /** Write something in place of the keystroke. */
  | { kind: 'insert'; edit: PendingEdit }
  /** Write nothing, and move the caret past the delimiter that is already there. */
  | { kind: 'skip'; caret: number }

/** Everything the pair rules read. */
export interface PairTyping {
  /** The document, as the field holds it. */
  text: string
  /** The selection's anchor. */
  from: number
  /** The selection's moving end; equal to `from` for a caret. */
  to: number
  /** The character the reader typed. */
  typed: string
  /** The declared pairs, in order. */
  pairs: readonly AutoPair[]
  /** The scope at the caret, when the caller can determine it. */
  scope?: Scope
  /** The grammar's word characters, for the "in front of a word" test. */
  wordChars?: RegExp
}

/**
 * Decide what typing one character should do.
 *
 * The order of the tests is the whole behaviour:
 *
 * 1. **A selection is wrapped**, because a reader who selected text and typed a
 *    delimiter meant to surround it, and only a pair whose `open` matches can.
 * 2. **A closing delimiter already at the caret is skipped**, so `()` typed by hand
 *    does not become `())`. This is checked before the opener rule because `"` and `'`
 *    are both openers and closers in most languages, and stepping over the closer the
 *    editor itself inserted is the commoner intent.
 * 3. **An opening delimiter closes itself**, unless the next character is a word
 *    character — typing `(` in front of `value` is how `(value` gets written, and
 *    closing the pair there would drop a `)` inside the word being typed.
 *
 * @param input - the document, the selection, the keystroke, and the declaration.
 * @returns the action, or `undefined` to let the browser type the character itself.
 */
export function planPairTyping(input: PairTyping): PairAction | undefined {
  const { text, typed, pairs } = input
  if (typed.length !== 1 || pairs.length === 0) return undefined
  const from = clamp(Math.min(input.from, input.to), 0, text.length)
  const to = clamp(Math.max(input.from, input.to), from, text.length)
  const allowed = (pair: AutoPair): boolean =>
    pair.notIn === undefined || input.scope === undefined || !pair.notIn.includes(input.scope)

  if (to > from) {
    const opener = pairs.find((pair) => pair.open === typed && allowed(pair))
    if (opener === undefined) return undefined
    const selected = text.slice(from, to)
    // The selection stays ON the wrapped text rather than collapsing after it: the
    // reader wrapped it to do something else to it next.
    return {
      kind: 'insert',
      edit: {
        from,
        to,
        text: `${opener.open}${selected}${opener.close}`,
        selection: {
          from: from + opener.open.length,
          to: from + opener.open.length + selected.length,
        },
      },
    }
  }

  const closer = pairs.find((pair) => pair.close === typed)
  if (closer !== undefined && text.charAt(from) === typed) {
    return { kind: 'skip', caret: from + 1 }
  }

  const opener = pairs.find((pair) => pair.open === typed && allowed(pair))
  if (opener === undefined) return undefined
  const next = text.charAt(from)
  const words = input.wordChars
  if (next !== '' && (words === undefined ? /\w/.test(next) : isWordChar(next, words))) {
    return undefined
  }
  return {
    kind: 'insert',
    edit: {
      from,
      to: from,
      text: `${opener.open}${opener.close}`,
      selection: { from: from + opener.open.length, to: from + opener.open.length },
    },
  }
}

/** Everything the Enter rule reads. */
export interface BracketEnter {
  /** The document. */
  text: string
  /** The caret's offset. */
  caret: number
  /** The declared pairs. */
  pairs: readonly AutoPair[]
  /** How many spaces one level of indentation is. Default 2. */
  indentSize?: number
}

/**
 * Decide what Enter between an empty pair should do.
 *
 * Between `{}` on one line, Enter is not a line break — it is the start of a block, and
 * what it should produce is three lines with the caret on the indented middle one. The
 * step is a tab when the line is already indented with tabs and spaces otherwise, so a
 * document indented one way does not acquire the other.
 *
 * @param input - the document, the caret, and the declaration.
 * @returns the edit, or `undefined` when the caret is not between a declared pair.
 */
export function planBracketEnter(input: BracketEnter): PendingEdit | undefined {
  const { text, pairs } = input
  if (pairs.length === 0) return undefined
  const caret = clamp(input.caret, 0, text.length)
  const before = text.charAt(caret - 1)
  const after = text.charAt(caret)
  const pair = pairs.find((candidate) => candidate.open === before && candidate.close === after)
  if (pair === undefined) return undefined

  const starts = lineStarts(text)
  const line = lineIndexAt(starts, caret)
  const indent = leadingWhitespace(text.slice(starts[line] ?? 0, caret))
  const step = indent.includes('\t') ? '\t' : ' '.repeat(Math.max(0, input.indentSize ?? 2))
  const inner = indent + step
  const written = `\n${inner}\n${indent}`
  const caretInNew = caret + 1 + inner.length
  return {
    from: caret,
    to: caret,
    text: written,
    selection: { from: caretInNew, to: caretInNew },
  }
}

/** Everything the comment toggle reads. */
export interface CommentToggle {
  /** The document. */
  text: string
  /** The selection's anchor. */
  from: number
  /** The selection's moving end; equal to `from` for a caret. */
  to: number
  /** The language's comment markers. */
  syntax: CommentSyntax
}

/**
 * Decide what the comment toggle should do to the selected lines.
 *
 * A language with a line marker gets line markers, whatever the selection spans: the
 * keystroke that reaches this is the one every editor binds to "comment out these
 * lines", and a reader who selected three lines to comment them out meant three
 * commented lines and not one block comment around them. A block pair is therefore the
 * answer for a language that has no line marker at all — and, for a language that has
 * both, a second command would be the way to reach it.
 *
 * The toggle is symmetric: a run whose every non-empty line is already commented has the
 * markers REMOVED, and one space after the marker goes with them, so toggling twice
 * leaves the document as it was found. Empty lines are left alone rather than given a
 * marker of their own.
 *
 * @param input - the document, the selection, and the declaration.
 * @returns the edit, or `undefined` when the language has no comment markers.
 */
export function planCommentToggle(input: CommentToggle): PendingEdit | undefined {
  const { text, syntax } = input
  const starts = lineStarts(text)
  const from = clamp(Math.min(input.from, input.to), 0, text.length)
  const to = clamp(Math.max(input.from, input.to), from, text.length)

  if (syntax.line !== undefined) return toggleLines(text, from, to, syntax.line, starts)
  if (syntax.block !== undefined) return toggleBlock(text, from, to, syntax.block)
  return undefined
}

/** The leading whitespace of a line. */
function leadingWhitespace(line: string): string {
  let at = 0
  while (at < line.length && (line.charAt(at) === ' ' || line.charAt(at) === '\t')) at += 1
  return line.slice(0, at)
}

/**
 * The bounds of one line, terminator excluded.
 *
 * A `\r\n` terminator belongs to the line it ends and to neither line's text, which
 * matters here more than anywhere else: a comment marker inserted after a stray `\r`
 * would end up on the wrong side of it, and the toggle would not be symmetric.
 *
 * @param text - the document.
 * @param starts - the result of {@link lineStarts}.
 * @param line - the zero-based line number.
 * @returns the half-open bounds of the line's text.
 */
function lineBounds(
  text: string,
  starts: readonly number[],
  line: number,
): { from: number; to: number } {
  const from = starts[line] ?? text.length
  const next = starts[line + 1]
  let to = next === undefined ? text.length : Math.max(from, next - 1)
  if (to > from && text.charAt(to - 1) === '\r') to -= 1
  return { from, to }
}

/** Add one line's comment marker after its indentation. */
function commentLine(line: string, marker: string): string {
  if (line.trim() === '') return line
  const indent = leadingWhitespace(line)
  return `${indent}${marker} ${line.slice(indent.length)}`
}

/** Remove one line's comment marker, and one space after it. */
function uncommentLine(line: string, marker: string): string {
  const indent = leadingWhitespace(line)
  const body = line.slice(indent.length)
  if (!body.startsWith(marker)) return line
  const rest = body.slice(marker.length)
  return `${indent}${rest.startsWith(' ') ? rest.slice(1) : rest}`
}

/**
 * Toggle a line marker over the lines the selection touches.
 *
 * Every terminator in the run is copied through from the original rather than rebuilt,
 * so a document written with `\r\n` keeps it. Only the line's own text is rewritten.
 *
 * @param text - the document.
 * @param from - the selection's start.
 * @param to - the selection's end.
 * @param marker - the line marker.
 * @param starts - the result of {@link lineStarts}.
 * @returns the edit.
 */
function toggleLines(
  text: string,
  from: number,
  to: number,
  marker: string,
  starts: readonly number[],
): PendingEdit {
  const first = lineIndexAt(starts, from)
  const last = lineIndexAt(starts, Math.max(from, to - 1))
  const bounds: { from: number; to: number }[] = []
  for (let line = first; line <= last; line += 1) bounds.push(lineBounds(text, starts, line))

  // A run whose every non-empty line already carries the marker is one to uncomment. A
  // run of nothing but empty lines is NOT treated as commented, or the first press
  // would do nothing and the second would add markers.
  const bodies = bounds.map((bound) => text.slice(bound.from, bound.to))
  const filled = bodies.filter((body) => body.trim() !== '')
  const commented = filled.length > 0 && filled.every((body) => body.trimStart().startsWith(marker))

  const blockFrom = bounds[0]?.from ?? from
  const blockTo = bounds[bounds.length - 1]?.to ?? to
  let written = ''
  let cursor = blockFrom
  for (const bound of bounds) {
    // Everything between the previous line's text and this one is the terminator, and
    // it is kept exactly as it was.
    written += text.slice(cursor, bound.from)
    const body = text.slice(bound.from, bound.to)
    written += commented ? uncommentLine(body, marker) : commentLine(body, marker)
    cursor = bound.to
  }

  const firstBody = bodies[0] ?? ''
  const newFirstBody = commented ? uncommentLine(firstBody, marker) : commentLine(firstBody, marker)
  // The caret keeps its column, moved by however much the marker changed the line it is
  // on. Anything else would jump the reader to the start of the line on every toggle.
  const column = from - blockFrom
  const caret = blockFrom + clamp(column + (newFirstBody.length - firstBody.length), 0, newFirstBody.length)
  return { from: blockFrom, to: blockTo, text: written, selection: { from: caret, to: caret } }
}

/**
 * Wrap or unwrap the selection in a block comment.
 *
 * The inner text stays selected in both directions, so pressing the toggle twice leaves
 * the reader where they started, with the same text selected.
 *
 * @param text - the document.
 * @param from - the selection's start.
 * @param to - the selection's end.
 * @param block - the opening and closing markers.
 * @returns the edit.
 */
function toggleBlock(
  text: string,
  from: number,
  to: number,
  block: readonly [string, string],
): PendingEdit {
  const [open, close] = block
  const selected = text.slice(from, to)
  const trimmed = selected.trim()
  if (trimmed.startsWith(open) && trimmed.endsWith(close) && trimmed.length >= open.length + close.length) {
    const innerStart = from + selected.indexOf(open) + open.length
    const innerEnd = from + selected.lastIndexOf(close)
    const inner = text.slice(innerStart, innerEnd)
    return { from, to, text: inner, selection: { from, to: from + inner.length } }
  }
  const wrapped = `${open}${selected}${close}`
  return {
    from,
    to,
    text: wrapped,
    selection: { from: from + open.length, to: from + open.length + selected.length },
  }
}
