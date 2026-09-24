// ─── litearea ───────────────────────────────────────────────────────────────
//
// A textarea-based code editor: undo that works, syntax highlighting from rules you
// write, VSCode-shaped completion, diagnostics, hover, and a box that fits its
// content. No CodeMirror, no Monaco, no runtime dependency.
//
// The package has three entry points and this is the largest:
//
//   @citisen/litearea              the engine and the DOM layer (this file)
//   @citisen/litearea/react        a React binding over the same editor
//   @citisen/litearea/styles.css   the stylesheet, for hosts that link CSS
//
// Nothing here knows any syntax, and the package ships none: a caller supplies
// the rules. `src/core/` is pure and needs no DOM; `src/dom/` needs a document
// and no framework.

export type {
  AutoPair,
  CheckRule,
  CommentSyntax,
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
} from './core/types.js'

export type { PaintSegment, SegmentInput } from './core/segments.js'

export { excerpt, fillTemplate, listPhrase } from './core/format.js'

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
} from './core/text.js'

export {
  asResolvedVocabulary,
  defineVocabulary,
  resolveWordsSource,
  vocabularyWords,
  type VocabularySpec,
} from './core/vocabulary.js'

export {
  isResolvedGrammar,
  resolveGrammar,
  scan,
  type ResolvedGrammar,
  type ScanResult,
} from './core/scan.js'

export { inspect, normalizeDiagnostics, type Inspection } from './core/inspect.js'

export {
  buildSegments,
  segmentClasses,
} from './core/segments.js'

export {
  fuzzyMatch,
  highlightSegments,
  isWordStart,
  rank,
  type FuzzyMatch,
  type Ranked,
  type RankOptions,
} from './core/rank.js'

export {
  applyCompletion,
  complete,
  type AppliedCompletion,
  type CompletionRequest,
} from './core/complete.js'

export { diagnosticHover, resolveHover } from './core/hover.js'

export {
  buildStickyBlocks,
  planStickyHeaders,
  type StickyBlock,
  type StickyBox,
  type StickyPlacement,
  type StickyRangeInput,
} from './core/sticky.js'

export {
  planBracketEnter,
  planCommentToggle,
  planPairTyping,
  type BracketEnter,
  type CommentToggle,
  type PairAction,
  type PairTyping,
  type PendingEdit,
} from './core/pairs.js'

export { defineCompletion, defineGrammar } from './core/grammar.js'

export {
  LITEAREA_STYLES,
  decorationClass,
  injectStyles,
  scopeClass,
  severityClass,
} from './styles.js'

export * from './dom/index.js'
