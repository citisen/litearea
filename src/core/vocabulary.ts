// ─── vocabulary: the four facts that must agree ─────────────────────────────
//
// A closed set of words appears four times in a language-aware editor: as the
// syntax that accepts it, as the colour it is painted in, as the message a typo
// earns, and as the documentation a hover shows. Written out four times they
// drift — a word added to the parser and forgotten by the highlighter is the
// ordinary way a grammar rots — and the drift is invisible until someone types
// the new word and watches the editor get it wrong.
//
// So they are declared once. `defineVocabulary` returns an object the engine
// already knows how to consume: hand it to a `words` rule and it paints, accepts,
// rejects, and documents without being mentioned again.
//
//     const SHAPES = defineVocabulary({
//       id: 'shape',
//       words: ['circle', 'rounded', 'square', 'none'],
//       unknownMessage: '"{word}" is not a shape — expected one of {allowed}.',
//       docs: { circle: 'A full disc, the background for a busy state.' },
//     })
//
//     { kind: 'words', words: SHAPES }

import type {
  ResolvedVocabulary,
  Scope,
  Severity,
  VocabularyContext,
  VocabularyEntry,
  WordsSource,
} from './types.js'
import { fillTemplate, listPhrase } from './format.js'

/** What a vocabulary is told about the document it is being resolved for. */
export interface VocabularySpec<State = unknown> {
  /** A stable id, used in the diagnostic code and for debugging. */
  id: string
  /**
   * The members.
   *
   * A function is how a set that lives outside the document reaches the grammar
   * without the grammar holding mutable state: the installed fonts, the states
   * the host actually has. It is called once per scan.
   */
  words: readonly string[] | ((context: VocabularyContext<State>) => readonly string[])
  /** The scope a member is painted with. Defaults to `vocabulary:<id>`. */
  scope?: Scope | ((word: string) => Scope)
  /** The scope a rejected word is painted with. Defaults to `'invalid'`. */
  unknownScope?: Scope
  /**
   * The message a rejected word earns.
   *
   * Present, a word-shaped token outside the set is reported; absent, it is
   * reported by nobody and the grammar is the poorer for it. `{word}` and
   * `{allowed}` are substituted, the latter as a readable list.
   */
  unknownMessage?: string | ((word: string, allowed: readonly string[]) => string)
  /** How loudly a rejected word complains. Default `'error'`. */
  unknownSeverity?: Severity
  /** A stable code for the rejection. Defaults to `vocabulary:<id>`. */
  unknownCode?: string
  /**
   * What each member explains about itself, for hover. A bare string is taken as
   * the body.
   */
  docs?: Readonly<Record<string, string | VocabularyEntry>>
  /** A dimmed line shown beside a member in the completion list. */
  detail?: (word: string) => string | undefined
  /** Whether membership is case-sensitive. Default `false`. */
  caseSensitive?: boolean
  /**
   * How a member is written into the document when it is accepted.
   *
   * Separate from the word itself because a member is not always insertable as
   * typed: a font family containing a space has to be quoted, even though the
   * vocabulary calls it `IBM Plex Mono`.
   */
  format?: (word: string) => string
}

/**
 * Build a vocabulary: the set, its colour, its rejection, and its documentation.
 * @param spec - the declaration.
 * @returns a resolved vocabulary, ready for a `words` rule.
 */
export function defineVocabulary<State = unknown>(
  spec: VocabularySpec<State>,
): ResolvedVocabulary<State> {
  const caseSensitive = spec.caseSensitive === true
  const unknownScope = spec.unknownScope ?? 'invalid'
  const defaultScope = `vocabulary:${spec.id}`
  const unknownCode = spec.unknownCode ?? `vocabulary:${spec.id}`
  const unknownSeverity = spec.unknownSeverity ?? 'error'
  /** Fold a word for lookup, honouring the vocabulary's case rule. */
  const fold = (word: string): string => (caseSensitive ? word : word.toLowerCase())
  /** Find the member a word names, preserving the declared spelling. */
  const memberOf = (word: string, allowed: readonly string[]): string | undefined => {
    const needle = fold(word)
    return allowed.find((candidate) => fold(candidate) === needle)
  }
  /** The declaration for one member, whichever of the two shapes it took. */
  const docOf = (word: string): VocabularyEntry | undefined => {
    if (spec.docs === undefined) return undefined
    for (const [key, value] of Object.entries(spec.docs)) {
      if (fold(key) !== fold(word)) continue
      return typeof value === 'string' ? { body: value } : value
    }
    return undefined
  }

  return {
    id: spec.id,
    caseSensitive,
    resolve: (context) => {
      const words = typeof spec.words === 'function' ? spec.words(context) : spec.words
      return Array.isArray(words) ? words : []
    },
    has: (word, context) => {
      const words = typeof spec.words === 'function' ? spec.words(context) : spec.words
      return memberOf(word, Array.isArray(words) ? words : []) !== undefined
    },
    scopeFor: (word) => {
      if (typeof spec.scope === 'function') return spec.scope(memberOf(word, [word]) ?? word)
      return spec.scope ?? defaultScope
    },
    unknownScope,
    reject: (word, context) => {
      if (spec.unknownMessage === undefined) return undefined
      const allowed = typeof spec.words === 'function' ? spec.words(context) : spec.words
      const members = Array.isArray(allowed) ? allowed : []
      const message =
        typeof spec.unknownMessage === 'function'
          ? spec.unknownMessage(word, members)
          : fillTemplate(spec.unknownMessage, {
              word,
              allowed: listPhrase(members, { conjunction: 'or' }),
            })
      return { message, severity: unknownSeverity, code: unknownCode }
    },
    entryFor: (word) => docOf(word),
    format: (word) => (spec.format === undefined ? word : spec.format(word)),
  }
}

/**
 * The members of a vocabulary, resolved for a document.
 *
 * A helper for the common case of a caller that has a vocabulary and wants its
 * words, without reaching through to `resolve` and re-supplying the context.
 * @param vocabulary - a resolved vocabulary.
 * @param context - the document it is being resolved for.
 * @returns the members, in declaration order.
 */
export function vocabularyWords<State>(
  vocabulary: ResolvedVocabulary<State>,
  context: VocabularyContext<State>,
): readonly string[] {
  return vocabulary.resolve(context)
}

/**
 * Recognize a vocabulary among the shapes a `WordsSource` may take.
 *
 * The test is structural rather than `instanceof`, so a grammar may hand over its
 * own object as long as it carries the four facts — which is what lets a host
 * wrap a vocabulary in logging, caching, or a translation layer without the
 * engine needing to know.
 * @param source - a words source.
 * @returns the vocabulary, or undefined when the source is a bare list or function.
 */
export function asResolvedVocabulary<State>(
  source: WordsSource<State>,
): ResolvedVocabulary<State> | undefined {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return undefined
  const candidate = source as { resolve?: unknown }
  return typeof candidate.resolve === 'function' ? (source as ResolvedVocabulary<State>) : undefined
}

/**
 * The members any words source stands for, whichever shape it took.
 * @param source - a bare list, a vocabulary, or a function.
 * @param context - the document it is being resolved for.
 * @returns the members, or an empty list when the source resolved to nothing.
 */
export function resolveWordsSource<State>(
  source: WordsSource<State>,
  context: VocabularyContext<State>,
): readonly string[] {
  const vocabulary = asResolvedVocabulary(source)
  const raw =
    vocabulary !== undefined
      ? vocabulary.resolve(context)
      : typeof source === 'function'
        ? source(context)
        : source
  return Array.isArray(raw) ? raw.filter((word) => word !== '') : []
}
