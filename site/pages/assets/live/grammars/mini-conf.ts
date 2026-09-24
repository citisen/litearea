// ─── mini conf: a key/value language with a nesting region ──────────────────
//
//     # a deployment
//     service api {
//       image "ghcr.io/citisen/api:1.4"
//       replicas 3
//       port 8080
//       health /healthz
//     }
//
// A config format, written to show the three things a rule list can say about position: a key
// is a word at the head of a line, a value is whatever follows it, and a brace opens a block
// that may contain another one. The host table behind the keys is also what makes the
// completion able to say what a KEY's values are, which is the part a word list cannot do.

import type { Diagnostic, HoverInfo } from '@citisen/litearea'
import { defineGrammar, defineVocabulary } from '@citisen/litearea'

/** A key, and the values it will accept, in the order a host wants them offered. */
export const CONF_KEYS: readonly { key: string; detail: string; body: string; values: readonly string[] }[] = [
  { key: 'image', detail: 'a container image', body: 'A reference, quoted when it carries a tag.', values: [] },
  { key: 'replicas', detail: 'how many copies to run', body: 'A whole number. Zero takes the service down.', values: ['1', '2', '3', '5', '8'] },
  { key: 'port', detail: 'the port inside the container', body: 'Where the process listens.', values: ['3000', '8080', '9000'] },
  { key: 'health', detail: 'the liveness path', body: 'Asked every ten seconds; a failure restarts the container.', values: ['/healthz', '/ready', '/'] },
  { key: 'memory', detail: 'the memory ceiling', body: 'A number and a unit.', values: ['256Mi', '512Mi', '1Gi', '2Gi'] },
]

const KEYS = defineVocabulary({
  id: 'conf-key',
  words: CONF_KEYS.map((entry) => entry.key),
  scope: 'key',
  unknownMessage: '"{word}" is not a key — expected {allowed}.',
  unknownCode: 'unknown-key',
  docs: Object.fromEntries(CONF_KEYS.map((entry) => [entry.key, { detail: entry.detail, body: entry.body }])),
})

/** One line the walk understood. */
export interface Setting {
  key: string
  value: string
  line: number
  /** Where the key is, so a complaint about it can point at it rather than at the file. */
  at: { from: number; to: number }
}

/** What one pass over the document produced. */
export interface ConfState {
  settings: Setting[]
}

export const miniConfGrammar = defineGrammar<ConfState>({
  id: 'mini-conf',
  name: 'mini conf',

  // A key may be written with a dot in it (`cache.ttl`), so the word is not split at the dot and
  // a completion replaces the whole path.
  wordChars: /[A-Za-z0-9_.-]/,

  rules: [
    { kind: 'match', scope: 'comment', pattern: /#[^\n]*/ },
    { kind: 'match', scope: 'keyword', pattern: /service/, when: { prevNot: '\\w' } },
    { kind: 'match', scope: 'string', pattern: /"(?:[^"\\]|\\.)*"/ },
    { kind: 'match', scope: 'number', pattern: /\d+(?:\.\d+)?/ },
    // A block. `nested` lets a block open inside a block, and the contents stay opaque to the
    // outer one, which is what makes the depth of the document a fact the scanner knows.
    {
      kind: 'region',
      scope: 'block',
      begin: /\{/,
      end: /\}/,
      nested: true,
      unclosed: { severity: 'error' },
    },
    // A key is a word at the head of a line. One the table does not know is reported rather
    // than quietly painted as an ordinary word.
    { kind: 'words', words: KEYS, when: { firstOnLine: true }, unknown: {} },
    // Anything else that is not whitespace or a brace is a value.
    { kind: 'match', scope: 'value', pattern: /[^\s{}]+/ },
  ],

  fallbackScope: 'text',

  comments: { line: '#' },

  analyze: (text) => {
    const settings: Setting[] = []
    let offset = 0
    for (const [index, raw] of text.split('\n').entries()) {
      const lineFrom = offset
      offset += raw.length + 1
      const match = /^\s*([\w.-]+)\s+(.+?)\s*$/.exec(raw)
      if (match === null) continue
      const [, key, value] = match
      if (key === undefined || value === undefined) continue
      const from = lineFrom + raw.indexOf(key)
      settings.push({
        key,
        value: value.replace(/^"|"$/g, ''),
        line: index,
        at: { from, to: from + key.length },
      })
    }
    return { settings }
  },

  // A value that is quoted is not checked, and neither is an empty one: this check is about
  // the shape of an unquoted value and nothing else.
  checks: [
    {
      code: 'value-style',
      severity: 'warning',
      scopes: ['key'],
      except: /^[a-z][a-z0-9.-]*$/,
      message: '"{word}" is not a key — lower case, digits, dots, and hyphens.',
    },
  ],

  validate: (context) => {
    const seen = new Set<string>()
    for (const setting of context.state.settings) {
      if (seen.has(setting.key)) {
        context.report({
          from: setting.at.from,
          to: setting.at.to,
          severity: 'info',
          code: 'repeated-key',
          message: `"${setting.key}" is set more than once; the last one wins.`,
        })
      }
      seen.add(setting.key)
    }
  },

  describe: (context) => {
    const token = context.token
    if (token === undefined || token.scope !== 'key') return undefined
    const entry = KEYS.entryFor(token.text)
    if (entry === undefined) return undefined
    const info: HoverInfo = { title: token.text }
    if (entry.detail !== undefined) info.detail = entry.detail
    if (entry.body !== undefined) info.body = entry.body
    return info
  },

  compose: [
    {
      id: 'key',
      when: (context) => context.firstWord,
      range: (context) => context.word,
      items: (context) => {
        const used = new Set(context.state.settings.map((setting) => setting.key))
        return CONF_KEYS.map((entry) => ({
          label: entry.key,
          // A space is written after the key and ACCEPTS the row, so the value can be typed
          // without leaving the keyboard. That is what a commit character is for.
          append: ' ',
          commitCharacters: ' ',
          kind: 'key',
          detail: used.has(entry.key) ? 'set already' : entry.detail,
          documentation: entry.body,
          sortText: used.has(entry.key) ? '1' : '0',
        }))
      },
    },
    {
      id: 'value',
      // A value follows a key, and it is the KEY that decides which values are worth offering.
      when: (context) => {
        const line = context.line.number
        const key = context.tokens.find((token) => token.line === line && token.scope === 'key')
        return key !== undefined && key.to <= context.caret && !context.firstWord
      },
      range: (context) => context.word,
      items: (context) => {
        const key = context.tokens.find((token) => token.line === context.line.number && token.scope === 'key')
        const entry = CONF_KEYS.find((candidate) => candidate.key === key?.text)
        if (entry === undefined) return []
        return entry.values.map((value) => ({ label: value, kind: 'value', detail: `a ${entry.key} value` }))
      },
    },
  ],
})

/** A problem the language reports, re-exported for a page that wants the type. */
export type ConfProblem = Diagnostic
