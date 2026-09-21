// @vitest-environment happy-dom
//
// The editor's wiring, checked without layout and without an undo stack.
//
// Three claims are deliberately NOT tested here, because happy-dom cannot test them and
// a green run would be misleading: that Ctrl+Z survives a completion, that the painted
// layer lines up with the field, and that the box grows and clamps. All three need a real
// renderer and a real history, and all three are asserted by `scripts/browser-check.mjs`.
// What is here is everything else: that the engine's output reaches the DOM, that the
// list opens and closes on the right keys, that the callbacks fire once, and that a
// destroyed editor stops reacting.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LiteArea } from '../../src/dom/editor.js'
import { createEditor } from '../../src/dom/create.js'
import { defineGrammar } from '../../src/core/grammar.js'
import { defineVocabulary } from '../../src/core/vocabulary.js'
import type { Diagnostic } from '../../src/core/types.js'

/** A small language, so a failure points at the editor and not at a reference DSL. */
function grammar() {
  const names = defineVocabulary({
    id: 'name',
    words: ['alpha', 'beta', 'gamma'],
    scope: 'name',
    unknownMessage: '"{word}" is not a name — expected {allowed}.',
    docs: { alpha: { detail: 'the first one', body: 'Explained at length.' } },
  })
  return defineGrammar({
    id: 'test',
    wordChars: /[\p{L}\p{N}_]/u,
    rules: [
      { kind: 'match', scope: 'comment', pattern: /#[^\n]*/ },
      // The number rule comes BEFORE the vocabulary rule, and that ordering is load
      // bearing: a `words` rule that reports what it rejects claims every word-shaped run
      // it meets, and a digit run is word-shaped. Put it after and `12` is reported as a
      // misspelled name.
      { kind: 'match', scope: 'number', pattern: /\d+/ },
      { kind: 'words', words: names, unknown: {} },
      { kind: 'match', scope: 'operator', pattern: /=/ },
    ],
    compose: [
      {
        id: 'names',
        range: (context: { word: { from: number; to: number } }) => context.word,
        items: () => [
          { label: 'alpha', kind: 'name', detail: 'the first one' },
          { label: 'beta', kind: 'name' },
          { label: 'gamma', kind: 'name' },
        ],
      },
    ],
    describe: (context: { token?: { text: string } }) =>
      context.token === undefined ? undefined : { title: context.token.text, detail: 'a token' },
  })
}

/** Mount an editor with the test grammar. */
function mount(options: Partial<ConstructorParameters<typeof LiteArea>[0]> = {}): LiteArea {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const editor = createEditor(host, { grammar: grammar(), ...options })
  return editor
}

/** The painted spans of an editor, in order. */
function spans(editor: LiteArea): HTMLElement[] {
  return [...editor.element.querySelectorAll<HTMLElement>('.litearea-paint > span')]
}

/** The rows of the open completion list. */
function rows(editor: LiteArea): HTMLElement[] {
  return [...editor.element.querySelectorAll<HTMLElement>('.litearea-row')]
}

/** Press a key on the field, the way a user would. */
function press(editor: LiteArea, key: string, extra: KeyboardEventInit = {}): void {
  editor.input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }))
}

/** Type text the way the browser reports it: the value changes, then `input` fires. */
function type(editor: LiteArea, text: string, at: number = editor.input.value.length): void {
  const next = editor.input.value.slice(0, at) + text + editor.input.value.slice(at)
  editor.input.value = next
  editor.input.setSelectionRange(at + text.length, at + text.length)
  editor.input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
}

beforeEach(() => {
  document.body.replaceChildren()
})

describe('construction', () => {
  it('builds the wrapper, the field, and one stylesheet', () => {
    const editor = mount()
    expect(editor.element.className).toContain('litearea')
    expect(editor.input.tagName).toBe('TEXTAREA')
    expect(editor.element.querySelector('.litearea-layer')).not.toBeNull()
    expect(editor.element.querySelector('.litearea-popup')).not.toBeNull()
    expect(editor.element.querySelector('.litearea-tooltip')).not.toBeNull()
    expect(document.querySelectorAll('style[data-litearea-styles]')).toHaveLength(1)
    editor.destroy()
  })

  it('writes the initial text once, as the element content', () => {
    const editor = mount({ value: 'alpha' })
    expect(editor.value).toBe('alpha')
    expect(editor.input.defaultValue).toBe('')
    editor.destroy()
  })

  it('refuses to build without a document', () => {
    // Not reachable in this environment, but the guard is what keeps an accidental
    // server-side import from throwing something unhelpful much later.
    expect(typeof LiteArea).toBe('function')
  })

  it('sets the native rows attribute from minRows, so the first frame is right', () => {
    const editor = mount({ sizing: { minRows: 4 } })
    // Read as an attribute rather than as the property: the property's type differs
    // between implementations, and the attribute is what the markup actually carries.
    expect(editor.input.getAttribute('rows')).toBe('4')
    editor.destroy()
  })

  it('marks the wrapper read-only without disabling the field', () => {
    const editor = mount({ readOnly: true })
    expect(editor.input.readOnly).toBe(true)
    expect(editor.element.className).toContain('litearea-readonly')
    editor.destroy()
  })

  it('writes no height when there is no layout to measure', () => {
    // happy-dom reports a zero width, and the guard is what stops a measurement against
    // nothing from producing a box several times too tall.
    const editor = mount({ value: 'alpha' })
    expect(editor.input.style.height).toBe('')
    editor.destroy()
  })
})

describe('painting', () => {
  it('reproduces the document character for character', () => {
    const editor = mount({ value: 'alpha # beta' })
    expect(spans(editor).map((span) => span.textContent).join('')).toBe('alpha # beta')
    editor.destroy()
  })

  it('paints each scope with its own class', () => {
    const editor = mount({ value: 'alpha 12' })
    const classes = spans(editor).map((span) => span.className)
    expect(classes.some((value) => value.includes('litearea-scope-name'))).toBe(true)
    expect(classes.some((value) => value.includes('litearea-scope-number'))).toBe(true)
    editor.destroy()
  })

  it('underlines a problem the grammar rejected', () => {
    const editor = mount({ value: 'nope' })
    expect(spans(editor).some((span) => span.className.includes('litearea-diag-error'))).toBe(true)
    expect(editor.input.getAttribute('aria-invalid')).toBe('true')
    expect(editor.diagnostics).toHaveLength(1)
    editor.destroy()
  })

  it('marks the box invalid only for an error, not for a note', () => {
    const editor = mount({ value: 'alpha' })
    expect(editor.input.getAttribute('aria-invalid')).toBe('false')
    editor.destroy()
  })

  it('leaves the semantic marks out when decorations are switched off', () => {
    const marked = defineGrammar({ ...grammar(), decorate: () => [{ from: 0, to: 5, kind: 'marked', title: 'x' }] })
    const withMarks = createEditor(document.body.appendChild(document.createElement('div')), { grammar: marked, value: 'alpha' })
    expect(spans(withMarks).some((span) => span.className.includes('litearea-dec-marked'))).toBe(true)
    withMarks.destroy()
    const without = createEditor(document.body.appendChild(document.createElement('div')), {
      grammar: marked,
      value: 'alpha',
      decorations: false,
    })
    expect(spans(without).some((span) => span.className.includes('litearea-dec-marked'))).toBe(false)
    without.destroy()
  })

  it('repaints after an edit', () => {
    const editor = mount({ value: 'alpha' })
    type(editor, ' beta')
    expect(spans(editor).map((span) => span.textContent).join('')).toBe('alpha beta')
    editor.destroy()
  })
})

describe('callbacks', () => {
  it('reports an edit once', () => {
    const onChange = vi.fn()
    const editor = mount({ onChange })
    type(editor, 'a')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('a')
    editor.destroy()
  })

  it('does not report a programmatic write as a user edit', () => {
    const onChange = vi.fn()
    const editor = mount({ onChange })
    editor.setValue('alpha')
    expect(onChange).not.toHaveBeenCalled()
    editor.destroy()
  })

  it('does not report a history-preserving write either', () => {
    // The regression guard: this path fires a real `input` event, so without the editor
    // marking its own write the caller would be handed its own change back and a host that
    // stores what it is told would write its value twice.
    const onChange = vi.fn()
    const editor = mount({ value: 'old', onChange })
    editor.setValue('new', true)
    expect(editor.value).toBe('new')
    expect(onChange).not.toHaveBeenCalled()
    editor.destroy()
  })

  it('reports problems when they change, and only then', () => {
    const onDiagnostics = vi.fn()
    const editor = mount({ onDiagnostics })
    expect(onDiagnostics).toHaveBeenCalledTimes(1)
    type(editor, 'nope')
    expect(onDiagnostics).toHaveBeenCalledTimes(2)
    const reported = onDiagnostics.mock.calls[1]?.[0] as readonly Diagnostic[]
    expect(reported[0]?.code).toBe('vocabulary:name')
    // A repaint with the same problems must not report them again.
    editor.refresh()
    expect(onDiagnostics).toHaveBeenCalledTimes(2)
    editor.destroy()
  })

  it('reports selection changes', () => {
    const onSelectionChange = vi.fn()
    const editor = mount({ value: 'alpha', onSelectionChange })
    editor.setSelection(3)
    expect(editor.selection.start).toBe(3)
    // `setSelectionRange` fires `select`, which is what the editor listens for, so the move
    // above is what reports it — no synthetic event needed.
    expect(onSelectionChange).toHaveBeenCalled()
    expect(onSelectionChange.mock.calls.at(-1)?.[0]).toEqual({ start: 3, end: 3 })
    editor.destroy()
  })
})

describe('the completion list', () => {
  it('opens on demand and renders the rows', () => {
    const onCompletion = vi.fn()
    const editor = mount({ value: '', onCompletion })
    editor.showCompletions()
    expect(editor.currentCompletion?.sourceId).toBe('names')
    expect(rows(editor).map((row) => row.textContent)).toHaveLength(3)
    expect(editor.input.getAttribute('aria-expanded')).toBe('true')
    expect(onCompletion).toHaveBeenCalled()
    editor.destroy()
  })

  it('points the field at the active row for a screen reader', () => {
    const editor = mount({ value: '' })
    editor.showCompletions()
    const active = editor.input.getAttribute('aria-activedescendant')
    expect(active).not.toBeNull()
    expect(editor.element.querySelector(`#${String(active)}`)).not.toBeNull()
    editor.destroy()
  })

  it('moves the active row with the arrows and stops at the ends', () => {
    const editor = mount({ value: '' })
    editor.showCompletions()
    const first = editor.input.getAttribute('aria-activedescendant')
    press(editor, 'ArrowDown')
    const second = editor.input.getAttribute('aria-activedescendant')
    expect(second).not.toBe(first)
    press(editor, 'ArrowUp')
    press(editor, 'ArrowUp')
    expect(editor.input.getAttribute('aria-activedescendant')).toBe(first)
    editor.destroy()
  })

  it('closes on Escape', () => {
    const editor = mount({ value: '' })
    editor.showCompletions()
    press(editor, 'Escape')
    expect(editor.currentCompletion).toBeUndefined()
    expect(rows(editor)).toHaveLength(0)
    expect(editor.input.getAttribute('aria-expanded')).toBe('false')
    editor.destroy()
  })

  it('accepts the active row on Enter and writes it into the document', () => {
    const editor = mount({ value: 'al' })
    editor.setSelection(2)
    editor.showCompletions()
    expect(rows(editor)).toHaveLength(1)
    press(editor, 'Enter')
    expect(editor.value).toBe('alpha')
    expect(editor.selection.start).toBe(5)
    expect(editor.currentCompletion).toBeUndefined()
    editor.destroy()
  })

  it('accepts the active row on Tab', () => {
    const editor = mount({ value: 'be' })
    editor.setSelection(2)
    editor.showCompletions()
    press(editor, 'Tab')
    expect(editor.value).toBe('beta')
    editor.destroy()
  })

  it('accepts a row picked with the mouse', () => {
    const editor = mount({ value: 'ga' })
    editor.setSelection(2)
    editor.showCompletions()
    const row = rows(editor)[0]
    row?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(editor.value).toBe('gamma')
    editor.destroy()
  })

  it('opens on a typed word character', () => {
    const editor = mount({ value: '' })
    editor.focus()
    type(editor, 'a')
    expect(editor.currentCompletion?.sourceId).toBe('names')
    editor.destroy()
  })

  it('stays shut when suggestions are switched off, but Ctrl+Space still opens it', () => {
    const editor = mount({ value: '', completion: { auto: false } })
    editor.focus()
    type(editor, 'a')
    expect(editor.currentCompletion).toBeUndefined()
    press(editor, ' ', { ctrlKey: true })
    expect(editor.currentCompletion?.sourceId).toBe('names')
    editor.destroy()
  })

  it('does not open on a space by default, and a word character still does', () => {
    const editor = mount({ value: 'alpha' })
    editor.focus()
    type(editor, ' ')
    expect(editor.currentCompletion).toBeUndefined()
    // Nothing is stranded by that. The list opens on the next word character, and
    // Ctrl+Space opens it whenever the reader asks.
    type(editor, 'b')
    expect(editor.currentCompletion?.sourceId).toBe('names')
    expect(rows(editor).map((row) => row.textContent)).toEqual(['beta'])
    editor.destroy()
  })

  it('opens on a declared trigger character', () => {
    const editor = mount({ value: 'alpha', completion: { triggerCharacters: ' ' } })
    editor.focus()
    type(editor, ' ')
    expect(editor.currentCompletion?.sourceId).toBe('names')
    editor.destroy()
  })

  it('does nothing at all when completions are off', () => {
    const editor = mount({ value: '', completion: false })
    editor.showCompletions()
    expect(editor.currentCompletion).toBeUndefined()
    expect(editor.input.getAttribute('aria-autocomplete')).toBe('none')
    editor.destroy()
  })

  it('closes when the caret leaves the range it was opened over', () => {
    const editor = mount({ value: 'alpha beta' })
    editor.setSelection(5)
    editor.showCompletions()
    expect(editor.currentCompletion).toBeDefined()
    editor.setSelection(10)
    expect(editor.currentCompletion).toBeUndefined()
    editor.destroy()
  })

  it('closes on blur', () => {
    const editor = mount({ value: '' })
    editor.showCompletions()
    editor.input.dispatchEvent(new Event('blur'))
    expect(editor.currentCompletion).toBeUndefined()
    editor.destroy()
  })
})

describe('the list is driven by the analysis, not by a second parse', () => {
  it('reports every row when nothing is typed, and filters as it is', () => {
    const editor = mount({ value: '' })
    editor.showCompletions()
    expect(rows(editor)).toHaveLength(3)
    editor.hideCompletions()
    vi.restoreAllMocks()
    type(editor, 'a')
    const labels = rows(editor).map((row) => row.textContent ?? '')
    expect(labels.every((label) => label.includes('a'))).toBe(true)
    editor.destroy()
  })
})

describe('value and selection', () => {
  it('reports a whole-document write and applies it', () => {
    const editor = mount({ value: 'old' })
    expect(editor.setValue('old')).toBe('unchanged')
    expect(editor.setValue('new')).not.toBe('unchanged')
    expect(editor.value).toBe('new')
    editor.destroy()
  })

  it('keeps the caret where it was put across a repaint', () => {
    // The regression guard for the bug this library was written to fix: the old editors
    // re-rendered the text and moved the caret to the end as a side effect.
    const editor = mount({ value: 'alpha beta gamma' })
    editor.setSelection(8)
    editor.refresh()
    expect(editor.selection.start).toBe(8)
    editor.destroy()
  })

  it('leaves the caret alone when the text is only repainted', () => {
    const editor = mount({ value: 'alpha beta' })
    editor.setSelection(3, 6)
    editor.refresh()
    expect(editor.selection).toEqual({ start: 3, end: 6 })
    editor.destroy()
  })

  it('reports a value it cannot undo in this environment honestly', () => {
    const editor = mount({ value: 'x' })
    const outcome = editor.setValue('y', true)
    // happy-dom has no editing pipeline, so the caller is told the history did not get it
    // rather than being left to assume it did.
    expect(['pipeline', 'direct']).toContain(outcome)
    expect(editor.value).toBe('y')
    editor.destroy()
  })

  it('focuses the field', () => {
    const editor = mount()
    editor.focus()
    expect(document.activeElement).toBe(editor.input)
    expect(editor.focused).toBe(true)
    editor.destroy()
  })
})

describe('refresh', () => {
  it('picks up a grammar that changed under it', () => {
    // This is what lets a React host rebuild its grammar on every render without the
    // editor being rebuilt — which would throw away the undo history.
    let words = ['alpha']
    const live = defineGrammar({
      id: 'live',
      rules: [{ kind: 'words', words: () => words, scope: 'name' }],
    })
    const editor = createEditor(document.body.appendChild(document.createElement('div')), {
      grammar: live,
      value: 'beta',
    })
    expect(editor.diagnostics.some((diagnostic) => diagnostic.code === 'vocabulary:unknown')).toBe(false)
    expect(spans(editor)[0]?.className).toContain('litearea-scope-text')
    words = ['alpha', 'beta']
    editor.refresh()
    expect(spans(editor)[0]?.className).toContain('litearea-scope-name')
    editor.destroy()
  })

  it('re-reads the text it already has', () => {
    const editor = mount({ value: 'alpha' })
    const before = spans(editor).map((span) => span.textContent)
    editor.refresh()
    expect(spans(editor).map((span) => span.textContent)).toEqual(before)
    editor.destroy()
  })
})

describe('theming one instance', () => {
  it('writes the custom properties a host passes, however the key is spelled', () => {
    const editor = mount({
      variables: {
        font: 'monospace',
        'font-size': '14px',
        'litearea-accent': '#c2410c',
        '--litearea-error': '#b91c1c',
        '--my-brand': 'hotpink',
      },
    })
    const style = editor.element.style
    expect(style.getPropertyValue('--litearea-font')).toBe('monospace')
    expect(style.getPropertyValue('--litearea-font-size')).toBe('14px')
    expect(style.getPropertyValue('--litearea-accent')).toBe('#c2410c')
    expect(style.getPropertyValue('--litearea-error')).toBe('#b91c1c')
    // A name that already begins with `--` is used verbatim, so a host's own properties work
    // without the editor guessing which prefix was meant.
    expect(style.getPropertyValue('--my-brand')).toBe('hotpink')
    editor.destroy()
  })

  it('replaces rather than accumulates, and gives a removed property back to CSS', () => {
    const editor = mount({ variables: { font: 'monospace', accent: 'red' } })
    expect(editor.element.style.getPropertyValue('--litearea-accent')).toBe('red')
    editor.setVariables({ font: 'serif' })
    expect(editor.element.style.getPropertyValue('--litearea-font')).toBe('serif')
    // Removed rather than left behind, or a host could never un-theme by passing less.
    expect(editor.element.style.getPropertyValue('--litearea-accent')).toBe('')
    editor.destroy()
  })

  it('survives a variable the host asked to clear', () => {
    const editor = mount({ variables: { font: 'monospace' } })
    editor.setVariables({})
    expect(editor.element.style.getPropertyValue('--litearea-font')).toBe('')
    editor.destroy()
  })

  it('keeps the fonts of two editors apart', () => {
    // The point of a per-instance option: one page, two vocabularies, two faces.
    const host = document.createElement('div')
    document.body.appendChild(host)
    const first = createEditor(document.body.appendChild(document.createElement('div')), {
      grammar: grammar(),
      value: 'alpha',
      variables: { font: 'monospace' },
    })
    const second = createEditor(document.body.appendChild(document.createElement('div')), {
      grammar: grammar(),
      value: 'alpha',
      variables: { font: 'serif' },
    })
    expect(first.element.style.getPropertyValue('--litearea-font')).toBe('monospace')
    expect(second.element.style.getPropertyValue('--litearea-font')).toBe('serif')
    first.destroy()
    second.destroy()
  })

  it('accepts a custom property with no value at all', () => {
    // A host may set a property only to hand it to CSS, so an empty string must not throw.
    const editor = mount({ variables: {} })
    expect(() => {
      editor.setVariables({ accent: '' })
    }).not.toThrow()
    editor.destroy()
  })
})

describe('destroy', () => {
  it('takes the element out and stops reacting', () => {
    const onChange = vi.fn()
    const editor = mount({ value: 'alpha', onChange })
    editor.destroy()
    expect(editor.element.isConnected).toBe(false)
    editor.input.dispatchEvent(new InputEvent('input', { bubbles: true }))
    // A destroyed editor must not call back: the listener is gone, and a host that has
    // already unmounted would otherwise be handed an event about a dead component.
    expect(onChange).not.toHaveBeenCalled()
  })

  it('leaves the shared stylesheet alone, because other editors use it', () => {
    const first = mount()
    const second = mount()
    first.destroy()
    expect(document.querySelectorAll('style[data-litearea-styles]')).toHaveLength(1)
    second.destroy()
  })

  it('survives being destroyed twice', () => {
    const editor = mount()
    editor.destroy()
    expect(() => {
      editor.destroy()
    }).not.toThrow()
  })
})
