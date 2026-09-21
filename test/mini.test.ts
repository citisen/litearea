// ─── mini-conf: a grammar the demo writes for itself ────────────────────────
//
// `examples/demo/grammars/mini.ts` is one of the two grammars the demo owns
// rather than the library (the other is `swatch.ts`, tested beside this file),
// and it is the one that exercises a region, positional rules, a check, commit
// characters, and per-word hover docs. Nothing in `src/` imports it, so without
// this file a change to the engine could break it and the breakage would only
// show up the next time somebody opened the demo.

import { describe, expect, it } from 'vitest'
import { complete, inspect } from '../src/index.js'
import { MINI_DEFAULT, blockState, miniConfGrammar } from '../examples/demo/grammars/mini.js'

/** The grammar, built the way the demo builds it: once, at module scope. */
const grammar = miniConfGrammar()

describe('mini-conf', () => {
  it('reads the seeded document, and reports the value that is not a boolean', () => {
    const inspection = inspect(MINI_DEFAULT, grammar)
    const state = inspection.state

    expect(state.sections.map((section) => section.name)).toEqual(['editor', 'server'])
    // Every key in the seeded document is one this reader knows, including the
    // top-level `theme` before any header.
    expect(state.properties.map((entry) => entry.key)).toEqual([
      'theme',
      'wordWrap',
      'ruler',
      'maxRows',
      'host',
      'port',
      'retries',
    ])
    expect(state.properties.find((entry) => entry.key === 'port')?.value).toBe('8080')
    expect(state.blockDepth).toBe(0)

    // `ruler = ruler` is the one line whose value is wrong: `ruler` is a boolean
    // setting and `ruler` is not a boolean. The key itself is fine.
    const codes = inspection.diagnostics.map((entry) => entry.code)
    expect(codes).toContain('bad-boolean')
    expect(codes).not.toContain('unclosed-block-comment')
    expect(codes).not.toContain('unreadable-line')
  })

  it('keeps a block comment opaque, so a section header inside it is prose', () => {
    // The header and the assignment sit strictly BETWEEN the delimiters, and the
    // closing delimiter is the last thing on its line. A grammar whose region rule
    // leaked would read both of them as code.
    const text = '/* outer\n[notASection]\nport = 8080\n*/\n'
    const inspection = inspect(text, grammar)

    expect(inspection.state.sections).toEqual([])
    expect(inspection.state.properties).toEqual([])
    expect(inspection.state.blockDepth).toBe(0)
    // No complaint about any of it, because a comment is not a mistake.
    expect(inspection.diagnostics).toEqual([])

    // The region was painted as one, delimiters included.
    expect(
      inspection.tokens.filter((token) => token.scope === 'comment.block').length,
    ).toBeGreaterThan(0)
    expect(
      inspection.tokens.filter((token) => token.scope === 'comment.block.marker').length,
    ).toBe(2)
  })

  it('mirrors the region scan, so the paint and the analysis agree on depth', () => {
    // The engine keeps a STACK of open regions, so a close delimiter ends the
    // innermost one and an inner open has to be closed before the outer comment
    // ends. `twoOpens` shows a second open inside a comment staying inside it: the
    // one close delimiter on line 3 ends only the inner level, so `x = true` is
    // still comment.
    const twoOpens = blockState(['/* one', '/* two', 'end */', 'x = true'])
    expect(twoOpens.depth).toEqual([1, 1, 1, 1])
    expect(twoOpens.unclosedAt).toBe(0)

    const balanced = blockState(['/* one', '/* two', 'two */', 'one */', 'x = true'])
    expect(balanced.depth).toEqual([1, 1, 1, 1, 0])
    expect(balanced.unclosedAt).toBe(-1)

    // An inline comment is opened and closed on one line, so nothing after it is
    // comment: the second line is code.
    const inline = blockState(['a = 1 /* inline */', 'b = 2'])
    expect(inline.depth).toEqual([1, 0])
    expect(inline.unclosedAt).toBe(-1)

    const open = blockState(['a = 1', '/* never closed', 'b = 2'])
    expect(open.depth).toEqual([0, 1, 1])
    expect(open.unclosedAt).toBe(6)
  })

  it('reports a block comment that is never closed', () => {
    const inspection = inspect('[editor]\n/* never closed\nwordWrap = no\n', grammar)
    expect(inspection.diagnostics.map((entry) => entry.code)).toContain('unclosed-block-comment')
    expect(inspection.state.blockDepth).toBe(1)
    // The header on the first line was read before the comment opened, and the
    // setting after it was not read at all.
    expect(inspection.state.sections.map((section) => section.name)).toEqual(['editor'])
    expect(inspection.state.properties).toEqual([])
  })

  it('offers the boolean words after a boolean key, and keys with a commit character', () => {
    const text = '[editor]\nwordWrap = '
    const result = complete(inspect(text, grammar), grammar, {
      text,
      caret: text.length,
      trigger: 'explicit',
    })
    expect(result?.sourceId).toBe('value')
    expect(result?.rows.map((row) => row.item.label)).toEqual(['true', 'false', 'yes', 'no'])

    const keyText = '[editor]\npo'
    const keyResult = complete(inspect(keyText, grammar), grammar, {
      text: keyText,
      caret: keyText.length,
      trigger: 'auto',
    })
    expect(keyResult?.sourceId).toBe('property')
    expect(keyResult?.rows[0]?.item.label).toBe('port')
    expect(keyResult?.rows[0]?.item.commitCharacters).toBe('=')
  })

  it('completes a section name and appends the closing bracket', () => {
    const text = '['
    const result = complete(inspect(text, grammar), grammar, { text, caret: 1, trigger: 'auto' })
    expect(result?.sourceId).toBe('section')
    expect(result?.rows[0]?.item.append).toBe(']')
  })

  it('explains a boolean from its own documentation', () => {
    const text = 'wordWrap = yes\n'
    const inspection = inspect(text, grammar)
    const from = text.indexOf('yes')
    const hover = grammar.describe?.({
      text,
      offset: from + 1,
      token: inspection.tokens.find((token) => token.text === 'yes'),
      word: { text: 'yes', from, to: from + 3, prefix: 'y', suffix: 'es' },
      line: {
        text: 'wordWrap = yes',
        from: 0,
        to: 14,
        number: 0,
        column: from + 1,
        before: 'wordWrap = y',
        after: 'es',
      },
      tokens: inspection.tokens,
      diagnostics: inspection.diagnostics,
      state: inspection.state,
    })
    expect(hover?.title).toBe('yes')
    expect(hover?.detail).toBe('on')
  })

  it('rejects a value that is not a boolean, and only where a value belongs', () => {
    const bad = inspect('wordWrap = maybe\n', grammar)
    expect(bad.diagnostics.map((entry) => entry.code)).toEqual(['bad-boolean'])
    expect(bad.diagnostics[0]?.from).toBe('wordWrap = '.length)

    // The same word as a section name is a different complaint, and as a bare
    // statement it is none at all: the rule is placed by position, not by shape.
    const asSection = inspect('[maybe]\n', grammar)
    expect(asSection.diagnostics.map((entry) => entry.code)).toEqual(['unknown-section'])
  })
})
