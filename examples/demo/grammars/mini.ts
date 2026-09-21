// --- mini-conf: a configuration language, written for this demo --------------
//
// Neither reference grammar is a key/value language, and this one exists to show
// what they do not: a REGION that a comment can open and close (and nest inside),
// rules placed by POSITION (firstOnLine, after, line), a declarative check,
// completion rows that carry commit characters, and per-word hover docs.
//
//     # a line comment — a semicolon opens one too, when it is first on its line
//     theme = dark            ; an unknown key, and a diagnostic about it
//
//     [editor]
//     wordWrap = no
//     ruler = ruler
//
//     /* a block comment
//        /* which nests, because the region rule says so
//        and [editor] in here is text, not a section
//     [server]                ; a section the grammar knows
//
// Nothing here is built in. The library ships no syntax; this file is a grammar
// like any host would write.

import type { Diagnostic, Scope, VocabularyContext } from '@citisen/litearea'
import { defineGrammar, defineVocabulary } from '@citisen/litearea'

/** A section header, located. */
export interface MiniSection {
  name: string
  /** The range of the bare name, so a diagnostic can underline it without the brackets. */
  from: number
  to: number
  line: number
}

/** One key = value line, located. */
export interface MiniProperty {
  key: string
  value: string
  keyFrom: number
  keyTo: number
  valueFrom: number
  valueTo: number
  /** Whether the value was written inside quotes. */
  quoted: boolean
  /** The section that was open when the line was read. */
  section: string | undefined
  line: number
}

/**
 * What one pass over the document produced.
 *
 * A grammar author writes this by hand; the contract only asks that every hook
 * agrees about it. The block depth is kept because the parser has to know whether
 * a section header line is really a header or merely text inside a block comment.
 */
export interface MiniState {
  sections: MiniSection[]
  properties: MiniProperty[]
  problems: Diagnostic[]
  /** How many block comments are still open at the end of the document. */
  blockDepth: number
}

/** Every key the grammar has a default for. */
export const MINI_KEYS: readonly string[] = [
  'host',
  'port',
  'user',
  'retries',
  'timeout',
  'maxRows',
  'theme',
  'wordWrap',
  'ruler',
]

/** The keys whose value is a boolean, which is what the boolean rule governs. */
export const MINI_BOOLEAN_KEYS: readonly string[] = ['wordWrap', 'ruler', 'autoSave']

/** The section headers the grammar knows. Anything else is reported. */
export const MINI_SECTIONS: readonly string[] = [
  'editor',
  'server',
  'session',
  'logging',
  'theme',
  'lint',
]

/** The defaults, shown in the completion list so a key says what it means. */
const MINI_DEFAULTS: Readonly<Record<string, string>> = {
  host: '127.0.0.1',
  port: '8080',
  user: 'the current user',
  retries: '0',
  timeout: '30',
  maxRows: '20',
  theme: 'system',
  wordWrap: 'no',
  ruler: 'none',
}

/** The default document, which is also what the panel resets to. */
export const MINI_DEFAULT = [
  '# mini-conf -- sections, key = value, and two kinds of comment',
  'theme = dark',
  '',
  '[editor]',
  'wordWrap = no',
  'ruler = ruler',
  'maxRows = 40',
  '',
  '/* a block comment',
  '   whose second line names a [notASection]',
  '   and whose third names a key = value — none of it is code',
  '*/',
  '',
  '[server]',
  'host = "127.0.0.1"',
  'port = 8080',
  'retries = three',
  '',
].join('\n')

/**
 * The key of a key = value line, or undefined when the line is not one.
 * @param body - the line with its comment already removed.
 * @returns the key as written.
 */
function keyOf(body: string): string | undefined {
  const match = /^\s*([^=#;]+?)\s*=(?!=)/.exec(body)
  const key = match?.[1]?.trim()
  return key === undefined || key === '' ? undefined : key
}

/**
 * Walk the document's block comments, one line at a time.
 *
 * The parser needs this and not the tokens, because a section header written
 * inside a block comment is prose: it must not become the section the following
 * lines are read under.
 *
 * The walk mirrors the engine's own region scan, and that is the whole point of
 * it. The scanner keeps a STACK of open regions, so a close delimiter ends the
 * innermost one and a second open delimiter inside a comment starts a level that
 * has to be closed before the outer comment ends. A walk that paired each close
 * with the first open — the obvious shortcut — would answer differently the moment
 * one comment contained the text of another, and an analysis that disagrees with
 * the paint is two documents wearing one name.
 *
 * Exported because it is the one piece of this grammar a test can check against
 * the tokens without going through a document, and because a host that stores a
 * position needs the same reading.
 * @param lines - the document's lines.
 * @returns the depth each line is read at, and the offset a still-open comment
 *   began at.
 */
export function blockState(lines: readonly string[]): { depth: number[]; unclosedAt: number } {
  const depth: number[] = []
  /** The offsets the currently open comments began at, innermost last. */
  const stack: number[] = []
  let offset = 0
  for (const line of lines) {
    const startDepth = stack.length
    /** Whether this line opens a comment that outlives it. */
    let opensHere = false
    let cursor = 0
    while (cursor < line.length) {
      const open = line.indexOf('/*', cursor)
      const close = line.indexOf('*/', cursor)
      if (open !== -1 && (close === -1 || open < close)) {
        if (stack.length === 0) opensHere = true
        stack.push(offset + open)
        cursor = open + 2
        continue
      }
      if (close === -1) break
      stack.pop()
      cursor = close + 2
    }
    // A line is comment when it BEGINs inside one, or when it opens one that is
    // still open at the end of the line. That is the same reading the scanner
    // paints: the opening delimiter and everything after it belong to the region,
    // and a comment that never closes owns the rest of the document.
    //
    // The one case this cannot describe is code written after a closing delimiter
    // on the same line (`*/ x = 1`). The demo's own document never does that: a
    // delimiter is always the last thing on its line. A grammar that needed it
    // would be reaching for a second walk in `validate`, where the tokens are
    // available and the engine has already decided where the region ends.
    depth.push(startDepth > 0 || opensHere ? 1 : 0)
    offset += line.length + 1
  }
  return { depth, unclosedAt: stack[0] ?? -1 }}

/**
 * Build the mini-conf grammar.
 * @returns a grammar that paints, completes, diagnoses, and explains the language.
 */
export function miniConfGrammar() {
  // Declared once each, so the word set, the paint, the rejection message, and the
  // hover text cannot disagree — which is the whole reason a vocabulary is one
  // object rather than four lists.
  const BOOLEAN_VOCAB = defineVocabulary<MiniState>({
    id: 'boolean',
    words: ['true', 'false', 'yes', 'no'],
    scope: 'value.boolean',
    caseSensitive: true,
    unknownMessage: '"{word}" is not a boolean — write one of {allowed}.',
    unknownCode: 'bad-boolean',
    docs: {
      true: { detail: 'on', body: 'The same as yes. Written lowercase: the reader folds nothing.' },
      false: { detail: 'off', body: 'The same as no.' },
      yes: { detail: 'on', body: 'Accepted so a file written by hand does not have to be rewritten.' },
      no: { detail: 'off', body: 'Accepted for the same reason as yes.' },
    },
  })

  const SECTION_VOCAB = defineVocabulary<MiniState>({
    id: 'section',
    words: MINI_SECTIONS,
    scope: 'section.name',
    caseSensitive: true,
    docs: {
      editor: { detail: 'the editing surface', body: 'Wrapping, rulers, and the rows the box may grow to.' },
      server: { detail: 'where the process listens', body: 'The host and the port; both optional, both defaulted.' },
      session: { detail: 'how long a session lives', body: 'Idle timeouts and resume behaviour.' },
      logging: { detail: 'what is written down', body: 'Levels and destinations.' },
      theme: { detail: 'the palette', body: 'Named presets only, so a theme cannot be illegible.' },
      lint: { detail: 'how strict the reader is', body: 'Rules the file is checked against before it is used.' },
    },
  })

  const KEY_VOCAB = defineVocabulary<MiniState>({
    id: 'key',
    words: MINI_KEYS,
    scope: 'property',
    caseSensitive: true,
    docs: Object.fromEntries(
      MINI_KEYS.map((key) => [
        key,
        {
          detail: MINI_BOOLEAN_KEYS.includes(key) ? 'a boolean' : 'a value',
          body: `The default is used when ${key} is absent, so a file only states what it changes.`,
        },
      ]),
    ),
  })

  /** The line's content with any trailing comment removed. */
  const bodyOf = (raw: string): string => {
    const hash = raw.indexOf('#')
    const semi = raw.indexOf(';')
    if (hash === -1) return semi === -1 ? raw : raw.slice(0, semi)
    if (semi === -1) return raw.slice(0, hash)
    return raw.slice(0, Math.min(hash, semi))
  }

  return defineGrammar<MiniState>({
    id: 'mini-conf',
    name: 'mini-conf',

    // A hyphen and a dot are word characters here because a configuration key may
    // hold them, and leaving them out would make a completion replace half a key.
    wordChars: /[A-Za-z0-9_.-]/,

    rules: [
      // -- the block comment, first, because it may span lines ---------------
      // The region runs from an open delimiter to the first close delimiter after
      // it, and everything between them — including a line that looks exactly like
      // a section header — is one comment rather than code. A nested open
      // delimiter is prose: `nested` is left off on purpose, because the engine
      // then finds the end in one search, and `blockState` above reads the
      // document the same way. The three scopes are declared separately so the
      // delimiters can be painted apart from the prose between them.
      {
        kind: 'region',
        begin: /\/\*/,
        end: /\*\//,
        // `nested` is what lets a block comment hold the text of another one, which
        // is the behaviour the demo document shows and the behaviour `blockState`
        // mirrors. Leaving it off makes the scanner close the region at the first
        // close delimiter it can find, and a walk that instead paired delimiters
        // line by line would then disagree with the paint.
        nested: true,
        openScope: 'comment.block.marker',
        contentScope: 'comment.block',
        closeScope: 'comment.block.marker',
        unclosed: {
          message: 'This block comment is never closed, so everything after it is a comment.',
          code: 'unclosed-block-comment',
          severity: 'error',
        },
      },

      // -- line comments -----------------------------------------------------
      { kind: 'match', scope: 'comment', pattern: /#[^\n]*/ },
      // A semicolon opens a comment only at the head of a line, so one inside a
      // value stays the value's business. The predicate is what says so.
      { kind: 'match', scope: 'comment', pattern: /;[^\n]*/, when: { firstOnLine: true } },

      // -- section headers ---------------------------------------------------
      // `line` is the predicate for "the WHOLE line is a header", so two headers
      // crammed onto one line are a mistake rather than two headers.
      { kind: 'match', scope: 'separator.bracket', pattern: /\[/, when: { line: /^\s*\[/ } },
      { kind: 'match', scope: 'separator.bracket', pattern: /\]/, when: { line: /\]\s*$/ } },
      {
        kind: 'words',
        words: SECTION_VOCAB,
        scope: 'section.name',
        // A header the grammar does not know is still a header, and it has to be
        // CLAIMED as one. Without `unknown` the rule simply fails to match, the
        // word predicate runs on past the bracket, and `[mystery]` becomes the
        // plain-text token `mystery]` — which the check below then never sees.
        // Claiming it is also what keeps its colour a section's, so the `check` is
        // the only thing that has to have an opinion about the name.
        unknown: { scope: 'section.name' },
        // A name the grammar does not know is still painted as a section and
        // reported by the `check` below: the rule that reports it is not the rule
        // that would have to guess its colour.
        when: { line: /^\s*\[[A-Za-z0-9_]+\]\s*$/ },
      },

      // -- the key, the operator, the value ----------------------------------
      // The key is seen from its equals sign so it cannot also swallow a value,
      // and `minColumn` is spelled out at 0 to show the predicate on a rule that
      // a reader might otherwise expect to carry it: a key may open a line.
      {
        kind: 'match',
        scope: 'property',
        pattern: /[A-Za-z_][A-Za-z0-9_.-]*(?=\s*=)/,
        when: { line: /^\s*[A-Za-z_][A-Za-z0-9_.-]*\s*=/, minColumn: 0 },
      },
      // `after` is what makes this equals sign an operator: a bare one in prose is
      // just a character, and the token before it is what tells the two apart.
      { kind: 'match', scope: 'operator', pattern: /=/, when: { after: ['property'] } },

      // Boolean values, with the vocabulary rejecting a word it does not know —
      // which is how `retries = three` earns a squiggle. The rule is placed by
      // POSITION and not left to match every word in the document: a vocabulary
      // that rejected everywhere would call a key, a section name, and a bare
      // number bad booleans too, and a squiggle under every word is worse than
      // none at all.
      { kind: 'words', words: BOOLEAN_VOCAB, unknown: {}, when: { after: ['operator'] } },

      { kind: 'match', scope: 'string', pattern: /"[^"\n]*"|'[^'\n]*'/ },
      { kind: 'match', scope: 'number', pattern: /\d+(?:\.\d+)?/ },
      { kind: 'match', scope: 'separator', pattern: /,/ },

      // Anything left is a word this language does not place. It is painted, not
      // reported: a bare value is an ordinary mistake to make.
      { kind: 'match', scope: 'value.plain', pattern: /[^\s,;#'"]+/ },
    ],

    fallbackScope: 'text',

    // -- what the document means -------------------------------------------
    //
    // One pass, and every later hook reads its result. This is the only place
    // that decides what a section header is, so the paint, the diagnostics, and
    // the completion list cannot be told three different stories about it.
    analyze: (text) => {
      const lines = text.split('\n')
      const { depth, unclosedAt } = blockState(lines)
      const sections: MiniSection[] = []
      const properties: MiniProperty[] = []
      const problems: Diagnostic[] = []
      const seen = new Map<string, number>()

      let section: string | undefined
      let offset = 0

      for (let number = 0; number < lines.length; number += 1) {
        const raw = lines[number] ?? ''
        const lineFrom = offset
        offset += raw.length + 1

        // A line that ends inside a block comment, or that is only a comment, is
        // prose however much it looks like a section header.
        if ((depth[number] ?? 0) > 0) continue
        const body = bodyOf(raw)
        const trimmed = body.trim()
        if (trimmed === '') continue

        const header = /^\[([^\]]*)\]$/.exec(trimmed)
        if (header !== null) {
          const name = (header[1] ?? '').trim()
          const bracket = raw.indexOf('[')
          const from = lineFrom + (bracket === -1 ? 0 : bracket + 1)
          sections.push({ name, from, to: from + name.length, line: number })
          section = name
          if (name === '') {
            problems.push({
              from: lineFrom + Math.max(0, bracket),
              to: lineFrom + Math.max(0, bracket) + 2,
              message: 'A section header needs a name.',
              severity: 'error',
              code: 'empty-section',
              source: 'mini-conf',
            })
          }
          continue
        }

        const key = keyOf(body)
        const equals = body.indexOf('=')
        if (key === undefined || equals === -1) {
          problems.push({
            from: lineFrom,
            to: lineFrom + raw.length,
            message: `"${trimmed}" is neither a section header nor a key = value line.`,
            severity: 'warning',
            code: 'unreadable-line',
            source: 'mini-conf',
          })
          continue
        }

        const after = body.slice(equals + 1)
        const written = after.trim()
        const keyFrom = lineFrom + body.indexOf(key)
        const valueFrom = lineFrom + equals + 1 + (after.length - after.trimStart().length)
        const quote = written.charAt(0)
        const quoted =
          (quote === '"' || quote === "'") && written.length >= 2 && written.endsWith(quote)
        const property: MiniProperty = {
          key,
          value: quoted ? written.slice(1, -1) : written,
          keyFrom,
          keyTo: keyFrom + key.length,
          valueFrom,
          valueTo: valueFrom + written.length,
          quoted,
          section,
          line: number,
        }
        properties.push(property)

        if (KEY_VOCAB.entryFor(key) === undefined) {
          problems.push({
            from: property.keyFrom,
            to: property.keyTo,
            message: `"${key}" is not a setting this reader has a default for.`,
            severity: 'error',
            code: 'unknown-key',
            source: 'mini-conf',
          })
        }

        const scope = section ?? '(top level)'
        const previous = seen.get(`${scope}\u0000${key}`)
        if (previous === undefined) {
          seen.set(`${scope}\u0000${key}`, number)
        } else {
          problems.push({
            from: property.keyFrom,
            to: property.keyTo,
            message: `"${key}" is already set on line ${String(previous + 1)} of [${scope}]; this value wins.`,
            severity: 'warning',
            code: 'duplicate-key',
            source: 'mini-conf',
          })
        }
      }

      const stillOpen = depth[depth.length - 1] ?? 0
      if (stillOpen > 0 && unclosedAt >= 0) {
        problems.push({
          from: unclosedAt,
          to: text.length,
          message: `A block comment is still open at the end of the file (depth ${String(stillOpen)}).`,
          severity: 'error',
          code: 'unclosed-block-comment',
          source: 'mini-conf',
        })
      }

      return { sections, properties, problems, blockDepth: stillOpen }
    },

    // -- the declarative check ---------------------------------------------
    checks: [
      {
        code: 'unknown-section',
        scopes: ['section.name'],
        allow: SECTION_VOCAB,
        severity: 'warning',
        message: 'Unknown section "{word}" — this reader knows {allowed}.',
        detail: 'An unknown section is kept as written; nothing in it is read.',
      },
    ],

    validate: (context) => {
      for (const problem of context.state.problems) {
        context.report({
          from: problem.from,
          to: problem.to,
          message: problem.message,
          severity: problem.severity,
          code: problem.code,
        })
      }
    },

    // -- what a thing is ---------------------------------------------------
    describe: (context) => {
      const token = context.token
      if (token === undefined) return undefined
      const entry =
        token.scope === 'property'
          ? KEY_VOCAB.entryFor(token.text)
          : (BOOLEAN_VOCAB.entryFor(token.text) ?? SECTION_VOCAB.entryFor(token.text))
      if (entry !== undefined) {
        return { title: token.text, detail: entry.detail, body: entry.body }
      }
      if (token.scope.startsWith('comment')) {
        return {
          title: 'comment',
          body: 'Ignored by the reader. A hash starts one anywhere, a semicolon only at the head of a line, and a block comment spans lines and nests.',
        }
      }
      if (token.scope === 'number') {
        return {
          title: token.text,
          detail: 'a number',
          body: 'Read as written. A unit belongs in the key, as in the timeout setting.',
        }
      }
      if (token.scope === 'string') {
        return {
          title: token.text,
          detail: 'a quoted value',
          body: 'The quotes come off before the value is read, so a value may contain a hash, a semicolon, and an equals sign.',
        }
      }
      return undefined
    },

    // -- what can come next ------------------------------------------------
    compose: [
      {
        id: 'section',
        // A header is the only thing that opens with a bracket, so the character
        // before the caret is enough to know the list belongs here.
        when: (context) => context.line.before.trimStart().startsWith('['),
        range: (context) => ({ from: context.word.from, to: context.word.to }),
        items: (context) => {
          const used = new Set(context.state.sections.map((entry) => entry.name))
          return MINI_SECTIONS.map((name) => ({
            label: name,
            insert: name,
            append: ']',
            kind: 'section',
            detail: used.has(name) ? 'already in this file' : 'a known section',
            documentation: SECTION_VOCAB.entryFor(name)?.body,
            // The name is written and the bracket appended, so the caret is left
            // inside the brackets rather than after them.
            caretOffset: -1,
            sortText: used.has(name) ? '1' : '0',
          }))
        },
      },
      {
        id: 'property',
        // A key opens a line, and `firstWord` stays true while it is being
        // spelled — which the stricter `firstOnLine` would not.
        when: (context) => context.firstWord && !context.line.before.includes('='),
        range: (context) => ({ from: context.word.from, to: context.word.to }),
        items: (context) => {
          const used = new Set(context.state.properties.map((entry) => entry.key))
          return MINI_KEYS.map((key) => ({
            label: key,
            insert: key,
            // The commit character is what makes typing `po` and then `=` accept
            // `port` and keep the equals sign, instead of making the user press
            // Enter and then type it.
            commitCharacters: '=',
            kind: 'property',
            detail: `default ${MINI_DEFAULTS[key] ?? ''}`,
            documentation: KEY_VOCAB.entryFor(key)?.body,
            sortText: used.has(key) ? '1' : '0',
          }))
        },
      },
      {
        id: 'value',
        when: (context) => {
          const key = keyAtCaret(context.line.before)
          return key !== undefined && MINI_BOOLEAN_KEYS.includes(key)
        },
        range: (context) => ({ from: context.word.from, to: context.word.to }),
        items: (context) =>
          BOOLEAN_VOCAB.resolve(vocabularyContext(context.text, context.state)).map((word) => {
            const entry = BOOLEAN_VOCAB.entryFor(word)
            return {
              label: word,
              insert: word,
              kind: 'value',
              detail: entry?.detail,
              documentation: entry?.body,
            }
          }),
      },
    ],

    // -- what is semantically true, rather than what the characters are ----
    decorate: (_text, state) => {
      const decorations = []
      // Which section a line belongs to is not a fact about its characters, so it
      // is painted as a decoration rather than as a token.
      for (const section of state.sections) {
        decorations.push({
          from: section.from,
          to: section.to,
          kind: 'section-head',
          title: `[${section.name}]`,
        })
      }
      const marked = new Set<string>()
      for (const property of state.properties) {
        const id = property.section ?? ''
        if (marked.has(id)) continue
        marked.add(id)
        decorations.push({
          from: property.keyFrom,
          to: property.keyTo,
          kind: 'first-key',
          title: 'the first setting in this scope',
        })
      }
      return decorations
    },
  })
}

/**
 * The key a value is being written for, read from the text before the caret.
 *
 * The parse reads whole lines, and half-way through `wordWrap = tr` the line is
 * not a finished assignment yet — the local reading is correct in the middle of
 * the edit, which is the only moment a completion is ever asked.
 * @param before - the caret's line, up to the caret.
 * @returns the key, or undefined when the caret is not after an equals sign.
 */
function keyAtCaret(before: string): string | undefined {
  const match = /^\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*[^=]*$/.exec(before)
  return match?.[1]
}

/** The context a vocabulary is resolved with, for the one call the demo makes by hand. */
function vocabularyContext(text: string, state: MiniState): VocabularyContext<MiniState> {
  return { text, state }
}

/** A scope name, re-exported so a host styling this grammar can write it once. */
export type MiniScope = Scope
