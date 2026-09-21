// ─── swatch: the second grammar the demo writes for itself ──────────────────
//
// `examples/demo/grammars/swatch.ts` is a grammar the demo owns rather than the
// library, and it is the one here that exercises a vocabulary supplied by the
// HOST: the colour set is an option, so the same document reads differently
// against another palette. It also covers two vocabularies rejecting in place, a
// completion that leads by `sortText`, and a decoration computed from the
// analysis. Nothing in `src/` imports it, so without this file a change to the
// engine could break it and the breakage would only show up the next time
// somebody opened the demo.

import { describe, expect, it } from 'vitest'
import { complete, inspect } from '../src/index.js'
import { SWATCH_DEFAULT, swatchGrammar } from '../examples/demo/grammars/swatch.js'

/** The grammar, built the way the demo builds it: once, at module scope. */
const grammar = swatchGrammar({ palette: ['red', 'teal', 'amber'], base: 'teal' })

describe('swatch', () => {
  it('reads the seeded document and reports the colour the palette does not have', () => {
    const inspection = inspect(SWATCH_DEFAULT, grammar)

    expect(inspection.state.entries.map((entry) => entry.color.name)).toEqual([
      'red',
      'teal',
      'amber',
      'mauve',
    ])
    // The seeded document names `mauve`, which this palette does not have. The
    // shapes and the sizes are all fine, so that is the only complaint.
    expect(inspection.diagnostics.map((entry) => entry.code)).toEqual(['unknown-color'])
    expect(inspection.diagnostics[0]?.from).toBe(SWATCH_DEFAULT.indexOf('mauve'))
  })

  it('rejects a shape it does not know, and only where a shape belongs', () => {
    const bad = inspect('red blob 20\n', grammar)
    expect(bad.diagnostics.map((entry) => entry.code)).toEqual(['unknown-shape'])

    // The size is a number and the colour is a member, so neither is a shape at
    // all: the shape rule is placed by position, not by the shape of the word.
    const fine = inspect('red circle 20\n', grammar)
    expect(fine.diagnostics).toEqual([])
  })

  it('reports a swatch that paints nothing', () => {
    const empty = inspect('red circle 0\n', grammar)
    expect(empty.diagnostics.map((entry) => entry.code)).toEqual(['empty-swatch'])
    // The line was still read: a zero size is a mistake, not a parse failure.
    expect(empty.state.entries).toHaveLength(1)
  })

  it('offers the colours the file has not used yet, and appends a space', () => {
    const text = 'red circle 20\n'
    const result = complete(inspect(text, grammar), grammar, {
      text,
      caret: text.length,
      trigger: 'explicit',
    })

    expect(result?.sourceId).toBe('color')
    // `red` is already used, so its sortText puts it last; teal and amber are
    // unused and keep their palette order.
    expect(result?.rows.map((row) => row.item.label)).toEqual(['teal', 'amber', 'red'])
    expect(result?.rows[0]?.item.append).toBe(' ')
  })

  it('moves from the colour list to the shape list, and stops once the row is full', () => {
    // Inside the first word the colours are offered...
    const colour = complete(inspect('r', grammar), grammar, {
      text: 'r',
      caret: 1,
      trigger: 'auto',
    })
    expect(colour?.sourceId).toBe('color')

    // ...and after a colour and a space, the shapes take over.
    const shape = complete(inspect('red ', grammar), grammar, {
      text: 'red ',
      caret: 4,
      trigger: 'auto',
    })
    expect(shape?.sourceId).toBe('shape')
    expect(shape?.rows.map((row) => row.item.label)).toContain('circle')

    // A shape being spelled keeps the shape list.
    const spelling = complete(inspect('red c', grammar), grammar, {
      text: 'red c',
      caret: 5,
      trigger: 'auto',
    })
    expect(spelling?.sourceId).toBe('shape')

    // A complete row wants a size, and there is no list for one.
    const full = complete(inspect('red circle ', grammar), grammar, {
      text: 'red circle ',
      caret: 11,
      trigger: 'explicit',
    })
    expect(full).toBeUndefined()
  })

  it('marks the palette base coat as a decoration rather than a token', () => {
    const inspection = inspect(SWATCH_DEFAULT, grammar)
    const decorations = grammar.decorate?.(SWATCH_DEFAULT, inspection.state) ?? []

    expect(decorations.map((decoration) => decoration.kind)).toEqual(['base-coat'])
    expect(decorations[0]?.title).toBe('base coat: teal')
    expect(decorations[0]?.from).toBe(SWATCH_DEFAULT.indexOf('teal'))
    // Which colour is the base is the palette's fact, so no token carries it.
    expect(inspection.tokens.some((token) => token.scope === 'base-coat')).toBe(false)
  })

  it('explains a shape from its own documentation', () => {
    const text = 'red circle 20\n'
    const inspection = inspect(text, grammar)
    const from = text.indexOf('circle')
    const hover = grammar.describe?.({
      text,
      offset: from + 1,
      token: inspection.tokens.find((token) => token.text === 'circle'),
      word: { text: 'circle', from, to: from + 6, prefix: 'c', suffix: 'ircle' },
      line: {
        text: 'red circle 20',
        from: 0,
        to: 13,
        number: 0,
        column: from + 1,
        before: 'red c',
        after: 'ircle 20',
      },
      tokens: inspection.tokens,
      diagnostics: inspection.diagnostics,
      state: inspection.state,
    })
    expect(hover?.title).toBe('circle')
    expect(hover?.detail).toBe('a disc')
  })
})
