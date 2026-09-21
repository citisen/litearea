// --- swatch: a palette language, written for this demo -----------------------
//
// The demo's second grammar, and the thing the mini-conf grammar does not show:
// a vocabulary that comes from the HOST rather than from the file. The palette
// is an option, so the same document means something else on another machine —
// which is exactly why the entry "in effect" is a decoration here and not a
// token. A token is what the characters are and does not change when the
// host's data does; a decoration is recomputed and can.
//
//     red circle 20        ; in this palette, so no complaint
//     mauve circle 20      ; not in this palette: one squiggle
//     teal blob 40         ; not a shape: another
//
// Nothing here is built in. The library ships no syntax; this file is a grammar
// written for the demo, and the real DSLs live beside the plugins that own them.

import type { Diagnostic, HoverInfo, Scope } from '@citisen/litearea'
import { defineGrammar, defineVocabulary } from '@citisen/litearea'

/** A palette colour, located, so a decoration or a squiggle can mark it alone. */
export interface SwatchColor {
  name: string
  from: number
  to: number
}

/** One paint line: a colour, a shape, and a size, all located. */
export interface SwatchEntry {
  color: SwatchColor
  shape: string
  size: number
  /** Zero-based line number. */
  line: number
}

/**
 * What one pass over a swatch document produced.
 *
 * A grammar author writes this by hand; the contract only asks that every hook
 * agrees about it.
 */
export interface SwatchState {
  entries: SwatchEntry[]
  problems: Diagnostic[]
}

/** What a host has to tell the grammar, because the palette is the host's. */
export interface SwatchOptions {
  /** The colours this host knows, in the order it wants them offered. */
  palette: readonly string[]
  /**
   * The colour this host paints first, if any.
   *
   * It is a NAME and not an index, because a palette is the host's own list and
   * an index would tie the file to the order of a list the file cannot see.
   */
  base?: string
}

/** The shapes this language knows. */
export const SWATCH_SHAPES: readonly string[] = ['circle', 'square', 'rounded', 'bar']

/** The default document, which is also what the panel resets to. */
export const SWATCH_DEFAULT = [
  '# swatch -- a host palette, the shapes this language knows, and a size',
  'red circle 20',
  'teal square 40',
  'amber rounded 12',
  'mauve bar 8',
  '',
].join('\n')

/** A line's words, located, with any comment removed. */
function wordsOf(raw: string, lineFrom: number): SwatchColor[] {
  const hash = raw.indexOf('#')
  const body = hash === -1 ? raw : raw.slice(0, hash)
  const words: SwatchColor[] = []
  const pattern = /[A-Za-z][A-Za-z0-9-]*|\d+/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(body)) !== null) {
    const from = lineFrom + match.index
    words.push({ name: match[0], from, to: from + match[0].length })
  }
  return words
}

/**
 * Build the swatch grammar over one host palette.
 *
 * @param options - the colours the host knows, and which of them is the base.
 * @returns a grammar that paints, diagnoses, completes, and explains swatches.
 */
export function swatchGrammar(options: SwatchOptions) {
  // The set lives OUTSIDE the document: this is the form the library calls once
  // per scan, and it is why the grammar needs no mutable state of its own. The
  // same document read against another host's palette is another document.
  const COLORS = defineVocabulary<SwatchState>({
    id: 'swatch-color',
    words: () => options.palette,
    scope: 'swatch.color',
    unknownMessage: '"{word}" is not in this host palette — expected {allowed}.',
    unknownCode: 'unknown-color',
  })

  const SHAPES = defineVocabulary<SwatchState>({
    id: 'swatch-shape',
    words: SWATCH_SHAPES,
    scope: 'swatch.shape',
    unknownMessage: '"{word}" is not a shape — expected {allowed}.',
    unknownCode: 'unknown-shape',
    docs: {
      circle: { detail: 'a disc', body: 'The roundest shape this language has.' },
      square: { detail: 'four corners', body: 'Sharp corners, straight edges.' },
      rounded: { detail: 'a rounded box', body: 'A square whose corners were taken off.' },
      bar: { detail: 'a full-width stripe', body: 'Used as a rule rather than as a mark.' },
    },
  })

  return defineGrammar<SwatchState>({
    id: 'swatch',
    name: 'swatch',

    // A hyphen belongs to a colour name here (`off-white`), so a completion must
    // replace the whole name rather than half of it.
    wordChars: /[A-Za-z0-9-]/,

    rules: [
      { kind: 'match', scope: 'comment', pattern: /#[^\n]*/ },
      // Numbers first: a digit is a word character, so a vocabulary rule placed
      // above this one would claim the size and complain about it.
      { kind: 'match', scope: 'number', pattern: /\d+/ },
      // A colour opens a line, and one the palette does not know is reported
      // rather than quietly painted as an ordinary word.
      { kind: 'words', words: COLORS, when: { firstOnLine: true }, unknown: {} },
      // Anything else word-shaped on the line is a shape, or a mistake.
      { kind: 'words', words: SHAPES, unknown: {} },
    ],

    fallbackScope: 'text',

    // -- what the document means -------------------------------------------
    //
    // One pass, and every later hook reads its result. Whether a line is a
    // swatch at all is decided here once, so the paint, the diagnostics, the
    // decoration, and the completion cannot disagree about it.
    analyze: (text) => {
      const entries: SwatchEntry[] = []
      const problems: Diagnostic[] = []
      const seen = new Set<string>()
      const lines = text.split('\n')
      let offset = 0

      for (let number = 0; number < lines.length; number += 1) {
        const raw = lines[number] ?? ''
        const lineFrom = offset
        offset += raw.length + 1
        const words = wordsOf(raw, lineFrom)
        if (words.length === 0) continue

        const [color, shape, size] = words
        if (color === undefined || shape === undefined || size === undefined) {
          problems.push({
            from: lineFrom,
            to: lineFrom + raw.length,
            severity: 'warning',
            code: 'incomplete-swatch',
            message: 'A swatch is a colour, a shape, and a size.',
            source: 'swatch',
          })
          continue
        }

        const value = Number(size.name)
        entries.push({ color, shape: shape.name, size: value, line: number })
        if (seen.has(color.name)) {
          problems.push({
            from: color.from,
            to: color.to,
            severity: 'warning',
            code: 'repeated-color',
            message: `"${color.name}" is painted twice; the second coat wins.`,
            source: 'swatch',
          })
        }
        seen.add(color.name)

        // The key itself is the vocabulary's business; this is the numeric half,
        // which a word set cannot express.
        if (value <= 0) {
          problems.push({
            from: size.from,
            to: size.to,
            severity: 'info',
            code: 'empty-swatch',
            message: 'A swatch with no size paints nothing.',
            source: 'swatch',
          })
        }
      }

      return { entries, problems }
    },

    validate: (context) => {
      for (const problem of context.state.problems) {
        context.report({
          from: problem.from,
          to: problem.to,
          message: problem.message,
          severity: problem.severity,
          code: problem.code,
        })
      }
    },

    // -- what a thing is ---------------------------------------------------
    describe: (context) => {
      const token = context.token
      if (token === undefined) return undefined
      const entry =
        token.scope === 'swatch.color'
          ? COLORS.entryFor(token.text)
          : SHAPES.entryFor(token.text)
      const info: HoverInfo = { title: token.text, detail: token.scope }
      if (entry?.detail !== undefined) info.detail = entry.detail
      if (entry?.body !== undefined) info.body = entry.body
      return info
    },

    // -- what can come next ------------------------------------------------
    compose: [
      {
        id: 'color',
        // `firstWord` and not `firstOnLine`: the list has to stay eligible while
        // the colour is being spelled, and by then the line has content.
        when: (context) => context.firstWord,
        range: (context) => context.word,
        items: (context) => {
          const used = new Set(context.state.entries.map((entry) => entry.color.name))
          return options.palette.map((color) => ({
            label: color,
            append: ' ',
            kind: 'color',
            detail: used.has(color) ? 'already in this file' : 'from the host palette',
            // A colour the file has not used yet is offered first, which is what
            // a sort key is for — its label does not start with a zero.
            sortText: used.has(color) ? '1' : '0',
          }))
        },
      },
      {
        id: 'shape',
        // A shape follows a colour. Both conditions are about the LINE rather
        // than about the word: `firstWord` is false once the caret has left the
        // colour, and a line that already has a shape token does not want a
        // second one — what follows a shape is a size, which has no list.
        //
        // The higher priority is what makes this source take over from the colour
        // source: both are eligible while the line is one word, and the colour
        // list would otherwise keep answering because it is declared first.
        priority: 1,
        when: (context) => {
          if (context.firstWord || context.line.before.trim() === '') return false
          const line = context.line.number
          return !context.tokens.some(
            (token) =>
              token.line === line &&
              token.scope === 'swatch.shape' &&
              token.to <= context.caret,
          )
        },
        range: (context) => context.word,
        items: () =>
          SWATCH_SHAPES.map((shape) => ({
            label: shape,
            append: ' ',
            kind: 'shape',
            detail: SHAPES.entryFor(shape)?.detail,
            documentation: SHAPES.entryFor(shape)?.body,
          })),
      },
    ],

    // -- what is semantically true, rather than what the characters are ----
    decorate: (_text, state) => {
      // Which swatch is the base coat depends on the HOST's palette and not on a
      // character in the file, so it is a decoration: recomputing one range list
      // is cheaper than re-lexing the document when the palette changes.
      if (options.base === undefined) return []
      const entry = state.entries.find((candidate) => candidate.color.name === options.base)
      if (entry === undefined) return []
      return [
        {
          from: entry.color.from,
          to: entry.color.to,
          kind: 'base-coat',
          title: `base coat: ${entry.color.name}`,
        },
      ]
    },
  })
}

/** A scope name, re-exported so a host styling this grammar can write it once. */
export type SwatchScope = Scope
