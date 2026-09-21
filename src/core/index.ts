// ─── the engine's public surface ────────────────────────────────────────────
//
// Everything here is pure: text and a grammar go in, values come out. Nothing in
// this module touches the DOM, which is why `scripts/browser-check.mjs` is needed
// for only one claim and everything else is asserted in plain Node.

export type {
  CheckRule,
  Completion,
  CompletionContext,
  CompletionRow,
  CompletionSource,
  CompletionTrigger,
  Decoration,
  DiagnoseContext,
  Diagnostic,
  Grammar,
  HoverContext,
  HoverInfo,
  LineInfo,
  MatchRule,
  Range,
  RegionRule,
  ResolvedVocabulary,
  Rule,
  RuleContext,
  RuleMatch,
  Scope,
  ScopeSpec,
  Severity,
  SuggestionItem,
  Token,
  VocabularyContext,
  VocabularyEntry,
  WordInfo,
  WordsRule,
  WordsSource,
} from './types.js'

export { excerpt, fillTemplate, listPhrase } from './format.js'

export {
  clamp,
  containsOffset,
  isEmptyRange,
  isOffset,
  isWordChar,
  lineAt,
  lineIndexAt,
  lineStarts,
  scopeAt,
  tokenAfter,
  tokenAt,
  tokenBefore,
  tokensOnLine,
  wordInfoAt,
} from './text.js'

export {
  asResolvedVocabulary,
  defineVocabulary,
  resolveWordsSource,
  vocabularyWords,
  type VocabularySpec,
} from './vocabulary.js'

export {
  isResolvedGrammar,
  resolveGrammar,
  scan,
  type ResolvedGrammar,
  type ScanResult,
} from './scan.js'

export { buildSegments, segmentClasses, type PaintSegment, type SegmentInput } from './segments.js'

export { inspect, normalizeDiagnostics, type Inspection } from './inspect.js'

export {
  fuzzyMatch,
  highlightSegments,
  isWordStart,
  rank,
  type FuzzyMatch,
  type Ranked,
  type RankOptions,
} from './rank.js'

export {
  applyCompletion,
  complete,
  type AppliedCompletion,
  type CompletionRequest,
} from './complete.js'

export { diagnosticHover, resolveHover } from './hover.js'

export { defineCompletion, defineGrammar } from './grammar.js'
