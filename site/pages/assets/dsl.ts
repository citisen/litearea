// ─── the language the playground's grammar editor is painted with ───────────
//
// A litearea grammar is an object literal, and this is the language of that object: the rule
// kinds, the fields a rule takes, the two definition calls, and the three literal forms that
// carry most of the meaning — a pattern, a string, and a number.
//
// It is a small language and it is deliberately incomplete. A field name is painted as a keyword
// rather than as a property, because in this language the field names ARE the language; and a
// name that is not one of them is left plain, because a grammar author's own identifiers are
// theirs and colouring them would be guessing.

import { defineGrammar } from '@citisen/litearea'

/** The words that are the language rather than the program. */
const WORDS = [
  'defineGrammar',
  'defineVocabulary',
  // the three rule kinds
  'match',
  'words',
  'region',
  // what a rule says
  'kind',
  'scope',
  'pattern',
  'when',
  'unknown',
  'begin',
  'end',
  'nested',
  'transparent',
  'unclosed',
  'phrase',
  'max',
  'firstOnLine',
  'after',
  'notAfter',
  'prevNot',
  'minColumn',
  'maxColumn',
  'unclosedMessage',
  // the grammar's own hooks
  'rules',
  'compose',
  'items',
  'range',
  'analyze',
  'validate',
  'describe',
  'decorate',
  'checks',
  'pairs',
  'comments',
  'fallbackScope',
  'wordChars',
  'initialState',
  'open',
  'close',
  'notIn',
  'line',
  'block',
  'perLine',
  // a completion row
  'label',
  'insert',
  'append',
  'detail',
  'documentation',
  'commitCharacters',
  'sortText',
  'filterText',
  'caretOffset',
  'priority',
  'merge',
  'source',
  // a diagnostic
  'severity',
  'code',
  'message',
  'detail',
  'docs',
  'body',
  'report',
  'state',
  'context',
  'text',
  'token',
  'tokens',
  'caret',
  'word',
  // values worth a colour of their own
  'error',
  'warning',
  'info',
  'hint',
  'true',
  'false',
  'undefined',
  'return',
  'const',
  'let',
  'function',
  'as',
  'readonly',
  'string',
  'number',
  'boolean',
]

export const dslGrammar = defineGrammar({
  id: 'litearea-grammar-source',
  name: 'grammar source',

  comments: { line: '//', block: ['/*', '*/'] },

  rules: [
    { kind: 'match', scope: 'comment', pattern: /\/\/[^\n]*/ },
    { kind: 'match', scope: 'comment', pattern: /\/\*[\s\S]*?\*\// },
    { kind: 'match', scope: 'string', pattern: /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/ },
    // A regular expression literal. The lookahead is what keeps a division and a comment out of
    // it, and a character class is what keeps `/` inside `[...]` from ending the pattern early.
    {
      kind: 'match',
      scope: 'pattern',
      pattern: /\/(?![/*])(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+\/[gimsuy]*/,
    },
    { kind: 'match', scope: 'number', pattern: /\d+(?:\.\d+)?/ },
    {
      kind: 'match',
      scope: 'keyword',
      pattern: new RegExp(`(?:${WORDS.join('|')})`),
      when: { prevNot: '\\w' },
    },
    { kind: 'match', scope: 'property', pattern: /[A-Za-z_$][\w$]*(?=\s*:)/ },
    { kind: 'match', scope: 'name', pattern: /[A-Za-z_$][\w$]*/ },
    { kind: 'match', scope: 'punctuation', pattern: /[{}()[\],;:.]/ },
  ],

  fallbackScope: 'text',

  describe: (context) => {
    const token = context.token
    if (token === undefined) return undefined
    if (token.scope === 'pattern') {
      return { title: 'a pattern', detail: 'sticky by default', body: 'The engine adds the `y` flag, so a pattern never has to be anchored and can never skip ahead.' }
    }
    if (token.scope === 'keyword') {
      return { title: token.text, detail: 'a field of the language' }
    }
    return undefined
  },
})
