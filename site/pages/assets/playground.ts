// ─── the playground: two editors and one instrument ─────────────────────────
//
// Three panes. The left one is a document in some language. The right one is the LANGUAGE, as
// source, and it is a litearea editor too — painted by the grammar in `dsl.ts`, which is a
// litearea grammar written for litearea grammars. Under them, what the engine says about the
// document right now: the tokens, the problems, the decorations, the completion rows, and the
// analysis `analyze` returned.
//
// The grammar is applied by EVALUATING its source with `new Function`, which is why the presets
// in `presets.ts` carry no imports. That is a decision rather than a shortcut: a playground that
// could only switch between three fixed languages would not be a playground. A source that does
// not evaluate is reported in place and the last working language stays in force, because a
// syntax error is the most likely thing to happen here and it must not take the page with it.
//
// The document editor is handed a LIVE VIEW of the grammar rather than the grammar itself — the
// same trick the React binding uses — so a new language is picked up by `refresh()` without the
// editor being rebuilt, and the reader's undo history survives applying one.

import {
  createEditor,
  defineGrammar,
  defineVocabulary,
  inspect,
  type Completion,
  type Grammar,
  type LiteArea,
} from '@citisen/litearea'
import { dslGrammar } from './dsl.js'
import { escapeHtml, plural } from './live/kit.js'
import { PRESETS, type Preset } from './presets.js'

/** What the bench keeps between keystrokes. */
interface Bench {
  /** The grammar in force, behind the live view the document editor holds. */
  holder: { current: Grammar }
  doc: LiteArea
  source: LiteArea
  read: HTMLElement
  error: HTMLElement
  counts: HTMLElement
}

/** One element, with a class and text, in one call. */
function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className !== undefined) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/**
 * A view of an object that always reads the newest value.
 * @param holder - the box holding the current grammar.
 * @returns the live view the editor is constructed with.
 */
function liveGrammar(holder: { current: Grammar }): Grammar {
  return new Proxy({} as Grammar, {
    get: (_target, key) => Reflect.get(holder.current as object, key),
    has: (_target, key) => Reflect.has(holder.current as object, key),
    ownKeys: () => Reflect.ownKeys(holder.current as object),
    getOwnPropertyDescriptor: (_target, key) => Reflect.getOwnPropertyDescriptor(holder.current as object, key),
  }) as Grammar
}

/**
 * Evaluate a grammar's source.
 *
 * The two definitions are handed in as PARAMETERS rather than left in scope, so a source has no
 * way to reach anything else on the page. That is as close as a browser gets to sandboxing an
 * `eval`, and it is why a preset is written as one expression rather than as a module.
 *
 * @param source - the source, as an expression that returns a grammar.
 * @returns the grammar it produced.
 */
function evaluate(source: string): Grammar {
  const factory = new Function('defineGrammar', 'defineVocabulary', `"use strict"; return (${source})`)
  return factory(defineGrammar, defineVocabulary) as Grammar
}

/** One row of the readout: a fixed-width tag and the value beside it. */
function row(tag: string, value: string, className = ''): string {
  const shown = value.length > 110 ? `${value.slice(0, 110)}…` : value
  return `<span class="tag">${escapeHtml(tag)}</span><span class="value ${className}">${escapeHtml(shown)}</span>`
}

/** One section of the readout: a heading, then the rows, or a sentence saying there are none. */
function section(title: string, rows: readonly string[], empty: string): HTMLElement {
  const box = element('div')
  box.append(element('h4', undefined, title))
  if (rows.length === 0) {
    box.append(element('p', 'empty', empty))
    return box
  }
  const list = element('ol')
  for (const html of rows) {
    const item = element('li')
    // The rows are built rather than parsed: `row` escapes both halves, so a document that
    // contains markup is shown as markup.
    item.innerHTML = html
    list.append(item)
  }
  box.append(list)
  return box
}

/**
 * Read the document through the engine itself.
 *
 * The bench does not ask the editor what it thinks. It calls `inspect` on the same text with the
 * same grammar and shows what comes back — which is the same call the editor makes, and the
 * point of the instrument: it shows the engine rather than a second opinion about it.
 *
 * @param bench - the bench.
 * @param completion - the list the editor last reported, if any.
 */
function render(bench: Bench, completion?: Completion): void {
  let inspection: ReturnType<typeof inspect>
  try {
    inspection = inspect(bench.doc.value, bench.holder.current)
  } catch (error) {
    bench.read.replaceChildren(section('the engine refused this document', [row('error', String(error))], 'none'))
    return
  }

  const tokens = inspection.tokens
    .filter((token) => token.text.trim() !== '')
    .map((token) => row(token.scope, token.text.replace(/\n/g, '⏎')))

  const problems = inspection.diagnostics.map((diagnostic) =>
    row(diagnostic.code ?? 'problem', diagnostic.message, `severity-${diagnostic.severity}`),
  )

  const marks = inspection.decorations.map((decoration) =>
    row(decoration.kind, inspection.text.slice(decoration.from, decoration.to).replace(/\n/g, '⏎')),
  )

  const rows = (completion?.rows ?? [])
    .slice(0, 12)
    .map((entry) =>
      row(entry.item.kind ?? 'row', entry.item.detail === undefined ? entry.item.label : `${entry.item.label} — ${entry.item.detail}`),
    )

  const state = inspection.state === undefined ? [] : [row('state', JSON.stringify(inspection.state) ?? 'undefined')]

  bench.counts.textContent = `${plural(tokens.length, 'token')} · ${plural(problems.length, 'problem')} · ${plural(marks.length, 'decoration')}`
  bench.read.replaceChildren(
    section('tokens', tokens.slice(0, 40), 'the document is empty'),
    section('problems', problems, 'none'),
    section('decorations', marks, 'none'),
    section('completion rows', rows, completion === undefined ? 'the list is closed' : 'nothing matches'),
    section('analysis', state, 'the grammar has no analyze'),
  )
}

/** Say why a grammar would not apply, in the pane it came from. */
function fail(bench: Bench, error: unknown): void {
  bench.error.hidden = false
  bench.error.textContent = error instanceof Error ? error.message : String(error)
}

/** One pane: a bar with a title and its controls, and a well under it. */
function pane(title: string, controls: readonly HTMLElement[]): { pane: HTMLElement; body: HTMLElement } {
  const box = element('div', 'bench-pane')
  const bar = element('p', 'bench-bar')
  bar.append(element('strong', undefined, title))
  const group = element('span', 'bench-controls')
  group.append(...controls)
  bar.append(group)
  const body = element('div')
  box.append(bar, body)
  return { pane: box, body }
}

/** Build the bench and mount both editors. */
function build(host: HTMLElement): void {
  const first = PRESETS[0]
  if (first === undefined) return

  let preset: Preset = first
  let grammar: Grammar
  try {
    grammar = evaluate(first.source)
  } catch (error) {
    // A preset is the site's own, generated from this repository, so a failure here is a mistake
    // in the site and not in the reader's input — and the page still may not go down with it. An
    // empty grammar paints plain text, which is a bench with nothing in it rather than no bench.
    grammar = { id: 'empty', rules: [] }
    console.error('playground: the shipped preset does not evaluate', error)
  }

  const bench: Bench = {
    holder: { current: grammar },
    doc: undefined as unknown as LiteArea,
    source: undefined as unknown as LiteArea,
    read: element('div', 'bench-read'),
    error: element('p', 'bench-error'),
    counts: element('span'),
  }
  bench.error.hidden = true

  // ── the controls ──────────────────────────────────────────────────────────
  const select = element('select')
  select.setAttribute('aria-label', 'Preset language')
  for (const candidate of PRESETS) {
    const option = element('option', undefined, candidate.name)
    option.value = candidate.id
    select.append(option)
  }
  const apply = element('button', undefined, 'apply')
  apply.type = 'button'
  const reset = element('button', undefined, 'reset document')
  reset.type = 'button'

  // ── the panes ─────────────────────────────────────────────────────────────
  const sourcePane = pane('the grammar', [select, apply])
  const docPane = pane('the document', [reset])
  const readPane = pane('the engine says', [bench.counts])

  sourcePane.pane.append(bench.error)
  readPane.body.append(bench.read)
  host.append(docPane.pane, sourcePane.pane, readPane.pane)

  // The grammar editor first: it is the language, and the document editor below is built with a
  // view of whatever it currently says.
  bench.source = createEditor(sourcePane.body, {
    grammar: dslGrammar,
    value: first.source,
    sizing: { minRows: 12, maxRows: 30 },
    indent: { unit: 2 },
    ariaLabel: 'The grammar source',
  })

  bench.doc = createEditor(docPane.body, {
    grammar: liveGrammar(bench.holder),
    value: first.document,
    sizing: { minRows: 12, maxRows: 30 },
    hover: { enabled: true, delay: 140 },
    ariaLabel: 'The document',
    onChange: () => render(bench),
    onCompletion: (completion) => render(bench, completion),
  })

  const load = (next: Preset): void => {
    preset = next
    bench.source.setValue(next.source, false)
    bench.doc.setValue(next.document, false)
    try {
      bench.holder.current = evaluate(next.source)
      bench.error.hidden = true
    } catch (error) {
      fail(bench, error)
    }
    bench.doc.refresh()
    render(bench)
  }

  select.addEventListener('change', () => {
    const next = PRESETS.find((candidate) => candidate.id === select.value)
    if (next !== undefined) load(next)
  })

  apply.addEventListener('click', () => {
    try {
      bench.holder.current = evaluate(bench.source.value)
      bench.error.hidden = true
      bench.doc.refresh()
      render(bench)
    } catch (error) {
      fail(bench, error)
    }
  })

  reset.addEventListener('click', () => {
    bench.doc.setValue(preset.document, false)
    render(bench)
  })

  render(bench)
}

/** Mount every bench on the page. There is one, and there is no reason for there to be two. */
export function mountBench(): void {
  for (const host of document.querySelectorAll<HTMLElement>('[data-bench]')) {
    try {
      build(host)
    } catch (error) {
      host.textContent = `the playground could not start: ${error instanceof Error ? error.message : String(error)}`
      console.error(error)
    }
  }
}
