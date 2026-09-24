// ─── the playground's three languages ───────────────────────────────────────
//
// A preset is SOURCE, not a module, and that is the whole mechanism of the playground: the page
// evaluates it with `new Function` when the reader presses apply, so a grammar can be edited
// live. An import would not survive that trip, which is why these three are written without one
// — the site's own example languages live in `live/grammars/` and are the ones whose pages show
// their source, while these are the ones a reader is invited to break.
//
// Each one is an expression that returns a grammar, and each is paired with a document that
// gives it something to say.

/** One language the bench can be reset to. */
export interface Preset {
  id: string
  name: string
  /** The grammar, as an expression. Evaluated with `defineGrammar` and `defineVocabulary` in scope. */
  source: string
  /** A document written in it. */
  document: string
}

export const PRESETS: readonly Preset[] = [
  {
    id: 'palette',
    name: 'palette',
    source: `defineGrammar({
  id: 'palette',

  rules: [
    { kind: 'match', scope: 'comment', pattern: /#[^\\n]*/ },
    { kind: 'match', scope: 'number', pattern: /\\d+/ },
    {
      kind: 'words',
      words: ['red', 'amber', 'teal', 'mauve'],
      scope: 'colour',
      when: { firstOnLine: true },
      unknown: { message: '"{word}" is not a colour — expected {allowed}.' },
    },
    { kind: 'match', scope: 'name', pattern: /[a-z][\\w-]*/ },
    { kind: 'match', scope: 'invalid', pattern: /\\S+/ },
  ],

  fallbackScope: 'text',

  compose: [
    {
      id: 'colour',
      when: (context) => context.firstWord,
      range: (context) => context.word,
      items: () =>
        ['red', 'amber', 'teal', 'mauve'].map((label) => ({
          label,
          append: ' ',
          kind: 'colour',
        })),
    },
  ],
})`,
    document: ['# a palette', 'red circle 20', 'mauve square 40', 'teal blob 12', ''].join('\n'),
  },
  {
    id: 'conf',
    name: 'conf',
    source: `defineGrammar({
  id: 'conf',
  wordChars: /[\\w.-]/,

  rules: [
    { kind: 'match', scope: 'comment', pattern: /#[^\\n]*/ },
    { kind: 'region', scope: 'block', begin: /\\{/, end: /\\}/, nested: true, unclosed: { severity: 'error' } },
    {
      kind: 'words',
      words: ['image', 'replicas', 'port', 'health'],
      scope: 'key',
      when: { firstOnLine: true },
      unknown: {},
    },
    { kind: 'match', scope: 'value', pattern: /[^\\s{}]+/ },
  ],

  fallbackScope: 'text',
  comments: { line: '#' },

  checks: [
    {
      code: 'key-case',
      severity: 'warning',
      scopes: ['key'],
      except: /^[a-z][\\w.-]*$/,
      message: '"{word}" is not a key — lower case, digits, dots, and hyphens.',
    },
  ],

  describe: (context) =>
    context.token === undefined
      ? undefined
      : { title: context.token.text, detail: context.token.scope },
})`,
    document: [
      '# a deployment',
      'service api {',
      '  image "ghcr.io/citisen/api:1.4"',
      '  Replicas 3',
      '  port 8080',
      '  health /healthz',
      '}',
      '',
    ].join('\n'),
  },
  {
    id: 'data',
    name: 'data',
    source: `defineGrammar({
  id: 'data',

  rules: [
    { kind: 'match', scope: 'comment', pattern: /#[^\\n]*/ },
    { kind: 'match', scope: 'string', pattern: /"(?:[^"\\\\]|\\\\.)*"/ },
    { kind: 'match', scope: 'number', pattern: /-?\\d+(?:\\.\\d+)?/ },
    { kind: 'match', scope: 'keyword', pattern: /true|false|null/, when: { prevNot: '\\\\w' } },
    { kind: 'match', scope: 'name', pattern: /[A-Za-z_][\\w-]*/ },
    { kind: 'match', scope: 'punctuation', pattern: /[{}()\\[\\],:]/ },
  ],

  // Typing one of these writes the closer and leaves the caret between the two.
  pairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"', notIn: ['string', 'comment'] },
  ],

  // Ctrl+/ toggles the marker on every line the selection touches.
  comments: { line: '#', block: ['/*', '*/'] },

  fallbackScope: 'text',
})`,
    document: [
      '{',
      '  name: "workbench",',
      '  size: 12,',
      '  # one edit, one undo',
      '  tags: [alpha, beta]',
      '}',
      '',
    ].join('\n'),
  },
]
