// ─── dsh-font's font query, as a litearea grammar ───────────────────────────
//
// The language is a CSS font-family list plus the one thing the list cannot carry:
//
//     Geist Mono medium, "Zhuque Fangsong (technical preview)", monospace
//     └─────┬────┘ └──┬─┘
//         family    weight
//
// `font-family: "Geist Mono" 500, monospace` is an invalid declaration that drops
// the whole stack, so the weight has to be its own `font-weight` — but it can
// still be WRITTEN next to the family it belongs to, which is what lets one field
// describe both. A weight is chosen for a family; having to change them in two
// places is exactly the problem this language exists to remove.
//
//     query  := entry ("," entry)*
//     entry  := family | weight
//     family := '"' … '"' | "'" … "'" | word (space word)*
//     weight := a word from WEIGHT_WORDS
//
// Only the LAST word of an unquoted entry may be a weight, and only when the whole
// entry is not itself a catalogued family: `Book Antiqua` and `Franklin Gothic
// Medium` are real families, and stripping either would silently retarget the stack
// at a font nobody picked. Quoting always means "this is the family name,
// verbatim", so a quoted entry never splits.
//
// The parser is forgiving on purpose. This text is typed by hand into a small box,
// not generated, so anything it cannot place is kept as written and reported as a
// diagnostic instead of being silently dropped. This grammar keeps that behaviour
// AND adds the one thing the original editor could not do: it tells you at the
// moment you type, rather than after you press a key.
//
// This is a REFERENCE grammar, not a built-in one. Nothing in `src/core/` knows
// this language exists.
//
// Semantic colouring, and why it is not a token rule's business
// ------------------------------------------------------------
// Two of the original's token classes are not lexical at all. `weightMissing` — a
// weight the chosen family does not have — depends on the machine's installed
// faces, and `unknown` depends on whether the catalogue is authoritative. Both are
// still painted here, from a `scope` FUNCTION that reads the analysis, because a
// rule may look at `match.state`. That is this library's answer to VSCode's split
// between a TextMate grammar and semantic tokens: one rule set, two sources of
// truth about a span, and the semantic one is allowed to override.

import type {
  Decoration,
  Grammar,
  Scope,
  Severity,
  SuggestionItem,
} from '../core/types.js'
import { defineGrammar } from '../core/grammar.js'
import { defineVocabulary } from '../core/vocabulary.js'

/** Every weight word the language accepts, mapped to its CSS number. */
export const FONT_WEIGHT_WORDS: Readonly<Record<string, number>> = {
  thin: 100,
  hairline: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  book: 400,
  normal: 400,
  regular: 400,
  roman: 400,
  medium: 500,
  demibold: 600,
  semibold: 600,
  bold: 700,
  extrabold: 800,
  ultrabold: 800,
  black: 900,
  heavy: 900,
  extrablack: 900,
  ultrablack: 900,
}

/** The CSS weight scale, in the order a picker shows it. */
export const FONT_WEIGHT_SCALE: readonly number[] = [100, 200, 300, 400, 500, 600, 700, 800, 900]

/** The canonical word per weight — `500` is `medium`. */
export const FONT_WEIGHT_LABELS: Readonly<Record<number, string>> = {
  100: 'thin',
  200: 'extralight',
  300: 'light',
  400: 'regular',
  500: 'medium',
  600: 'semibold',
  700: 'bold',
  800: 'extrabold',
  900: 'black',
}

/**
 * Generic CSS families. Valid anywhere in a list, and only useful at the end,
 * which is why they are coloured apart from an installed family: picking one is a
 * different intent from picking a font.
 */
export const FONT_GENERIC_FAMILIES: readonly string[] = [
  'system-ui',
  'sans-serif',
  'serif',
  'monospace',
  'cursive',
  'fantasy',
  'math',
  'emoji',
  'fangsong',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
  'ui-rounded',
]

/**
 * Popular families offered as suggestions even when not detected.
 *
 * Detection cannot see every font and a family may be installed later, so the
 * picker must not present itself as the complete truth. A host that has read the
 * real catalogue passes it in; this list is what a host with no permission to read
 * one can still offer.
 */
export const FONT_COMMON_FAMILIES: readonly string[] = [
  'Inter',
  'IBM Plex Sans',
  'IBM Plex Mono',
  'Noto Sans',
  'Noto Sans SC',
  'Noto Serif',
  'Source Han Sans SC',
  'Source Han Serif SC',
  'JetBrains Mono',
  'Fira Code',
  'Fira Sans',
  'Cascadia Code',
  'Cascadia Mono',
  'Maple Mono',
  'Roboto',
  'Roboto Mono',
  'Open Sans',
  'Lato',
  'Montserrat',
  'Poppins',
  'Ubuntu',
  'Ubuntu Mono',
  'DejaVu Sans',
  'DejaVu Sans Mono',
  'Hack',
  'Inconsolata',
  'Iosevka',
  'Comic Sans MS',
  'PingFang SC',
  'Hiragino Sans GB',
  'Microsoft YaHei',
  'Microsoft YaHei UI',
  'Microsoft JhengHei',
  'SimSun',
  'SimHei',
  'KaiTi',
  'Segoe UI',
  'Segoe UI Variable',
  'Helvetica Neue',
  'Arial',
  'Consolas',
  'Menlo',
  'Monaco',
  'SF Mono',
  'Courier New',
  'Times New Roman',
  'Georgia',
]

/** The scope names this grammar paints with. */
const SCOPE = {
  family: 'family',
  generic: 'family.generic',
  unknown: 'family.unknown',
  unclosed: 'family.unclosed',
  weight: 'weight',
  weightMissing: 'weight.missing',
  separator: 'separator',
} as const

/** One entry of the query, as it was found in the source. */
export interface DshFontEntry {
  /** The whole entry, whitespace included. */
  from: number
  to: number
  /** The trimmed core, and its range. */
  coreFrom: number
  coreTo: number
  core: string
  /** Whether the core opens with a quote. */
  quoted: boolean
  /** The family name, with the quotes and any weight word taken out. */
  name: string
  nameFrom: number
  nameTo: number
  /** The weight word the entry carries, if any. */
  word: string | undefined
  wordFrom: number
  wordTo: number
  /** What the reader made of the entry. */
  kind: 'empty' | 'family' | 'generic' | 'unknown' | 'weight'
}

/** A problem the structural pass found. */
export interface DshFontProblem {
  from: number
  to: number
  message: string
  code: string
  severity: Severity
}

/** What one pass over the query produced. */
export interface DshFontState {
  entries: DshFontEntry[]
  /** The family names the entries name, in order. */
  families: string[]
  /** Which of them the browser will actually paint with; -1 when none will. */
  effective: number
  /** The numeric weight the query states, if it states one. */
  weight: number | undefined
  weightWord: string | undefined
  problems: DshFontProblem[]
}

/** What a host supplies to describe the machine the query will run on. */
export interface DshFontQueryOptions {
  /** The family names the machine has. */
  catalogue?: readonly string[]
  /**
   * Whether that catalogue was READ from the machine.
   *
   * It changes what an unrecognized name means. With a read catalogue the browser
   * will fall through to a later family, which is worth warning about; without one
   * the catalogue is only a suggestion list, and the parser has no business
   * second-guessing a name the user typed.
   */
  enumerated?: boolean
  /** The face style names of each family, as the Local Font Access API reports them. */
  styles?: Readonly<Record<string, readonly string[]>>
  /** The weight the axis ships with, offered as a row that takes the word away. */
  shippedWeight?: number
  /** Families offered even when not detected. */
  commonFamilies?: readonly string[]
  /** The generic CSS families. */
  genericFamilies?: readonly string[]
  /** How many words one unquoted family name may span when matching the catalogue. */
  phraseWords?: number
}

/**
 * The word a numeric weight is spelled with: `500` becomes `medium`.
 * @param weight - a numeric weight.
 * @returns the canonical word, or the number as text when it is off the scale.
 */
export function fontWeightWord(weight: number): string {
  return FONT_WEIGHT_LABELS[weight] ?? String(weight)
}

/**
 * The weights one family actually has, read off its faces' style names.
 *
 * The Local Font Access API reports a face's `style` (`Regular`, `SemiBold`,
 * `Bold Italic`) rather than a number, and is not obliged to spell a two-word
 * style with a hyphen, so `Semi Bold` has to be folded back into one word before
 * the lookup.
 *
 * An empty result means "unknown", never "none": enumerating faces is
 * permission-gated, and a family may report styles this vocabulary cannot read.
 * @param styles - the face style names of one family.
 * @returns the distinct weights, ascending.
 */
export function fontFaceWeights(styles: readonly string[] | undefined): number[] {
  if (styles === undefined) return []
  const found = new Set<number>()
  for (const style of styles) {
    const text = String(style)
      .toLowerCase()
      .replace(/\b(semi|demi)\s+(?=[a-z])/g, 'semi')
      .replace(/\b(extra|ultra)\s+(?=[a-z])/g, 'extra')
    for (const word of text.split(/[^a-z]+/)) {
      const weight = FONT_WEIGHT_WORDS[word]
      if (weight !== undefined) found.add(weight)
    }
  }
  return [...found].sort((left, right) => left - right)
}

/**
 * Render a family name for a CSS list, quoting it only when CSS requires it.
 *
 * A generic family or a CSS-wide keyword must NOT be quoted, because `"sans-serif"`
 * names a literal font instead of the generic family. A single leading hyphen is
 * part of an identifier (`-apple-system`), so it survives unquoted too.
 * @param family - a bare family name.
 * @returns the CSS token for it.
 */
export function quoteFontFamily(family: string): string {
  const name = family.trim()
  if (name === '') return ''
  if (/^-?[A-Za-z][\w-]*$/.test(name)) return name
  return `"${name.replaceAll('"', '')}"`
}

/** Whether a lowercase name is a generic CSS family. */
function isGenericName(name: string, generics: readonly string[]): boolean {
  return generics.includes(name)
}

/**
 * Find the entries of a query, keeping every raw slice.
 *
 * Commas inside quotes are not separators, and an unclosed quote swallows the rest
 * of the document — the same reading the original takes, which is what makes the
 * unclosed-quote diagnostic worth having.
 * @param source - the query.
 * @returns one range per entry, in order. A blank query yields one empty entry.
 */
function splitEntries(source: string): Array<{ from: number; to: number }> {
  const bounds: Array<{ from: number; to: number }> = []
  let start = 0
  let quote = ''
  for (let index = 0; index < source.length; index += 1) {
    const char = source.charAt(index)
    if (quote !== '') {
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === ',') {
      bounds.push({ from: start, to: index })
      start = index + 1
    }
  }
  bounds.push({ from: start, to: source.length })
  return bounds
}

/**
 * Build the grammar for dsh-font's font query.
 * @param options - the machine's catalogue, its faces, and the shipped weight.
 * @returns a grammar that paints, completes, diagnoses, and explains the language.
 */
export function dshFontQueryGrammar(options: DshFontQueryOptions = {}): Grammar<DshFontState> {
  const CATALOGUE = options.catalogue ?? []
  const COMMON = options.commonFamilies ?? FONT_COMMON_FAMILIES
  const GENERICS = options.genericFamilies ?? FONT_GENERIC_FAMILIES
  const STYLES = options.styles ?? {}
  const ENUMERATED = options.enumerated === true
  const SHIPPED_WEIGHT = options.shippedWeight
  const PHRASE_WORDS = options.phraseWords ?? 4

  /** The lowercase catalogue, which is what every lookup folds against. */
  const KNOWN = new Set(CATALOGUE.map((family) => family.toLowerCase()))
  /** The suggestion space: the catalogue when there is one, plus the curated list. */
  const SUGGESTION_SPACE = [...new Set([...CATALOGUE, ...COMMON, ...GENERICS])]
  /** Every weight word, as a literal alternation, for the lexical weight rule. */
  const WEIGHT_ALTERNATION = Object.keys(FONT_WEIGHT_WORDS).join('|')

  /** The families that explain themselves through hover. */
  const FAMILY_VOCAB = defineVocabulary<DshFontState>({
    id: 'family',
    words: SUGGESTION_SPACE,
    scope: SCOPE.family,
    format: quoteFontFamily,
  })

  const GENERIC_VOCAB = defineVocabulary<DshFontState>({
    id: 'generic',
    words: GENERICS,
    scope: SCOPE.generic,
    docs: Object.fromEntries(
      GENERICS.map((name) => [
        name,
        {
          detail: 'a generic CSS family',
          body: 'Always valid, and only useful at the end of the list: it is what the browser falls back to when nothing before it resolves.',
        },
      ]),
    ),
  })

  const WEIGHT_VOCAB = defineVocabulary<DshFontState>({
    id: 'weight',
    words: Object.keys(FONT_WEIGHT_WORDS),
    scope: SCOPE.weight,
    unknownScope: SCOPE.weight,
    docs: Object.fromEntries(
      Object.entries(FONT_WEIGHT_WORDS).map(([word, weight]) => [
        word,
        { title: word, detail: `font-weight ${String(weight)}` },
      ]),
    ),
  })

  /**
   * Read one entry range into the family it names and the weight it carries.
   *
   * The two shapes a weight can take are both here: a bare entry whose last word
   * is a weight (`Geist Mono medium`), and a quoted family followed by one
   * (`"Geist Mono" medium`). Only the last word of an UNQUOTED entry may be a
   * weight, and only when the whole entry is not itself a catalogued family.
   * @param source - the query.
   * @param bounds - the entry's range.
   * @returns the entry, and any complaint about it.
   */
  const readEntry = (
    source: string,
    bounds: { from: number; to: number },
  ): { entry: DshFontEntry; problems: DshFontProblem[] } => {
    const raw = source.slice(bounds.from, bounds.to)
    const trimmed = raw.trim()
    const lead = trimmed === '' ? raw.length : raw.indexOf(trimmed)
    const coreFrom = bounds.from + lead
    const core = trimmed
    const coreTo = coreFrom + core.length
    const problems: DshFontProblem[] = []

    const entry: DshFontEntry = {
      from: bounds.from,
      to: bounds.to,
      coreFrom,
      coreTo,
      core,
      quoted: false,
      name: '',
      nameFrom: coreFrom,
      nameTo: coreTo,
      word: undefined,
      wordFrom: coreTo,
      wordTo: coreTo,
      kind: 'empty',
    }
    if (core === '') return { entry, problems }

    const quoteChar = core.charAt(0)
    const quote = quoteChar === '"' || quoteChar === "'" ? quoteChar : ''
    const lower = core.toLowerCase()
    /**
     * Whether the entry is still worth looking up.
     *
     * A quote that never closes, or text after a closing one that is neither a weight
     * nor part of the name, means the entry is already reported — and the name the
     * reader salvaged from it is a consequence of that mistake, not a separate fact
     * about the machine. Warning that this consequence is "not in the font list" would
     * bury the cause under its symptom.
     */
    let lookUp = true

    if (quote !== '') {
      entry.quoted = true
      const close = core.indexOf(quote, 1)
      if (close < 0) {
        // An unclosed quote runs to the end of the document, which is why it is
        // reported rather than repaired: everything after it became one name.
        entry.name = core.slice(1).trim()
        entry.nameFrom = coreFrom + 1
        entry.kind = 'family'
        problems.push({
          from: coreFrom,
          to: coreTo,
          message: 'This quote is never closed, so everything after it is read as part of one family name.',
          code: 'unclosed-quote',
          severity: 'error',
        })
        return { entry, problems }
      }
      entry.name = core.slice(1, close)
      entry.nameFrom = coreFrom + 1
      entry.nameTo = coreFrom + close
      const rest = core.slice(close + 1).trim()
      if (rest !== '') {
        const restFrom = coreTo - rest.length
        if (Object.hasOwn(FONT_WEIGHT_WORDS, rest.toLowerCase())) {
          entry.word = rest.toLowerCase()
          entry.wordFrom = restFrom
          entry.wordTo = coreTo
        } else {
          problems.push({
            from: restFrom,
            to: coreTo,
            message: `"${rest}" follows a quoted family name but is neither a weight nor part of it, so it is ignored.`,
            code: 'trailing-text',
            severity: 'error',
          })
          lookUp = false
        }
      }
      entry.kind = 'family'
    } else if (isGenericName(lower, GENERICS) || KNOWN.has(lower)) {
      // The whole entry is one family: there is nothing to strip off it.
      entry.name = core
      entry.kind = isGenericName(lower, GENERICS) ? 'generic' : 'family'
    } else if (Object.hasOwn(FONT_WEIGHT_WORDS, lower)) {
      // A bare weight word stands on its own, without a family.
      entry.kind = 'weight'
      entry.word = lower
      entry.wordFrom = coreFrom
      entry.wordTo = coreTo
    } else {
      const cut = lower.lastIndexOf(' ')
      const tail = cut > 0 ? lower.slice(cut + 1) : ''
      if (cut > 0 && Object.hasOwn(FONT_WEIGHT_WORDS, tail)) {
        entry.word = tail
        entry.wordFrom = coreFrom + cut + 1
        entry.wordTo = coreTo
        entry.name = core.slice(0, cut).trim()
        entry.nameTo = entry.nameFrom + entry.name.length
      } else {
        entry.name = core
      }
      entry.kind = 'family'
    }

    const nameLower = entry.name.trim().toLowerCase()
    const generic = nameLower !== '' && isGenericName(nameLower, GENERICS)
    const catalogued = nameLower !== '' && KNOWN.has(nameLower)
    if (lookUp && nameLower !== '' && !generic && !catalogued && ENUMERATED) {
      entry.kind = 'unknown'
      problems.push({
        from: entry.nameFrom,
        to: entry.nameFrom + entry.name.length,
        message: `"${entry.name}" is not in this machine's font list. It is still written, and the browser will fall back to whatever comes after it.`,
        code: 'unknown-family',
        severity: 'warning',
      })
    } else if (generic) {
      entry.kind = 'generic'
    }
    return { entry, problems }
  }

  return defineGrammar<DshFontState>({
    id: 'dsh-font-query',
    name: 'dsh-font font query',

    // A hyphen belongs to a name (`-apple-system`, `Helvetica Neue` has spaces and
    // is reached by the phrase rule instead), and `.` deliberately does not: no
    // family name in this vocabulary contains one, and leaving it out keeps a
    // stray `Inter.` from being read as a single unknown name.
    wordChars: /[\p{L}\p{N}_-]/u,

    rules: [
      // ── quoted names, before anything can split them ───────────────────
      {
        kind: 'match',
        pattern: /"[^"\n]*"|'[^'\n]*'/,
        // The scope is decided by what is INSIDE the quotes: a quoted generic is
        // still a generic, and a quoted name the machine does not have is still
        // worth painting as unknown.
        scope: (match) => quotedScope(match.text, KNOWN, GENERICS, ENUMERATED),
      },
      {
        kind: 'match',
        pattern: /["'][^\n]*/,
        scope: SCOPE.unclosed,
      },

      { kind: 'match', scope: SCOPE.separator, pattern: /,/ },

      // ── a weight word, but only where a weight may stand ──────────────
      // A weight is the LAST word of an entry, so the rule looks ahead for a comma
      // or the end of a line. Without that lookahead `Book` in `Book Antiqua`
      // would be painted as a weight. `prevNot` stops it matching the tail of a
      // longer word.
      //
      // The scope is decided from the ANALYSIS rather than from the characters,
      // which is the one place this grammar needs that: `weight` and
      // `weightMissing` are the same word, and only the machine knows which one it
      // is. A rule may look at `match.state` precisely so that a semantic
      // judgement does not have to become a second highlighter.
      {
        kind: 'match',
        pattern: new RegExp(`(?:${WEIGHT_ALTERNATION})(?=\\s*(?:,|$))`, 'im'),
        when: { prevNot: '\\w' },
        scope: (match) => {
          const state = match.state
          if (state.weight === undefined || state.effective < 0) return SCOPE.weight
          const family = state.families[state.effective] ?? ''
          const faces = fontFaceWeights(lookupStyles(STYLES, family))
          // An unread face list means "unknown", never "absent".
          if (faces.length === 0 || faces.includes(state.weight)) return SCOPE.weight
          return SCOPE.weightMissing
        },
      },

      // ── the catalogue, longest phrase first ──────────────────────────
      // The generics come first because they are ALSO in the suggestion space,
      // and a generic painted as an installed family would say the wrong thing
      // about a word whose whole point is that it names no particular font.
      { kind: 'words', words: GENERIC_VOCAB },
      {
        kind: 'words',
        words: FAMILY_VOCAB,
        phrase: { max: PHRASE_WORDS },
      },

      // ── anything else is a name the reader has not seen ──────────────
      // `unknown` when the catalogue is authoritative, because then the browser
      // really will fall through; plain `family` when it is only a suggestion
      // list, because the parser has no business doubting the user.
      {
        kind: 'match',
        pattern: /[^\s,]+/,
        scope: ENUMERATED ? SCOPE.unknown : SCOPE.family,
      },
    ],

    fallbackScope: 'text',

    // ── what the query means ──────────────────────────────────────────────
    analyze: (text) => {
      const entries: DshFontEntry[] = []
      const problems: DshFontProblem[] = []
      for (const bounds of splitEntries(text)) {
        const read = readEntry(text, bounds)
        entries.push(read.entry)
        problems.push(...read.problems)
      }

      const families: string[] = []
      let weight: number | undefined
      let weightWord: string | undefined
      let sawWeight = false
      for (const entry of entries) {
        if (entry.name.trim() !== '') families.push(entry.name.trim())
        if (entry.word !== undefined) {
          if (!sawWeight) {
            sawWeight = true
            weight = FONT_WEIGHT_WORDS[entry.word]
            weightWord = entry.word
          } else {
            problems.push({
              from: entry.wordFrom,
              to: entry.wordTo,
              message: `The weight is stated more than once. The first one is used and this "${entry.word}" is ignored.`,
              code: 'duplicate-weight',
              severity: 'warning',
            })
          }
        }
      }

      // ── the family that is actually in effect ───────────────────────────
      // With a catalogue read from the machine the first INSTALLED family wins,
      // because that is the one the browser will paint with. Without one the
      // catalogue is only a suggestion list, so the first entry stands.
      let effective = -1
      if (families.length > 0) {
        if (!ENUMERATED) {
          effective = 0
        } else {
          for (let index = 0; index < families.length; index += 1) {
            const lower = (families[index] ?? '').toLowerCase()
            if (isGenericName(lower, GENERICS) || KNOWN.has(lower)) {
              effective = index
              break
            }
          }
        }
      }

      // ── a weight the effective family does not have ──────────────────────
      // Only reported when that family's faces are actually known: an empty face
      // list means "not read", never "not installed".
      if (weight !== undefined && effective >= 0) {
        const family = families[effective] ?? ''
        const faces = fontFaceWeights(lookupStyles(STYLES, family))
        if (faces.length > 0 && !faces.includes(weight)) {
          const entry = entries.find((candidate) => candidate.word !== undefined)
          if (entry !== undefined) {
            problems.push({
              from: entry.wordFrom,
              to: entry.wordTo,
              message: `"${family}" has no ${String(weight)} face, so the browser will synthesise one. It does have ${faces.join(', ')}.`,
              code: 'missing-weight',
              severity: 'warning',
            })
          }
        }
      }

      // Only the unenumerated, non-generic case needs the old generic warning: a list
      // with no generic tail is a list with nothing to fall back to.
      if (
        families.length > 0 &&
        !families.some((family) => isGenericName(family.toLowerCase(), GENERICS))
      ) {
        // A note about the document as a whole belongs to no character, so its range is
        // empty and sits at the end. Underlining an entry to say the LIST is incomplete
        // would put a squiggle on text that is perfectly correct — and, because a
        // diagnostic outranks a description in a tooltip, it would also hide what that
        // entry has to say about itself.
        problems.push({
          from: text.length,
          to: text.length,
          message:
            'No generic family at the end, so a name that fails to resolve has nothing to fall back to. Adding one, such as `sans-serif`, is free.',
          code: 'no-generic-fallback',
          severity: 'info',
        })
      }

      return { entries, families, effective, weight, weightWord, problems }
    },

    validate: (context) => {
      for (const problem of context.state.problems) {
        context.report({
          from: problem.from,
          to: problem.to,
          message: problem.message,
          code: problem.code,
          severity: problem.severity,
        })
      }
    },

    // ── the family in effect, marked rather than recoloured ───────────────
    // It is a decoration and not a scope because it depends on the machine, not on
    // the characters: the same text means something else on a computer with
    // different fonts, and re-lexing the document whenever the catalogue changed
    // would be the wrong shape of work.
    decorate: (_text, state) => {
      const decorations: Decoration[] = []
      if (state.effective < 0) return decorations
      const family = state.families[state.effective] ?? ''
      const target = state.entries.find((candidate) => candidate.name.trim() === family)
      if (target !== undefined) {
        decorations.push({
          from: target.nameFrom,
          to: target.nameFrom + target.name.length,
          kind: 'effective',
          title: `in effect: ${family}`,
        })
      }
      return decorations
    },

    // ── what can come next ────────────────────────────────────────────────
    compose: [
      {
        id: 'family',
        // The whole query is entries, so this source is always eligible; the
        // entry under the caret decides what it replaces.
        when: () => true,
        range: (context) => entryRange(context.state, context.caret),
        items: (context) => {
          const entry = entryAt(context.state.entries, context.caret)
          const core = entry?.core ?? ''
          const quoted = entry?.quoted === true
          // The needle is the FAMILY part of the entry: a weight word the entry
          // already carries would otherwise make `"Geist Mono" medium` match no
          // family at all.
          const inner = unquote(core)
          const carried = entry?.word
          const needle = carried === undefined ? inner.trim() : inner.slice(0, -(carried.length)).trim()
          const exact = findExact(SUGGESTION_SPACE, needle)
          // What the caret has already spelled, with any weight word still to come
          // left out. This is what makes `Geist Mono b` offer Geist Mono's weights:
          // the entry as a whole is not a family name, but the part before the word
          // being typed is. Without this fallback a weight becomes unreachable the
          // moment the first letter of it is typed.
          const headFrom = entry?.coreFrom ?? context.word.from
          const head = unquote(context.text.slice(headFrom, Math.max(context.word.from, headFrom))).trim()
          // Where the caret sits decides whether a pick replaces the entry or is
          // inserted ahead of it. A caret at the very start of a COMPLETE entry is
          // a boundary, not an edit: the user put it there to place another family
          // in front, which is how a fallback stays a fallback.
          const atBoundary = entry !== undefined && context.caret <= entry.coreFrom && exact !== undefined

          const familyInEntry = exact ?? findExact(SUGGESTION_SPACE, head)
          // Where the caret sits decides what leads. Past the family name the user
          // is reaching for a weight (`Geist Mono b` → Bold); inside the name they
          // are still spelling it out, so the family list leads and the list never
          // fills with weights while a name is half-written.
          const atFamilyEnd = entry === undefined || context.caret >= entry.wordFrom

          // A weight is only offered once the entry names a family.
          const weightRows: SuggestionItem[] = []
          if (familyInEntry !== undefined && !atBoundary && atFamilyEnd) {
            const detected = fontFaceWeights(lookupStyles(STYLES, familyInEntry))
            const pool = detected.length > 0 ? detected : [...FONT_WEIGHT_SCALE]
            const typedWord = context.word.prefix.toLowerCase()
            for (const value of pool) {
              const word = fontWeightWord(value)
              if (typedWord !== '' && !word.startsWith(typedWord)) continue
              weightRows.push({
                label: `${familyInEntry} ${word}`,
                insert: quoteFontFamily(familyInEntry) + (value === SHIPPED_WEIGHT ? '' : ` ${word}`),
                kind: 'weight',
                detail: `font-weight ${String(value)}`,
                documentation:
                  value === SHIPPED_WEIGHT
                    ? 'The weight this axis already uses, so picking it takes the word away rather than spelling out a value nobody chose.'
                    : undefined,
                // A weight's position is decided by the SCALE and not by the length of
                // its label, which is what the zero-padded key is for: without it the
                // shortest word would lead, so `bold` would sit above the shipped
                // `regular` and the list would look shuffled. The weight the entry
                // already states outranks all of them, so an Enter that accepts the top
                // row re-applies what is written.
                sortText:
                  word === carried ? '0' : `1${String(value).padStart(3, '0')}`,
              })
            }
          }

          const familyRows: SuggestionItem[] = []
          for (const name of SUGGESTION_SPACE) {
            const generic = isGenericName(name.toLowerCase(), GENERICS)
            familyRows.push({
              label: name,
              // A completion never drops a weight the entry already states: the
              // word travels with the pick, so swapping the family does not quietly
              // reset the weight.
              insert: quoteFontFamily(name) + (carried === undefined ? '' : ` ${carried}`),
              mode: atBoundary ? 'before' : 'replace',
              // A comma invites the next fallback. Only after a family, never after
              // a weight, which completes the entry instead of starting one.
              append: atBoundary || lastEntry(context.state, context.caret) ? ', ' : '',
              kind: generic ? 'generic' : 'family',
              detail: generic
                ? 'generic family'
                : KNOWN.has(name.toLowerCase())
                  ? 'installed'
                  : 'suggested',
              // After the weights when weights lead, which is the whole reason a
              // grammar gets to name the group: `2` sorts above `1xxx` and below `0`.
              sortText: weightRows.length > 0 ? '2' : '0',
            })
          }

          const rows = weightRows.length > 0 ? [...weightRows, ...familyRows] : familyRows
          // The entry exactly as typed, so a name nobody catalogued can still be
          // completed to itself rather than being impossible to accept.
          if (needle !== '' && exact === undefined && !isGenericName(needle.toLowerCase(), GENERICS)) {
            rows.push({
              label: inner,
              insert: inner,
              kind: 'custom',
              detail: 'as typed',
              documentation:
                'Written exactly as it stands. A name the browser does not have is still a valid declaration: it is what lets a stack work on a machine this one cannot see.',
              sortText: '3',
            })
          }
          return rows
        },
      },
    ],

    // ── what a thing is ───────────────────────────────────────────────────
    describe: (context) => {
      const token = context.token
      if (token === undefined) return undefined
      const state = context.state
      const entry = entryAt(state.entries, context.offset)

      if (token.scope === SCOPE.separator) return undefined

      if (token.scope === SCOPE.weight || token.scope === SCOPE.weightMissing) {
        const word = token.text.toLowerCase()
        const value = FONT_WEIGHT_WORDS[word]
        const family = state.effective >= 0 ? state.families[state.effective] : undefined
        if (value === undefined) return { title: token.text }
        const faces = family === undefined ? [] : fontFaceWeights(lookupStyles(STYLES, family))
        return {
          title: `${word} — font-weight ${String(value)}`,
          detail: entry?.name === '' ? 'applies to the whole axis' : `applies to ${family ?? 'the first family'}`,
          body:
            faces.length === 0
              ? `${family ?? 'This family'} was not read, so whether it has a ${String(value)} face is unknown.`
              : faces.includes(value)
                ? `${family ?? 'This family'} has this face.`
                : `${family ?? 'This family'} has no ${String(value)} face, so the browser will synthesise one.`,
        }
      }

      if (token.scope === SCOPE.generic) {
        return {
          title: token.text,
          detail: 'a generic CSS family',
          body: 'Always valid, and only useful at the end of the list: it is what the browser falls back to when nothing before it resolves.',
        }
      }

      if (token.scope === SCOPE.unclosed) {
        return {
          title: token.text,
          detail: 'unclosed quote',
          body: 'The closing quote is missing, so this and everything after it are read as one family name. A font family containing a quote character has to be written with the other quote style, because backslash escapes are deliberately not interpreted.',
        }
      }

      if (entry !== undefined && entry.kind === 'unknown') {
        return {
          title: entry.name,
          detail: 'not installed here',
          body: 'Still a valid declaration: it is written to the setting, and the browser falls through to the next family in the list when it cannot resolve. Reordering it to the end of the list is what the fallbacks are for.',
        }
      }

      const entryDoc = FAMILY_VOCAB.entryFor(token.text)
      const installed = KNOWN.has(token.text.toLowerCase())
      const faces = fontFaceWeights(lookupStyles(STYLES, token.text))
      return {
        title: token.text,
        detail: installed ? 'installed' : 'not read on this machine',
        body:
          entryDoc?.body ??
          (faces.length > 0
            ? `Faces read from this machine: ${faces.join(', ')}.`
            : 'This family has no faces recorded, so its weights are unknown rather than absent.'),
      }
    },
  })
}

/** The scope a closed quoted entry is painted with. */
function quotedScope(
  text: string,
  known: ReadonlySet<string>,
  generics: readonly string[],
  enumerated: boolean,
): Scope {
  const quote = text.charAt(0)
  const inner = text.length >= 2 && text.endsWith(quote) ? text.slice(1, -1) : text.slice(1)
  const lower = inner.trim().toLowerCase()
  if (lower === '') return SCOPE.family
  if (generics.includes(lower)) return SCOPE.generic
  if (known.has(lower)) return SCOPE.family
  return enumerated ? SCOPE.unknown : SCOPE.family
}

/** Take one matching pair of surrounding quotes off a name. */
function unquote(name: string): string {
  const text = String(name)
  const quote = text.charAt(0)
  if ((quote === '"' || quote === "'") && text.length >= 2 && text.endsWith(quote)) {
    return text.slice(1, -1)
  }
  return text
}

/** The entry an offset falls in, when it falls in one. */
function entryAt(entries: readonly DshFontEntry[], offset: number): DshFontEntry | undefined {
  for (const entry of entries) {
    if (offset >= entry.from && offset <= entry.to) return entry
  }
  return entries[entries.length - 1]
}

/**
 * The range a completion over the caret replaces: the CORE of the entry it sits
 * in, without the whitespace around it.
 *
 * The whitespace is left out on purpose, and it matters twice. It keeps the
 * replacement from swallowing the separator that belongs to the comma before it,
 * and it keeps the needle honest — the text between the range's start and the
 * caret is what the list is filtered by, and a leading space in it would match
 * nothing while looking like it should match everything.
 * @param state - the analysis.
 * @param caret - the caret offset.
 * @returns the range to replace.
 */
function entryRange(state: DshFontState, caret: number): { from: number; to: number } {
  const entry = entryAt(state.entries, caret)
  return entry === undefined ? { from: caret, to: caret } : { from: entry.coreFrom, to: entry.coreTo }
}

/** Whether the caret's entry is the last one in the document. */
function lastEntry(state: DshFontState, caret: number): boolean {
  const entry = entryAt(state.entries, caret)
  return entry === undefined || entry === state.entries[state.entries.length - 1]
}

/** Case-insensitive exact lookup in a suggestion space. */
function findExact(names: readonly string[], needle: string): string | undefined {
  const lower = needle.toLowerCase()
  return names.find((name) => name.toLowerCase() === lower)
}

/** The face style names of a family, matched without regard to case. */
function lookupStyles(
  styles: Readonly<Record<string, readonly string[]>>,
  family: string,
): readonly string[] | undefined {
  if (Object.hasOwn(styles, family)) return styles[family]
  const lower = family.toLowerCase()
  for (const [name, faces] of Object.entries(styles)) {
    if (name.toLowerCase() === lower) return faces
  }
  return undefined
}

/** A diagnostic the grammar rates as informational rather than as a mistake. */
export const DSH_FONT_INFO_CODES: readonly string[] = ['no-generic-fallback']
