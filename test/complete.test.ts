import { describe, expect, it } from 'vitest'
import { applyCompletion, complete } from '../src/core/complete.js'
import { inspect } from '../src/core/inspect.js'
import { defineGrammar } from '../src/core/grammar.js'
import type { Grammar, SuggestionItem } from '../src/core/types.js'

/** The state the fixture grammar analyses out, so the completion can read structure. */
interface FixtureState {
  words: string[]
}

/**
 * A grammar built for these tests rather than borrowed from one of the reference
 * DSLs, so a failure points at the engine and not at a language.
 */
function fixture(): Grammar<FixtureState> {
  return defineGrammar<FixtureState>({
    id: 'fixture',
    rules: [
      { kind: 'match', scope: 'comment', pattern: /#[^\n]*/ },
      { kind: 'words', words: ['alpha', 'beta'], scope: 'name' },
      { kind: 'match', scope: 'operator', pattern: /=/ },
      { kind: 'match', scope: 'word', pattern: /\S+/ },
    ],
    wordChars: /[\p{L}\p{N}_]/u,
    analyze: (text) => ({ words: text.split(/\s+/).filter((word) => word !== '') }),
    compose: [
      {
        id: 'names',
        when: (context) => context.scope !== 'comment',
        range: (context) => context.word,
        items: () => [
          { label: 'alpha', kind: 'value' },
          { label: 'beta', kind: 'value' },
        ],
      },
    ],
  })
}

/** Inspect and complete in one step, which is what every assertion here needs. */
function ask(grammar: Grammar<FixtureState>, text: string, caret = text.length) {
  const inspection = inspect(text, grammar)
  return complete(inspection, grammar, { text, caret, trigger: 'auto' })
}

describe('complete', () => {
  it('offers every row the source returns when nothing has been typed', () => {
    expect(ask(fixture(), '')?.rows.map((row) => row.item.label)).toEqual(['alpha', 'beta'])
  })

  it('filters rows against the text between the range and the caret', () => {
    const completion = ask(fixture(), 'be')
    expect(completion?.needle).toBe('be')
    expect(completion?.rows.map((row) => row.item.label)).toEqual(['beta'])
  })

  it('offers only what a partial word matches', () => {
    expect(ask(fixture(), 'al')?.rows.map((row) => row.item.label)).toEqual(['alpha'])
  })

  it('reports the range it would replace', () => {
    const completion = ask(fixture(), 'x be')
    expect(completion?.range).toEqual({ from: 2, to: 4 })
  })

  it('says which source answered, so a host can tell them apart', () => {
    expect(ask(fixture(), 'al')?.sourceId).toBe('names')
  })

  it('returns nothing when no source is eligible', () => {
    const grammar = defineGrammar<FixtureState>({
      ...fixture(),
      compose: [{ id: 'never', when: () => false, range: (context) => context.word, items: () => [] }],
    })
    expect(ask(grammar, 'al')).toBeUndefined()
  })

  it('returns nothing when the eligible source has no rows', () => {
    const grammar = defineGrammar<FixtureState>({
      ...fixture(),
      compose: [
        { id: 'empty', range: (context) => context.word, items: () => [] },
      ],
    })
    expect(ask(grammar, 'al')).toBeUndefined()
  })

  it('honours the row limit', () => {
    const grammar = defineGrammar<FixtureState>({
      ...fixture(),
      compose: [
        {
          id: 'many',
          range: (context) => context.word,
          items: () => Array.from({ length: 50 }, (_, index) => ({ label: `row${String(index)}` })),
        },
      ],
    })
    const inspection = inspect('', grammar)
    const completion = complete(inspection, grammar, { text: '', caret: 0, trigger: 'explicit', limit: 5 })
    expect(completion?.rows).toHaveLength(5)
  })

  it('lets a higher priority source win', () => {
    const grammar = defineGrammar<FixtureState>({
      ...fixture(),
      compose: [
        { id: 'low', priority: 0, range: (context) => context.word, items: () => [{ label: 'low' }] },
        { id: 'high', priority: 5, range: (context) => context.word, items: () => [{ label: 'high' }] },
      ],
    })
    expect(ask(grammar, '')?.sourceId).toBe('high')
  })

  it('adds a merging source to the winner', () => {
    const grammar = defineGrammar<FixtureState>({
      ...fixture(),
      compose: [
        { id: 'main', priority: 1, range: (context) => context.word, items: () => [{ label: 'main' }] },
        { id: 'extra', priority: 0, merge: true, range: (context) => context.word, items: () => [{ label: 'extra' }] },
      ],
    })
    expect(ask(grammar, '')?.rows.map((row) => row.item.label).sort()).toEqual(['extra', 'main'])
  })

  it('keeps the source that answered while it stays eligible, but grows the range', () => {
    // The regression guard for a bug that only shows up after the SECOND character: the
    // list opened over `r`, the user typed `u`, and a range held from the first keystroke
    // replaced only the `r` — so accepting `running` produced `running u`.
    const grammar = fixture()
    const opened = ask(grammar, 'r')
    expect(opened?.range).toEqual({ from: 0, to: 1 })
    const grown = complete(inspect('ru', grammar), grammar, {
      text: 'ru',
      caret: 2,
      trigger: 'auto',
      previousSourceId: 'names',
    })
    expect(grown?.sourceId).toBe('names')
    expect(grown?.range).toEqual({ from: 0, to: 2 })
    expect(grown?.needle).toBe('ru')
  })

  it('lets the range shrink again when the user deletes', () => {
    const grammar = fixture()
    const shrunk = complete(inspect('a', grammar), grammar, {
      text: 'a',
      caret: 1,
      trigger: 'auto',
      previousSourceId: 'names',
    })
    expect(shrunk?.range).toEqual({ from: 0, to: 1 })
  })

  it('falls back to the priority order when the remembered source is gone', () => {
    const grammar = fixture()
    const completion = complete(inspect('al', grammar), grammar, {
      text: 'al',
      caret: 2,
      trigger: 'auto',
      previousSourceId: 'gone',
    })
    expect(completion?.sourceId).toBe('names')
    expect(completion?.range).toEqual({ from: 0, to: 2 })
  })

  it('tells a source whether the caret is in the first word of its line', () => {
    const seen: Array<{ firstOnLine: boolean; firstWord: boolean }> = []
    const grammar = defineGrammar<FixtureState>({
      ...fixture(),
      compose: [
        {
          id: 'probe',
          range: (context) => context.word,
          items: (context) => {
            seen.push({ firstOnLine: context.firstOnLine, firstWord: context.firstWord })
            return [{ label: 'x' }]
          },
        },
      ],
    })
    ask(grammar, 'runn')
    ask(grammar, 'alpha beta')
    ask(grammar, 'alpha\nbe')
    // Typing a head word keeps `firstWord` true while `firstOnLine` has already gone
    // false — the distinction a line-oriented grammar needs to stay offered mid-word.
    expect(seen[0]).toEqual({ firstOnLine: false, firstWord: true })
    expect(seen[1]).toEqual({ firstOnLine: false, firstWord: false })
    expect(seen[2]).toEqual({ firstOnLine: false, firstWord: true })
  })

  it('reads the structure the grammar analysed, not a second parse', () => {
    const grammar = defineGrammar<FixtureState>({
      ...fixture(),
      compose: [
        {
          id: 'structure',
          range: (context) => context.word,
          items: (context) => context.state.words.map((word) => ({ label: word })),
        },
      ],
    })
    // Caret at the start, so the needle is empty and nothing is filtered away.
    expect(ask(grammar, 'one two three', 0)?.rows).toHaveLength(3)
  })
})

describe('applyCompletion', () => {
  const item = (over: Partial<SuggestionItem> = {}): SuggestionItem => ({ label: 'alpha', ...over })

  it('replaces the range and puts the caret after what was written', () => {
    const applied = applyCompletion('al, beta', { from: 0, to: 2 }, item())
    expect(applied.text).toBe('alpha, beta')
    expect(applied.caret).toBe(5)
    expect(applied.insert).toBe('alpha')
    expect(applied.from).toBe(0)
    expect(applied.to).toBe(2)
    expect(applied.range).toEqual({ from: 0, to: 5 })
  })

  it('writes the insert text when it differs from the label', () => {
    const applied = applyCompletion('al', { from: 0, to: 2 }, item({ insert: 'quote(alpha)' }))
    expect(applied.text).toBe('quote(alpha)')
    expect(applied.caret).toBe(12)
  })

  it('appends what the row asked for', () => {
    const applied = applyCompletion('al', { from: 0, to: 2 }, item({ append: ', ' }))
    expect(applied.text).toBe('alpha, ')
    expect(applied.caret).toBe(7)
  })

  it('does not append text the document already has there', () => {
    // Accepting `alpha` immediately before an existing comma must not add another.
    const applied = applyCompletion('al, beta', { from: 0, to: 2 }, item({ append: ', ' }))
    expect(applied.text).toBe('alpha, beta')
  })

  it('does not add a space that is already there', () => {
    const applied = applyCompletion('al beta', { from: 0, to: 2 }, item({ append: ' ' }))
    expect(applied.text).toBe('alpha beta')
  })

  it('writes in front of the range and keeps it, for the `before` mode', () => {
    const applied = applyCompletion('Inter, mono', { from: 0, to: 5 }, item({ label: 'Geist', mode: 'before', append: ', ' }))
    expect(applied.text).toBe('Geist, Inter, mono')
    expect(applied.from).toBe(0)
    expect(applied.to).toBe(0)
    expect(applied.insert).toBe('Geist, ')
    expect(applied.caret).toBe(7)
  })

  it('does not invent a separator in the `before` mode, because that is the row\'s to give', () => {
    // The engine restores the whitespace that belonged to the comma before the entry,
    // and nothing else. Whether a separator belongs between the inserted entry and the
    // one after it is a fact about the language, so it comes from the row's `append` —
    // a completer that inserted one by default would be guessing about every language.
    const withoutAppend = applyCompletion('Inter, mono', { from: 7, to: 11 }, item({ label: 'Geist', mode: 'before' }))
    expect(withoutAppend.text).toBe('Inter, Geistmono')

    const withAppend = applyCompletion(
      'Inter, mono',
      { from: 7, to: 11 },
      item({ label: 'Geist', mode: 'before', append: ', ' }),
    )
    expect(withAppend.text).toBe('Inter, Geist, mono')
  })

  it('moves the caret back when the row asks for it', () => {
    const applied = applyCompletion('f', { from: 0, to: 1 }, item({ insert: 'f()', caretOffset: -1 }))
    expect(applied.text).toBe('f()')
    expect(applied.caret).toBe(2)
  })

  it('clamps a range that runs past the document', () => {
    const applied = applyCompletion('ab', { from: 0, to: 99 }, item())
    expect(applied.text).toBe('alpha')
  })

  it('accepts a backwards range by ordering it', () => {
    const applied = applyCompletion('ab', { from: 2, to: 0 }, item())
    expect(applied.text).toBe('alpha')
  })

  it('produces a text that matches what the caller would compute from the pieces', () => {
    // The editor writes only `[from, to)` with `insert`, so the two descriptions of the
    // same edit must agree — which is what lets the write go through the undo stack.
    const source = 'Geist Mono medium, Inter'
    const applied = applyCompletion(source, { from: 19, to: 24 }, item({ label: 'IBM Plex Mono' }))
    const rebuilt = source.slice(0, applied.from) + applied.insert + source.slice(applied.to)
    expect(rebuilt).toBe(applied.text)
    expect(applied.caret).toBe(applied.from + applied.insert.length)
  })
})
