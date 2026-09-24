// ─── swatch: a palette language with a vocabulary the host owns ─────────────
//
// The front page's language, and the site's smallest complete one. The palette is an OPTION
// rather than a constant, so the same document means something else on another machine — which
// is exactly why the colour a host paints first is a decoration here and not a token. A token
// is what the characters are and does not change when the host's data does; a decoration is
// recomputed and can.
//
//     red circle 20        ; in this palette, so no complaint
//     mauve circle 20      ; not in this palette: one squiggle
//     teal blob 40         ; not a shape: another
//
// Nothing here is built in. The library ships no syntax, and this file is the whole of the
// language the front page reads.

import type { Diagnostic, HoverInfo, Scope } from '@citisen/litearea'
import { defineGrammar, defineVocabulary } from '@citisen/litearea'

/** The shapes this language knows. */
export const SWATCH_SHAPES = ['circle', 'square', 'rounded', 'bar'] as const

/** One located word of a line, with any comment already removed. */
export interface Word {
  text: string
  from: number
  to: number
}

/** One paint line: a colour, a shape, and a size. */
export interface SwatchEntry {
  color: string
  shape: string
  size: number
  from: number
  line: number
}

/** What one pass over the document produced. */
export interface SwatchState {
  entries: SwatchEntry[]
  problems: Diagnostic[]
}

/** What a host has to tell the language, because the palette is the host's. */
export interface SwatchOptions {
  /** The colours this host knows, in the order it wants them offered. */
  palette: readonly string[]
  /** The colour this host paints first, if any. Named rather than indexed: the file cannot
   *  see the host's list, so a position in it would mean nothing to the file. */
  base?: string
}

/** A line's words, located, with any comment removed. */
function wordsOf(raw: string, lineFrom: number): Word[] {
  const hash = raw.indexOf('#')
  const body = hash === -1 ? raw : raw.slice(0, hash)
  const words: Word[] = []
  const pattern = /[A-Za-z][A-Za-z0-9-]*|\d+/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(body)) !== null) {
    const from = lineFrom + match.index
    words.push({ text: match[0], from, to: from + match[0].length })
  }
  return words
}

/**
 * Build the language over one host palette.
 *
 * @param options - the colours the host knows, and which of them it paints first.
 * @returns a grammar that paints, diagnoses, completes, explains, and marks a swatch line.
 */
export function swatchGrammar(options: SwatchOptions) {
  // The word set lives OUTSIDE the document, which is the form the library calls once per scan
  // and the reason the grammar needs no mutable state of its own.
  const COLORS = defineVocabulary<SwatchState>({
    id: 'swatch-color',
    words: () => options.palette,
    scope: 'swatch.color',
    unknownMessage: '"{word}" is not in this palette — expected {allowed}.',
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

    // A hyphen belongs to a colour name here (`off-white`), so a completion has to replace the
    // whole name rather than half of it.
    wordChars: /[A-Za-z0-9-]/,

    rules: [
      { kind: 'match', scope: 'comment', pattern: /#[^\n]*/ },
      // A digit is a word character, so this rule has to come before the vocabularies or the
      // size would be claimed by one of them and complained about.
      { kind: 'match', scope: 'number', pattern: /\d+/ },
      { kind: 'words', words: COLORS, when: { firstOnLine: true }, unknown: {} },
      { kind: 'words', words: SHAPES, unknown: {} },
    ],

    fallbackScope: 'text',

    // ── what the document means ─────────────────────────────────────────────
    //
    // One pass, and every later hook reads its result. Whether a line is a swatch at all is
    // decided here once, so the paint, the diagnostics, and the decoration cannot disagree.
    analyze: (text) => {
      const entries: SwatchEntry[] = []
      const problems: Diagnostic[] = []
      const seen = new Set<string>()
      const rows = text.split('\n')
      let offset = 0

      for (let index = 0; index < rows.length; index += 1) {
        const raw = rows[index] ?? ''
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

        entries.push({ color: color.text, shape: shape.text, size: Number(size.text), from: color.from, line: index })
        if (seen.has(color.text)) {
          problems.push({
            from: color.from,
            to: color.to,
            severity: 'warning',
            code: 'repeated-color',
            message: `"${color.text}" is painted twice; the second coat wins.`,
            source: 'swatch',
          })
        }
        seen.add(color.text)

        // The colour names are the vocabulary's business. The number is this half's, because a
        // word set cannot say anything about a value.
        if (Number(size.text) <= 0) {
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

    // ── what a thing is ─────────────────────────────────────────────────────
    describe: (context) => {
      const token = context.token
      if (token === undefined) return undefined
      const entry = token.scope === 'swatch.color' ? COLORS.entryFor(token.text) : SHAPES.entryFor(token.text)
      const info: HoverInfo = { title: token.text, detail: token.scope }
      if (entry?.detail !== undefined) info.detail = entry.detail
      if (entry?.body !== undefined) info.body = entry.body
      return info
    },

    // ── what can come next ──────────────────────────────────────────────────
    compose: [
      {
        id: 'color',
        // `firstWord` and not `firstOnLine`: the list has to stay eligible while the colour is
        // being spelled, and by then the line has content.
        when: (context) => context.firstWord,
        range: (context) => context.word,
        items: (context) => {
          const used = new Set(context.state.entries.map((entry) => entry.color))
          return options.palette.map((color) => ({
            label: color,
            append: ' ',
            kind: 'color',
            detail: used.has(color) ? 'already in this file' : 'from the host palette',
            // A colour the file has not used yet is offered first. That is what a sort key is
            // for: the label does not have to start with a zero to be ranked above another.
            sortText: used.has(color) ? '1' : '0',
          }))
        },
      },
      {
        id: 'shape',
        // A shape follows a colour. The higher priority is what lets this source take over from
        // the colour source: both are eligible while the line is one word, and the colour list
        // would otherwise keep answering because it is declared first.
        priority: 1,
        when: (context) => {
          if (context.firstWord || context.line.before.trim() === '') return false
          const line = context.line.number
          return !context.tokens.some(
            (token) => token.line === line && token.scope === 'swatch.shape' && token.to <= context.caret,
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

    // ── what is semantically true, rather than what the characters are ──────
    decorate: (_text, state) => {
      if (options.base === undefined) return []
      const entry = state.entries.find((candidate) => candidate.color === options.base)
      if (entry === undefined) return []
      return [
        {
          from: entry.from,
          to: entry.from + entry.color.length,
          kind: 'base-coat',
          title: `base coat: ${entry.color}`,
        },
      ]
    },
  })
}

/** A scope name, re-exported so a host styling this language writes it once. */
export type SwatchScope = Scope
