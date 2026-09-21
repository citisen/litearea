import { describe, expect, it } from 'vitest'
import { fuzzyMatch, highlightSegments, isWordStart, rank } from '../src/core/rank.js'

/** The tier a match reached, for assertions about precedence rather than about numbers. */
function tier(needle: string, label: string): number | undefined {
  return fuzzyMatch(needle, label)?.tier
}

describe('isWordStart', () => {
  it('counts the beginning of the text', () => {
    expect(isWordStart('Fira', 0)).toBe(true)
  })

  it('counts the character after a separator', () => {
    expect(isWordStart('Fira Mono', 5)).toBe(true)
    expect(isWordStart('IBM-Plex', 4)).toBe(true)
    expect(isWordStart('a_b', 2)).toBe(true)
  })

  it('counts a lower-to-upper transition, which is what makes camel humps searchable', () => {
    expect(isWordStart('notoSans', 4)).toBe(true)
    expect(isWordStart('notoSans', 1)).toBe(false)
  })

  it('does not count the middle of a word', () => {
    expect(isWordStart('Fira', 2)).toBe(false)
  })
})

describe('fuzzyMatch', () => {
  it('scores an empty needle without matching anything', () => {
    const match = fuzzyMatch('', 'anything')
    expect(match?.score).toBe(0)
    expect(match?.indices).toEqual([])
  })

  it('returns nothing when the needle is not in the label at all', () => {
    expect(fuzzyMatch('zzz', 'Inter')).toBeUndefined()
  })

  it('ranks an exact match above an exact match in another case', () => {
    expect(tier('Inter', 'Inter')).toBeGreaterThan(tier('inter', 'Inter') ?? -1)
  })

  it('ranks a prefix above a match found later', () => {
    expect(tier('inte', 'Inter Tight')).toBeGreaterThan(tier('tight', 'Inter Tight') ?? -1)
  })

  it('ranks initials above a scattered subsequence', () => {
    expect(tier('IPM', 'IBM Plex Mono')).toBeGreaterThan(tier('ibx', 'IBM Plex Mono') ?? -1)
  })

  it('finds initials that no substring contains', () => {
    const match = fuzzyMatch('IPM', 'IBM Plex Mono')
    expect(match?.indices).toEqual([0, 4, 9])
  })

  it('finds humps across a camel-case name', () => {
    const match = fuzzyMatch('ns', 'notoSans')
    expect(match?.indices).toEqual([0, 4])
  })

  it('finds a scattered subsequence and reports where it landed', () => {
    const match = fuzzyMatch('jbmo', 'JetBrains Mono')
    expect(match?.indices).toEqual([0, 3, 10, 11])
  })

  it('matches case-sensitively when the needle has an uppercase letter', () => {
    // The same "smart case" a terminal has used for decades: `Inter` is not `inter`.
    expect(fuzzyMatch('Inter', 'inter tight')).toBeUndefined()
    expect(fuzzyMatch('inter', 'inter tight')).toBeDefined()
  })

  it('prefers a shorter label when two match equally well', () => {
    const short = fuzzyMatch('inter', 'Inter')
    const long = fuzzyMatch('inter', 'Inter Tight')
    expect((short?.score ?? 0) > (long?.score ?? 0)).toBe(true)
  })

  it('prefers the match that starts earlier', () => {
    const early = fuzzyMatch('mo', 'Mono Thing')
    const late = fuzzyMatch('mo', 'Thing Mono')
    expect((early?.score ?? 0) > (late?.score ?? 0)).toBe(true)
  })
})

describe('rank', () => {
  const families = ['Inter Tight', 'Inter', 'IBM Plex Mono', 'Fira Mono', 'JetBrains Mono']
  const options = { label: (name: string) => name }

  it('keeps the declared order when there is no needle', () => {
    // This is what Ctrl+Space shows: the whole vocabulary, in the order the grammar
    // thought about it, and an alphabetical tie-break would silently rearrange it.
    expect(rank(families, '', options).map((entry) => entry.item)).toEqual(families)
  })

  it('puts an exact match first', () => {
    expect(rank(families, 'inter', options)[0]?.item).toBe('Inter')
  })

  it('puts a prefix match before a later one', () => {
    // All three match at a word start, so the tie is broken by where the match starts:
    // the earliest one wins, which is the only rule that keeps the order stable and
    // explainable when several names are equally good answers.
    const ordered = rank(families, 'mono', options).map((entry) => entry.item)
    expect(ordered).toEqual(['Fira Mono', 'IBM Plex Mono', 'JetBrains Mono'])
  })

  it('drops rows the needle does not match', () => {
    expect(rank(families, 'zzz', options)).toEqual([])
  })

  it('reports the matched offsets for emphasis', () => {
    const first = rank(families, 'inter', options)[0]
    expect(first?.indices).toEqual([0, 1, 2, 3, 4])
  })

  it('matches on filterText while emphasising nothing, rather than the wrong thing', () => {
    const items = [{ label: 'shown', filterText: 'hidden' }]
    const matched = rank(items, 'hidden', {
      label: (item) => item.label,
      filterText: (item) => item.filterText,
    })
    expect(matched).toHaveLength(1)
    expect(matched[0]?.indices).toEqual([])
  })

  it('orders by sortText first, so a grammar can group rows without faking labels', () => {
    const items = [
      { label: 'medium', sortText: '1' },
      { label: 'thin', sortText: '0' },
    ]
    expect(rank(items, '', { label: (item) => item.label, sortText: (item) => item.sortText }).map((entry) => entry.item.label)).toEqual([
      'thin',
      'medium',
    ])
  })

  it('still ranks by score within one sortText group', () => {
    const items = [
      { label: 'Black', sortText: '0' },
      { label: 'Blue', sortText: '0' },
    ]
    const ordered = rank(items, 'bl', {
      label: (item) => item.label,
      sortText: (item) => item.sortText,
    }).map((entry) => entry.item.label)
    // Both are prefix matches, so the shorter label wins — the group decided that the
    // two belong together, and the score decided the order inside it.
    expect(ordered).toEqual(['Blue', 'Black'])
  })
})

describe('highlightSegments', () => {
  it('splits a label into plain and matched runs', () => {
    expect(highlightSegments('Fira Mono', [0, 5])).toEqual([
      { text: 'F', matched: true },
      { text: 'ira ', matched: false },
      { text: 'M', matched: true },
      { text: 'ono', matched: false },
    ])
  })

  it('returns the whole label when nothing matched', () => {
    expect(highlightSegments('Fira', [])).toEqual([{ text: 'Fira', matched: false }])
  })

  it('returns nothing for an empty label', () => {
    expect(highlightSegments('', [])).toEqual([])
  })

  it('survives an out-of-range index', () => {
    expect(highlightSegments('ab', [9])).toEqual([{ text: 'ab', matched: false }])
  })
})
