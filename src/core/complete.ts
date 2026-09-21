// ─── complete: turning a caret into a list, and a list into an edit ─────────
//
// Two pure functions, deliberately separated, because they fail in different
// ways and only one of them is interesting to a user.
//
// `complete` answers "what could go here?" and returns rows. `applyCompletion`
// answers "what does the document become?" and returns text plus a caret. Keeping
// them apart is what makes the hard half — the interaction — testable in Node
// without a browser, and it is why the two bugs that make a completer feel broken
// have somewhere to live:
//
//   A SOURCE that swaps mid-typing loses the thread. The list opens over a family
//   name, the user types `=` and it becomes a value list, and the row they were
//   looking at is gone. So once a source has answered, it keeps answering for as long
//   as it stays eligible, and the priority order only decides which source OPENS the
//   list.
//
//   A range that does not grow leaves text behind. The range is recomputed from the
//   caret on every filter, never reused: type `ru`, accept `running`, and the
//   replacement must cover both letters. Holding the range resolved when the list
//   opened replaces only the `r` and produces `running u` — a bug worth naming,
//   because it is invisible in a test that only ever types one character before
//   accepting.

import type {
  Completion,
  CompletionContext,
  CompletionSource,
  CompletionTrigger,
  Grammar,
  Range,
  SuggestionItem,
} from './types.js'
import type { Inspection } from './inspect.js'
import { rank, type Ranked } from './rank.js'
import { clamp, lineAt, lineStarts, scopeAt, tokenBefore, tokensOnLine, wordInfoAt } from './text.js'
import { isResolvedGrammar, resolveGrammar, type ResolvedGrammar } from './scan.js'

/** The most rows a completion will carry, so a huge catalogue cannot stall a list. */
const DEFAULT_LIMIT = 100

/** What the editor knows when it asks for a list. */
export interface CompletionRequest {
  text: string
  caret: number
  trigger: CompletionTrigger
  /**
   * The source that answered last time, when a list is already open.
   *
   * Passing it is what keeps a list stable while the user types: the same source answers
   * again for as long as it stays eligible, so typing a character that makes a different
   * source eligible does not swap the rows out from under the reader. Only the SOURCE is
   * held — the range is recomputed from the caret every time, so it grows with the word.
   */
  previousSourceId?: string | undefined
  /** The most rows to return. */
  limit?: number
}

/**
 * Resolve a completion for a caret.
 *
 * @param inspection - the current inspection of the document.
 * @param grammar - the language.
 * @param request - the caret, the trigger, and any list already open.
 * @returns the range and the rows, or undefined when nothing applies.
 */
export function complete<State>(
  inspection: Inspection<State>,
  grammar: Grammar<State> | ResolvedGrammar<State>,
  request: CompletionRequest,
): Completion | undefined {
  const resolved = isResolvedGrammar(grammar) ? grammar : resolveGrammar(grammar)
  const sources = resolved.grammar.compose
  if (sources === undefined || sources.length === 0) return undefined

  const text = request.text
  const caret = clamp(request.caret, 0, text.length)
  const context = completionContext(inspection, resolved, caret, request.trigger)

  const eligible = sources.filter((source) => source.when === undefined || source.when(context))
  if (eligible.length === 0) return undefined

  // ── which source, and over what range ────────────────────────────────────
  // Ordered by priority, and the range comes from the winner because two sources
  // disagreeing about the range have no coherent shared answer.
  // ── which source ────────────────────────────────────────────────────────
  // Priority decides which source OPENS the list; after that the source that answered
  // keeps answering while it remains eligible, so the rows do not change identity under
  // the reader's hands. The range is not part of this: it is computed fresh below, from
  // the caret as it is now.
  const ordered = [...eligible].sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0))
  const reopening =
    request.previousSourceId === undefined
      ? undefined
      : ordered.find((source) => source.id === request.previousSourceId)
  const winner = reopening ?? ordered[0]
  if (winner === undefined) return undefined
  const range = resolveRange(winner, context)

  // ── the rows ─────────────────────────────────────────────────────────────
  const merged: SuggestionItem[] = [...winner.items(context)]
  for (const source of ordered) {
    if (source === winner || source.merge !== true) continue
    merged.push(...source.items(context))
  }
  if (merged.length === 0) return undefined

  // The needle is what the user has typed INSIDE the range, which is the only reading
  // that stays meaningful when the range is an entry rather than a word. It is clamped
  // to the range at both ends: a caret can sit past the range — after the trailing space
  // of an entry, say — and slicing to the caret there would pull a separator into the
  // needle and filter the list by a character the user did not mean to search for.
  const needleFrom = clamp(range.from, 0, caret)
  const needleTo = clamp(caret, needleFrom, Math.max(range.to, needleFrom))
  const needle = text.slice(needleFrom, needleTo)
  const ranked: Ranked<SuggestionItem>[] = rank(merged, needle, {
    label: (item) => item.label,
    ...(merged.some((item) => item.filterText !== undefined)
      ? { filterText: (item: SuggestionItem) => item.filterText ?? item.label }
      : {}),
    ...(merged.some((item) => item.sortText !== undefined)
      ? { sortText: (item: SuggestionItem) => item.sortText }
      : {}),
  })
  const limit = request.limit ?? DEFAULT_LIMIT

  return {
    range,
    rows: ranked.slice(0, limit).map((entry) => ({
      item: entry.item,
      score: entry.score,
      indices: entry.indices,
    })),
    needle,
    sourceId: winner.id,
  }
}

/** Resolve a source's range, whether it declared one or computes it. */
function resolveRange<State>(
  source: CompletionSource<State>,
  context: CompletionContext<State>,
): Range {
  if (typeof source.range !== 'function') return source.range
  const range = source.range(context)
  return {
    from: Math.min(range.from, range.to),
    to: Math.max(range.from, range.to),
  }
}

/**
 * Build everything a completion source may look at.
 * @param inspection - the current inspection.
 * @param resolved - the resolved grammar.
 * @param caret - the caret offset.
 * @param trigger - how the list came to be open.
 * @returns the context.
 */
function completionContext<State>(
  inspection: Inspection<State>,
  resolved: ResolvedGrammar<State>,
  caret: number,
  trigger: CompletionTrigger,
): CompletionContext<State> {
  const { text, tokens, diagnostics, state } = inspection
  const line = lineAt(text, caret, lineStarts(text))
  const lineTokens = tokensOnLine(tokens, line.number)
  const word = wordInfoAt(text, caret, resolved.wordChars)
  return {
    text,
    caret,
    word,
    line,
    tokens,
    diagnostics,
    state,
    scope: scopeAt(tokens, caret),
    scopeBefore: tokenBefore(tokens, caret)?.scope,
    // "First on line" means only whitespace precedes the caret, which is a question
    // about the caret and not about the token under it: a caret in the indentation of
    // a line that already has content is not first on that line. `lineTokens` is what
    // tells the difference, so the tokens are read even though the answer looks like a
    // string test.
    firstOnLine: line.before.trim() === '' && !lineTokens.some((token) => token.to <= caret),
    // "First word" additionally allows the rest of the word the caret is in, which is
    // what keeps a line-head completion alive while the head is being typed.
    firstWord: line.text.slice(0, Math.max(0, word.from - line.from)).trim() === '',
    firstToken: lineTokens[0],
    trigger,
  }
}

/** An edit produced by accepting a row. */
export interface AppliedCompletion {
  /** The document after the edit. */
  text: string
  /** Where the caret belongs in it. */
  caret: number
  /**
   * What changed, in the NEW document. The editor uses it to scroll the result
   * into view and to describe the edit to a host.
   */
  range: Range
  /**
   * The offset the edit starts at in the ORIGINAL document.
   *
   * Exposed alongside `insert` because an editor must write only the range that
   * changed. Assigning the whole recomputed `text` would be simpler and would throw
   * away the browser's undo history, which is the one thing this library exists to
   * protect.
   */
  from: number
  /** The offset the edit ends at in the original document. */
  to: number
  /** The text written between those two offsets. */
  insert: string
}

/**
 * Apply a chosen row to a document.
 *
 * The row decides three things: what is written, whether it is written over the
 * range or in front of it, and how much text follows it. `append` is the
 * grammar's business and not the engine's — inviting another entry with a `, `
 * is a fact about font stacks, and an engine that appended one by default would
 * be guessing about every other language.
 *
 * @param text - the document.
 * @param range - the range the list was opened over.
 * @param item - the chosen row.
 * @returns the resulting text, caret, and the edit that produced them.
 */
export function applyCompletion(text: string, range: Range, item: SuggestionItem): AppliedCompletion {
  const from = clamp(Math.min(range.from, range.to), 0, text.length)
  const to = clamp(Math.max(range.from, range.to), from, text.length)
  const insert = item.insert ?? item.label
  const append = item.append ?? ''
  const offset = item.caretOffset ?? 0

  if (item.mode === 'before') {
    const head = text.slice(0, from)
    // The whitespace in front of the existing entry belonged to the comma before
    // it, so it is restored rather than doubled.
    const gap = head !== '' && !/\s$/.test(head) ? ' ' : ''
    const rest = text.slice(from).replace(/^\s+/, '')
    const written = `${gap}${insert}${redundant(append, rest) ? '' : append}`
    return {
      text: `${head}${written}${rest}`,
      caret: head.length + written.length + offset,
      range: { from: head.length, to: head.length + written.length },
      from,
      to: from,
      insert: written,
    }
  }

  const head = text.slice(0, from)
  const rest = text.slice(to)
  const written = `${insert}${redundant(append, rest) ? '' : append}`
  return {
    text: `${head}${written}${rest}`,
    caret: head.length + written.length + offset,
    range: { from: head.length, to: head.length + written.length },
    from,
    to,
    insert: written,
  }
}

/**
 * Whether an append would only repeat what the document already says.
 *
 * Accepting `running` immediately before an existing space must not produce two,
 * and accepting a font family immediately before an existing `, ` must not add
 * another comma. Whitespace is compared as whitespace rather than as the exact
 * characters, so a tab counts as the space an append was reaching for.
 * @param append - the row's `append` text.
 * @param rest - the document immediately after the range.
 * @returns whether the append should be left out.
 */
function redundant(append: string, rest: string): boolean {
  if (append === '') return true
  return append.trim() === '' ? /^\s/.test(rest) : rest.startsWith(append)
}
