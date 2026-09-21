// ─── inspect: the one call the editor makes per keystroke ───────────────────
//
// Everything the editor needs to know about a document is computed here, once,
// from one grammar. The paint, the squiggles, the semantic decorations, and the
// structural analysis come out of a single call and are stored together, so the
// completion list and the coloured text cannot be looking at different documents.
//
// That is a deliberate inversion of how the editors this library replaces were
// built. Each of them re-derived the tokens, the parse, and the suggestions
// separately, from the same string, in three places — and the three drifted, so
// a word could be painted as a valid value while the completer thought it was
// unknown and the diagnostic pointed at a range that had already moved.

import type {
  CheckRule,
  Decoration,
  DiagnoseContext,
  Diagnostic,
  Grammar,
  Token,
} from './types.js'
import { listPhrase } from './format.js'
import { isResolvedGrammar, resolveGrammar, scan, type ResolvedGrammar } from './scan.js'
import { resolveWordsSource } from './vocabulary.js'

/** Everything one pass over a document produced. */
export interface Inspection<State = unknown> {
  /** The text this was computed from, kept so nothing has to guess its version. */
  text: string
  tokens: Token[]
  /** Lexical problems, the grammar's `checks`, and its `validate`, together. */
  diagnostics: Diagnostic[]
  /** Semantic ranges that are not tokens. */
  decorations: Decoration[]
  /** Whatever `Grammar.analyze` returned. */
  state: State
}

/**
 * Run a grammar's declarative checks over the tokens.
 *
 * A check is the shape most vocabulary mistakes actually take — "this token is
 * one of these words or it is wrong" — and expressing it declaratively means the
 * message, the severity, and the code are declared once instead of being
 * reassembled by hand at every site.
 * @param source - the document.
 * @param grammar - the resolved grammar.
 * @param tokens - the scanned tokens.
 * @param state - the analysis, so a check may consult a vocabulary the machine supplied.
 * @returns the diagnostics the checks raised.
 */
function runChecks<State>(
  source: string,
  grammar: ResolvedGrammar<State>,
  tokens: readonly Token[],
  state: State,
): Diagnostic[] {
  const checks = grammar.grammar.checks
  if (checks === undefined || checks.length === 0) return []
  const diagnostics: Diagnostic[] = []
  // The ANALYSIS, not `initialState`. A `WordsSource` function is documented as receiving
  // the grammar's analysis, and the point of a dynamic vocabulary is that it comes from
  // outside the document — so a check whose allowed set is resolved from `analyze` must
  // see it, or the two halves of one declaration would disagree about what is legal.
  const context = { text: source, state }

  for (const check of checks as readonly CheckRule<State>[]) {
    const members = check.allow === undefined ? undefined : resolveWordsSource(check.allow, context)
    const vocabulary = check.allow === undefined ? undefined : check.allow
    const caseSensitive =
      typeof vocabulary === 'object' && vocabulary !== null && !Array.isArray(vocabulary)
        ? (vocabulary as { caseSensitive?: boolean }).caseSensitive === true
        : false
    const fold = (word: string): string => (caseSensitive ? word : word.toLowerCase())
    const set =
      members === undefined ? undefined : new Set(members.map((member) => fold(member)))
    /** Lines already reported, for a check that only wants one complaint each. */
    const reportedLines = new Set<number>()

    for (const token of tokens) {
      // Whitespace is a token like any other, which means a check written against `'*'` would
      // otherwise underline every space and report it as a misspelling. No one has ever
      // wanted a diagnostic about a space.
      if (token.text.trim() === '') continue
      if (!check.scopes.includes('*') && !check.scopes.includes(token.scope)) continue
      if (check.except !== undefined && check.except.test(token.text)) continue
      if (set !== undefined && set.has(fold(token.text))) continue
      if (check.perLine === true) {
        if (reportedLines.has(token.line)) continue
        reportedLines.add(token.line)
      }
      diagnostics.push({
        from: token.from,
        to: token.to,
        severity: check.severity ?? 'error',
        message: check.message
          .replace(/\{word\}/g, token.text)
          .replace(/\{allowed\}/g, listPhrase(members ?? [])),
        code: check.code,
        detail: check.detail,
        source: grammar.grammar.id,
      })
    }
  }
  return diagnostics
}

/**
 * Inspect a document: paint, problems, decorations, and structure in one pass.
 * @param source - the document.
 * @param grammar - the language, as written or already resolved.
 * @returns everything the editor needs for one text.
 */
export function inspect<State>(
  source: string,
  grammar: Grammar<State> | ResolvedGrammar<State>,
): Inspection<State> {
  const resolved = isResolvedGrammar(grammar) ? grammar : resolveGrammar(grammar)
  const scanned = scan(source, resolved)
  const declared = resolved.grammar
  const diagnostics: Diagnostic[] = [...scanned.diagnostics]

  diagnostics.push(...runChecks(source, resolved, scanned.tokens, scanned.state))

  if (declared.validate !== undefined) {
    const context: DiagnoseContext<State> = {
      text: source,
      tokens: scanned.tokens,
      state: scanned.state,
      report: (problem) => {
        diagnostics.push({
          from: problem.from,
          to: problem.to,
          severity: problem.severity ?? 'error',
          message: problem.message,
          code: problem.code ?? 'validate',
          detail: problem.detail,
          source: declared.id,
        })
      },
    }
    declared.validate(context)
  }

  const decorations = declared.decorate === undefined ? [] : [...declared.decorate(source, scanned.state)]

  return {
    text: source,
    tokens: scanned.tokens,
    diagnostics: normalizeDiagnostics(diagnostics),
    decorations: normalizeDecorations(decorations, source.length),
    state: scanned.state,
  }
}

/**
 * Sort diagnostics by position and drop duplicates.
 *
 * Two rules can legitimately notice the same mistake — a vocabulary's own
 * rejection and a grammar's validator both know that `nope` is not a colour —
 * and drawing the underline twice makes it darker rather than more informative.
 * Duplicates are compared on position, code, and message, so two genuinely
 * different complaints about one word both survive.
 * @param diagnostics - the collected diagnostics.
 * @returns the deduplicated, ordered list.
 */
export function normalizeDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>()
  const out: Diagnostic[] = []
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.from}:${diagnostic.to}:${diagnostic.code ?? ''}:${diagnostic.message}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(diagnostic)
  }
  return out.sort((left, right) => left.from - right.from || left.to - right.to)
}

/**
 * Clamp decorations into the document and drop the ones that came out empty.
 *
 * A grammar computing decorations from a stale parse can hand over a range that
 * no longer exists, and a decoration outside the text would only produce a span
 * nobody can see.
 * @param decorations - the declared decorations.
 * @param length - the document's length.
 * @returns the usable decorations, ordered.
 */
function normalizeDecorations(decorations: readonly Decoration[], length: number): Decoration[] {
  const out: Decoration[] = []
  for (const decoration of decorations) {
    const from = Math.max(0, Math.min(decoration.from, length))
    const to = Math.max(from, Math.min(decoration.to, length))
    if (to <= from) continue
    out.push({ ...decoration, from, to })
  }
  return out.sort((left, right) => left.from - right.from || left.to - right.to)
}
