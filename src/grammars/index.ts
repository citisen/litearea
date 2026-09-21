// ─── reference grammars ─────────────────────────────────────────────────────
//
// The core of litearea ships NO syntax. There is no built-in language, no
// language identifier to switch on, and nothing in `src/core/` that knows what a
// font stack or a favicon state is. That is the whole claim of the library, and
// these two files are how it is checked rather than merely asserted.
//
// They are two real DSLs, taken from two real plugins, expressed entirely as data
// the engine is handed:
//
//   dshFontQueryGrammar()      a CSS font-family list with a weight written beside
//                              the family it belongs to
//   dshSentryStyleGrammar()    a line-oriented appearance document, one line per
//                              session state
//
// Between them they exercise every part of the contract: regex rules and
// vocabulary rules, multi-word phrases, a lookahead, a scope FUNCTION that reads
// the analysis, a dynamic vocabulary resolved from the host machine, all four
// diagnostic sources, completion with both insertion modes, hover, and semantic
// decorations. If a future change to the engine broke any of that, these two files
// would stop working — which is why they are in the test suite and why the
// documentation points at them as the worked examples.
//
// They are importable because a host should not have to retype a language that
// already exists. They are NOT built in: pass one to `createEditor` or import
// nothing from this module and write your own.

export {
  DSH_FONT_INFO_CODES,
  FONT_COMMON_FAMILIES,
  FONT_GENERIC_FAMILIES,
  FONT_WEIGHT_LABELS,
  FONT_WEIGHT_SCALE,
  FONT_WEIGHT_WORDS,
  dshFontQueryGrammar,
  fontFaceWeights,
  fontWeightWord,
  quoteFontFamily,
  type DshFontEntry,
  type DshFontProblem,
  type DshFontQueryOptions,
  type DshFontState,
} from './dshFont.js'

export {
  DSH_SENTRY_COLORS,
  DSH_SENTRY_STATES,
  DSH_SENTRY_VOCABULARY,
  dshSentryStyleGrammar,
  type DshSentryLine,
  type DshSentryLook,
  type DshSentryProblem,
  type DshSentrySlot,
  type DshSentryState,
  type DshSentryStyleOptions,
  type DshSentryWord,
} from './dshSentry.js'
