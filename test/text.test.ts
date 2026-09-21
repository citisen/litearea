import { describe, expect, it } from 'vitest'
import {
  clamp,
  containsOffset,
  isOffset,
  isWordChar,
  lineAt,
  lineIndexAt,
  lineStarts,
  scopeAt,
  tokenAfter,
  tokenAt,
  tokenBefore,
  tokensOnLine,
  wordInfoAt,
} from '../src/core/text.js'
import type { Token } from '../src/core/types.js'

const WORD = /[\p{L}\p{N}_]/u

const token = (from: number, to: number, scope: string, line = 0, column = from): Token => ({
  from,
  to,
  scope,
  text: '',
  line,
  column,
})

describe('clamp', () => {
  it('keeps a value inside its bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(11, 0, 10)).toBe(10)
  })
})

describe('isOffset', () => {
  it('accepts only finite, non-negative integers', () => {
    expect(isOffset(0)).toBe(true)
    expect(isOffset(7)).toBe(true)
    expect(isOffset(-1)).toBe(false)
    expect(isOffset(1.5)).toBe(false)
    expect(isOffset(Number.NaN)).toBe(false)
    expect(isOffset('3')).toBe(false)
    expect(isOffset(undefined)).toBe(false)
  })
})

describe('lineStarts', () => {
  it('gives one offset per line, starting at zero', () => {
    expect(lineStarts('a\nbb\nccc')).toEqual([0, 2, 5])
  })

  it('handles a document with no newline', () => {
    expect(lineStarts('abc')).toEqual([0])
  })

  it('counts a CRLF pair as one terminator', () => {
    expect(lineStarts('a\r\nb')).toEqual([0, 3])
  })

  it('counts a lone CR as a terminator', () => {
    expect(lineStarts('a\rb')).toEqual([0, 2])
  })

  it('adds a line for a trailing newline, because there is an empty one', () => {
    expect(lineStarts('a\n')).toEqual([0, 2])
  })
})

describe('lineIndexAt', () => {
  const starts = lineStarts('a\nbb\nccc')

  it('finds the line an offset falls on', () => {
    expect(lineIndexAt(starts, 0)).toBe(0)
    expect(lineIndexAt(starts, 1)).toBe(0)
    expect(lineIndexAt(starts, 2)).toBe(1)
    expect(lineIndexAt(starts, 4)).toBe(1)
    expect(lineIndexAt(starts, 5)).toBe(2)
    expect(lineIndexAt(starts, 8)).toBe(2)
  })
})

describe('lineAt', () => {
  const source = 'first\r\nsecond\nthird'

  it('reports the line text without its terminator', () => {
    const line = lineAt(source, 0)
    expect(line.text).toBe('first')
    expect(line.number).toBe(0)
    expect(line.from).toBe(0)
    expect(line.to).toBe(5)
  })

  it('computes the column for the position asked about', () => {
    // The bug this guards: caching a line record by line number alone hands every
    // position on the line the first one's column, and every rule guarded by
    // `firstOnLine` then matches the whole line.
    const seven = lineAt(source, 7)
    const nine = lineAt(source, 9)
    expect(seven.number).toBe(1)
    expect(seven.column).toBe(0)
    expect(nine.number).toBe(1)
    expect(nine.column).toBe(2)
    expect(nine.before).toBe('se')
    expect(nine.after).toBe('cond')
  })

  it('handles the last line and the end of the document', () => {
    const line = lineAt(source, source.length)
    expect(line.text).toBe('third')
    expect(line.column).toBe(5)
  })

  it('clamps an offset past the end', () => {
    const line = lineAt(source, 999)
    expect(line.number).toBe(2)
    expect(line.column).toBe(5)
  })
})

describe('isWordChar', () => {
  it('counts a letter or a digit and nothing else, for a conservative predicate', () => {
    expect(isWordChar('a', WORD)).toBe(true)
    expect(isWordChar('7', WORD)).toBe(true)
    expect(isWordChar('_', WORD)).toBe(true)
    expect(isWordChar('-', WORD)).toBe(false)
    expect(isWordChar('.', WORD)).toBe(false)
    expect(isWordChar('', WORD)).toBe(false)
  })
})

describe('wordInfoAt', () => {
  it('expands both ways from the caret', () => {
    const word = wordInfoAt('Geist Mono', 3, WORD)
    expect(word.text).toBe('Geist')
    expect(word.from).toBe(0)
    expect(word.to).toBe(5)
    expect(word.prefix).toBe('Gei')
    expect(word.suffix).toBe('st')
  })

  it('finds the word when the caret sits at its end, which is where completion asks', () => {
    const word = wordInfoAt('Geist ', 5, WORD)
    expect(word.text).toBe('Geist')
    expect(word.prefix).toBe('Geist')
    expect(word.suffix).toBe('')
  })

  it('reports an empty word in whitespace', () => {
    const word = wordInfoAt('a  b', 2, WORD)
    expect(word.text).toBe('')
    expect(word.prefix).toBe('')
  })

  it('splits a name on a character the predicate rejects', () => {
    const word = wordInfoAt('system-ui', 8, WORD)
    expect(word.text).toBe('ui')
  })
})

describe('token lookups', () => {
  const tokens: Token[] = [
    { ...token(0, 5, 'state'), text: 'state' },
    { ...token(5, 6, 'text'), text: ' ' },
    { ...token(6, 8, 'text'), text: '  ' },
    { ...token(8, 14, 'value'), text: 'circle' },
  ]

  it('finds the token covering an offset, whitespace included', () => {
    expect(tokenAt(tokens, 0)?.scope).toBe('state')
    expect(tokenAt(tokens, 4)?.scope).toBe('state')
    // Whitespace is painted too, so it is a token like any other: `scopeAt` answers
    // for a space rather than pretending the document has a hole in it.
    expect(tokenAt(tokens, 5)?.scope).toBe('text')
    expect(tokenAt(tokens, 8)?.scope).toBe('value')
  })

  it('reports nothing past the end of the token stream', () => {
    expect(tokenAt(tokens, 14)).toBeUndefined()
    expect(scopeAt(tokens, 99)).toBeUndefined()
  })

  it('answers for a position inside a token', () => {
    expect(scopeAt(tokens, 9)).toBe('value')
  })

  it('skips whitespace when looking for the nearest neighbour', () => {
    expect(tokenBefore(tokens, 8)?.scope).toBe('state')
    expect(tokenBefore(tokens, 0)).toBeUndefined()
    expect(tokenAfter(tokens, 6)?.scope).toBe('value')
    expect(tokenAfter(tokens, 14)).toBeUndefined()
  })

  it('lists the non-whitespace tokens on a line', () => {
    const across = [
      { ...token(0, 5, 'state', 0, 0), text: 'state' },
      { ...token(5, 6, 'text', 0, 5), text: ' ' },
      { ...token(6, 12, 'value', 0, 6), text: 'circle' },
      { ...token(13, 17, 'state', 1, 0), text: 'next' },
    ]
    expect(tokensOnLine(across, 0).map((entry) => entry.scope)).toEqual(['state', 'value'])
    expect(tokensOnLine(across, 1).map((entry) => entry.scope)).toEqual(['state'])
  })
})

describe('containsOffset', () => {
  it('treats the end of a range as outside it', () => {
    expect(containsOffset({ from: 2, to: 5 }, 2)).toBe(true)
    expect(containsOffset({ from: 2, to: 5 }, 4)).toBe(true)
    expect(containsOffset({ from: 2, to: 5 }, 5)).toBe(false)
    expect(containsOffset({ from: 2, to: 5 }, 1)).toBe(false)
  })
})
