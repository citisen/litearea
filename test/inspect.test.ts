import { describe, expect, it } from 'vitest'
import { inspect, normalizeDiagnostics } from '../src/core/inspect.js'
import { defineGrammar } from '../src/core/grammar.js'
import { defineVocabulary } from '../src/core/vocabulary.js'
import type { Diagnostic, Grammar } from '../src/core/types.js'

/** A grammar whose analysis carries the words the host's machine supplied. */
interface HostState {
  known: string[]
}

/**
 * A grammar with one scope and one check, so a failure points at the diagnostics and not
 * at a rule set.
 * @param options - the check to install, and what the analysis reports as known.
 * @returns the grammar.
 */
function checked(
  options: {
    allow?: Grammar<HostState>['checks'] extends readonly (infer C)[] | undefined
      ? C extends { allow?: infer A }
        ? A
        : never
      : never
    message?: string
    severity?: 'error' | 'warning' | 'info' | 'hint'
    except?: RegExp
    perLine?: boolean
    known?: string[]
  } = {},
): Grammar<HostState> {
  return defineGrammar<HostState>({
    id: 'checked',
    rules: [{ kind: 'match', scope: 'value', pattern: /\w+/ }],
    analyze: () => ({ known: options.known ?? ['alpha', 'beta'] }),
    checks: [
      {
        code: 'not-allowed',
        scopes: ['value'],
        allow: options.allow,
        message: options.message ?? '"{word}" is not allowed — expected {allowed}.',
        severity: options.severity,
        except: options.except,
        perLine: options.perLine,
      },
    ],
  })
}

describe('inspect', () => {
  it('returns the text it was computed from, so nothing has to guess its version', () => {
    expect(inspect('alpha', checked()).text).toBe('alpha')
  })

  it('carries the tokens, the diagnostics, the decorations, and the analysis together', () => {
    const result = inspect('alpha', checked({ allow: ['alpha', 'beta'] }))
    expect(result.tokens.length).toBeGreaterThan(0)
    expect(result.diagnostics).toEqual([])
    expect(result.decorations).toEqual([])
    expect(result.state.known).toEqual(['alpha', 'beta'])
  })
})

describe('declarative checks', () => {
  it('accepts a member of the allowed set', () => {
    expect(inspect('alpha', checked({ allow: ['alpha', 'beta'] })).diagnostics).toEqual([])
  })

  it('reports a word outside it, with the range and the code', () => {
    const diagnostics = inspect('alpha nope', checked({ allow: ['alpha', 'beta'] })).diagnostics
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.code).toBe('not-allowed')
    expect(diagnostics[0]?.from).toBe(6)
    expect(diagnostics[0]?.to).toBe(10)
    expect(diagnostics[0]?.source).toBe('checked')
  })

  it('fills the message with the word and a readable list of what was expected', () => {
    const diagnostics = inspect('nope', checked({ allow: ['alpha', 'beta'] })).diagnostics
    expect(diagnostics[0]?.message).toBe('"nope" is not allowed — expected alpha or beta.')
  })

  it('resolves a dynamic allowed set from the ANALYSIS, not from the initial state', () => {
    // The regression guard for the fix: a check whose vocabulary comes from the machine
    // must see what the grammar analysed, or the two halves of one declaration disagree.
    const grammar = checked({ allow: (context) => context.state.known })
    expect(inspect('alpha', grammar).diagnostics).toEqual([])
    const wrong = inspect('gamma', grammar).diagnostics
    expect(wrong).toHaveLength(1)
    expect(wrong[0]?.message).toContain('alpha or beta')
  })

  it('accepts a vocabulary, and honours its case rule', () => {
    const strict = defineVocabulary({ id: 'v', words: ['Alpha'], caseSensitive: true })
    expect(inspect('Alpha', checked({ allow: strict })).diagnostics).toEqual([])
    expect(inspect('alpha', checked({ allow: strict })).diagnostics).toHaveLength(1)
  })

  it('reports a token outside its scope not at all', () => {
    const grammar = defineGrammar<HostState>({
      id: 'checked',
      rules: [
        { kind: 'match', scope: 'comment', pattern: /#[^\n]*/ },
        { kind: 'match', scope: 'value', pattern: /\w+/ },
      ],
      checks: [{ code: 'never', scopes: ['value'], allow: [], message: 'no.' }],
    })
    expect(inspect('# nothing to say', grammar).diagnostics).toEqual([])
  })

  it('matches a whole-scope check against every token except whitespace', () => {
    // Whitespace is a token too. A check written against `'*'` that reported every space as
    // a misspelling would be useless, so runs of whitespace are skipped.
    const grammar = defineGrammar<HostState>({
      id: 'checked',
      rules: [{ kind: 'match', scope: 'value', pattern: /\w+/ }],
      checks: [{ code: 'never', scopes: ['*'], allow: [], message: 'no.' }],
    })
    expect(inspect('a b c', grammar).diagnostics).toHaveLength(3)
  })

  it('reports everything when it is given no allowed set', () => {
    // Not a mistake: a check with only an `except` says "nothing may be anything but this",
    // which is a real rule and the reason `allow` is optional.
    const grammar = defineGrammar<HostState>({
      id: 'checked',
      rules: [{ kind: 'match', scope: 'value', pattern: /\w+/ }],
      checks: [{ code: 'digits-only', scopes: ['value'], except: /^\d+$/, message: 'digits only.' }],
    })
    expect(inspect('42 a 7', grammar).diagnostics).toHaveLength(1)
    expect(inspect('42 a 7', grammar).diagnostics[0]?.from).toBe(3)
  })

  it('lets an exception carve a word out', () => {
    const grammar = checked({ allow: ['alpha'], except: /^\d+$/ })
    expect(inspect('alpha 42', grammar).diagnostics).toEqual([])
  })

  it('reports at most once per line when asked', () => {
    const grammar = checked({ allow: ['alpha'], perLine: true })
    expect(inspect('x y z', grammar).diagnostics).toHaveLength(1)
    expect(inspect('x y\nz w', grammar).diagnostics).toHaveLength(2)
  })

  it('carries the severity and the detail through', () => {
    const grammar = checked({ allow: ['alpha'], severity: 'warning', message: 'careful' })
    const diagnostics = inspect('nope', grammar).diagnostics
    expect(diagnostics[0]?.severity).toBe('warning')
  })

  it('runs no check when the grammar declares none', () => {
    expect(inspect('anything', { id: 'plain', rules: [] }).diagnostics).toEqual([])
  })
})

describe('validate', () => {
  it('reports with the grammar own ranges and defaults', () => {
    const grammar = defineGrammar<HostState>({
      id: 'validated',
      rules: [],
      validate: (context) => {
        context.report({ from: 0, to: 3, message: 'something is wrong' })
        context.report({ from: 4, to: 6, message: 'and this too', severity: 'hint', code: 'custom', detail: 'more' })
      },
    })
    const diagnostics = inspect('abcdef', grammar).diagnostics
    expect(diagnostics).toHaveLength(2)
    expect(diagnostics[0]?.severity).toBe('error')
    expect(diagnostics[0]?.code).toBe('validate')
    expect(diagnostics[0]?.source).toBe('validated')
    expect(diagnostics[1]?.severity).toBe('hint')
    expect(diagnostics[1]?.code).toBe('custom')
    expect(diagnostics[1]?.detail).toBe('more')
  })

  it('receives the tokens and the analysis', () => {
    const seen: string[] = []
    const grammar = defineGrammar<HostState>({
      id: 'validated',
      rules: [{ kind: 'match', scope: 'value', pattern: /\w+/ }],
      analyze: () => ({ known: ['x'] }),
      validate: (context) => {
        seen.push(context.tokens.map((token) => token.text).join(''))
        seen.push(context.state.known.join(','))
      },
    })
    inspect('ab', grammar)
    expect(seen[0]).toBe('ab')
    expect(seen[1]).toBe('x')
  })
})

describe('diagnostics from several sources', () => {
  it('puts them in order by position, keeping a lexical and a declarative complaint apart', () => {
    const grammar = defineGrammar<HostState>({
      id: 'both',
      rules: [
        { kind: 'words', words: defineVocabulary({ id: 'v', words: ['ok'], unknownMessage: 'lexical' }), unknown: {} },
      ],
      checks: [{ code: 'checked', scopes: ['invalid'], allow: [], message: 'declarative' }],
    })
    const diagnostics = inspect('aa ok bb', grammar).diagnostics
    // Two complaints per rejected word, from two different rules — which is the grammar
    // author's choice, and they stay apart because their codes and messages differ.
    expect(diagnostics.map((diagnostic) => diagnostic.from)).toEqual([0, 0, 6, 6])
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'vocabulary:v',
      'checked',
      'vocabulary:v',
      'checked',
    ])
  })

  it('drops a duplicate of the same position, code, and message', () => {
    // Two rules can legitimately notice the same mistake, and drawing the underline twice
    // makes it darker rather than more informative.
    const duplicated: Diagnostic[] = [
      { from: 0, to: 2, severity: 'error', message: 'same', code: 'x' },
      { from: 0, to: 2, severity: 'warning', message: 'same', code: 'x' },
      { from: 0, to: 2, severity: 'error', message: 'different', code: 'x' },
      { from: 0, to: 2, severity: 'error', message: 'same', code: 'y' },
    ]
    expect(normalizeDiagnostics(duplicated)).toHaveLength(3)
  })

  it('keeps two genuinely different complaints about one word', () => {
    const kept = normalizeDiagnostics([
      { from: 1, to: 3, severity: 'error', message: 'a', code: 'x' },
      { from: 1, to: 3, severity: 'error', message: 'b', code: 'x' },
    ])
    expect(kept).toHaveLength(2)
  })
})

describe('decorations', () => {
  it('are clamped into the document and dropped when they come out empty', () => {
    const grammar = defineGrammar<HostState>({
      id: 'decorated',
      rules: [],
      decorate: () => [
        { from: 2, to: 4, kind: 'inside' },
        { from: 50, to: 60, kind: 'past-the-end' },
        { from: 3, to: 3, kind: 'empty' },
        { from: 4, to: 2, kind: 'backwards' },
      ],
    })
    const decorations = inspect('abcdef', grammar).decorations
    expect(decorations.map((decoration) => decoration.kind)).toEqual(['inside'])
  })

  it('come back in order', () => {
    const grammar = defineGrammar<HostState>({
      id: 'decorated',
      rules: [],
      decorate: () => [
        { from: 4, to: 6, kind: 'second' },
        { from: 0, to: 2, kind: 'first' },
      ],
    })
    expect(inspect('abcdef', grammar).decorations.map((decoration) => decoration.kind)).toEqual([
      'first',
      'second',
    ])
  })

  it('are empty when the grammar declares none', () => {
    expect(inspect('abc', { id: 'plain', rules: [] }).decorations).toEqual([])
  })
})
