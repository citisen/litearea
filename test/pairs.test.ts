import { describe, expect, it } from 'vitest'
import {
  planBracketEnter,
  planCommentToggle,
  planPairTyping,
  type PendingEdit,
} from '../src/core/pairs.js'
import type { AutoPair, CommentSyntax } from '../src/core/types.js'

const PAIRS: readonly AutoPair[] = [
  { open: '(', close: ')' },
  { open: '{', close: '}' },
  { open: '"', close: '"', notIn: ['string'] },
]

/** What the document looks like after an edit, so an assertion reads as the result. */
function applied(text: string, edit: PendingEdit): string {
  return text.slice(0, edit.from) + edit.text + text.slice(edit.to)
}

/** The text the selection covers after an edit. */
function selected(text: string, edit: PendingEdit): string {
  const next = applied(text, edit)
  return next.slice(edit.selection.from, edit.selection.to)
}

describe('planPairTyping', () => {
  it('closes an opening delimiter and puts the caret inside it', () => {
    const action = planPairTyping({ text: '', from: 0, to: 0, typed: '(', pairs: PAIRS })
    expect(action?.kind).toBe('insert')
    if (action?.kind !== 'insert') return
    expect(applied('', action.edit)).toBe('()')
    expect(action.edit.selection).toEqual({ from: 1, to: 1 })
  })

  it('wraps a selection and keeps it selected', () => {
    // A reader who selected text and typed a delimiter meant to surround it, and they
    // are about to do something else to it next.
    const action = planPairTyping({ text: 'alpha', from: 0, to: 5, typed: '(', pairs: PAIRS })
    if (action?.kind !== 'insert') throw new Error('expected an insert')
    expect(applied('alpha', action.edit)).toBe('(alpha)')
    expect(selected('alpha', action.edit)).toBe('alpha')
  })

  it('skips over a closing delimiter instead of doubling it', () => {
    // `()` typed by hand: after the auto-closed pair, `)` is already at the caret.
    const action = planPairTyping({ text: '()', from: 1, to: 1, typed: ')', pairs: PAIRS })
    expect(action).toEqual({ kind: 'skip', caret: 2 })
  })

  it('does not close a delimiter in front of a word', () => {
    // Typing `(` before `value` is how `(value` gets written; a closer there would land
    // in the middle of the word being typed.
    expect(planPairTyping({ text: 'value', from: 0, to: 0, typed: '(', pairs: PAIRS })).toBeUndefined()
  })

  it('does not close a delimiter the language forbids in this scope', () => {
    const quote = { text: 'a "b', from: 4, to: 4, typed: '"', pairs: PAIRS, scope: 'string' }
    expect(planPairTyping(quote)).toBeUndefined()
    const prose = { ...quote, scope: 'text' }
    expect(planPairTyping(prose)?.kind).toBe('insert')
  })

  it('leaves a delimiter with no declared pair to the browser', () => {
    expect(planPairTyping({ text: '', from: 0, to: 0, typed: 'x', pairs: PAIRS })).toBeUndefined()
    expect(planPairTyping({ text: '', from: 0, to: 0, typed: '(', pairs: [] })).toBeUndefined()
  })

  it('ignores anything that is not one character', () => {
    // A paste is not a keystroke: it is the reader saying exactly what they want, and
    // closing a pair around it would edit what they asked for.
    expect(planPairTyping({ text: '', from: 0, to: 0, typed: 'ab', pairs: PAIRS })).toBeUndefined()
    expect(planPairTyping({ text: '', from: 0, to: 0, typed: '', pairs: PAIRS })).toBeUndefined()
  })

  it('reads a selection written backwards as a selection', () => {
    const forwards = planPairTyping({ text: 'alpha', from: 0, to: 5, typed: '[', pairs: PAIRS })
    expect(forwards).toBeUndefined()
    const action = planPairTyping({ text: 'alpha', from: 5, to: 0, typed: '(', pairs: PAIRS })
    if (action?.kind !== 'insert') throw new Error('expected an insert')
    expect(applied('alpha', action.edit)).toBe('(alpha)')
  })

  it('uses the grammar’s own word characters', () => {
    // A language whose names may contain a hyphen can close a pair in front of one that
    // starts with a hyphen, where a `\w` test would refuse.
    const pairs: readonly AutoPair[] = [{ open: '(', close: ')' }]
    const withDefault = { text: '-name', from: 0, to: 0, typed: '(', pairs }
    expect(planPairTyping(withDefault)?.kind).toBe('insert')
    const withGrammar = { ...withDefault, wordChars: /[\p{L}\p{N}_-]/u }
    expect(planPairTyping(withGrammar)).toBeUndefined()
  })
})

describe('planBracketEnter', () => {
  const pairs: readonly AutoPair[] = [{ open: '{', close: '}' }]

  it('opens an indented block between an empty pair', () => {
    const edit = planBracketEnter({ text: '{}', caret: 1, pairs })
    if (edit === undefined) throw new Error('expected an edit')
    expect(applied('{}', edit)).toBe('{\n  \n}')
    expect(edit.selection).toEqual({ from: 4, to: 4 })
  })

  it('keeps the indentation of the line it is on', () => {
    const text = 'if x {\n    {}'
    const edit = planBracketEnter({ text, caret: text.length - 1, pairs })
    if (edit === undefined) throw new Error('expected an edit')
    expect(applied(text, edit)).toBe('if x {\n    {\n      \n    }')
  })

  it('steps with a tab when the line is indented with tabs', () => {
    const text = 'a\n\t{}'
    const edit = planBracketEnter({ text, caret: text.length - 1, pairs })
    if (edit === undefined) throw new Error('expected an edit')
    expect(applied(text, edit)).toBe('a\n\t{\n\t\t\n\t}')
  })

  it('takes the step from the option', () => {
    const edit = planBracketEnter({ text: '{}', caret: 1, pairs, indentSize: 4 })
    if (edit === undefined) throw new Error('expected an edit')
    expect(applied('{}', edit)).toBe('{\n    \n}')
  })

  it('leaves Enter alone anywhere else', () => {
    expect(planBracketEnter({ text: '{}', caret: 0, pairs })).toBeUndefined()
    expect(planBracketEnter({ text: '{}', caret: 2, pairs })).toBeUndefined()
    expect(planBracketEnter({ text: '{}', caret: 1, pairs: [] })).toBeUndefined()
    // Declared openers and closers that are not a pair of each other.
    expect(
      planBracketEnter({ text: '()', caret: 1, pairs: [{ open: '{', close: '}' }] }),
    ).toBeUndefined()
  })
})

describe('planCommentToggle', () => {
  const hash: CommentSyntax = { line: '#' }
  const slash: CommentSyntax = { line: '//' }
  const block: CommentSyntax = { block: ['/*', '*/'] }

  it('comments out the line the caret is on', () => {
    const edit = planCommentToggle({ text: 'note', from: 2, to: 2, syntax: hash })
    if (edit === undefined) throw new Error('expected an edit')
    expect(applied('note', edit)).toBe('# note')
  })

  it('uncomments a line that already carries the marker', () => {
    const edit = planCommentToggle({ text: '# note', from: 2, to: 2, syntax: hash })
    if (edit === undefined) throw new Error('expected an edit')
    expect(applied('# note', edit)).toBe('note')
  })

  it('adds the marker after the indentation, not before it', () => {
    const edit = planCommentToggle({ text: '    code', from: 6, to: 6, syntax: hash })
    if (edit === undefined) throw new Error('expected an edit')
    expect(applied('    code', edit)).toBe('    # code')
  })

  it('toggles a run whose every line is already commented', () => {
    const text = '# one\n# two'
    const edit = planCommentToggle({ text, from: 0, to: text.length, syntax: hash })
    if (edit === undefined) throw new Error('expected an edit')
    expect(applied(text, edit)).toBe('one\ntwo')
  })

  it('toggles twice back to where it started', () => {
    const text = '# one\n# two'
    const off = planCommentToggle({ text, from: 0, to: text.length, syntax: hash })
    if (off === undefined) throw new Error('expected an edit')
    const plain = applied(text, off)
    const on = planCommentToggle({ text: plain, from: 0, to: plain.length, syntax: hash })
    if (on === undefined) throw new Error('expected an edit')
    expect(applied(plain, on)).toBe(text)
  })

  it('leaves empty lines empty rather than giving them a marker', () => {
    const text = 'one\n\ntwo'
    const edit = planCommentToggle({ text, from: 0, to: text.length, syntax: hash })
    if (edit === undefined) throw new Error('expected an edit')
    expect(applied(text, edit)).toBe('# one\n\n# two')
  })

  it('gives the caret its column back, moved by what the marker changed', () => {
    const text = '  code'
    const edit = planCommentToggle({ text, from: 4, to: 4, syntax: hash })
    if (edit === undefined) throw new Error('expected an edit')
    // `  code` becomes `  # code`: the marker and its space are two characters, so the
    // caret moves right by two and stays on the same character of the same word.
    expect(edit.selection.from).toBe(6)
  })

  it('keeps a carriage return on the line it ends', () => {
    const text = 'one\r\ntwo'
    const edit = planCommentToggle({ text, from: 0, to: text.length, syntax: slash })
    if (edit === undefined) throw new Error('expected an edit')
    expect(applied(text, edit)).toBe('// one\r\n// two')
  })

  it('uses a block comment for a language that has no line marker', () => {
    const text = 'one\ntwo'
    const edit = planCommentToggle({ text, from: 0, to: text.length, syntax: block })
    if (edit === undefined) throw new Error('expected an edit')
    expect(applied(text, edit)).toBe('/*one\ntwo*/')
    expect(selected(text, edit)).toBe('one\ntwo')
  })

  it('unwraps a block comment that is already there', () => {
    const text = '/*one\ntwo*/'
    const edit = planCommentToggle({ text, from: 0, to: text.length, syntax: block })
    if (edit === undefined) throw new Error('expected an edit')
    expect(applied(text, edit)).toBe('one\ntwo')
  })

  it('falls back to the line marker for a span when no block pair is declared', () => {
    const text = 'one\ntwo'
    const edit = planCommentToggle({ text, from: 0, to: text.length, syntax: slash })
    if (edit === undefined) throw new Error('expected an edit')
    expect(applied(text, edit)).toBe('// one\n// two')
  })

  it('comments LINES when the language has both markers', () => {
    // The keystroke that reaches this is the one editors bind to commenting lines out,
    // so a language that has line markers gets them however many lines are selected. A
    // block pair is the answer for a language with no line marker.
    const both: CommentSyntax = { line: '//', block: ['/*', '*/'] }
    const text = 'one\ntwo'
    const edit = planCommentToggle({ text, from: 0, to: text.length, syntax: both })
    if (edit === undefined) throw new Error('expected an edit')
    expect(applied(text, edit)).toBe('// one\n// two')
  })

  it('uses the line marker on one line even when a block pair exists', () => {
    const both: CommentSyntax = { line: '//', block: ['/*', '*/'] }
    const edit = planCommentToggle({ text: 'one', from: 0, to: 3, syntax: both })
    if (edit === undefined) throw new Error('expected an edit')
    expect(applied('one', edit)).toBe('// one')
  })

  it('returns nothing for a language with no comment markers', () => {
    expect(planCommentToggle({ text: 'one', from: 0, to: 0, syntax: {} })).toBeUndefined()
  })
})
