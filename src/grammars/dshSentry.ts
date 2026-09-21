// ─── dsh-sentry's style document, as a litearea grammar ─────────────────────
//
// The language is line-oriented: a line names one of the plugin's states and then
// says what that state looks like, either as bare words or as `key=value` pairs.
//
//     # comments and blank lines are ignored
//     running  circle  blue  turn   3
//     waiting  rounded amber blink  1.1
//     approval rounded amber blink  1.9
//     done     circle  green flush  1.6
//
//     running shape=none color=gray motion=still speed=1
//
// A bare word goes into the first positional slot the line has not filled, in the
// order shape, colour, pattern, motion, speed — except that the value sets are
// disjoint, so in practice the *word itself* says where it goes and the slot order
// only decides what a word that fits nothing is measured against. That is the
// plugin's own reading of the language and this grammar reproduces it.
//
// This is a REFERENCE grammar, not a built-in one. litearea ships no syntax of its
// own and nothing in `src/core/` knows this language exists; the file is here to
// prove that a fully custom rule set can express a real DSL, to be the worked
// example the documentation points at, and to be copied or imported by a host.
//
// Why the lexical layer cannot validate an option's value
// ------------------------------------------------------
// It is worth stating, because it is the first thing a grammar author tries. The
// obvious rule is "a word after `=` must be one of the shape words", and it is
// wrong: the rule can see the `=` but not the KEY, so it cannot tell `shape=blue`
// from `color=blue`. Written that way, `color=blue` earns a complaint that blue is
// not a shape. The key is structural information, so option values are validated by
// the structural pass below and only the line-leading state word is validated
// lexically, where nothing shares its position and there is nothing to confuse it
// with.
//
// Deliberately stricter than the host parser
// ------------------------------------------
// `parseStyle` in the plugin does no value checking for a known option: it writes
// `shape=bogus` into the rule and lets `resolveLook` quietly substitute the shipped
// default later. Nothing tells the user, and a typo shows up as an icon that simply
// never changed. This grammar reports it, as a warning rather than an error, since
// the document still works — it just does not mean what it says.
//
// It also does NOT accept `fallback`. The plugin's module comment shows a
// `fallback none` line, but `STYLE_STATES` holds only the four states and any other
// leading word is reported as an unknown state; `fallback` is derived internally
// from `STYLE_FALLBACK_LOOK` and has never been parseable. The comment is stale,
// and copying it here would have made the editor disagree with the parser it edits
// for.

import type {
  Grammar,
  ResolvedVocabulary,
  Scope,
  Severity,
  SuggestionItem,
} from '../core/types.js'
import { defineGrammar } from '../core/grammar.js'
import { defineVocabulary, type VocabularySpec } from '../core/vocabulary.js'
import { lineStarts } from '../core/text.js'

/** One positional slot of a state line, in the order a bare word fills them. */
export type DshSentrySlot = 'shape' | 'color' | 'pattern' | 'motion' | 'speed'

/** The four facts one state's appearance is made of. */
export interface DshSentryLook {
  shape: string
  color: string
  pattern: string
  motion: string
  speed: number
}

/** One word of the document, with the range it occupies. */
export interface DshSentryWord {
  text: string
  from: number
  to: number
}

/** A problem the structural walk found, ready to be reported. */
export interface DshSentryProblem {
  from: number
  to: number
  message: string
  code: string
  severity: Severity
}

/** One line, read. */
export interface DshSentryLine {
  /** Zero-based line number, so a completion can find the line the caret is on. */
  number: number
  /** The state the line opens, as written. */
  state: string | undefined
  /** Whether that state is one this document understands. */
  known: boolean
  /** The words on the line, comments removed. */
  words: DshSentryWord[]
  /** The value each positional slot ended up with, whatever syntax put it there. */
  slots: Partial<Record<DshSentrySlot, string>>
  /** The option keys the line named, in order, whether or not they are known. */
  keys: string[]
  /** The option key whose value the line has not written yet, as `speed=`. */
  pendingKey: string | undefined
}

/** What one pass over the document produced. */
export interface DshSentryState {
  lines: DshSentryLine[]
  /** What the structural walk found. `validate` reports these verbatim. */
  problems: DshSentryProblem[]
}

/** The vocabularies and shipped defaults a host may override. */
export interface DshSentryStyleOptions {
  /** The states a document may address, in the order the list shows them. */
  states?: readonly string[]
  /** The background shapes a rule may name. */
  shapes?: readonly string[]
  /** The motions a rule may apply. */
  motions?: readonly string[]
  /** The patterns still accepted as `pattern=<name>`. */
  patterns?: readonly string[]
  /** The named palette. Presets on purpose: a free colour can be illegible. */
  colors?: Readonly<Record<string, string>>
  /** The option keys a rule may write. */
  options?: readonly string[]
  /** The shipped look per state, used to rank and to document. */
  defaults?: Readonly<Record<string, DshSentryLook>>
}

// ─── the shipped vocabulary ─────────────────────────────────────────────────
//
// Every word below is verbatim from the plugin, including the palette, whose eight
// members exist because the two contrast failures that plugin has already shipped
// were both free colour choices. A preset cannot be illegible, so the set is closed
// and the editor must not offer anything else.

const DEFAULT_STATES = ['running', 'waiting', 'approval', 'done']
const DEFAULT_SHAPES = ['circle', 'rounded', 'square', 'none']
const DEFAULT_MOTIONS = ['still', 'turn', 'blink', 'flush']
const DEFAULT_PATTERNS: readonly string[] = []
const DEFAULT_COLORS: Readonly<Record<string, string>> = {
  blue: '#4d6bfe',
  amber: '#f59e0b',
  green: '#22c55e',
  red: '#ef4444',
  purple: '#8b5cf6',
  gray: '#8b8f97',
  dark: '#23262c',
  light: '#eef0f3',
}
const DEFAULT_OPTIONS = ['shape', 'color', 'pattern', 'motion', 'speed', 'bg']
const DEFAULT_SLOTS: readonly DshSentrySlot[] = ['shape', 'color', 'pattern', 'motion', 'speed']
const DEFAULT_LOOK: Readonly<Record<string, DshSentryLook>> = {
  running: { shape: 'circle', color: 'blue', pattern: 'none', motion: 'turn', speed: 3 },
  waiting: { shape: 'rounded', color: 'amber', pattern: 'none', motion: 'blink', speed: 1.1 },
  approval: { shape: 'rounded', color: 'amber', pattern: 'none', motion: 'blink', speed: 1.9 },
  done: { shape: 'circle', color: 'green', pattern: 'none', motion: 'flush', speed: 1.6 },
}

/** The scope each slot's values are painted under. */
const SLOT_SCOPE: Record<DshSentrySlot, Scope> = {
  shape: 'value.shape',
  color: 'value.color',
  pattern: 'value.pattern',
  motion: 'value.motion',
  speed: 'value.number',
}

/** Which positional slot an option key writes. `bg` is an alias for `color`. */
const KEY_SLOT: Record<string, DshSentrySlot | undefined> = {
  shape: 'shape',
  color: 'color',
  bg: 'color',
  pattern: 'pattern',
  motion: 'motion',
  speed: 'speed',
}

/** The nine colours, so a message can list them without resolving a vocabulary. */
const COLOR_NAMES_OF = (colors: Readonly<Record<string, string>>): string[] => Object.keys(colors)

/**
 * A vocabulary, with the one setting this grammar always wants.
 *
 * `caseSensitive` is on for every word here because the host parser compares with
 * `includes` on the literal: a suggestion list that accepted `Circle` would be
 * teaching a spelling the plugin then rejects.
 * @param spec - the declaration, minus the repeated setting.
 * @returns the resolved vocabulary.
 */
function closed<State>(spec: VocabularySpec<State>): ResolvedVocabulary<State> {
  return defineVocabulary<State>({ ...spec, caseSensitive: true })
}

/**
 * Build the grammar for dsh-sentry's style document.
 * @param options - the vocabularies and shipped defaults, defaulting to the plugin's.
 * @returns a grammar that paints, completes, diagnoses, and explains the language.
 */
export function dshSentryStyleGrammar(
  options: DshSentryStyleOptions = {},
): Grammar<DshSentryState> {
  const STATES = options.states ?? DEFAULT_STATES
  const SHAPES = options.shapes ?? DEFAULT_SHAPES
  const MOTIONS = options.motions ?? DEFAULT_MOTIONS
  const PATTERNS = options.patterns ?? DEFAULT_PATTERNS
  const COLORS = options.colors ?? DEFAULT_COLORS
  const COLOR_NAMES = COLOR_NAMES_OF(COLORS)
  const OPTIONS = options.options ?? DEFAULT_OPTIONS
  const LOOK = options.defaults ?? DEFAULT_LOOK
  const SLOTS = DEFAULT_SLOTS
  /** The patterns a bare word may name. Empty in this build, and that is the shipped truth. */
  const PATTERN_WORDS = PATTERNS.length > 0 ? PATTERNS : ['none']

  // ── vocabularies ────────────────────────────────────────────────────────
  // Declared once each so the word set, the paint, the hover text, and the
  // completion list cannot disagree. Nothing here carries `unknownMessage` except
  // the state vocabulary, because nothing else can be validated from a token: see
  // the header note about the key a lexical rule cannot see.

  const STATE_VOCAB = closed({
    id: 'state',
    words: STATES,
    scope: 'state',
    unknownMessage: 'Unknown state "{word}" — this document understands {allowed}.',
    docs: {
      running: { detail: 'a turn is in progress', body: 'The agent is working and does not need anyone.' },
      waiting: { detail: 'a question is waiting', body: 'The agent asked something, and the turn is blocked until it is answered.' },
      approval: { detail: 'a permission is waiting', body: 'The agent requested an escalation or a plan review, and the turn is blocked on it.' },
      done: { detail: 'the turn finished', body: 'The agent stopped and left the tab alone.' },
    },
  })

  const SHAPE_VOCAB = closed({
    id: 'shape',
    words: SHAPES,
    scope: SLOT_SCOPE.shape,
    docs: {
      circle: { detail: 'a full disc' },
      rounded: { detail: 'a rounded square' },
      square: { detail: 'a square with sharp corners' },
      none: {
        detail: 'no background',
        body: 'The fish alone, on whatever the tab gives it. A bare `none` is a SHAPE and never a pattern: one word cannot mean two things.',
      },
    },
  })

  const COLOR_VOCAB = closed({
    id: 'color',
    words: COLOR_NAMES,
    scope: SLOT_SCOPE.color,
    docs: Object.fromEntries(Object.entries(COLORS).map(([name, hex]) => [name, { detail: hex }])),
  })

  const MOTION_VOCAB = closed({
    id: 'motion',
    words: MOTIONS,
    scope: SLOT_SCOPE.motion,
    docs: {
      still: { detail: 'nothing moves' },
      turn: { detail: 'rotates', body: 'speed is seconds per revolution.' },
      blink: { detail: 'alternates', body: 'speed is seconds per cycle.' },
      flush: { detail: 'pulses', body: 'speed is seconds per cycle.' },
    },
  })

  const PATTERN_VOCAB = closed({
    id: 'pattern',
    words: PATTERN_WORDS,
    scope: SLOT_SCOPE.pattern,
    docs: {
      none: {
        detail: 'carve nothing',
        body: 'Every dial-like pattern was tried on a real 16px favicon and read as noise, so `none` is the only pattern left. It is written as `pattern=none` and never as a bare word, because `none` is also a shape.',
      },
    },
  })

  /** What each option key explains about itself. */
  const KEY_DOCS: Record<string, { detail: string; body: string }> = {
    shape: { detail: 'background shape', body: `One of ${SHAPES.join(', ')}.` },
    color: { detail: 'disc colour', body: `${COLOR_NAMES.join(', ')} — all presets, chosen so the fish stays legible.` },
    pattern: { detail: 'carved pattern', body: 'Only `none` remains; write it as `pattern=none`.' },
    motion: { detail: 'what moves', body: `One of ${MOTIONS.join(', ')}.` },
    speed: { detail: 'seconds per cycle', body: 'A number: seconds per revolution for `turn`, seconds per cycle otherwise.' },
    bg: { detail: 'an alias for color', body: 'Kept so a document written against an earlier release still says what it means.' },
  }

  /** Every vocabulary, by the scope its words are painted under, for hover. */
  const BY_SCOPE = new Map<Scope, ResolvedVocabulary<DshSentryState>>([
    ['state', STATE_VOCAB],
    [SLOT_SCOPE.shape, SHAPE_VOCAB],
    [SLOT_SCOPE.color, COLOR_VOCAB],
    [SLOT_SCOPE.pattern, PATTERN_VOCAB],
    [SLOT_SCOPE.motion, MOTION_VOCAB],
  ])

  /** The vocabulary that decides a value written for an option key. */
  const VOCAB_FOR_KEY: Record<string, ResolvedVocabulary<DshSentryState>> = {
    shape: SHAPE_VOCAB,
    color: COLOR_VOCAB,
    bg: COLOR_VOCAB,
    pattern: PATTERN_VOCAB,
    motion: MOTION_VOCAB,
  }

  /** The words a slot accepts, for both a message and a completion list. */
  const wordsForSlot = (slot: string): readonly string[] => {
    if (slot === 'shape') return SHAPES
    if (slot === 'color' || slot === 'bg') return COLOR_NAMES
    if (slot === 'motion') return MOTIONS
    if (slot === 'pattern') return PATTERN_WORDS
    return []
  }

  /**
   * What a slot expects, in words, for a diagnostic message.
   * @param slot - a positional slot name, or an option key such as `bg`.
   * @returns a readable list.
   */
  const expectedList = (slot: string): string => {
    if (slot === 'speed') return 'a number of seconds, such as 3 or 1.1'
    const words = wordsForSlot(slot)
    if (words.length === 0) return `pattern=<name>`
    return words.join(', ')
  }

  /**
   * Whether a value written for an option key is acceptable.
   * @param key - the option key.
   * @param value - the value as written.
   * @returns a complaint, or undefined when the value is fine.
   */
  const valueProblem = (key: string, value: string): string | undefined => {
    if (key === 'speed') {
      return Number.isFinite(Number.parseFloat(value))
        ? undefined
        : `"${value}" is not a speed — write a number of seconds, such as 3 or 1.1. The shipped rate is used instead.`
    }
    if (VOCAB_FOR_KEY[key] === undefined) return undefined
    const words = wordsForSlot(key)
    if (words.includes(value)) return undefined
    const noun = key === 'bg' ? 'preset colour' : key
    return `"${value}" is not a ${noun} — expected ${words.join(', ')}. The shipped default is used instead.`
  }

  return defineGrammar<DshSentryState>({
    id: 'dsh-sentry-style',
    name: 'dsh-sentry style document',

    // A decimal speed is one token because the number RULE says so, not because `.`
    // is a word character. Leaving `.` out of the predicate stops a stray
    // `circle.` from being read as one word, matching no shape, and earning a
    // diagnostic about a word the user never typed.
    wordChars: /[\p{L}\p{N}_]/u,

    rules: [
      { kind: 'match', scope: 'comment', pattern: /#[^\n]*/ },

      // The first word on a line is a state or it is a mistake. `unknown: {}` asks
      // for the vocabulary's own rejection, and this is the one place in the
      // language where the lexical layer can be that sure: nothing else may stand
      // at the head of a line, so there is no later rule to wait for.
      {
        kind: 'words',
        words: STATE_VOCAB,
        when: { firstOnLine: true },
        unknown: {},
      },

      // `shape=` — the key, seen from the `=` so it cannot also swallow a value.
      { kind: 'match', scope: 'property', pattern: /[A-Za-z][\w-]*(?==)/ },
      { kind: 'match', scope: 'operator', pattern: /=/ },
      { kind: 'match', scope: 'separator', pattern: /,/ },

      // Values. The sets are disjoint, so membership alone places a bare word, and
      // none of these rules rejects: a rule that did would claim a word belonging
      // to the next vocabulary down the list.
      { kind: 'words', words: SHAPE_VOCAB },
      { kind: 'words', words: COLOR_VOCAB },
      { kind: 'words', words: MOTION_VOCAB },
      { kind: 'match', scope: SLOT_SCOPE.speed, pattern: /\d+(?:\.\d+)?/ },

      // Anything left is a word this language does not know. Painting it as invalid
      // rather than as plain text makes a typo visible before the structural pass
      // has even run, and that pass supplies the precise message.
      { kind: 'match', scope: 'invalid', pattern: /\S+/ },
    ],

    fallbackScope: 'text',

    // ── what the document means ───────────────────────────────────────────
    //
    // This walk decides the slot filling AND records what went wrong, rather than
    // leaving the second job to a second walk. They are the same decision: the only
    // reason to know which slot is free is to say what a word that fits nothing
    // should have been, and splitting them would mean two implementations of one
    // rule — which is exactly how the editors this library replaces came to
    // disagree with themselves.
    analyze: (text) => {
      const starts = lineStarts(text)
      const lines: DshSentryLine[] = []
      const problems: DshSentryProblem[] = []

      for (let number = 0; number < starts.length; number += 1) {
        const from = starts[number] ?? 0
        const rawTo = starts[number + 1] ?? text.length
        let to = rawTo
        while (to > from && (text.charAt(to - 1) === '\n' || text.charAt(to - 1) === '\r')) to -= 1
        const raw = text.slice(from, to)
        // The host parser splits the comment off at the first `#` anywhere on the
        // line, so a `#` inside a value begins a comment there too.
        const comment = raw.indexOf('#')
        const body = comment === -1 ? raw : raw.slice(0, comment)

        const words: DshSentryWord[] = []
        const wordPattern = /[^\s,]+/g
        let match: RegExpExecArray | null
        while ((match = wordPattern.exec(body)) !== null) {
          words.push({
            text: match[0],
            from: from + match.index,
            to: from + match.index + match[0].length,
          })
        }

        const line: DshSentryLine = {
          number,
          state: undefined,
          known: true,
          words,
          slots: {},
          keys: [],
          pendingKey: undefined,
        }
        lines.push(line)

        const first = words[0]
        if (first === undefined) continue
        line.state = first.text
        line.known = STATES.includes(first.text)
        // An unknown state is a dead end for the parser: it discards the rest of
        // the line, so complaining about the values on it would be inventing
        // problems the document does not have.
        if (!line.known) continue

        const claim = (slot: DshSentrySlot, value: string): void => {
          line.slots[slot] = value
        }

        for (let index = 1; index < words.length; index += 1) {
          const word = words[index]
          if (word === undefined) continue
          const equals = word.text.indexOf('=')
          const key = equals === -1 ? undefined : word.text.slice(0, equals)
          const value = equals === -1 ? undefined : word.text.slice(equals + 1)

          if (key !== undefined) {
            line.keys.push(key)
            // `key` exists only because the word held an `=`, so there is always a
            // right-hand side; an empty one means the value is still being typed.
            const written = value ?? ''
            if (written === '') {
              line.pendingKey = key
              continue
            }
            const complaint = valueProblem(key, written)
            if (complaint !== undefined) {
              problems.push({
                from: word.from,
                to: word.to,
                message: complaint,
                code: 'bad-option-value',
                severity: 'warning',
              })
              continue
            }
            const slot = KEY_SLOT[key]
            if (slot !== undefined) claim(slot, written)
            continue
          }

          // A bare word is placed by what it IS. The sets are disjoint, which is
          // what lets the position be inferred without the slot order mattering.
          if (MOTIONS.includes(word.text)) {
            claim('motion', word.text)
            continue
          }
          if (SHAPES.includes(word.text)) {
            claim('shape', word.text)
            continue
          }
          if (COLOR_NAMES.includes(word.text)) {
            claim('color', word.text)
            continue
          }
          if (PATTERNS.includes(word.text)) {
            claim('pattern', word.text)
            continue
          }
          if (Number.isFinite(Number.parseFloat(word.text))) {
            claim('speed', word.text)
            continue
          }

          // It fits nothing, so the host parser measures it against the first slot
          // the line has not filled — and since every value set has been ruled out
          // above, the answer can only be "not valid for that slot" or "there is no
          // slot left".
          const free = SLOTS.find((slot) => line.slots[slot] === undefined)
          if (free === undefined) {
            problems.push({
              from: word.from,
              to: word.to,
              message: `"${word.text}" has nowhere to go — this line already names a shape, colour, pattern, motion, and speed.`,
              code: 'unexpected-value',
              severity: 'error',
            })
          } else {
            problems.push({
              from: word.from,
              to: word.to,
              message: `"${word.text}" is not a valid ${free} — expected ${expectedList(free)}.`,
              code: 'bad-value',
              severity: 'error',
            })
          }
        }
      }

      return { lines, problems }
    },

    // ── what the tokens must be ───────────────────────────────────────────
    // One declarative check, because "a key must be one it knows" is exactly the
    // shape a check is for: a scope, an allowed set, and a message.
    checks: [
      {
        code: 'unknown-option',
        scopes: ['property'],
        allow: closed({ id: 'option', words: [...OPTIONS, ...PATTERNS] }),
        severity: 'error',
        message: 'Unknown option "{word}" — this document understands {allowed}.',
      },
    ],

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

    // ── what can come next ────────────────────────────────────────────────
    compose: [
      {
        id: 'state',
        // A state opens a line, so its list belongs at the head of one — and it has to
        // stay offered while the state is being spelled, which is why this asks
        // `firstWord` rather than `firstOnLine`. Asking the stricter question makes the
        // list vanish after the first letter, which is precisely the "the completion
        // feels unnatural" complaint this grammar exists to answer.
        when: (context) => context.firstWord,
        range: (context) => context.word,
        items: () =>
          STATES.map((state) => ({
            label: state,
            insert: state,
            // A space is what the next word on the line needs. The engine will not
            // add a second one if the document already has whitespace there.
            append: ' ',
            kind: 'state',
            detail: STATE_VOCAB.entryFor(state)?.detail,
            documentation: STATE_VOCAB.entryFor(state)?.body,
            sortText: '0',
          })),
      },
      {
        id: 'value',
        when: (context) => {
          const line = context.state.lines[context.line.number]
          // Values belong to a line that has opened a state, and to the part of it
          // after the state word.
          if (line === undefined || line.state === undefined || !line.known) return false
          const stateWord = line.words[0]
          return stateWord !== undefined && context.caret > stateWord.to
        },
        range: (context) => context.word,
        items: (context) => {
          const line = context.state.lines[context.line.number]
          // Inside `key=`, the key names the slot, so the list is exactly that slot's
          // vocabulary.
          const key = optionAtCaret(context.line.before)
          if (key !== undefined && key !== '') {
            return valueItems(key, line)
          }
          const free = SLOTS.find((slot) => line?.slots[slot] === undefined)
          const items: SuggestionItem[] = free === undefined ? [] : valueItems(free, line)
          // The keys follow the values: a line names values far more often than it
          // switches to the `key=value` spelling, so the values lead.
          for (const key of OPTIONS) {
            if (line?.keys.includes(key) === true) continue
            const doc = KEY_DOCS[key]
            items.push({
              label: `${key}=`,
              insert: `${key}=`,
              kind: 'property',
              detail: doc?.detail,
              documentation: doc?.body,
              sortText: '1',
            })
          }
          return items
        },
      },
    ],

    // ── what a thing is ───────────────────────────────────────────────────
    describe: (context) => {
      const token = context.token
      if (token === undefined) return undefined
      if (token.scope === 'comment') {
        return { title: 'comment', body: 'Ignored by the parser. A `#` anywhere on a line starts one.' }
      }
      if (token.scope === 'property') {
        const doc = KEY_DOCS[token.text]
        return doc === undefined ? undefined : { title: token.text, detail: doc.detail, body: doc.body }
      }
      if (token.scope === 'operator' || token.scope === 'separator') return undefined
      if (token.scope === 'invalid') {
        return {
          title: token.text,
          detail: 'not part of this language',
          body: 'Nothing here accepts this word: it is not a state, not one of the option keys, and not a value any slot recognises.',
        }
      }
      if (token.scope === SLOT_SCOPE.speed) {
        return {
          title: token.text,
          detail: 'seconds per cycle',
          body: 'Seconds per revolution for `turn`, seconds per cycle otherwise.',
        }
      }
      const entry = BY_SCOPE.get(token.scope)?.entryFor(token.text)
      // Nothing documented means nothing to say. Falling back to the scope name would put an
      // internal identifier in front of the user — resting the pointer on a gap in the
      // document once produced a tooltip whose only content was the word `text`.
      return entry === undefined
        ? undefined
        : { title: token.text, detail: entry.detail, body: entry.body }
    },
  })

  /**
   * The completion rows for one slot or option key.
   *
   * A slot already filled by the line still gets a list, because replacing a value
   * is as common as writing the first one — but its own value leads, so accepting
   * the top row changes nothing by accident.
   * @param slot - a positional slot name, or an option key such as `bg`.
   * @param line - the line the caret is on, when there is one.
   * @returns the rows, ready to rank.
   */
  function valueItems(slot: string, line: DshSentryLine | undefined): SuggestionItem[] {
    if (slot === 'speed') {
      // A speed is a free number, so the list offers the shipped rates rather than
      // pretending to be exhaustive. The state's own rate leads.
      const current = line?.state === undefined ? undefined : LOOK[line.state]?.speed
      const rates = [...new Set([...Object.values(LOOK).map((look) => look.speed), 1, 2, 3])].sort(
        (left, right) => left - right,
      )
      return rates.map((rate) => ({
        label: String(rate),
        insert: String(rate),
        kind: 'number',
        detail: current === rate ? 'the shipped rate for this state' : 'seconds per cycle',
        sortText: current === rate ? '0' : '1',
      }))
    }
    const words = wordsForSlot(slot)
    if (words.length === 0) return []
    const scope = slot === 'bg' ? SLOT_SCOPE.color : SLOT_SCOPE[slot as DshSentrySlot]
    const vocabulary = BY_SCOPE.get(scope)
    const filled = line?.slots[KEY_SLOT[slot] ?? 'shape']
    const noun = slot === 'bg' ? 'color' : slot
    return words.map((word) => {
      const entry = vocabulary?.entryFor(word)
      return {
        label: word,
        insert: word,
        kind: 'value',
        detail: word === filled ? `the current ${noun}` : entry?.detail,
        documentation: entry?.body,
        sortText: word === filled ? '0' : '1',
      }
    })
  }
}

/**
 * The option a value is being written for, when the caret is inside one.
 *
 * Read from the text before the caret on the caret's own line. The parse reads whole
 * lines, and part-way through `shape=ci` the line is not a finished rule yet — the local
 * reading is correct in the middle of the edit, which is the only moment a completion is
 * ever asked.
 *
 * The value has to be the word the caret is IN, which is why the pattern allows no
 * whitespace between the `=` and the caret. Without that, any earlier `key=` on the line
 * would claim the list: a line that already said `pattern=none` would go on offering
 * patterns instead of moving on to the slot that is still empty.
 * @param before - the caret's line, up to the caret.
 * @returns the key, or undefined when the caret is not in a value.
 */
function optionAtCaret(before: string): string | undefined {
  const match = /([A-Za-z][\w-]*)\s*=([^\s=]*)$/.exec(before)
  return match?.[1]
}

/** The four states this grammar understands, for a host that wants to list them. */
export const DSH_SENTRY_STATES: readonly string[] = DEFAULT_STATES

/** The palette it documents, for a host that wants to draw a swatch. */
export const DSH_SENTRY_COLORS: Readonly<Record<string, string>> = DEFAULT_COLORS

/** The value sets it accepts, for a host that wants to validate a stored document. */
export const DSH_SENTRY_VOCABULARY = {
  states: DEFAULT_STATES,
  shapes: DEFAULT_SHAPES,
  motions: DEFAULT_MOTIONS,
  colors: DEFAULT_COLORS,
  options: DEFAULT_OPTIONS,
} as const
