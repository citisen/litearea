import { describe, expect, it } from 'vitest'
import { buildSegments, segmentClasses } from '../src/core/segments.js'
import type { Decoration, Diagnostic, Token } from '../src/core/types.js'

/** A token whose text is filled in, since most assertions read it back. */
function token(source: string, from: number, to: number, scope: string): Token {
  return { from, to, scope, text: source.slice(from, to), line: 0, column: from }
}

const scopeClass = (scope: string): string => `s-${scope}`
const decorationClass = (kind: string): string => `d-${kind}`
const severityClass = (severity: string): string => `x-${severity}`

describe('buildSegments', () => {
  const source = 'alpha beta'

  it('returns nothing for an empty document', () => {
    expect(buildSegments('', { tokens: [], decorations: [], diagnostics: [] })).toEqual([])
  })

  it('covers the document exactly, in order', () => {
    const tokens = [token(source, 0, 5, 'name'), token(source, 5, 6, 'space'), token(source, 6, 10, 'name')]
    const segments = buildSegments(source, { tokens, decorations: [], diagnostics: [] })
    expect(segments.map((segment) => segment.text).join('')).toBe(source)
    let cursor = 0
    for (const segment of segments) {
      expect(segment.from).toBe(cursor)
      cursor = segment.to
    }
    expect(cursor).toBe(source.length)
  })

  it('paints a character no token covers with the fallback scope', () => {
    const segments = buildSegments(source, { tokens: [], decorations: [], diagnostics: [] }, 'plain')
    expect(segments).toEqual([
      { from: 0, to: 10, text: source, scope: 'plain', decorations: [], severity: undefined, title: undefined },
    ])
  })

  it('merges adjacent segments that present identically', () => {
    const tokens = [token(source, 0, 2, 'name'), token(source, 2, 10, 'name')]
    expect(buildSegments(source, { tokens, decorations: [], diagnostics: [] })).toHaveLength(1)
  })

  it('does not merge across a change of scope', () => {
    const tokens = [token(source, 0, 5, 'name'), token(source, 5, 10, 'other')]
    expect(buildSegments(source, { tokens, decorations: [], diagnostics: [] })).toHaveLength(2)
  })

  it('splits a token where a diagnostic starts inside it', () => {
    const tokens = [token(source, 0, 10, 'name')]
    const diagnostics: Diagnostic[] = [{ from: 6, to: 10, severity: 'error', message: 'no' }]
    const segments = buildSegments(source, { tokens, decorations: [], diagnostics })
    expect(segments.map((segment) => [segment.text, segment.severity])).toEqual([
      ['alpha ', undefined],
      ['beta', 'error'],
    ])
  })

  it('shows the loudest severity when several cover one run', () => {
    const tokens = [token(source, 0, 10, 'name')]
    const diagnostics: Diagnostic[] = [
      { from: 0, to: 10, severity: 'hint', message: 'a' },
      { from: 2, to: 8, severity: 'error', message: 'b' },
      { from: 0, to: 10, severity: 'warning', message: 'c' },
    ]
    const segments = buildSegments(source, { tokens, decorations: [], diagnostics })
    // The inner error narrows the run; the surrounding hint and warning lose to it.
    const covered = segments.filter((segment) => segment.severity === 'error')
    expect(covered.map((segment) => segment.text)).toEqual(['pha be'])
  })

  it('collects every decoration kind covering a run, in declaration order', () => {
    const tokens = [token(source, 0, 10, 'name')]
    const decorations: Decoration[] = [
      { from: 0, to: 10, kind: 'outer' },
      { from: 0, to: 5, kind: 'inner' },
    ]
    const segments = buildSegments(source, { tokens, decorations, diagnostics: [] })
    expect(segments[0]?.decorations).toEqual(['outer', 'inner'])
    expect(segments[1]?.decorations).toEqual(['outer'])
  })

  it('carries a decoration title through to the segment', () => {
    const decorations: Decoration[] = [{ from: 0, to: 5, kind: 'effective', title: 'in effect: Alpha' }]
    const segments = buildSegments(source, { tokens: [token(source, 0, 10, 'name')], decorations, diagnostics: [] })
    expect(segments[0]?.title).toBe('in effect: Alpha')
  })

  it('clamps a range that runs past the document', () => {
    const segments = buildSegments(source, {
      tokens: [token(source, 0, 999, 'name')],
      decorations: [],
      diagnostics: [],
    })
    expect(segments.map((segment) => segment.to)).toEqual([10])
  })

  it('ignores a range entirely outside the document', () => {
    const segments = buildSegments(source, {
      tokens: [],
      decorations: [],
      diagnostics: [{ from: 50, to: 60, severity: 'error', message: 'gone' }],
      }, 'plain')
    expect(segments).toHaveLength(1)
    expect(segments[0]?.severity).toBeUndefined()
  })
})

describe('segmentClasses', () => {
  it('lists the scope first, then the marks, then the severity', () => {
    const segment = {
      from: 0,
      to: 1,
      text: 'a',
      scope: 'value.shape',
      decorations: ['effective'],
      severity: 'error' as const,
      title: undefined,
    }
    expect(segmentClasses(segment, scopeClass, decorationClass, severityClass)).toEqual([
      's-value.shape',
      'd-effective',
      'x-error',
    ])
  })

  it('omits the severity class when there is no diagnostic', () => {
    const segment = {
      from: 0,
      to: 1,
      text: 'a',
      scope: 'text',
      decorations: [],
      severity: undefined,
      title: undefined,
    }
    expect(segmentClasses(segment, scopeClass, decorationClass, severityClass)).toEqual(['s-text'])
  })
})
