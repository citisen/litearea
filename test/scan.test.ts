import { describe, expect, it } from 'vitest'
import { defineVocabulary } from '../src/core/vocabulary.js'
import { isResolvedGrammar, resolveGrammar, scan } from '../src/core/scan.js'
import type { Diagnostic, Grammar, Rule, Token } from '../src/core/types.js'

/** A grammar with one state field, for the scope-function and vocabulary tests. */
interface TestState {
  known: string[]
}

/**
 * Scan and keep only the tokens that carry text.
 *
 * Whitespace is painted too, and almost every assertion here is about the words, so
 * filtering once is clearer than filtering in each expectation.
 * @param source - the document.
 * @param grammar - the grammar.
 * @returns the tokens that are not whitespace, and the diagnostics.
 */
function scanText<State>(
  source: string,
  grammar: Grammar<State>,
): { tokens: Token[]; diagnostics: Diagnostic[] } {
  const result = scan(source, grammar)
  return {
    tokens: result.tokens.filter((token) => token.text.trim() !== ''),
    diagnostics: result.diagnostics,
  }
}

/** The `scope:text` pairs of a scan, which is what a highlighter test is about. */
function painted(tokens: readonly Token[]): string[] {
  return tokens.map((token) => `${token.scope}:${token.text}`)
}

describe('rule precedence', () => {
  it('takes the first rule that matches', () => {
    const grammar: Grammar = {
      id: 'test',
      rules: [
        { kind: 'match', scope: 'first', pattern: /\w+/ },
        { kind: 'match', scope: 'second', pattern: /\w+/ },
      ],
    }
    expect(painted(scanText('abc', grammar).tokens)).toEqual(['first:abc'])
  })

  it('gives a later rule its turn when an earlier one declines', () => {
    const grammar: Grammar = {
      id: 'test',
      rules: [
        { kind: 'match', scope: 'keyword', pattern: /running/ },
        { kind: 'match', scope: 'word', pattern: /\w+/ },
      ],
    }
    expect(painted(scanText('walking', grammar).tokens)).toEqual(['word:walking'])
  })

  it('treats a rule that can match the empty string as if it did not match', () => {
    // A pattern that CAN be empty, at a position where it IS empty, must be skipped
    // rather than matched. Otherwise the scan never advances and the page freezes,
    // which is what an infinite loop in a highlighter looks like.
    const grammar: Grammar = {
      id: 'test',
      rules: [
        { kind: 'match', scope: 'empty', pattern: /\w*/ },
        { kind: 'match', scope: 'word', pattern: /\S+/ },
      ],
    }
    expect(painted(scanText('!', grammar).tokens)).toEqual(['word:!'])
    // Where it does match something, it legitimately wins.
    expect(painted(scanText('abc', grammar).tokens)).toEqual(['empty:abc'])
  })

  it('falls back to the declared scope for a character nothing claims', () => {
    const grammar: Grammar = {
      id: 'test',
      rules: [{ kind: 'match', scope: 'word', pattern: /\w+/ }],
      fallbackScope: 'plain',
    }
    const tokens = scan('$$', grammar).tokens
    expect(tokens.map((token) => token.scope)).toEqual(['plain'])
  })
})

describe('context predicates', () => {
  const lineGrammar: Grammar = {
    id: 'test',
    rules: [
      { kind: 'words', words: ['running', 'waiting'], scope: 'state', when: { firstOnLine: true } },
      { kind: 'words', words: ['circle', 'blue'], scope: 'value' },
      { kind: 'match', scope: 'word', pattern: /\S+/ },
    ],
  }

  it('restricts a rule to the first word of a line and no further', () => {
    // `firstOnLine` must be a question about the position, not about the line. The bug
    // it guards against paints every word on the line as a state.
    const { tokens } = scanText('running circle blue', lineGrammar)
    expect(painted(tokens)).toEqual(['state:running', 'value:circle', 'value:blue'])
  })

  it('applies the same restriction on a later line', () => {
    const { tokens } = scanText('running circle\nwaiting blue', lineGrammar)
    expect(painted(tokens)).toEqual([
      'state:running',
      'value:circle',
      'state:waiting',
      'value:blue',
    ])
  })

  it('accepts an indented first word', () => {
    const { tokens } = scanText('   running', lineGrammar)
    expect(painted(tokens)).toEqual(['state:running'])
  })

  it('reads the previous token with `after`', () => {
    const grammar: Grammar = {
      id: 'test',
      rules: [
        { kind: 'match', scope: 'operator', pattern: /=/ },
        { kind: 'words', words: ['blue'], scope: 'value', when: { after: ['operator'] } },
        { kind: 'words', words: ['blue'], scope: 'name' },
      ],
    }
    // `x` is claimed by nothing, so it is painted with the fallback scope — and the
    // `blue` after the `=` is a value precisely because the `=` came first.
    expect(painted(scanText('x=blue', grammar).tokens)).toEqual([
      'text:x',
      'operator:=',
      'value:blue',
    ])
  })

  it('reads the previous token with `notAfter`', () => {
    const grammar: Grammar = {
      id: 'test',
      rules: [
        { kind: 'match', scope: 'operator', pattern: /=/ },
        { kind: 'words', words: ['blue'], scope: 'name', when: { notAfter: ['operator'] } },
        { kind: 'words', words: ['blue'], scope: 'value' },
      ],
    }
    expect(painted(scanText('=blue', grammar).tokens)).toEqual(['operator:=', 'value:blue'])
  })

  it('tests the whole line with `line`', () => {
    const grammar: Grammar = {
      id: 'test',
      rules: [
        { kind: 'match', scope: 'number', pattern: /\d+/, when: { line: /speed/ } },
        { kind: 'match', scope: 'plain', pattern: /\d+/ },
      ],
    }
    // The word `speed` itself is claimed by neither rule, so it is taken as one run of
    // unclaimed characters — the trailing space included, because a run stops only at
    // a newline or at something a rule claims.
    expect(painted(scanText('speed 3', grammar).tokens)).toEqual(['text:speed ', 'number:3'])
    expect(painted(scanText('other 3', grammar).tokens)).toEqual(['text:other ', 'plain:3'])
  })

  it('bounds a rule by column', () => {
    const grammar: Grammar = {
      id: 'test',
      rules: [
        { kind: 'match', scope: 'head', pattern: /\w+/, when: { maxColumn: 2 } },
        { kind: 'match', scope: 'rest', pattern: /\w+/ },
      ],
    }
    expect(painted(scanText('ab cdef', grammar).tokens)).toEqual(['head:ab', 'rest:cdef'])
  })

  it('stops a rule from matching the tail of a longer word with `prevNot`', () => {
    const grammar: Grammar = {
      id: 'test',
      rules: [
        { kind: 'match', scope: 'weight', pattern: /medium/, when: { prevNot: '\\w' } },
        { kind: 'match', scope: 'word', pattern: /\w+/ },
      ],
    }
    expect(painted(scanText('medium', grammar).tokens)).toEqual(['weight:medium'])
    expect(painted(scanText('xmedium', grammar).tokens)).toEqual(['word:xmedium'])
  })
})

describe('vocabularies', () => {
  it('matches a member and paints it with the vocabulary scope', () => {
    const shapes = defineVocabulary({ id: 'shape', words: ['circle', 'square'], scope: 'value.shape' })
    const grammar: Grammar = { id: 'test', rules: [{ kind: 'words', words: shapes }] }
    expect(painted(scanText('circle', grammar).tokens)).toEqual(['value.shape:circle'])
  })

  it('matches a member regardless of case, and paints the text as typed', () => {
    const shapes = defineVocabulary({ id: 'shape', words: ['Circle'] })
    const grammar: Grammar = { id: 'test', rules: [{ kind: 'words', words: shapes }] }
    // The token carries the document's characters; the declared spelling reaches the
    // insert text and the documentation, not the paint.
    expect(painted(scanText('CIRCLE', grammar).tokens)).toEqual(['vocabulary:shape:CIRCLE'])
    expect(shapes.has('circlE', { text: '', state: undefined })).toBe(true)
  })

  it('honours case sensitivity when a vocabulary asks for it', () => {
    const shapes = defineVocabulary({ id: 'shape', words: ['Circle'], caseSensitive: true })
    const grammar: Grammar = {
      id: 'test',
      rules: [
        { kind: 'words', words: shapes },
        { kind: 'match', scope: 'invalid', pattern: /\S+/ },
      ],
    }
    expect(painted(scanText('circle', grammar).tokens)).toEqual(['invalid:circle'])
    expect(painted(scanText('Circle', grammar).tokens)).toEqual(['vocabulary:shape:Circle'])
  })

  it('declines a non-member when the rule has no `unknown` clause', () => {
    const shapes = defineVocabulary({ id: 'shape', words: ['circle'] })
    const grammar: Grammar = {
      id: 'test',
      rules: [
        { kind: 'words', words: shapes },
        { kind: 'match', scope: 'invalid', pattern: /\S+/ },
      ],
    }
    expect(painted(scanText('nope', grammar).tokens)).toEqual(['invalid:nope'])
  })

  it('claims a non-member and reports it when the rule asks for the vocabulary rejection', () => {
    const shapes = defineVocabulary({
      id: 'shape',
      words: ['circle', 'square'],
      scope: 'value.shape',
      unknownMessage: '"{word}" is not a shape — expected {allowed}.',
    })
    const grammar: Grammar = {
      id: 'test',
      rules: [{ kind: 'words', words: shapes, unknown: {} }],
    }
    const { tokens, diagnostics } = scanText('nope', grammar)
    expect(painted(tokens)).toEqual(['invalid:nope'])
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.code).toBe('vocabulary:shape')
    expect(diagnostics[0]?.message).toBe('"nope" is not a shape — expected circle or square.')
  })

  it('reports the range of the whole word it rejected', () => {
    const shapes = defineVocabulary({ id: 'shape', words: ['circle'], unknownMessage: 'no' })
    const grammar: Grammar = { id: 'test', rules: [{ kind: 'words', words: shapes, unknown: {} }] }
    const { diagnostics } = scanText('circle nope', grammar)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.from).toBe(7)
    expect(diagnostics[0]?.to).toBe(11)
  })

  it('reads the words from a function, so a set outside the document can reach the rules', () => {
    const grammar: Grammar = {
      id: 'test',
      rules: [
        {
          kind: 'words',
          scope: 'installed',
          words: (context) => (context.state as { known: string[] }).known,
        },
      ],
      analyze: () => ({ known: ['Inter'] }),
    }
    expect(painted(scanText('Inter', grammar).tokens)).toEqual(['installed:Inter'])
    // A word the set does not have is claimed by nothing, so it is painted with the
    // fallback scope rather than being reported: this rule declared no `unknown`.
    expect(painted(scanText('Nope', grammar).tokens)).toEqual(['text:Nope'])
  })

  it('matches the longest phrase, so a catalogue holding both names resolves the longer one', () => {
    const families = defineVocabulary({ id: 'family', words: ['IBM Plex', 'IBM Plex Mono'] })
    const grammar: Grammar = {
      id: 'test',
      rules: [{ kind: 'words', words: families, scope: 'family', phrase: { max: 4 } }],
    }
    expect(painted(scanText('IBM Plex Mono', grammar).tokens)).toEqual(['family:IBM Plex Mono'])
  })

  it('accepts a separator that is more than one space', () => {
    const families = defineVocabulary({ id: 'family', words: ['Noto Sans SC'] })
    const grammar: Grammar = {
      id: 'test',
      rules: [{ kind: 'words', words: families, phrase: { max: 4 } }],
    }
    expect(painted(scanText('Noto  Sans   SC', grammar).tokens)).toEqual([
      'vocabulary:family:Noto  Sans   SC',
    ])
  })

  it('refuses to let a phrase span a line', () => {
    const families = defineVocabulary({ id: 'family', words: ['Noto Sans'] })
    const grammar: Grammar = {
      id: 'test',
      rules: [{ kind: 'words', words: families, phrase: { max: 4 } }],
    }
    expect(scanText('Noto\nSans', grammar).tokens).toHaveLength(2)
  })

  it('really caps a phrase at max, which means not reaching it by the literal route', () => {
    // A multi-word member contains a space, and a space is not a word character, so it also
    // sits in the literal fallback list. Taking that route would match a three-word member
    // whatever `max` said — a cap that applies on one of two routes to the same member is
    // not a cap.
    const families = defineVocabulary({ id: 'family', words: ['one two three'] })
    const capped: Grammar = {
      id: 'test',
      rules: [{ kind: 'words', words: families, scope: 'family', phrase: { max: 2 } }],
    }
    // Claimed by nothing, so it is painted with the fallback scope rather than matching.
    expect(painted(scanText('one two three', capped).tokens)).toEqual(['text:one two three'])

    const allowed: Grammar = { ...capped, rules: [{ kind: 'words', words: families, scope: 'family', phrase: { max: 3 } }] }
    expect(painted(scanText('one two three', allowed).tokens)).toEqual(['family:one two three'])
  })

  it('matches a member the word predicate cannot read, as written', () => {
    const families = defineVocabulary({ id: 'family', words: ['-apple-system'] })
    const grammar: Grammar = {
      id: 'test',
      rules: [{ kind: 'words', words: families, scope: 'family' }],
      wordChars: /[\p{L}\p{N}_]/u,
    }
    expect(painted(scanText('-apple-system', grammar).tokens)).toEqual(['family:-apple-system'])
  })
})

describe('scope functions', () => {
  it('names a match from what was matched', () => {
    const grammar: Grammar = {
      id: 'test',
      rules: [
        {
          kind: 'match',
          pattern: /"[^"]*"/,
          scope: (match) => (match.text.includes('sans') ? 'generic' : 'family'),
        },
      ],
    }
    expect(painted(scanText('"sans-serif"', grammar).tokens)).toEqual(['generic:"sans-serif"'])
    expect(painted(scanText('"Geist"', grammar).tokens)).toEqual(['family:"Geist"'])
  })

  it('reads the analysis, which is how a semantic judgement avoids a second highlighter', () => {
    interface FaceState {
      hasFace: boolean
    }
    const grammar: Grammar<FaceState> = {
      id: 'test',
      rules: [
        {
          kind: 'match',
          pattern: /medium/,
          scope: (match) => (match.state.hasFace ? 'weight' : 'weight.missing'),
        },
      ],
      analyze: () => ({ hasFace: true }),
    }
    expect(painted(scanText('medium', grammar).tokens)).toEqual(['weight:medium'])
    expect(
      painted(scanText('medium', { ...grammar, analyze: () => ({ hasFace: false }) }).tokens),
    ).toEqual(['weight.missing:medium'])
  })
})

describe('regions', () => {
  it('keeps a non-nested region opaque to the rules around it', () => {
    const grammar: Grammar = {
      id: 'test',
      rules: [
        { kind: 'region', begin: /"/, end: /"/, contentScope: 'string', scope: 'string' },
        { kind: 'match', scope: 'keyword', pattern: /running/ },
        { kind: 'match', scope: 'word', pattern: /\S+/ },
      ],
    }
    // `running` inside the quotes is text, not a keyword. The assertion is about
    // opacity rather than about where the token boundaries land, because whether the
    // delimiters merge with the content depends on the region bookkeeping and is not
    // what a reader of this grammar would notice.
    const tokens = scanText('"running"', grammar).tokens
    expect(tokens.some((token) => token.scope === 'keyword')).toBe(false)
    expect(tokens.every((token) => token.scope === 'string')).toBe(true)
    expect(tokens.map((token) => token.text).join('')).toBe('"running"')
  })

  it('reports an unclosed region and runs it to the end of the document', () => {
    const grammar: Grammar = {
      id: 'test',
      rules: [{ kind: 'region', begin: /\/\*/, end: /\*\//, contentScope: 'comment' }],
    }
    const result = scan('/* nothing closes this', grammar)
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]?.code).toBe('unclosed-region')
    expect(result.diagnostics[0]?.from).toBe(0)
    expect(result.diagnostics[0]?.to).toBe(2)
    expect(result.tokens.some((token) => token.text.includes('nothing'))).toBe(true)
  })

  it('paints an unterminated region apart from a terminated one, when told to', () => {
    // The difference between "this is a string" and "this is a broken string" is exactly
    // what a reader needs in order to trust the colours instead of being misled by them.
    const grammar: Grammar = {
      id: 'test',
      rules: [
        {
          kind: 'region',
          begin: /"/,
          end: /"/,
          contentScope: 'string',
          unclosed: { scope: 'string.unclosed' },
        },
      ],
    }
    expect(scan('"abc', grammar).tokens.map((token) => token.scope)).toEqual([
      'text',
      'string.unclosed',
    ])
    expect(scan('"abc"', grammar).tokens.map((token) => token.scope)).toEqual([
      'text',
      'string',
      'text',
    ])
  })

  it('reports a NESTED region that never closes, innermost first', () => {
    // The nested path closes its frames from the stack rather than by searching, so running
    // off the end used to leave the frames open and say nothing at all — the rest of the
    // document was quietly painted as region content with no explanation.
    const grammar: Grammar = {
      id: 'test',
      rules: [
        { kind: 'region', begin: /\[/, end: /\]/, contentScope: 'group', nested: true },
        { kind: 'match', scope: 'word', pattern: /[a-z]+/ },
      ],
    }
    const result = scan('[a [b', grammar)
    expect(result.diagnostics).toHaveLength(2)
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'unclosed-region',
      'unclosed-region',
    ])
    // Innermost first, because that is the one a reader has to fix first.
    expect(result.diagnostics[0]?.from).toBe(3)
    expect(result.diagnostics[1]?.from).toBe(0)
  })

  it('says nothing about a nested region that does close', () => {
    const grammar: Grammar = {
      id: 'test',
      rules: [{ kind: 'region', begin: /\[/, end: /\]/, contentScope: 'group', nested: true }],
    }
    expect(scan('[a [b] c]', grammar).diagnostics).toEqual([])
  })

  it('honours a custom unclosed message and severity', () => {
    const grammar: Grammar = {
      id: 'test',
      rules: [
        {
          kind: 'region',
          begin: /"/,
          end: /"/,
          contentScope: 'string',
          unclosed: { message: 'The quote is never closed.', severity: 'warning', code: 'unclosed-quote' },
        },
      ],
    }
    const result = scan('"abc', grammar)
    expect(result.diagnostics[0]?.message).toBe('The quote is never closed.')
    expect(result.diagnostics[0]?.severity).toBe('warning')
    expect(result.diagnostics[0]?.code).toBe('unclosed-quote')
  })

  it('lets a nested region open another of itself, and keeps the contents opaque', () => {
    // Nesting adds the DELIMITER and nothing else. A comment that nests is still a comment
    // all the way down, so the word rule must not reach inside it.
    const grammar: Grammar = {
      id: 'test',
      rules: [
        { kind: 'region', begin: /\[/, end: /\]/, contentScope: 'group', nested: true },
        { kind: 'match', scope: 'word', pattern: /[a-z]+/ },
      ],
    }
    const result = scan('[a [b] c]', grammar)
    expect(result.tokens.filter((token) => token.scope === 'word')).toEqual([])
    expect(result.diagnostics).toEqual([])
    // One region in the end, because the outer one closes last.
    expect(result.tokens.filter((token) => token.scope === 'group')).toHaveLength(1)
  })

  it('lets the rule list inside when the region is transparent', () => {
    // The other half of the pair, for a region that is not prose: a template in another
    // language, where the inner rules are the point.
    const grammar: Grammar = {
      id: 'test',
      rules: [
        { kind: 'region', begin: /\[/, end: /\]/, contentScope: 'group', transparent: true },
        { kind: 'match', scope: 'word', pattern: /[a-z]+/ },
      ],
    }
    const result = scan('[a [b] c]', grammar)
    expect(result.tokens.filter((token) => token.scope === 'word').map((token) => token.text)).toEqual([
      'a',
      'b',
      'c',
    ])
    expect(result.diagnostics).toEqual([])
  })

  it('paints the three parts of a region with their own scopes', () => {
    const grammar: Grammar = {
      id: 'test',
      rules: [
        {
          kind: 'region',
          begin: /"/,
          end: /"/,
          openScope: 'punctuation',
          contentScope: 'string',
          closeScope: 'punctuation',
        },
      ],
    }
    const result = scan('"ab"', grammar)
    expect(result.tokens.map((token) => `${token.scope}:${token.text}`)).toEqual([
      'punctuation:"',
      'string:ab',
      'punctuation:"',
    ])
  })
})

describe('token merging and coordinates', () => {
  it('merges adjacent tokens that share a scope', () => {
    // One rule matching one character at a time produces one push per character, and
    // they must come back as a single span: a span per character would mean thousands
    // of DOM nodes for a document nobody is looking at.
    const grammar: Grammar = {
      id: 'test',
      rules: [{ kind: 'match', scope: 'word', pattern: /\w/ }],
    }
    const tokens = scan('abc', grammar).tokens
    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.text).toBe('abc')
  })

  it('takes a run of characters no rule claims in one piece', () => {
    const grammar: Grammar = { id: 'test', rules: [], fallbackScope: 'plain' }
    expect(scan('....', grammar).tokens).toHaveLength(1)
  })

  it('never merges across a newline, because a token reports where it starts', () => {
    const grammar: Grammar = { id: 'test', rules: [], fallbackScope: 'plain' }
    const tokens = scan('a\nb', grammar).tokens
    // Three tokens: the newline is its own, and the characters either side of it are
    // not folded into one span whose start would misdescribe half of it.
    expect(tokens.map((token) => token.text)).toEqual(['a', '\n', 'b'])
  })

  it('reports the line and column each token starts at', () => {
    const grammar: Grammar = {
      id: 'test',
      rules: [{ kind: 'match', scope: 'word', pattern: /\w+/ }],
    }
    const result = scan('ab\n  cd', grammar)
    const words = result.tokens.filter((token) => token.scope === 'word')
    expect(words[0]?.line).toBe(0)
    expect(words[0]?.column).toBe(0)
    expect(words[1]?.line).toBe(1)
    expect(words[1]?.column).toBe(2)
  })

  it('covers the document exactly, with no gap and no overlap', () => {
    const grammar: Grammar = {
      id: 'test',
      rules: [
        { kind: 'match', scope: 'hash', pattern: /#[^\n]*/ },
        { kind: 'match', scope: 'word', pattern: /[a-z]+/ },
        { kind: 'match', scope: 'number', pattern: /\d+/ },
      ],
      fallbackScope: 'plain',
    }
    const source = '# a comment\nrunning 3\n"unclosed'
    const result = scan(source, grammar)
    let cursor = 0
    for (const entry of result.tokens) {
      expect(entry.from).toBe(cursor)
      expect(entry.text).toBe(source.slice(entry.from, entry.to))
      cursor = entry.to
    }
    expect(cursor).toBe(source.length)
  })
})

describe('resolveGrammar', () => {
  it('fills in the defaults', () => {
    const resolved = resolveGrammar({ id: 'test', rules: [] })
    expect(resolved.fallbackScope).toBe('text')
    expect(resolved.wordChars.source).toBe('[\\p{L}\\p{N}_$]')
  })

  it('marks itself, so the two shapes can be told apart', () => {
    // A plain grammar is allowed to declare a `fallbackScope` of its own, so
    // duck-typing on that field misreads it. The marker is what is reliable.
    const plain: Grammar = { id: 'test', rules: [], fallbackScope: 'plain' }
    expect(isResolvedGrammar(plain)).toBe(false)
    expect(isResolvedGrammar(resolveGrammar(plain))).toBe(true)
  })

  it('strips the flags that would make a pattern stateful across calls', () => {
    // A global word predicate answers correctly for the first character and then for
    // every other one, because `test` advances `lastIndex`.
    const resolved = resolveGrammar({ id: 'test', rules: [], wordChars: /[a-z]/g })
    expect(resolved.wordChars.flags.includes('g')).toBe(false)
    expect(resolved.wordChars.test('a')).toBe(true)
    expect(resolved.wordChars.test('a')).toBe(true)
  })

  it('accepts an already resolved grammar without re-resolving it', () => {
    const resolved = resolveGrammar({ id: 'test', rules: [] })
    expect(scan('x', resolved).tokens.length).toBeGreaterThan(0)
  })
})

describe('the test grammar, unused, keeps the state type honest', () => {
  it('threads the analysis to the rules and out again', () => {
    const rules: Rule<TestState>[] = [{ kind: 'words', words: (context) => context.state.known }]
    const grammar: Grammar<TestState> = { id: 'test', rules, analyze: () => ({ known: ['a'] }) }
    const result = scan('a', grammar)
    expect(result.state.known).toEqual(['a'])
  })
})
