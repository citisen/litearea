/**
 * Exercise the BUILT package rather than the working tree.
 *
 * `npm run typecheck` and `npm run test` both read `src/`, so neither of them can
 * notice a build that silently dropped an entry point, produced a declaration file
 * with nothing in it, or failed to write the stylesheet. This is the gate that
 * imports what would actually be installed and asserts it is all there.
 *
 * Usage:
 *   node scripts/verify-package.mjs [path/to/dist]
 *
 * The optional path exists so an INSTALLED copy can be checked, which is the only
 * way to be sure the tarball is complete rather than the checkout.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = process.argv[2] ?? join(root, 'dist')
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

/**
 * Every entry point `package.json` promises, and where its declarations landed.
 *
 * The declarations come from `tsc` rather than from the JavaScript bundler, so they
 * mirror the source tree: the root entry is one file, while `react` and `grammars`
 * are directories with an `index.d.ts` in them. That extra level is the price of not
 * depending on a declaration bundler that predates TypeScript 7, and it is encoded
 * here so a change to the layout cannot pass unnoticed.
 */
const ENTRIES = [
  { name: 'index', declarations: 'types/index.d.ts' },
  { name: 'react', declarations: 'types/react/index.d.ts' },
  { name: 'grammars', declarations: 'types/grammars/index.d.ts' },
  { name: 'styles', declarations: 'types/styles.d.ts' },
]

/** The names the root entry must export. */
const CORE_EXPORTS = [
  'defineGrammar',
  'defineVocabulary',
  'defineCompletion',
  'resolveGrammar',
  'isResolvedGrammar',
  'scan',
  'inspect',
  'complete',
  'applyCompletion',
  'resolveHover',
  'diagnosticHover',
  'buildSegments',
  'fuzzyMatch',
  'rank',
  'highlightSegments',
  'lineAt',
  'lineStarts',
  'wordInfoAt',
  'clamp',
  'LiteArea',
  'createEditor',
  'TextMirror',
  'injectStyles',
  'scopeClass',
  'LITEAREA_STYLES',
  'readSelection',
  'writeSelection',
  'replaceThroughPipeline',
  'undoField',
  'redoField',
  'writeDocument',
  'canEditThroughPipeline',
]

/** The names the grammars entry must export. */
const GRAMMAR_EXPORTS = [
  'dshFontQueryGrammar',
  'dshSentryStyleGrammar',
  'fontWeightWord',
  'fontFaceWeights',
  'quoteFontFamily',
  'FONT_WEIGHT_WORDS',
  'FONT_GENERIC_FAMILIES',
]

/** The names the React entry must export. */
const REACT_EXPORTS = ['LiteAreaEditor']

/** Report a failure the way the rest of the house scripts do. */
function fail(message) {
  console.error(`verify-package: ${message}`)
  process.exit(1)
}

// ── every file the package promises is on disk ──────────────────────────────

for (const entry of ENTRIES) {
  for (const extension of ['js', 'cjs']) {
    const file = join(dist, `${entry.name}.${extension}`)
    if (!existsSync(file)) fail(`${entry.name}.${extension} is missing — run \`npm run build\``)
    if (statSync(file).size === 0) fail(`${entry.name}.${extension} is empty`)
  }
  const declarations = join(dist, entry.declarations)
  if (!existsSync(declarations)) {
    fail(`${entry.declarations} is missing — run \`npm run build\``)
  }
  if (statSync(declarations).size === 0) fail(`${entry.declarations} is empty`)
}

const css = join(dist, 'styles.css')
if (!existsSync(css)) fail('styles.css is missing — run `npm run build`')
const cssText = readFileSync(css, 'utf8')
/** The stylesheet without its comments, since the prose quotes selectors. */
const cssRules = cssText.replace(/\/\*[\s\S]*?\*\//g, '')
// The two classes that make the whole arrangement work. A stylesheet without them
// would ship, install cleanly, and paint nothing.
for (const selector of ['.litearea-input', '.litearea-layer', '.litearea-popup']) {
  if (!cssText.includes(selector)) fail(`styles.css does not define ${selector}`)
}

// ── every scope the stylesheet names is actually painted ───────────────────
//
// The variables and the rules that spend them must agree, and they once did not: twenty-nine
// scope variables were declared with no rule that used one, so the tokenizer painted the right
// classes and every scope rendered in the inherited text colour. The editor had no syntax
// colouring at all, the stylesheet looked complete, and the DOM was correct — which is also why
// a browser check cannot catch it, because a colourless token is an ordinary thing to find.
const declaredScopes = new Set(
  [...cssRules.matchAll(/--litearea-scope-([a-z-]+)\s*:/g)].map((match) => match[1]),
)
const paintedScopes = new Set(
  [...cssRules.matchAll(/\.litearea-scope-([a-z-]+)\s*\{/g)].map((match) => match[1]),
)
if (paintedScopes.size < 15) {
  fail(`styles.css has only ${String(paintedScopes.size)} scope colour rules; the palette is not wired up`)
}
const unpainted = [...declaredScopes].filter((scope) => !paintedScopes.has(scope))
if (unpainted.length > 0) {
  fail(
    `styles.css declares --litearea-scope-* for ${unpainted.join(', ')} with no rule that uses ` +
      'them, so those scopes would paint in the inherited colour',
  )
}
for (const scope of paintedScopes) {
  if (!cssRules.includes(`.litearea-scope-${scope} { color: var(--litearea-scope-${scope}); }`)) {
    fail(`.litearea-scope-${scope} does not spend its own variable`)
  }
}
// A squiggle is only a squiggle if it is drawn by the browser, and only a stylesheet says how.
for (const severity of ['error', 'warning']) {
  if (!new RegExp(`\\.litearea-diag-${severity} \\{[^}]*text-decoration-style: wavy`).test(cssRules)) {
    fail(`.litearea-diag-${severity} does not draw a wavy underline`)
  }
}
if (cssRules.includes('.litearea-paint > span')) {
  fail('.litearea-paint > span would outrank the severity classes and switch every squiggle off')
}

// ── the declarations describe the exports ──────────────────────────────────

const declarations = readFileSync(join(dist, 'types', 'index.d.ts'), 'utf8')
if (declarations.length < 500) {
  fail(`types/index.d.ts looks truncated (${String(declarations.length)} bytes)`)
}

// ── the built modules really export what the declarations claim ────────────

const core = await import(pathToFileURL(join(dist, 'index.js')).href)
const missing = CORE_EXPORTS.filter((name) => core[name] === undefined)
if (missing.length > 0) fail(`index.js does not export: ${missing.join(', ')}`)

const grammars = await import(pathToFileURL(join(dist, 'grammars.js')).href)
const missingGrammars = GRAMMAR_EXPORTS.filter((name) => grammars[name] === undefined)
if (missingGrammars.length > 0) fail(`grammars.js does not export: ${missingGrammars.join(', ')}`)

const react = await import(pathToFileURL(join(dist, 'react.js')).href)
const missingReact = REACT_EXPORTS.filter((name) => react[name] === undefined)
if (missingReact.length > 0) fail(`react.js does not export: ${missingReact.join(', ')}`)

// ── the engine works from the built artifact, not just from source ─────────

const grammar = grammars.dshSentryStyleGrammar()
const inspection = core.inspect('running  circle  blue  turn   3\nbogus circle', grammar)
assert.ok(inspection.tokens.length > 0, 'the built engine produced no tokens')
assert.ok(
  inspection.diagnostics.some((diagnostic) => diagnostic.code === 'vocabulary:state'),
  'the built engine did not report the unknown state',
)
const completion = core.complete(inspection, grammar, {
  text: 'running ',
  caret: 'running '.length,
  trigger: 'explicit',
})
assert.ok(completion !== undefined, 'the built engine offered no completion')
assert.ok(completion.rows.length > 0, 'the built engine offered an empty completion')

const segments = core.buildSegments(inspection.text, inspection)
assert.equal(
  segments.map((segment) => segment.text).join(''),
  inspection.text,
  'the built segmenter did not cover the document exactly',
)

// ── the package metadata points at real files ──────────────────────────────

for (const [key, value] of Object.entries(packageJson.exports ?? {})) {
  if (typeof value === 'string') {
    if (!existsSync(join(root, value))) fail(`exports["${key}"] points at ${value}, which does not exist`)
    continue
  }
  for (const condition of ['types', 'import', 'require']) {
    const target = value[condition]
    if (target === undefined) fail(`exports["${key}"] has no ${condition} condition`)
    if (!existsSync(join(root, target))) {
      fail(`exports["${key}"].${condition} points at ${target}, which does not exist`)
    }
  }
}

// ── the links a reader will click resolve, and will be published ───────────
//
// A README is rendered on the package page by npm, where a relative link only works if the
// file it points at is in the tarball. `docs/grammar.md` was linked from the README and left
// out of `files`, which is a link that resolves in a checkout and 404s for everyone who
// installed the package — the kind of mistake that is invisible until a stranger hits it.

const publishedRoots = new Set((packageJson.files ?? []).map((entry) => entry.split('/')[0]))

for (const readme of ['README.md', 'README.zh.md']) {
  const file = join(root, readme)
  if (!existsSync(file)) continue
  const text = readFileSync(file, 'utf8')
  for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1]
    if (target === undefined) continue
    if (/^(https?:|mailto:|#)/.test(target)) continue
    const [path] = target.split('#')
    if (path === undefined || path === '') continue
    if (!existsSync(join(root, path))) {
      fail(`${readme} links to ${path}, which does not exist`)
    }
    const top = path.split('/')[0] ?? ''
    if (top !== readme && !publishedRoots.has(top)) {
      fail(`${readme} links to ${path}, which \`files\` does not publish — the link would 404 on npm`)
    }
  }
}

console.log(`verify-package: OK — ${String(ENTRIES.length)} entries, ${String(CORE_EXPORTS.length)} core exports`)
console.log('verify-package: the built engine tokenizes, diagnoses, completes, and segments')
console.log('verify-package: every relative README link resolves and is published')
