import { describe, expect, it } from 'vitest'
import { planIndent, resolveIndentUnit, type IndentRequest } from '../src/core/indent.js'
import type { PendingEdit } from '../src/core/pairs.js'

const SPACES = '  '

/** Plan a command over a document, with `|` marking the selection. */
function plan(marked: string, unit: string, direction: 'in' | 'out', lines = false): PendingEdit | undefined {
  const from = marked.indexOf('|')
  const withoutFirst = marked.slice(0, from) + marked.slice(from + 1)
  const to = withoutFirst.indexOf('|')
  const text = to === -1 ? withoutFirst : withoutFirst.slice(0, to) + withoutFirst.slice(to + 1)
  const anchor = from
  const end = to === -1 ? from : to
  const request: IndentRequest = { text, from: anchor, to: end, unit, direction, lines }
  return planIndent(request)
}

/** The document and selection an edit produces, with `|` back in place. */
function applied(marked: string, unit: string, direction: 'in' | 'out', lines = false): string {
  const edit = plan(marked, unit, direction, lines)
  if (edit === undefined) return '(no edit)'
  const from = marked.indexOf('|')
  const withoutFirst = marked.slice(0, from) + marked.slice(from + 1)
  const to = withoutFirst.indexOf('|')
  const text = to === -1 ? withoutFirst : withoutFirst.slice(0, to) + withoutFirst.slice(to + 1)
  const next = text.slice(0, edit.from) + edit.text + text.slice(edit.to)
  const { from: a, to: b } = edit.selection
  // One marker for a caret, two for a selection, so an assertion reads the way the
  // reader would see it.
  if (a === b) return next.slice(0, a) + '|' + next.slice(a)
  return next.slice(0, a) + '|' + next.slice(a, b) + '|' + next.slice(b)
}

describe('resolveIndentUnit', () => {
  it('reads a width as that many spaces', () => {
    expect(resolveIndentUnit(4)).toBe('    ')
    expect(resolveIndentUnit(0)).toBe('')
  })

  it('takes characters as they were written', () => {
    expect(resolveIndentUnit('\t')).toBe('\t')
    expect(resolveIndentUnit('    ')).toBe('    ')
  })

  it('defaults to two spaces', () => {
    expect(resolveIndentUnit(undefined)).toBe('  ')
  })
})

describe('planIndent at a caret', () => {
  it('types one unit at the caret, wherever the caret is', () => {
    // Tab is a typing key before it is a line command: in the middle of a line the
    // reader is asking for an indent unit there.
    expect(applied('al|pha', SPACES, 'in')).toBe('al  |pha')
  })

  it('takes the caret with the unit it typed', () => {
    const edit = plan('al|pha', SPACES, 'in')
    expect(edit?.selection).toEqual({ from: 4, to: 4 })
  })

  it('removes one unit before a caret standing in the indentation', () => {
    // The caret is two characters into a four-space indent, so two is what fits before
    // it: the character it is standing on is not the one that disappears.
    expect(applied('  |    alpha', SPACES, 'out')).toBe('|    alpha')
  })

  it('outdents the line when the caret is past the content', () => {
    expect(applied('    alp|ha', SPACES, 'out')).toBe('  alp|ha')
  })

  it('stops at the start of the line rather than above it', () => {
    expect(applied('  a|', SPACES, 'out')).toBe('a|')
  })

  it('does nothing when the line is flush with the margin', () => {
    // No edit rather than an edit that changes nothing, so the key can fall through and
    // the reader is not left wondering whether the binding is broken.
    expect(plan('al|pha', SPACES, 'out')).toBeUndefined()
  })

  it('eats a tab on its own, whatever the unit is', () => {
    expect(applied('|\talpha', SPACES, 'out')).toBe('|alpha')
    expect(applied('\t|alpha', SPACES, 'out')).toBe('|alpha')
  })

  it('outdents a short indent fully under a wider unit', () => {
    // Two spaces under a four-space unit: removing four would eat the first two
    // characters of the line, and removing none would report nothing to do about a line
    // that is visibly indented.
    expect(applied('|  alpha', '    ', 'out')).toBe('|alpha')
  })

  it('steps by one space when a space-indented line meets a tab unit', () => {
    expect(applied('|  alpha', '\t', 'out')).toBe('| alpha')
  })

  it('does nothing for an empty unit', () => {
    expect(plan('al|pha', '', 'in')).toBeUndefined()
    expect(plan('  al|pha', '', 'out')).toBeUndefined()
  })
})

describe('planIndent over a block', () => {
  it('indents every line the selection touches, once', () => {
    expect(applied('|one\ntwo\nthree|', SPACES, 'in')).toBe('|  one\n  two\n  three|')
  })

  it('keeps the selection on the same lines', () => {
    // The reader selected three lines to indent them; collapsing to a caret would leave
    // them to select the same three lines again.
    const edit = plan('|one\ntwo\nthree|', SPACES, 'in')
    const next = '  one\n  two\n  three'
    expect(next.slice(edit?.selection.from, edit?.selection.to)).toBe('  one\n  two\n  three')
  })

  it('does not take a line the selection only reaches the start of', () => {
    // Selecting `one\n` and stopping at the start of `two` is one line, not two.
    expect(applied('|one\n|two\nthree', SPACES, 'in')).toBe('|  one|\ntwo\nthree')
  })

  it('indents a line the selection ends inside', () => {
    expect(applied('one\nt|wo|', SPACES, 'in')).toBe('one\n  t|wo|')
  })

  it('is one edit for the whole block, so one undo takes it back', () => {
    const edit = plan('|one\ntwo\nthree|', SPACES, 'in')
    expect(edit?.from).toBe(0)
    expect(edit?.to).toBe('one\ntwo\nthree'.length)
  })

  it('keeps the line terminators it found', () => {
    expect(applied('|one\r\ntwo|', SPACES, 'in')).toBe('|  one\r\n  two|')
  })

  it('leaves an empty line alone and still counts it', () => {
    expect(applied('|one\n\ntwo|', SPACES, 'in')).toBe('|  one\n  \n  two|')
  })

  it('outdents a block to the shallowest line, not below the margin', () => {
    // Four, two, and none: each loses what it has, up to one level, and no line moves
    // text above its own start.
    expect(applied('|    one\n  two\nthree|', SPACES, 'out')).toBe('|  one\ntwo\nthree|')
  })

  it('does nothing when no line in the block can outdent', () => {
    expect(plan('|one\ntwo|', SPACES, 'out')).toBeUndefined()
  })

  it('outdents the lines that can and leaves the rest', () => {
    expect(applied('|one\n  two|', SPACES, 'out')).toBe('|one\ntwo|')
  })

  it('moves the selection back by what was actually removed', () => {
    const edit = plan('|    one\n  two|', SPACES, 'out')
    const next = '  one\ntwo'
    expect(next.slice(edit?.selection.from, edit?.selection.to)).toBe('  one\ntwo')
  })

  it('keeps a mid-block caret inside the text it was in', () => {
    const edit = plan('|    one\ntw|o\n  three|', SPACES, 'in')
    expect(edit).toBeDefined()
    const text = '    one\ntwo\n  three'
    const next = text.slice(0, edit?.from) + edit?.text + text.slice(edit?.to)
    expect(next.slice(edit?.selection.from)).toContain('two')
  })

  it('indents the caret line for the line commands', () => {
    expect(applied('one\nt|wo\nthree', SPACES, 'in', true)).toBe('one\n  t|wo\nthree')
  })

  it('outdents the caret line for the line commands', () => {
    expect(applied('one\n  t|wo\nthree', SPACES, 'out', true)).toBe('one\nt|wo\nthree')
  })

  it('moves only the caret line, not the lines beside it', () => {
    expect(applied('one\n|two\nthree', SPACES, 'in', true)).toBe('one\n|  two\nthree')
  })

  it('handles the last line of a document with no terminator', () => {
    expect(applied('one\n|two', SPACES, 'in')).toBe('one\n  |two')
  })

  it('handles a document that is one empty line', () => {
    expect(applied('|', SPACES, 'in')).toBe('  |')
  })

  it('indents and then outdents back to where it started', () => {
    const start = '|    one\n  two\nthree|'
    const inline = plan(start, SPACES, 'in')
    expect(inline).toBeDefined()
    const indented = '      one\n    two\n  three'
    const back = planIndent({
      text: indented,
      from: inline?.selection.from ?? 0,
      to: inline?.selection.to ?? 0,
      unit: SPACES,
      direction: 'out',
    })
    expect(back).toBeDefined()
    const restored = indented.slice(0, back?.from) + (back?.text ?? '') + indented.slice(back?.to ?? 0)
    expect(restored).toBe('    one\n  two\nthree')
    expect(restored.slice(back?.selection.from, back?.selection.to)).toBe('    one\n  two\nthree')
  })
})
