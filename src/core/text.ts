// ─── text: offsets, lines, and words ────────────────────────────────────────
//
// The engine counts in character offsets and nothing else. Not rows, not
// columns, not pixels: every position that crosses a module boundary in litearea
// is an offset into the document string, so there is exactly one coordinate
// system to get wrong instead of three that must be kept in step.
//
// Pixels enter only in `src/dom/`, only to place the popup, and never travel
// back inward. That boundary is the fix for a whole family of bugs in the
// editors this library replaces, where a caret was tracked as a character index
// in one place and read back as a screen position in another.

import type { LineInfo, Range, Token, WordInfo } from './types.js'

/** Keeps a number inside a range, which every caller here needs and none should repeat. */
export function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value
}

/** Whether a value is a usable offset: a finite, non-negative integer. */
export function isOffset(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/**
 * The offset each line starts at, in order. The first entry is always `0`.
 *
 * `\r\n`, `\n`, and a lone `\r` all end a line, because this text is typed by
 * hand into a textarea and a paste from a Windows editor must not read as one
 * long line. The terminator itself belongs to no line: a line's text excludes it
 * so that column arithmetic never has to reason about a stray carriage return.
 * @param source - the document.
 * @returns one offset per line, ascending.
 */
export function lineStarts(source: string): number[] {
  const starts = [0]
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index)
    if (code === 10) {
      starts.push(index + 1)
    } else if (code === 13) {
      if (source.charCodeAt(index + 1) === 10) index += 1
      starts.push(index + 1)
    }
  }
  return starts
}

/**
 * The index of the line an offset falls on.
 * @param starts - the result of {@link lineStarts}.
 * @param offset - a character offset.
 * @returns a zero-based line index.
 */
export function lineIndexAt(starts: readonly number[], offset: number): number {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if ((starts[middle] ?? 0) <= offset) low = middle
    else high = middle - 1
  }
  return low
}

/**
 * The line an offset falls on, with the offset expressed inside it.
 *
 * `before` and `after` are the line's own text split at the caret, which is what
 * completion and the indentation rules actually want; handing them out here
 * means neither has to re-derive the split and get it subtly different.
 * @param source - the document.
 * @param offset - a character offset; clamped into the document.
 * @param starts - the result of {@link lineStarts}, when the caller already has it.
 * @returns the line, its bounds, and the caret's place in it.
 */
export function lineAt(source: string, offset: number, starts?: readonly number[]): LineInfo {
  const position = clamp(offset, 0, source.length)
  const boundaries = starts ?? lineStarts(source)
  const index = lineIndexAt(boundaries, position)
  const from = boundaries[index] ?? 0
  const rawTo = boundaries[index + 1] ?? source.length
  // The next line's start sits after the terminator, so the last character of
  // the raw slice is the terminator itself — one character, or two for `\r\n`.
  let to = rawTo
  while (to > from) {
    const code = source.charCodeAt(to - 1)
    if (code === 10 || code === 13) to -= 1
    else break
  }
  const text = source.slice(from, to)
  const column = clamp(position - from, 0, text.length)
  return {
    from,
    to,
    text,
    number: index,
    column,
    before: text.slice(0, column),
    after: text.slice(column),
  }
}

/**
 * Whether a character is part of a word.
 *
 * The predicate is supplied by the grammar because it decides three things at
 * once — what a completion replaces, what a diagnostic underlines, and where a
 * double click puts the selection — and a language whose names contain a hyphen
 * must say so or every completion will replace one segment of a name instead of
 * the name.
 * @param char - one character, or the empty string at the end of the document.
 * @param wordChars - a single-character test.
 * @returns whether the character continues a word.
 */
export function isWordChar(char: string, wordChars: RegExp): boolean {
  return char !== '' && wordChars.test(char)
}

/**
 * The word at an offset.
 *
 * The word is found by expanding in BOTH directions from the offset rather than
 * by requiring the offset to be strictly inside a word. Completion needs the
 * second reading: a caret sitting at `Geist|` is at the end of the word, and the
 * word it is completing is still `Geist` — a lookup that insisted the offset be
 * interior would find nothing at exactly the moment the user wants a list.
 * @param source - the document.
 * @param offset - a character offset; clamped into the document.
 * @param wordChars - a single-character test.
 * @returns the word, its range, and the text either side of the caret.
 */
export function wordInfoAt(source: string, offset: number, wordChars: RegExp): WordInfo {
  const position = clamp(offset, 0, source.length)
  let from = position
  let to = position
  while (from > 0 && isWordChar(source.charAt(from - 1), wordChars)) from -= 1
  while (to < source.length && isWordChar(source.charAt(to), wordChars)) to += 1
  const text = source.slice(from, to)
  const column = position - from
  return {
    from,
    to,
    text,
    prefix: text.slice(0, column),
    suffix: text.slice(column),
  }
}

/** Whether a range is empty. */
export function isEmptyRange(range: Range): boolean {
  return range.to <= range.from
}

/** Whether an offset lies inside a range, with `to` exclusive. */
export function containsOffset(range: Range, offset: number): boolean {
  return offset >= range.from && offset < range.to
}

// ─── reading the token stream ───────────────────────────────────────────────

/**
 * The token covering an offset.
 *
 * Zero-length tokens are skipped, so a caret at a boundary resolves to the token
 * it is *inside* rather than to an empty marker sitting on the seam.
 * @param tokens - the scanned tokens, ascending.
 * @param offset - a character offset.
 * @returns the covering token, or undefined in whitespace.
 */
export function tokenAt(tokens: readonly Token[], offset: number): Token | undefined {
  for (const token of tokens) {
    if (token.from <= offset && offset < token.to) return token
    if (token.from > offset) break
  }
  return undefined
}

/**
 * The scope painted at an offset, when there is one.
 * @param tokens - the scanned tokens, ascending.
 * @param offset - a character offset.
 * @returns the scope, or undefined in whitespace.
 */
export function scopeAt(tokens: readonly Token[], offset: number): string | undefined {
  return tokenAt(tokens, offset)?.scope
}

/**
 * The nearest token that ends at or before an offset, skipping whitespace.
 *
 * Whitespace is skipped because every caller is asking a question about
 * structure — "which slot is this word in?" — and a space is never an answer.
 * @param tokens - the scanned tokens, ascending.
 * @param offset - a character offset.
 * @returns the token, or undefined at the start of the document.
 */
export function tokenBefore(tokens: readonly Token[], offset: number): Token | undefined {
  let found
  for (const token of tokens) {
    if (token.to > offset) break
    if (token.text.trim() !== '') found = token
  }
  return found
}

/**
 * The nearest token that starts at or after an offset, skipping whitespace.
 * @param tokens - the scanned tokens, ascending.
 * @param offset - a character offset.
 * @returns the token, or undefined at the end of the document.
 */
export function tokenAfter(tokens: readonly Token[], offset: number): Token | undefined {
  for (const token of tokens) {
    if (token.to <= offset) continue
    if (token.text.trim() !== '') return token
  }
  return undefined
}

/**
 * The non-whitespace tokens on one line, in order.
 *
 * Completion and diagnostics both ask "what is on this line so far", and both
 * must ignore the indentation and the gaps between words. Returning the tokens
 * rather than the words means a grammar can ask what they *were* (their scopes)
 * and not only what they said.
 * @param tokens - the scanned tokens, ascending.
 * @param line - a line number, or a line record.
 * @returns the tokens on that line.
 */
export function tokensOnLine(
  tokens: readonly Token[],
  line: number | LineInfo,
): Token[] {
  const number = typeof line === 'number' ? line : line.number
  return tokens.filter((token) => token.line === number && token.text.trim() !== '')
}
