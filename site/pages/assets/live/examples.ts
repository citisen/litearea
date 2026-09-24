// ─── the six examples, mounted ──────────────────────────────────────────────
//
// Site plumbing, and deliberately not shown on any page: what a page shows is the LANGUAGE, in
// `live/grammars/`, and this file is the twenty lines per example that put it in a box, choose a
// document for it, and report what the editor says about it.
//
// Every readout here is fed by a real callback from the editor — `onDiagnostics`, `onCompletion`,
// `onChange` — rather than by a second parse of the text. A page that recomputed the problems in
// order to display them would be the exact drift the library exists to remove, and it would be
// embarrassing to ship on its documentation site.

import type { Completion, Diagnostic, LiteArea } from '@citisen/litearea'
import { createEditor } from '@citisen/litearea'
import { aidsGrammar } from './grammars/aids.js'
import { familiesGrammar } from './grammars/families.js'
import { formSchemaGrammar } from './grammars/form-schema.js'
import { miniConfGrammar } from './grammars/mini-conf.js'
import { planGrammar } from './grammars/plan.js'
import { swatchGrammar } from './grammars/swatch.js'
import { escapeHtml, lines, plural, type LiveHost } from './kit.js'

/** The colours the site's own swatch documents are read against. */
const PALETTE = ['red', 'amber', 'teal', 'mauve', 'bone', 'ink']

const SWATCH_DOC = lines(
  '# a palette, a shape, and a size',
  'red circle 20',
  'teal square 40',
  'bone rounded 12',
  '',
)

const SCHEMA_DOC = lines(
  '# the signup form',
  'form signup',
  '  text    email     required',
  '  text    password  secret   "at least 12 characters"',
  '  number  age       optional',
  '  choice  plan      required  [free, pro]',
  '',
)

const CONF_DOC = lines(
  '# a deployment',
  'service api {',
  '  image "ghcr.io/citisen/api:1.4"',
  '  replicas 3',
  '  port 8080',
  '  health /healthz',
  '}',
  '',
)

const PLAN_DOC = lines(
  '# a plan, long enough that the box has to scroll',
  'group alpha',
  '  step one 10',
  '  step two 20',
  '  step three 30',
  '  step four 40',
  'group beta',
  '  step wire 1',
  '  step solder 2',
  '  step test 3',
  '  step ship 4',
  'group gamma',
  '  step sketch 7',
  '  step carve 8',
  '  step sand 9',
  '  step oil 10',
)

const AIDS_DOC = lines(
  '{',
  '  name: "workbench",',
  '  size: 12,',
  '  # ctrl+/ toggles these markers',
  '  tags: [alpha, beta]',
  '}',
  '',
)

const STACK_DOC = 'font: Inter, Iosevka\n'

/**
 * The problem list, in one line.
 *
 * The first problem is spelled out and the rest are counted, because a readout is small print
 * under a box rather than a second copy of the editor's own diagnostics panel.
 *
 * @param diagnostics - what the editor reported.
 * @returns HTML, already escaped.
 */
function problems(diagnostics: readonly Diagnostic[]): string {
  if (diagnostics.length === 0) return '<b>no problems</b>'
  const [first] = diagnostics
  if (first === undefined) return '<b>no problems</b>'
  const more = diagnostics.length > 1 ? ` and ${diagnostics.length - 1} more` : ''
  return `<b>${escapeHtml(first.code ?? 'problem')}</b> · ${escapeHtml(first.message)}${more}`
}

/** What the completion list is showing, in one line. */
function completionLine(completion: Completion | undefined): string {
  if (completion === undefined) return '<b>list closed</b>'
  const [top] = completion.rows
  const rows = plural(completion.rows.length, 'row')
  if (top === undefined) return `<b>${rows}</b> · nothing matches`
  const needle = completion.needle === '' ? 'no needle' : `needle “${escapeHtml(completion.needle)}”`
  return `<b>${escapeHtml(top.item.label)}</b> · ${rows} · ${needle}`
}

/** 01 · swatch, which is also the front page's language. */
export function swatchExample(host: LiveHost, document = SWATCH_DOC, palette = PALETTE): void {
  const editor = createEditor(host.body, {
    grammar: swatchGrammar({ palette, base: 'red' }),
    value: document,
    sizing: { minRows: 4, maxRows: 16 },
    hover: { enabled: true, delay: 120 },
    // Every editor on the site is a real form control, so every one of them has a name. It is the
    // only thing a screen reader can announce about a box whose visual label is a bar above it.
    ariaLabel: 'A swatch document',
    onDiagnostics: (diagnostics) => host.readout(problems(diagnostics)),
  })
  host.button('reset', 'reset', () => {
    editor.setValue(document, true)
    editor.focus()
  })
}

/** 02 · the form schema, with its check and its walk both reporting. */
export function formSchemaExample(host: LiveHost): void {
  const editor = createEditor(host.body, {
    grammar: formSchemaGrammar,
    value: SCHEMA_DOC,
    sizing: { minRows: 6, maxRows: 20 },
    hover: { enabled: true, delay: 120 },
    ariaLabel: 'A form schema document',
    onDiagnostics: (diagnostics) => host.readout(problems(diagnostics)),
  })
  host.button('reset', 'reset', () => {
    editor.setValue(SCHEMA_DOC, true)
    editor.focus()
  })
}

/** 03 · mini conf, where a key's completion knows which values that key accepts. */
export function miniConfExample(host: LiveHost): void {
  const editor = createEditor(host.body, {
    grammar: miniConfGrammar,
    value: CONF_DOC,
    sizing: { minRows: 8, maxRows: 24 },
    hover: { enabled: true, delay: 120 },
    ariaLabel: 'A deployment configuration',
    onDiagnostics: (diagnostics) => host.readout(problems(diagnostics)),
  })
  host.button('reset', 'reset', () => {
    editor.setValue(CONF_DOC, true)
    editor.focus()
  })
}

/** 04 · sticky block headers, which need a box shorter than its document. */
export function stickyExample(host: LiveHost): void {
  const editor = createEditor(host.body, {
    grammar: planGrammar,
    value: PLAN_DOC,
    sizing: { minRows: 8, maxRows: 8 },
    completion: false,
    sticky: { kinds: ['block'] },
    ariaLabel: 'A plan, with blocks that nest',
  })
  host.readout('the box is eight rows; the document is nineteen')
  // Scrolled past the comment and into the first group, so the pinned row is on screen when the
  // page loads rather than after the reader works out that this box scrolls. It waits a frame
  // because the box's height is written by the editor's FIRST measurement, which happens after
  // construction: scrolling before that is scrolling an element that is still its placeholder
  // height, and the browser puts the offset back when the real height arrives.
  requestAnimationFrame(() => {
    editor.input.scrollTop = 44
  })
}

/** 05 · the typing aids, where every edit the editor makes is one undoable edit. */
export function typingAidsExample(host: LiveHost): void {
  const count = (text: string): string => `${plural(text.split('\n').length, 'line')} · one Ctrl+Z per edit`
  createEditor(host.body, {
    grammar: aidsGrammar,
    value: AIDS_DOC,
    sizing: { minRows: 6, maxRows: 20 },
    indent: { unit: 2 },
    ariaLabel: 'A data document',
    onChange: (text) => host.readout(count(text)),
    // Tab is deliberately NOT bound: it is how a reader leaves a form, and an editor that takes
    // it turns every field into a keyboard trap. Two lines give it back:
    //
    //     { key: 'Tab', command: 'indent' },
    //     { key: 'Shift+Tab', command: 'outdent' },
    keys: [
      { key: 'Mod+]', command: 'indentLines' },
      { key: 'Mod+[', command: 'outdentLines' },
    ],
  })
  host.readout(count(AIDS_DOC))
}

/** 06 · the completion list, its ranking, and the inline preview. */
export function completionExample(host: LiveHost): void {
  let editor: LiteArea | undefined

  const mount = (inline: boolean): void => {
    editor?.destroy()
    editor = createEditor(host.body, {
      grammar: familiesGrammar,
      value: STACK_DOC,
      sizing: { minRows: 3, maxRows: 12 },
      hover: { enabled: true, delay: 120 },
      completion: { inline },
      ariaLabel: 'A font stack',
      onCompletion: (completion) => host.readout(completionLine(completion)),
    })
    editor.focus()
    editor.setSelection(editor.value.length)
    editor.showCompletions()
  }

  mount(true)

  // The option is read when the editor mounts, so the switch remounts it — and the page says so,
  // because that is a real property of the options and not a quirk of this button.
  host.toggle('inline', 'inline preview', true, (on) => mount(on))
  host.button('reset', 'reset', () => {
    editor?.setValue(STACK_DOC, true)
    editor?.focus()
  })
}

/** What the front page and the documentation index pin beside their prose. */
export function overviewExample(host: LiveHost): void {
  swatchExample(
    host,
    lines('red circle 20', 'mauve square 40', 'teal blob 12', ''),
    ['red', 'amber', 'teal', 'indigo'],
  )
}

/**
 * The theming page: one grammar, two editors, two faces.
 *
 * The point is the thing `variables` exists for and a stylesheet cannot do — two editors on one
 * page with different faces — so the specimen is two mounts rather than one, and the second one is
 * a proportional serif with a different accent, which is also the honest answer to "does the
 * highlight still line up": it does, because the layer, the field, and the mirror all read the
 * same computed font.
 */
export function themedExample(host: LiveHost): void {
  const pair = document.createElement('div')
  pair.className = 'live-pair'
  host.body.append(pair)

  const plain = document.createElement('div')
  const styled = document.createElement('div')
  pair.append(plain, styled)

  const text = lines('red circle 20', 'teal square 40', '')

  createEditor(plain, {
    grammar: swatchGrammar({ palette: PALETTE, base: 'red' }),
    value: text,
    sizing: { minRows: 2, maxRows: 8 },
    completion: false,
    ariaLabel: 'A swatch document, default theme',
  })

  createEditor(styled, {
    grammar: swatchGrammar({ palette: PALETTE, base: 'red' }),
    value: text,
    sizing: { minRows: 2, maxRows: 8 },
    completion: false,
    ariaLabel: 'A swatch document, custom theme',
    variables: {
      font: 'Georgia, "Times New Roman", serif',
      'font-size': '16px',
      'line-height': '26px',
      'padding-block': '10px',
      'padding-inline': '14px',
      radius: '10px',
      // The theme is complete on purpose: a host that sets three properties inherits the rest from
      // the stylesheet — which is the behaviour worth knowing — but a specimen set in the site's own
      // ink-mode colours on a cream ground would be a demonstration of nothing.
      '--litearea-fg': '#2b2318',
      '--litearea-fg-dim': '#8a7f6b',
      '--litearea-bg': '#fdfbf5',
      '--litearea-bg-raised': '#fdfbf5',
      '--litearea-border': '#ded3bd',
      '--litearea-border-focus': '#1d4ed8',
      'scope-swatch-color': '#7c2d12',
      'scope-swatch-shape': '#1d4ed8',
      accent: '#1d4ed8',
    },
  })

  host.readout('the one below is themed entirely through <b>variables</b>')
}
