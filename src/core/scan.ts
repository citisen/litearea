// ─── scan: text in, painted tokens out ──────────────────────────────────────
//
// One left-to-right pass. At each position the rules are tried in the order the
// grammar declared them and the first one that matches wins, which is the whole
// of the precedence model: to make a rule win, put it higher.
//
// A few decisions here are what keep a hand-written grammar honest.
//
// A rule may never match the empty string. A pattern that can, such as `/\w*/`,
// is treated as if it did not match, so the scan cannot stall on one position
// forever. An infinite loop in a highlighter looks exactly like a frozen page.
//
// Consecutive tokens with the same scope are merged. Whitespace is most of a
// document, and one span per space would mean thousands of DOM nodes for a file
// nobody is looking at. Merging stops at a newline, because a token's line and
// column describe where it starts and a span across two lines would make that a
// lie.
//
// A non-nested region is found in one search rather than tested character by
// character, and its contents are painted as a single span without the rule list
// ever running inside it. That is what makes a string a string: the word
// `running` inside a quoted font name is text, not a state.

import type {
  Diagnostic,
  Grammar,
  LineInfo,
  RegionRule,
  Rule,
  RuleContext,
  RuleMatch,
  Scope,
  ScopeSpec,
  Token,
  VocabularyContext,
  WordsRule,
  WordsSource,
} from './types.js'
import { listPhrase } from './format.js'
import { clamp, isWordChar, lineAt, lineIndexAt, lineStarts } from './text.js'
import { asResolvedVocabulary } from './vocabulary.js'

/** A grammar with its defaults filled in and its patterns made safe to reuse. */
export interface ResolvedGrammar<State = unknown> {
  /**
   * Marks this value as already resolved.
   *
   * Present so the two shapes can be told apart without guessing. The obvious test
   * — "does it have a `fallbackScope`?" — is wrong, because a plain grammar is
   * allowed to declare one, and the mistake surfaces as the engine reading `.grammar`
   * off a value that has no such field and crashing at the first keystroke.
   */
  readonly __resolved: true
  grammar: Grammar<State>
  rules: readonly Rule<State>[]
  /** The scope a character no rule claimed is painted with. */
  fallbackScope: Scope
  /** The single-character test that decides where words begin and end. */
  wordChars: RegExp
}

/**
 * Whether a value is a resolved grammar rather than one as written.
 * @param value - the grammar, either shape.
 * @returns whether it is already resolved.
 */
export function isResolvedGrammar<State>(
  value: Grammar<State> | ResolvedGrammar<State>,
): value is ResolvedGrammar<State> {
  return (value as { __resolved?: unknown }).__resolved === true
}

/** The whole result of one scan: the paint, what the scan noticed, and the analysis. */
export interface ScanResult<State = unknown> {
  tokens: Token[]
  /**
   * What the lexical pass itself found: a word a vocabulary rejected, a region
   * that never closed. A grammar's own `checks` and `validate` are added by
   * `diagnose`, which builds on this.
   */
  diagnostics: Diagnostic[]
  /** Whatever `Grammar.analyze` returned, or `initialState`. */
  state: State
}

/** The word predicate a grammar that does not declare one gets. */
const DEFAULT_WORD_CHARS = /[\p{L}\p{N}_$]/u

/**
 * A pattern that can be run at a position without ever skipping ahead.
 *
 * The sticky flag is added rather than demanded: a grammar author writing
 * `/foo/` means "foo here", and one who forgot the `y` would otherwise get a
 * pattern that quietly matches anywhere later in the document and paints the
 * wrong text. Compiled patterns are cached per source pattern, so a scan does not
 * recompile one per position.
 */
const stickyCache = new WeakMap<RegExp, RegExp>()

/**
 * A pattern that runs at a position and cannot skip ahead.
 * @param pattern - the rule's pattern.
 * @returns the same pattern with the sticky flag, cached.
 */
function sticky(pattern: RegExp): RegExp {
  const cached = stickyCache.get(pattern)
  if (cached !== undefined) return cached
  const flags = pattern.flags.replace(/[gy]/g, '')
  const compiled = new RegExp(pattern.source, `${flags}y`)
  stickyCache.set(pattern, compiled)
  return compiled
}

/** Run a pattern at an exact position, or report that it did not match there. */
function execAt(pattern: RegExp, source: string, index: number): RegExpExecArray | null {
  pattern.lastIndex = index
  const match = pattern.exec(source)
  return match !== null && match.index === index ? match : null
}

/**
 * Strip the flags that would make a pattern stateful across calls.
 *
 * `RegExp.prototype.test` advances `lastIndex` on a global pattern, so a word
 * predicate carrying one would answer correctly for the first character and then
 * for every other one — a bug that looks like a typo in the grammar and cannot be
 * seen by reading it.
 * @param pattern - the grammar's pattern, if it declared one.
 * @returns a pattern safe to call repeatedly.
 */
function withoutStatefulFlags(pattern: RegExp): RegExp {
  const flags = pattern.flags.replace(/[gy]/g, '')
  return flags === pattern.flags ? pattern : new RegExp(pattern.source, flags)
}

/**
 * Fill in a grammar's defaults and make its patterns safe.
 * @param grammar - the grammar as written.
 * @returns the grammar the scanner runs.
 */
export function resolveGrammar<State>(grammar: Grammar<State>): ResolvedGrammar<State> {
  return {
    __resolved: true,
    grammar,
    rules: grammar.rules,
    fallbackScope: grammar.fallbackScope ?? 'text',
    wordChars: withoutStatefulFlags(grammar.wordChars ?? DEFAULT_WORD_CHARS),
  }
}

/** What a words source resolves to, once per scan. */
interface ResolvedWords {
  list: readonly string[]
  /** Folded member text, for lookup. */
  set: Set<string>
  /**
   * Members containing a character the word predicate rejects, longest first.
   * They cannot be reached by reading a word in, so they are matched literally.
   */
  literal: readonly string[]
  caseSensitive: boolean
}

/**
 * Scan a document into tokens.
 * @param source - the document.
 * @param grammar - the language, as written or already resolved.
 * @returns the tokens, the lexical diagnostics, and the analysis.
 */
export function scan<State>(
  source: string,
  grammar: Grammar<State> | ResolvedGrammar<State>,
): ScanResult<State> {
  const resolved: ResolvedGrammar<State> = isResolvedGrammar(grammar)
    ? grammar
    : resolveGrammar(grammar)
  const { rules, fallbackScope, wordChars } = resolved
  const declared = resolved.grammar
  const sourceId = declared.id
  const state: State =
    declared.analyze === undefined ? (declared.initialState as State) : declared.analyze(source)
  const vocabularyContext: VocabularyContext<State> = { text: source, state }

  const tokens: Token[] = []
  const diagnostics: Diagnostic[] = []
  const starts = lineStarts(source)
  const length = source.length

  // ── per-scan caches ───────────────────────────────────────────────────────
  // The vocabulary context is constant for a whole scan, so a vocabulary is
  // resolved once rather than at every position that tests a word.
  const wordsCache = new Map<WordsSource<State>, ResolvedWords>()
  /**
   * The line last asked for, so the scan does not re-slice per token.
   *
   * Only the line's BOUNDS are cached, never its column. A column depends on the
   * position being asked about while the bounds do not, and caching the pair
   * together is a bug with a very specific smell: the first token on a line caches
   * column 0, every later token on that line reads it back, and every rule guarded
   * by `firstOnLine` starts matching the whole line.
   */
  let cachedLineNumber = -1
  let cachedLineBounds: { from: number; to: number; text: string } | undefined
  /** Compiled `prevNot` character classes, per rule context. */
  const prevNotCache = new WeakMap<RuleContext, RegExp>()

  /** The line record for a position, with the column computed for that position. */
  const lineInfoAt = (position: number): LineInfo => {
    const number = lineIndexAt(starts, position)
    if (number !== cachedLineNumber || cachedLineBounds === undefined) {
      const info = lineAt(source, position, starts)
      cachedLineBounds = { from: info.from, to: info.to, text: info.text }
      cachedLineNumber = number
    }
    const column = clamp(position - cachedLineBounds.from, 0, cachedLineBounds.text.length)
    return {
      from: cachedLineBounds.from,
      to: cachedLineBounds.to,
      text: cachedLineBounds.text,
      number,
      column,
      before: cachedLineBounds.text.slice(0, column),
      after: cachedLineBounds.text.slice(column),
    }
  }

  /** Resolve a words source, once per scan. */
  const resolveWords = (from: WordsSource<State>): ResolvedWords => {
    const cached = wordsCache.get(from)
    if (cached !== undefined) return cached
    const vocabulary = asResolvedVocabulary(from)
    const caseSensitive = vocabulary?.caseSensitive === true
    const raw =
      vocabulary !== undefined
        ? vocabulary.resolve(vocabularyContext)
        : typeof from === 'function'
          ? from(vocabularyContext)
          : from
    const list = Array.isArray(raw) ? raw.filter((word) => word !== '') : []
    const fold = (word: string): string => (caseSensitive ? word : word.toLowerCase())
    const entry: ResolvedWords = {
      list,
      set: new Set(list.map(fold)),
      literal: list
        .filter((word) => [...word].some((char) => !isWordChar(char, wordChars)))
        .slice()
        .sort((left, right) => right.length - left.length),
      caseSensitive,
    }
    wordsCache.set(from, entry)
    return entry
  }

  /** Name a match: a fixed scope, or the grammar's function. */
  const scopeOf = (
    spec: ScopeSpec<State> | undefined,
    match: RuleMatch<State>,
    fallback: Scope,
  ): Scope => (spec === undefined ? fallback : typeof spec === 'function' ? spec(match) : spec)

  /** Whether every predicate a rule declared holds at this position. */
  const contextHolds = (
    when: RuleContext | undefined,
    index: number,
    previousScope: Scope | undefined,
  ): boolean => {
    if (when === undefined) return true
    const info = lineInfoAt(index)
    if (when.firstOnLine === true && info.text.slice(0, info.column).trim() !== '') return false
    if (when.after !== undefined) {
      if (previousScope === undefined || !when.after.includes(previousScope)) return false
    }
    if (when.notAfter !== undefined && previousScope !== undefined) {
      if (when.notAfter.includes(previousScope)) return false
    }
    if (when.line !== undefined && !when.line.test(info.text)) return false
    if (when.minColumn !== undefined && info.column < when.minColumn) return false
    if (when.maxColumn !== undefined && info.column > when.maxColumn) return false
    if (when.prevNot !== undefined && index > 0) {
      let pattern = prevNotCache.get(when)
      if (pattern === undefined) {
        pattern = new RegExp(`[${when.prevNot}]`)
        prevNotCache.set(when, pattern)
      }
      // `prevNot` names characters that must NOT precede the match, so a hit here is
      // a failure. At offset zero there is nothing in front of the match, so the
      // predicate holds — a rule guarded this way is not meant to be disabled at the
      // start of the document, which is what returning early there would do.
      if (pattern.test(source.charAt(index - 1))) return false
    }
    return true
  }

  // ── emitting ─────────────────────────────────────────────────────────────

  /** The scope of the innermost enclosing region, for a token's `region`. */
  let regionScope: Scope | undefined
  /** The scope of the nearest preceding non-whitespace token, maintained as we go. */
  let previousScope: Scope | undefined

  /**
   * Append a token, merging it into the previous one when that is invisible.
   * @param scope - the scope to paint.
   * @param from - the first offset.
   * @param to - the offset after the last.
   * @param region - overrides the enclosing region scope, for a fast-path region.
   */
  const push = (scope: Scope, from: number, to: number, region?: Scope): void => {
    if (to <= from) return
    const text = source.slice(from, to)
    const last = tokens[tokens.length - 1]
    if (
      last !== undefined &&
      last.scope === scope &&
      last.to === from &&
      last.region === region &&
      !/[\r\n]/.test(text) &&
      !/[\r\n]/.test(last.text)
    ) {
      last.to = to
      last.text = source.slice(last.from, to)
    } else {
      const info = lineInfoAt(from)
      tokens.push({ from, to, scope, text, line: info.number, column: from - info.from, region })
    }
    if (text.trim() !== '') previousScope = scope
  }

  /** Raise a diagnostic, stamping the grammar's id on it. */
  const report = (problem: {
    from: number
    to: number
    message: string
    severity?: Diagnostic['severity']
    code?: string
  }): void => {
    diagnostics.push({
      from: problem.from,
      to: problem.to,
      message: problem.message,
      severity: problem.severity ?? 'error',
      code: problem.code ?? 'lexical',
      source: sourceId,
    })
  }

  /** The `RuleMatch` a scope function is handed. */
  const ruleMatch = (
    text: string,
    from: number,
    groups: readonly (string | undefined)[],
  ): RuleMatch<State> => ({ text, source, from, groups, state })

  // ── reading words ────────────────────────────────────────────────────────

  /** The offset after the run of word characters starting at a position. */
  const readWordRun = (index: number): number => {
    let to = index
    while (to < length && isWordChar(source.charAt(to), wordChars)) to += 1
    return to
  }

  /**
   * The whitespace-separated segments a phrase may span.
   *
   * A phrase never crosses a line: a name split over two lines is two names, and
   * letting a vocabulary reach across the break would paint a paragraph as one
   * font.
   */
  const readSegments = (index: number, limit: number): Array<{ from: number; to: number }> => {
    const segments: Array<{ from: number; to: number }> = []
    let cursor = index
    while (segments.length < limit && cursor < length) {
      const to = readWordRun(cursor)
      if (to === cursor) break
      segments.push({ from: cursor, to })
      cursor = to
      const gap = /^[^\S\r\n]+/.exec(source.slice(cursor))?.[0]
      if (gap === undefined) break
      cursor += gap.length
    }
    return segments
  }

  /** The longest member a position spells, or undefined when it spells none. */
  const matchWords = (
    rule: WordsRule<State>,
    words: ResolvedWords,
    index: number,
  ): { to: number; member: string } | undefined => {
    const fold = (word: string): string => (words.caseSensitive ? word : word.toLowerCase())
    const firstTo = readWordRun(index)
    if (firstTo > index) {
      if (rule.phrase !== undefined) {
        const segments = readSegments(index, Math.max(rule.phrase.max ?? 4, 1))
        // Longest first, so a catalogue holding both `IBM Plex` and `IBM Plex
        // Mono` resolves the longer name.
        for (let count = segments.length; count >= 1; count -= 1) {
          const texts = segments.slice(0, count).map((segment) => source.slice(segment.from, segment.to))
          const candidate = texts.join(' ')
          if (words.set.has(fold(candidate))) {
            const last = segments[count - 1]
            if (last !== undefined) return { to: last.to, member: candidate }
          }
        }
      } else {
        const candidate = source.slice(index, firstTo)
        if (words.set.has(fold(candidate))) return { to: firstTo, member: candidate }
      }
    }
    // A member the word predicate cannot read, matched as written. Only tried when reading
    // a word in failed, so the ordinary path pays nothing.
    for (const member of words.literal) {
      // A member containing whitespace is reachable through the phrase path, and matching
      // it literally would ignore `phrase.max` — a cap that only applies on one of the two
      // routes to the same member is not a cap.
      if (rule.phrase !== undefined && /\s/.test(member)) continue
      if (source.startsWith(member, index)) return { to: index + member.length, member }
    }
    return undefined
  }

  /** Whether any rule would claim a position, which is what ends an unclaimed run. */
  const anyRuleClaims = (index: number, previous: Scope | undefined): boolean => {
    // A nested region's closing delimiter is a claim even though no rule mentions
    // it at this position. Without this the run would swallow the delimiter, the
    // region would never close, and a perfectly well-formed document would be
    // reported as unterminated.
    const openRegion = openRegions[openRegions.length - 1]
    if (openRegion !== undefined) {
      const endMatch = execAt(sticky(openRegion.rule.end), source, index)
      if (endMatch !== null && endMatch[0].length > 0) return true
    }
    for (const rule of rules) {
      if (!contextHolds(rule.when, index, previous)) continue
      if (rule.kind === 'region') {
        const match = execAt(sticky(rule.begin), source, index)
        if (match !== null && match[0].length > 0) return true
        continue
      }
      if (rule.kind === 'words') {
        if (matchWords(rule, resolveWords(rule.words), index) !== undefined) return true
        // A rule that reports what it rejects also claims what it rejects:
        // otherwise the word would be swallowed as plain text and the rejection
        // would never be reached.
        if (rule.unknown !== undefined && readWordRun(index) > index) return true
        continue
      }
      const match = execAt(sticky(rule.pattern), source, index)
      if (match !== null && match[0].length > 0) return true
    }
    return false
  }

  // ── the main loop ────────────────────────────────────────────────────────

  /** The regions currently open, innermost last. Only a nested region uses the stack. */
  const openRegions: Array<{
    rule: RegionRule<State>
    scope: Scope
    /** Where the opening delimiter was, so an unterminated region can be reported. */
    beginFrom: number
    beginTo: number
  }> = []

  let index = 0
  while (index < length) {
    const open = openRegions[openRegions.length - 1]

    if (open !== undefined) {
      // The region's own end is always what is tried first, whatever else the rule allows.
      const endMatch = execAt(sticky(open.rule.end), source, index)
      if (endMatch !== null && endMatch[0].length > 0) {
        const closeScope = scopeOf(
          open.rule.closeScope ?? open.rule.scope,
          ruleMatch(endMatch[0], index, [...endMatch]),
          open.scope,
        )
        push(closeScope, index, index + endMatch[0].length, open.scope)
        index += endMatch[0].length
        openRegions.pop()
        regionScope = openRegions[openRegions.length - 1]?.scope
        continue
      }

      // ── an opaque region recognises nothing but its own delimiters ───────
      // This is what makes a string a string: the word `running` inside a quoted name is
      // text, not a state. Nesting does NOT lift it — a comment that nests is still a
      // comment all the way down, and a language whose comments behave otherwise would be
      // one nobody could write a comment in.
      if (open.rule.transparent !== true) {
        if (open.rule.nested === true) {
          const inner = execAt(sticky(open.rule.begin), source, index)
          if (inner !== null && inner[0].length > 0) {
            const innerMatch = ruleMatch(inner[0], index, [...inner])
            push(
              scopeOf(open.rule.openScope ?? open.rule.scope, innerMatch, open.scope),
              index,
              index + inner[0].length,
              open.scope,
            )
            openRegions.push({
              rule: open.rule,
              scope: open.scope,
              beginFrom: index,
              beginTo: index + inner[0].length,
            })
            index += inner[0].length
            continue
          }
        }
        push(open.scope, index, index + 1, open.scope)
        index += 1
        continue
      }
      // A transparent region falls through: the rule list runs inside it, which is the
      // whole meaning of the flag.
    }

    let matched = false

    for (const rule of rules) {
      if (!contextHolds(rule.when, index, previousScope)) continue

      if (rule.kind === 'region') {
        const begin = execAt(sticky(rule.begin), source, index)
        if (begin === null || begin[0].length === 0) continue
        const beginMatch = ruleMatch(begin[0], index, [...begin])
        const scope = scopeOf(rule.scope, beginMatch, 'text')
        const openScope = scopeOf(rule.openScope ?? rule.scope, beginMatch, scope)
        const contentScope = scopeOf(rule.contentScope ?? rule.scope, beginMatch, scope)
        const closeScope = scopeOf(rule.closeScope ?? rule.scope, beginMatch, scope)
        const beginEnd = index + begin[0].length
        push(openScope, index, beginEnd, regionScope)

        // A region that only nests, or that is transparent, is tracked on the stack; the
        // stack is what its end is matched against, and what an unterminated one is reported
        // from. Everything else takes the fast path below.
        if (rule.nested === true || rule.transparent === true) {
          openRegions.push({ rule, scope: contentScope, beginFrom: index, beginTo: beginEnd })
          regionScope = contentScope
          index = beginEnd
          matched = true
          break
        }

        // The common case: find the end in one search rather than re-testing at
        // every character, and paint the whole middle as a single span.
        const close = findRegionEnd(rule.end, source, beginEnd)
        if (close === undefined) {
          // An unterminated region may be painted apart from a terminated one: `unclosed.scope`
          // is what lets a grammar say "this is not a string, it is a broken string", which is
          // the difference between a reader trusting the colours and being misled by them.
          push(
            scopeOf(rule.unclosed?.scope === undefined ? undefined : rule.unclosed.scope, beginMatch, contentScope),
            beginEnd,
            length,
            scope,
          )
          report({
            from: index,
            to: beginEnd,
            message:
              rule.unclosed?.message === undefined
                ? `Unterminated ${scope}.`
                : typeof rule.unclosed.message === 'function'
                  ? rule.unclosed.message(beginMatch)
                  : rule.unclosed.message,
            severity: rule.unclosed?.severity ?? 'error',
            code: rule.unclosed?.code ?? 'unclosed-region',
          })
          index = length
          matched = true
          break
        }
        push(contentScope, beginEnd, close.from, scope)
        push(closeScope, close.from, close.to, scope)
        index = close.to
        matched = true
        break
      }

      if (rule.kind === 'words') {
        const words = resolveWords(rule.words)
        const vocabulary = asResolvedVocabulary(rule.words)
        const hit = matchWords(rule, words, index)
        if (hit !== undefined) {
          const text = source.slice(index, hit.to)
          const match = ruleMatch(text, index, [text])
          const scope =
            rule.scope !== undefined
              ? scopeOf(rule.scope, match, 'word')
              : vocabulary?.scopeFor !== undefined
                ? vocabulary.scopeFor(hit.member)
                : 'word'
          push(scope, index, hit.to, regionScope)
          index = hit.to
          matched = true
          break
        }
        if (rule.unknown === undefined) continue
        // Only the first word is consumed. The scanner has no way to know how far
        // a name it has never seen was meant to reach, and guessing would swallow
        // the words that follow it; a multi-word name that is merely misspelled is
        // the grammar's validator's business, where the structure is known.
        const candidateTo = readWordRun(index)
        if (candidateTo <= index) continue
        const word = source.slice(index, candidateTo)
        const rejected = vocabulary?.reject?.(word, vocabularyContext)
        const message =
          rule.unknown.message === undefined
            ? rejected?.message
            : typeof rule.unknown.message === 'function'
              ? rule.unknown.message(word, ruleMatch(word, index, [word]))
              : rule.unknown.message
                .replace(/\{word\}/g, word)
                .replace(/\{allowed\}/g, listPhrase(words.list))
        push(rule.unknown.scope ?? vocabulary?.unknownScope ?? 'invalid', index, candidateTo, regionScope)
        if (message !== undefined) {
          report({
            from: index,
            to: candidateTo,
            message,
            severity: rule.unknown.severity ?? rejected?.severity ?? 'error',
            code: rule.unknown.code ?? rejected?.code ?? 'unknown-word',
          })
        }
        index = candidateTo
        matched = true
        break
      }

      const match = execAt(sticky(rule.pattern), source, index)
      if (match === null || match[0].length === 0) continue
      const matchInfo = ruleMatch(match[0], index, [...match])
      push(scopeOf(rule.scope, matchInfo, fallbackScope), index, index + match[0].length, regionScope)
      index += match[0].length
      matched = true
      break
    }

    if (matched) continue

    // ── nothing claimed this character ─────────────────────────────────────
    // A run of unclaimed characters is taken at once. Whitespace is by far the
    // most common thing no rule claims, and pushing it one character at a time
    // would be both slower and a great many spans.
    //
    // The run carries its own `previous`: once it has consumed a non-whitespace
    // character, the nearest preceding token is the run itself, not whatever came
    // before it. Without that, a rule guarded by `after` would be asked the wrong
    // question part way through and could let the run swallow a word it wanted.
    // Inside a nested region, a character no rule claims is still region content, so
    // it is painted with that region's scope rather than with the document fallback.
    const unclaimed = regionScope ?? fallbackScope
    let to = index
    let runPrevious = previousScope
    while (to < length) {
      const char = source.charAt(to)
      if (char === '\n' || char === '\r') break
      if (anyRuleClaims(to, runPrevious)) break
      if (/\S/.test(char)) runPrevious = unclaimed
      to += 1
    }
    // `anyRuleClaims(index, ...)` is false here by construction, so this always
    // advances; the guard is against a rule list that disagrees with itself.
    push(unclaimed, index, Math.max(to, index + 1), regionScope)
    index = Math.max(to, index + 1)
  }

  // ── regions the document ended inside ───────────────────────────────────
  // A nested region is closed by the stack, not by a search, so running off the end of the
  // document leaves its frame open with nothing said. Reporting it here is the same fact
  // the opaque path reports when its search fails: a delimiter was opened and never closed.
  // Innermost first, because that is the one the reader has to fix first.
  for (let frame = openRegions.length - 1; frame >= 0; frame -= 1) {
    const open = openRegions[frame]
    if (open === undefined) continue
    const message =
      open.rule.unclosed?.message === undefined
        ? `Unterminated ${open.scope}.`
        : typeof open.rule.unclosed.message === 'function'
          ? open.rule.unclosed.message(ruleMatch('', open.beginFrom, ['']))
          : open.rule.unclosed.message
    report({
      from: open.beginFrom,
      to: open.beginTo,
      message,
      severity: open.rule.unclosed?.severity ?? 'error',
      code: open.rule.unclosed?.code ?? 'unclosed-region',
    })
  }

  return { tokens, diagnostics, state }
}

/**
 * Find a region's closing delimiter at or after a position.
 *
 * The search runs over the rest of the document rather than character by
 * character. The pattern is deliberately stripped of the sticky flag for this one
 * call: the end of a region is *searched for*, not anchored, which is the
 * difference between a string and a string that must begin exactly where the last
 * one ended.
 * @param pattern - the rule's `end` pattern.
 * @param source - the document.
 * @param from - where to start looking.
 * @returns the closing range, or undefined when the region never closes.
 */
function findRegionEnd(
  pattern: RegExp,
  source: string,
  from: number,
): { from: number; to: number } | undefined {
  const probe = new RegExp(pattern.source, `${pattern.flags.replace(/[gy]/g, '')}g`)
  probe.lastIndex = from
  const match = probe.exec(source)
  if (match === null || match[0].length === 0) return undefined
  return { from: match.index, to: match.index + match[0].length }
}
