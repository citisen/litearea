import { describe, expect, it } from 'vitest'
import { complete, inspect, resolveHover } from '../src/core/index.js'
import { dshFontQueryGrammar } from '../src/grammars/dshFont.js'
import { dshSentryStyleGrammar } from '../src/grammars/dshSentry.js'
import type { Grammar } from '../src/core/types.js'

/** The `scope:text` pairs of an inspection, which is what a colouring test is about. */
function painted<State>(source: string, grammar: Grammar<State>): string[] {
  return inspect(source, grammar)
    .tokens.filter((token) => token.text.trim() !== '')
    .map((token) => `${token.scope}:${token.text}`)
}

/** The diagnostic codes an inspection raised, in order. */
function codes<State>(source: string, grammar: Grammar<State>): string[] {
  return inspect(source, grammar).diagnostics.map((diagnostic) => diagnostic.code ?? '')
}

/** Ask for completions at a caret. */
function offer<State>(source: string, grammar: Grammar<State>, caret = source.length) {
  return complete(inspect(source, grammar), grammar, { text: source, caret, trigger: 'explicit' })
}

const SENTRY = dshSentryStyleGrammar()

describe('dsh-sentry style document', () => {
  describe('painting', () => {
    it('reads a state line', () => {
      expect(painted('running  circle  blue  turn   3', SENTRY)).toEqual([
        'state:running',
        'value.shape:circle',
        'value.color:blue',
        'value.motion:turn',
        'value.number:3',
      ])
    })

    it('reads the key=value spelling, including the operator', () => {
      expect(painted('approval shape=none color=gray motion=still speed=1', SENTRY)).toEqual([
        'state:approval',
        'property:shape',
        'operator:=',
        'value.shape:none',
        'property:color',
        'operator:=',
        'value.color:gray',
        'property:motion',
        'operator:=',
        'value.motion:still',
        'property:speed',
        'operator:=',
        'value.number:1',
      ])
    })

    it('paints a comment and stops at it', () => {
      // The host parser splits the comment off at the first `#` anywhere on the line,
      // so a word inside one is never read as a value.
      expect(painted('running circle # blue is not read', SENTRY)).toEqual([
        'state:running',
        'value.shape:circle',
        'comment:# blue is not read',
      ])
    })

    it('paints a word it does not know as invalid', () => {
      expect(painted('done square teal', SENTRY)).toContain('invalid:teal')
    })

    it('paints a bare none as a shape, and reads pattern=none as a pattern', () => {
      // `none` is a shape word, so that is what it is painted as wherever it appears —
      // a token cannot mean two things. The KEY is what makes it a pattern, and the key
      // is structural, so the analysis is where the difference is recorded.
      expect(painted('running none blue turn 3', SENTRY)).toContain('value.shape:none')
      expect(painted('running pattern=none', SENTRY)).toContain('value.shape:none')
      expect(inspect('running pattern=none', SENTRY).state.lines[0]?.slots.pattern).toBe('none')
    })
  })

  describe('diagnostics', () => {
    it('reports an unknown state, and nothing else on that line', () => {
      // An unknown state is a dead end for the host parser: it discards the rest of
      // the line, so complaining about the values on it would invent problems.
      const source = 'bogus circle'
      expect(codes(source, SENTRY)).toEqual(['vocabulary:state'])
      expect(inspect(source, SENTRY).diagnostics[0]?.from).toBe(0)
      expect(inspect(source, SENTRY).diagnostics[0]?.to).toBe(5)
    })

    it('names the slot a word was measured against', () => {
      const diagnostics = inspect('done square teal', SENTRY).diagnostics
      expect(diagnostics).toHaveLength(1)
      expect(diagnostics[0]?.code).toBe('bad-value')
      expect(diagnostics[0]?.severity).toBe('error')
      expect(diagnostics[0]?.message).toContain('not a valid color')
      expect(diagnostics[0]?.message).toContain('blue, amber, green')
    })

    it('reports a word that has nowhere to go', () => {
      // Every positional slot filled, so there is no slot left to measure it against.
      const diagnostics = inspect('running circle blue pattern=none turn 3 extra', SENTRY).diagnostics
      expect(diagnostics[0]?.code).toBe('unexpected-value')
      expect(diagnostics[0]?.message).toContain('nowhere to go')
    })

    it('reports an unknown option key by a declarative check', () => {
      const diagnostics = inspect('running spokes=3', SENTRY).diagnostics
      expect(diagnostics[0]?.code).toBe('unknown-option')
      expect(diagnostics[0]?.message).toContain('"spokes"')
      expect(diagnostics[0]?.message).toContain('shape, color, pattern, motion, speed, or bg')
    })

    it('reports a bad option value as a warning, because the document still works', () => {
      // Deliberately stricter than the host parser, which writes the value in and lets
      // it fall back to the shipped default in silence.
      const diagnostics = inspect('running shape=bogus', SENTRY).diagnostics
      expect(diagnostics).toHaveLength(1)
      expect(diagnostics[0]?.code).toBe('bad-option-value')
      expect(diagnostics[0]?.severity).toBe('warning')
      expect(diagnostics[0]?.message).toContain('The shipped default is used instead')
    })

    it('accepts the shipped document without a word of complaint', () => {
      const shipped = [
        'running  circle  blue  turn   3',
        'waiting  rounded amber blink  1.1',
        'approval rounded amber blink  1.9',
        'done     circle  green flush  1.6',
      ].join('\n')
      expect(inspect(shipped, SENTRY).diagnostics).toEqual([])
    })

    it('does not accept fallback as a state, because the host parser does not', () => {
      // The plugin's own module comment shows a `fallback none` line, but its states
      // list holds four entries and any other leading word is reported. Copying the
      // comment into the grammar would make the editor disagree with the parser.
      expect(codes('fallback none', SENTRY)).toEqual(['vocabulary:state'])
    })
  })

  describe('the analysis', () => {
    it('fills a slot from whatever syntax put a value there', () => {
      const state = inspect('running circle color=blue turn 3', SENTRY).state
      expect(state.lines[0]?.slots).toEqual({
        shape: 'circle',
        color: 'blue',
        motion: 'turn',
        speed: '3',
      })
    })

    it('records the option keys a line named and the one still being written', () => {
      const state = inspect('running shape=', SENTRY).state
      expect(state.lines[0]?.keys).toEqual(['shape'])
      expect(state.lines[0]?.pendingKey).toBe('shape')
    })

    it('marks a line opening an unknown state as unknown', () => {
      expect(inspect('bogus circle', SENTRY).state.lines[0]?.known).toBe(false)
    })
  })

  describe('completion', () => {
    it('offers the states at the head of a line', () => {
      const completion = offer('run', SENTRY)
      expect(completion?.sourceId).toBe('state')
      expect(completion?.rows[0]?.item.label).toBe('running')
    })

    it('keeps offering the states while the name is being spelled', () => {
      // `firstWord` rather than `firstOnLine`: a source that asked the stricter
      // question would switch itself off after one keystroke.
      expect(offer('runn', SENTRY)?.sourceId).toBe('state')
      expect(offer('running', SENTRY)?.sourceId).toBe('state')
    })

    it('offers the next unfilled slot after a state', () => {
      const completion = offer('running ', SENTRY)
      expect(completion?.sourceId).toBe('value')
      const labels = completion?.rows.map((row) => row.item.label) ?? []
      expect(labels).toContain('circle')
      expect(labels).toContain('shape=')
    })

    it('offers colours once a shape is written', () => {
      const completion = offer('running circle ', SENTRY)
      const labels = completion?.rows.map((row) => row.item.label) ?? []
      expect(labels[0]).toBe('blue')
    })

    it('offers a slot vocabulary inside the key=value spelling', () => {
      const completion = offer('running shape=ci', SENTRY)
      expect(completion?.rows.map((row) => row.item.label)).toEqual(['circle'])
      expect(completion?.range).toEqual({ from: 14, to: 16 })
    })

    it('offers the shipped rates for a speed, with the state own rate leading', () => {
      const completion = offer('running circle blue pattern=none turn ', SENTRY)
      expect(completion?.rows[0]?.item.label).toBe('3')
      expect(completion?.rows[0]?.item.detail).toBe('the shipped rate for this state')
    })

    it('puts the value already written at the head of its own list', () => {
      // The caret is inside the value, so the key names the slot and the slot already has
      // a value: that value leads, and accepting the top row then changes nothing by
      // accident.
      const completion = offer('running color=blue', SENTRY)
      expect(completion?.rows[0]?.item.label).toBe('blue')
      expect(completion?.rows[0]?.item.detail).toBe('the current color')
    })

    it('completes with the trailing space a state needs', () => {
      expect(offer('runn', SENTRY)?.rows[0]?.item.append).toBe(' ')
    })
  })

  describe('hover', () => {
    it('explains a state', () => {
      const info = resolveHover(inspect('running', SENTRY), SENTRY, 2)
      expect(info?.title).toBe('running')
      expect(info?.detail).toBe('a turn is in progress')
    })

    it('explains a colour with its hex value', () => {
      expect(resolveHover(inspect('running circle blue', SENTRY), SENTRY, 17)?.detail).toBe('#4d6bfe')
    })

    it('leads with the severity when the pointer is on a problem', () => {
      // A diagnostic outranks a description, because the user resting the pointer on a
      // squiggle is asking what is wrong with it.
      const info = resolveHover(inspect('running bogus', SENTRY), SENTRY, 10)
      expect(info?.kind).toBe('diagnostic')
      expect(info?.title).toBe('Error')
      expect(info?.body).toContain('bogus')
    })

    it('explains an option key', () => {
      const info = resolveHover(inspect('running speed=1', SENTRY), SENTRY, 9)
      expect(info?.title).toBe('speed')
      expect(info?.detail).toBe('seconds per cycle')
    })

    it('says nothing about blank space', () => {
      // Whitespace is painted with a scope like everything else, so a token IS found in a gap —
      // and describing it produced a tooltip whose entire content was the fallback scope's name.
      const source = 'running  circle'
      expect(resolveHover(inspect(source, SENTRY), SENTRY, 7)).toBeUndefined()
      expect(resolveHover(inspect(source, SENTRY), SENTRY, 8)).toBeUndefined()
    })

    it('says nothing at all about a document that is only whitespace', () => {
      expect(resolveHover(inspect('   \n  ', SENTRY), SENTRY, 2)).toBeUndefined()
    })

    it('explains a speed rather than naming its scope', () => {
      const info = resolveHover(inspect('running circle blue none turn 3', SENTRY), SENTRY, 30)
      expect(info?.title).toBe('3')
      expect(info?.detail).toBe('seconds per cycle')
    })
  })
})

const FONT_CATALOGUE = [
  'Inter',
  'Inter Tight',
  'IBM Plex Mono',
  'Geist Mono',
  'Fira Code',
  'Book Antiqua',
]
const FONT_STYLES = { 'Geist Mono': ['Regular', 'Medium', 'SemiBold', 'Bold'] }

/** The font grammar as a host would build it, with the catalogue read from the machine. */
function fontGrammar(enumerated = true) {
  return dshFontQueryGrammar({
    catalogue: FONT_CATALOGUE,
    enumerated,
    styles: FONT_STYLES,
    shippedWeight: 400,
  })
}

describe('dsh-font font query', () => {
  describe('painting', () => {
    it('reads a stack of families, a weight, and a generic', () => {
      expect(painted('Geist Mono medium, Inter, monospace', fontGrammar())).toEqual([
        'family:Geist Mono',
        'weight:medium',
        'separator:,',
        'family:Inter',
        'separator:,',
        'family.generic:monospace',
      ])
    })

    it('paints a quoted family as one token, whatever is inside it', () => {
      // Quoting always means "this is the family name, verbatim", so a space, a bracket,
      // and a comma inside it are all just characters.
      expect(painted('"Zhuque Fangsong (technical preview)"', fontGrammar(false))).toEqual([
        'family:"Zhuque Fangsong (technical preview)"',
      ])
    })

    it('paints a quoted name the machine does not have as unknown when the catalogue is authoritative', () => {
      expect(painted('"Zhuque"', fontGrammar())).toEqual(['family.unknown:"Zhuque"'])
    })

    it('paints an unclosed quote as an unclosed quote', () => {
      expect(painted('Geist Mono, "Zhuque', fontGrammar())).toContain('family.unclosed:"Zhuque')
    })

    it('paints a name the machine does not have as unknown when the catalogue is authoritative', () => {
      expect(painted('Not A Font', fontGrammar())).toContain('family.unknown:Not')
    })

    it('paints the same name as an ordinary family when the catalogue is only a suggestion', () => {
      // Without a catalogue read from the machine, the parser has no business
      // second-guessing a name the user typed.
      expect(painted('Not A Font', fontGrammar(false))).toContain('family:Not')
    })

    it('leaves a weight word alone when it is not the last word of the entry', () => {
      // `Book Antiqua` is a real family, and stripping the weight would silently
      // retarget the stack at a font nobody picked. The catalogue decides: the phrase is
      // matched whole, so the trailing word is never reached as a weight.
      expect(painted('Book Antiqua', fontGrammar())).toContain('family:Book Antiqua')
      expect(painted('Book Antiqua medium', fontGrammar())).toContain('weight:medium')
    })
  })

  describe('diagnostics', () => {
    it('warns about a family this machine does not have', () => {
      const diagnostics = inspect('Geist Mono, Not A Font', fontGrammar()).diagnostics
      const unknown = diagnostics.find((diagnostic) => diagnostic.code === 'unknown-family')
      expect(unknown?.severity).toBe('warning')
      expect(unknown?.message).toContain('"Not A Font"')
    })

    it('reports an unclosed quote as an error', () => {
      const diagnostics = inspect('Geist Mono, "Zhuque', fontGrammar()).diagnostics
      expect(diagnostics.some((diagnostic) => diagnostic.code === 'unclosed-quote')).toBe(true)
      expect(diagnostics.find((diagnostic) => diagnostic.code === 'unclosed-quote')?.severity).toBe('error')
    })

    it('reports text after a quoted name that is neither a weight nor part of it', () => {
      const diagnostics = inspect('"Inter" Bold Italic', fontGrammar()).diagnostics
      const trailing = diagnostics.find((diagnostic) => diagnostic.code === 'trailing-text')
      expect(trailing?.message).toContain('"Bold Italic"')
    })

    it('reports a weight stated more than once', () => {
      const diagnostics = inspect('Inter medium, IBM Plex Mono bold', fontGrammar()).diagnostics
      expect(diagnostics.some((diagnostic) => diagnostic.code === 'duplicate-weight')).toBe(true)
    })

    it('reports a weight the chosen family does not have, and repaints it', () => {
      const source = 'Geist Mono thin'
      const diagnostics = inspect(source, fontGrammar()).diagnostics
      expect(diagnostics.some((diagnostic) => diagnostic.code === 'missing-weight')).toBe(true)
      expect(painted(source, fontGrammar())).toContain('weight.missing:thin')
    })

    it('says nothing about a weight when the family has no faces recorded', () => {
      // An unread face list means "unknown", never "absent". The only note left is the
      // one about the missing generic fallback, which is about the list and not the weight.
      const grammar = dshFontQueryGrammar({ catalogue: ['Inter'], enumerated: true })
      expect(codes('Inter thin', grammar)).not.toContain('missing-weight')
    })

    it('notes a list with no generic family at the end', () => {
      const diagnostics = inspect('Inter, IBM Plex Mono', fontGrammar()).diagnostics
      const note = diagnostics.find((diagnostic) => diagnostic.code === 'no-generic-fallback')
      expect(note?.severity).toBe('info')
    })

    it('says nothing about the shipped-shaped query', () => {
      expect(codes('Geist Mono medium, monospace', fontGrammar())).toEqual([])
    })
  })

  describe('the analysis', () => {
    it('finds the family the browser will actually paint with', () => {
      const state = inspect('Nope Family, Geist Mono, monospace', fontGrammar()).state
      expect(state.effective).toBe(1)
      expect(state.families[state.effective]).toBe('Geist Mono')
    })

    it('falls back to the first entry when the catalogue is not authoritative', () => {
      expect(inspect('Nope Family, Geist Mono', fontGrammar(false)).state.effective).toBe(0)
    })

    it('reads the weight next to the family it belongs to', () => {
      const state = inspect('Geist Mono medium', fontGrammar()).state
      expect(state.weight).toBe(500)
      expect(state.weightWord).toBe('medium')
    })

    it('marks the family in effect as a decoration, not as a scope', () => {
      // It depends on the machine and not on the characters, so re-lexing the document
      // whenever the catalogue changed would be the wrong shape of work.
      const decorations = inspect('Geist Mono medium, monospace', fontGrammar()).decorations
      expect(decorations).toHaveLength(1)
      expect(decorations[0]?.kind).toBe('effective')
      expect(decorations[0]).toMatchObject({ from: 0, to: 10 })
      expect(decorations[0]?.title).toContain('Geist Mono')
    })
  })

  describe('completion', () => {
    it('offers the families for a partial name', () => {
      const rows = offer('Geist M', fontGrammar())?.rows.map((row) => row.item.label) ?? []
      expect(rows).toContain('Geist Mono')
    })

    it('offers a weight once the entry names a family, in scale order', () => {
      const rows = offer('Geist Mono ', fontGrammar())?.rows.map((row) => row.item.label) ?? []
      // The shipped weight leads, because a list ordered by label length would put
      // `bold` — the shortest word — at the top and look shuffled.
      expect(rows[0]).toBe('Geist Mono regular')
      expect(rows.slice(0, 4)).toEqual([
        'Geist Mono regular',
        'Geist Mono medium',
        'Geist Mono semibold',
        'Geist Mono bold',
      ])
    })

    it('still finds the family when the weight has been started', () => {
      // The entry as a whole is not a family name, but the part before the word being
      // typed is — without that fallback a weight is unreachable after one keystroke.
      const rows = offer('Geist Mono m', fontGrammar())?.rows.map((row) => row.item.label) ?? []
      expect(rows).toContain('Geist Mono medium')
    })

    it('offers only the weights the family actually has', () => {
      const rows = offer('Geist Mono ', fontGrammar())?.rows.map((row) => row.item.label) ?? []
      expect(rows.some((label) => label.includes('black'))).toBe(false)
      expect(rows.some((label) => label.includes('bold'))).toBe(true)
    })

    it('inserts a whole new entry when the caret sits at the start of a complete one', () => {
      // Which is how a family is promoted to the front without dragging anything.
      const completion = offer('Inter, monospace', fontGrammar(), 0)
      const geist = completion?.rows.find((row) => row.item.label === 'Geist Mono')
      expect(geist?.item.mode).toBe('before')
    })

    it('invites another fallback with a trailing comma', () => {
      const completion = offer('Geist M', fontGrammar())
      const geist = completion?.rows.find((row) => row.item.label === 'Geist Mono')
      expect(geist?.item.append).toBe(', ')
    })

    it('offers the entry as typed, so an uncatalogued name can still be accepted', () => {
      const rows = offer('My Custom Font', fontGrammar())?.rows ?? []
      expect(rows.some((row) => row.item.kind === 'custom')).toBe(true)
    })

    it('carries the weight the entry already states through a family swap', () => {
      // Swap the family and the weight the entry states travels with the pick, so
      // completing a name does not quietly reset how heavy it is. The family is quoted
      // because CSS requires it for a name containing a space.
      const completion = offer('Geist Mono medium', fontGrammar(), 8)
      const geist = completion?.rows.find((row) => row.item.label === 'Geist Mono')
      expect(geist?.item.insert).toBe('"Geist Mono" medium')
    })

    it('does not quote a generic family, because quoting it names a literal font', () => {
      const completion = offer('mono', fontGrammar())
      const generic = completion?.rows.find((row) => row.item.label === 'monospace')
      expect(generic?.item.insert).toBe('monospace')
    })
  })

  describe('hover', () => {
    it('explains a weight by number', () => {
      const info = resolveHover(inspect('Geist Mono medium', fontGrammar()), fontGrammar(), 13)
      expect(info?.title).toContain('font-weight 500')
      expect(info?.body).toContain('has this face')
    })

    it('says when the family has no such face', () => {
      const info = resolveHover(inspect('Geist Mono thin', fontGrammar()), fontGrammar(), 13)
      expect(info?.body).toContain('synthesise')
    })

    it('explains a generic family', () => {
      const info = resolveHover(inspect('monospace', fontGrammar()), fontGrammar(), 2)
      expect(info?.detail).toBe('a generic CSS family')
    })

    it('says what an unclosed quote did', () => {
      const info = resolveHover(inspect('"Zhuque', fontGrammar()), fontGrammar(), 2)
      expect(info?.kind).toBe('diagnostic')
      expect(info?.body).toContain('one family name')
    })
  })
})
