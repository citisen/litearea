// ─── the page set ───────────────────────────────────────────────────────────
//
// One record per page, in the order the site is read. `sources` are concatenated and rendered as
// one document, which is what lets a page be assembled from one of the repository's own reference
// files next to prose written for the site.
//
// `out` is relative to the Vite root (`site/pages`) and `url` is where the page lands. The two are
// separate fields because a url ends in `/` and a file does not, and every relative link is
// computed from the output path.
//
// `nav` is which masthead entry the page belongs to, written out rather than inferred from the
// url: `/docs/grammar/` starts with `/docs/`, so a prefix match would light up the documentation
// index while the reader is four pages deep in it.

/** @typedef {{ url: string, out: string, kind: string, title: string, nav?: string, description: string, sources: string[], specimen?: { id: string, label?: string, controls?: string[] }, rail?: boolean, headTitle?: string }} PageRecord */

/** @type {readonly PageRecord[]} */
export const PAGES = [
  {
    url: '/',
    out: 'index.html',
    kind: 'home',
    title: 'litearea',
    headTitle: 'litearea — a code editor over a plain textarea',
    description:
      'A code editor over a plain textarea: undo that works, highlighting from rules you write, and VSCode-shaped completion. No runtime dependencies, and no grammar shipped.',
    sources: ['content/home.md'],
    specimen: { id: 'swatch', label: 'swatch' },
    rail: false,
  },
  {
    url: '/docs/',
    out: 'docs/index.html',
    kind: 'doc',
    title: 'Documentation',
    nav: '/docs/',
    description:
      'Every page of the litearea documentation: the grammar reference, completion, theming, options, key bindings, the published API, architecture, and the limits.',
    sources: ['content/docs.md'],
    specimen: { id: 'swatch-overview', label: 'swatch' },
  },
  {
    url: '/docs/grammar/',
    out: 'docs/grammar/index.html',
    kind: 'doc',
    title: 'Grammar',
    nav: '/docs/',
    description:
      'The grammar reference: match, words, and region rules, precedence, vocabularies, diagnostics, decorations, hover, and a worked walkthrough.',
    sources: ['../docs/grammar.md'],
  },
  {
    url: '/docs/completion/',
    out: 'docs/completion/index.html',
    kind: 'doc',
    title: 'Completion',
    nav: '/docs/',
    description:
      'The completion reference: how the list opens, what a source is asked for, how rows are ranked, and what accepting a row does to the document.',
    sources: ['../docs/completion.md'],
  },
  {
    url: '/docs/architecture/',
    out: 'docs/architecture/index.html',
    kind: 'doc',
    title: 'Architecture',
    nav: '/docs/',
    description:
      'Why litearea is built this way: the one-parse rule, the uncontrolled textarea, layer alignment, the measuring mirror, and what was rejected.',
    sources: ['../docs/architecture.md'],
  },
  {
    url: '/docs/theming/',
    out: 'docs/theming/index.html',
    kind: 'doc',
    title: 'Theming',
    nav: '/docs/',
    description:
      'How to change how the editor looks: every custom property, the variables option, two editors with two faces, and what may not change without breaking alignment.',
    sources: ['content/theming.md'],
    specimen: { id: 'swatch-themed', label: 'one grammar, two themes' },
  },
  {
    url: '/docs/options/',
    out: 'docs/options/index.html',
    kind: 'doc',
    title: 'Options and methods',
    nav: '/docs/',
    description: 'Every option litearea takes, with its default, and every method the editor offers after it is mounted.',
    sources: ['content/options.md'],
  },
  {
    url: '/docs/keys/',
    out: 'docs/keys/index.html',
    kind: 'doc',
    title: 'Keys and commands',
    nav: '/docs/',
    description: 'The keymap as data: every command, every default binding, how to move or remove one, and what the editor deliberately leaves to the browser.',
    sources: ['content/keys.md'],
  },
  {
    url: '/docs/api/',
    out: 'docs/api/index.html',
    kind: 'doc',
    title: 'API',
    nav: '/docs/',
    description: 'The published surface of @citisen/litearea: the editor, the engine, the React binding, and every export of each entry point.',
    sources: ['content/api.md'],
  },
  {
    url: '/docs/limits/',
    out: 'docs/limits/index.html',
    kind: 'doc',
    title: 'Limits',
    nav: '/docs/',
    description: 'What litearea does not do, what it cannot do, and the two or three places where the platform decides for it.',
    sources: ['content/limits.md'],
  },
  {
    url: '/examples/',
    out: 'examples/index.html',
    kind: 'doc',
    title: 'Examples',
    nav: '/examples/',
    description:
      'Six worked languages for litearea — a swatch palette, a form schema, a config format, sticky blocks, typing aids, and completion — each one live on its own page.',
    sources: ['content/examples.md'],
    rail: false,
  },
  {
    url: '/examples/swatch/',
    out: 'examples/swatch/index.html',
    kind: 'example',
    title: 'Swatch',
    nav: '/examples/',
    description: 'A palette language whose word set comes from the host rather than from the file, so the same document means something else on another machine.',
    sources: ['content/example-swatch.md'],
    specimen: { id: 'swatch', label: 'swatch', controls: ['reset'] },
  },
  {
    url: '/examples/form-schema/',
    out: 'examples/form-schema/index.html',
    kind: 'example',
    title: 'Form schema',
    nav: '/examples/',
    description: 'A form schema with typed rows, a note region, a declarative check, and an analysis the completion reads.',
    sources: ['content/example-form-schema.md'],
    specimen: { id: 'form-schema', label: 'form schema', controls: ['reset'] },
  },
  {
    url: '/examples/mini-conf/',
    out: 'examples/mini-conf/index.html',
    kind: 'example',
    title: 'Mini conf',
    nav: '/examples/',
    description: 'A key/value configuration language: a nesting region, rules placed by position, a check, commit characters, and per-word hover documentation.',
    sources: ['content/example-mini-conf.md'],
    specimen: { id: 'mini-conf', label: 'mini conf', controls: ['reset'] },
  },
  {
    url: '/examples/sticky/',
    out: 'examples/sticky/index.html',
    kind: 'example',
    title: 'Sticky headers',
    nav: '/examples/',
    description: 'Blocks that nest, with the header of the block the reader is inside pinned to the top of the box — one row per level.',
    sources: ['content/example-sticky.md'],
    specimen: { id: 'sticky', label: 'plan' },
  },
  {
    url: '/examples/typing-aids/',
    out: 'examples/typing-aids/index.html',
    kind: 'example',
    title: 'Typing aids',
    nav: '/examples/',
    description: 'Pairs that close themselves, a selection that wraps, an indented block on Enter, and a comment toggle — each one a single undoable edit.',
    sources: ['content/example-typing-aids.md'],
    specimen: { id: 'typing-aids', label: 'data' },
  },
  {
    url: '/examples/completion/',
    out: 'examples/completion/index.html',
    kind: 'example',
    title: 'Completion',
    nav: '/examples/',
    description: 'Four families, tiered ranking, a documentation panel, commit characters, and the inline preview that draws the rest of the row at the caret.',
    sources: ['content/example-completion.md'],
    specimen: { id: 'completion', label: 'font stack', controls: ['inline', 'reset'] },
  },
  {
    url: '/playground/',
    out: 'playground/index.html',
    kind: 'playground',
    title: 'Playground',
    nav: '/playground/',
    description:
      'Write a litearea grammar and a document in two live editors, and watch the tokens, problems, decorations, and completion rows the engine reports for every keystroke.',
    sources: ['content/playground.md'],
    rail: false,
  },
  {
    url: '/404.html',
    out: '404.html',
    kind: 'doc',
    title: 'Not here',
    description: 'That page is not on this site.',
    sources: ['content/404.md'],
    rail: false,
  },
]
