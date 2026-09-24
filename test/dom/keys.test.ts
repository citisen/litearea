// @vitest-environment happy-dom
//
// The keymap's wiring: which command a keystroke reaches, and — just as important —
// whether the editor takes the keystroke away from the browser at all.
//
// The eligibility rules are the part worth guarding here. `Tab` has two jobs and the
// editor's state decides which one it does; a refactor that stopped asking eligibility
// would leave a host's `Tab` untouched while the list is open, or would swallow `Tab`
// for everybody the moment it bound `indent`.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEditor } from '../../src/dom/create.js'
import type { LiteArea, LiteAreaOptions } from '../../src/dom/editor.js'
import { defineGrammar } from '../../src/core/grammar.js'
import { defineVocabulary } from '../../src/core/vocabulary.js'

/** A language with one vocabulary, one comment marker, and one completion source. */
function grammar() {
  const names = defineVocabulary({
    id: 'name',
    words: ['alpha', 'beta', 'gamma'],
    scope: 'name',
  })
  return defineGrammar({
    id: 'keymap-test',
    wordChars: /[\p{L}\p{N}_]/u,
    rules: [
      { kind: 'match', scope: 'comment', pattern: /#[^\n]*/ },
      { kind: 'words', words: names },
    ],
    comments: { line: '#' },
    compose: [
      {
        id: 'names',
        range: (context) => context.word,
        items: () => [
          { label: 'alpha' },
          { label: 'beta' },
          { label: 'gamma' },
        ],
      },
    ],
  })
}

/** Mount an editor with the test grammar. */
function mount(options: Partial<LiteAreaOptions> = {}): LiteArea {
  const host = document.createElement('div')
  document.body.appendChild(host)
  return createEditor(host, { grammar: grammar(), ...options })
}

/**
 * Press a key, and report whether the editor TOOK it.
 *
 * key is the name a KeyboardEvent reports — Tab, not Shift+Tab — with the
 * modifiers passed alongside it.
 *
 * `dispatchEvent` returns false when a listener called `preventDefault`, so this is the
 * question a keymap has to get right and a value assertion cannot see: did the editor
 * take the key away from the browser, or leave it alone? A `Tab` that is bound but
 * unbindable, or one that is only meant to indent, must come back `false`.
 */
function press(editor: LiteArea, key: string, extra: KeyboardEventInit = {}): boolean {
  const allowed = editor.input.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }),
  )
  return !allowed
}

/** Every editor this file mounted, so nothing leaks into the next test. */
let mounted: LiteArea[] = []

/** Mount and remember, so `afterEach` can clean up whatever a failing test left. */
function open(options: Partial<LiteAreaOptions> = {}): LiteArea {
  const editor = mount(options)
  mounted.push(editor)
  return editor
}

afterEach(() => {
  for (const editor of mounted) editor.destroy()
  mounted = []
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('the keymap', () => {
  it('gives Tab to the list while the list is open, even when Tab is bound to indent', () => {
    // The regression this file exists for. A host binds Tab to indent; the list opens;
    // Tab must still be the pick, because the list owns it while it is open. If
    // eligibility were dropped, the first binding in the table would win and the reader
    // would indent the very word the list is filtering on.
    const editor = open({ value: 'be', keys: [{ key: 'Tab', command: 'indent' }] })
    editor.focus()
    editor.setSelection(2)
    editor.showCompletions()
    expect(press(editor, 'Tab')).toBe(true)
    expect(editor.value).toBe('beta')
  })

  it('indents on Tab once the list is closed, when a host asked for it', () => {
    const editor = open({
      value: 'alpha',
      keys: [{ key: 'Tab', command: 'indent' }],
      indent: { unit: 4 },
    })
    editor.focus()
    editor.setSelection(0)
    expect(press(editor, 'Tab')).toBe(true)
    expect(editor.value).toBe('    alpha')
    expect(editor.selection).toEqual({ start: 4, end: 4 })
  })

  it('outdents on Shift+Tab', () => {
    const editor = open({
      value: '    alpha',
      keys: [{ key: 'Shift+Tab', command: 'outdent' }],
    })
    editor.focus()
    editor.setSelection(6)
    expect(press(editor, 'Tab', { shiftKey: true })).toBe(true)
    expect(editor.value).toBe('  alpha')
  })

  it('leaves Tab alone when it is not bound', () => {
    // The default. Tab is how a reader leaves a form, and an editor that swallowed it
    // without being asked would be a keyboard trap — so the key must come back
    // UNcancelled.
    const editor = open({ value: 'alpha' })
    editor.focus()
    editor.setSelection(0)
    expect(press(editor, 'Tab')).toBe(false)
    expect(editor.value).toBe('alpha')
  })

  it('hands a key back to the browser when a host unbinds it', () => {
    const editor = open({ value: 'alpha', keys: [{ key: 'Tab', command: 'ignore' }] })
    editor.focus()
    editor.setSelection(0)
    // `ignore` suppresses the defaults below it and performs nothing, so nothing calls
    // `preventDefault` and the browser's own Tab handling happens.
    expect(press(editor, 'Tab')).toBe(false)
    expect(editor.value).toBe('alpha')
  })

  it('moves a default binding out of the way when a host takes the key', () => {
    const editor = open({ value: '# note', keys: [{ key: 'Mod+/', command: 'ignore' }] })
    editor.focus()
    editor.setSelection(6)
    expect(press(editor, '/', { ctrlKey: true })).toBe(false)
    expect(editor.value).toBe('# note')
  })

  it('runs a default binding on a key the host chose instead', () => {
    const editor = open({ value: '# note', keys: [{ key: 'F2', command: 'toggleComment' }] })
    editor.focus()
    editor.setSelection(6)
    expect(press(editor, 'F2')).toBe(true)
    expect(editor.value).toBe('note')
  })

  it('indents every line a selection touches, and keeps the selection', () => {
    const editor = open({
      value: 'one\ntwo\nthree',
      keys: [{ key: 'Tab', command: 'indent' }],
    })
    editor.focus()
    editor.setSelection(0, 13)
    press(editor, 'Tab')
    expect(editor.value).toBe('  one\n  two\n  three')
    expect(editor.selection).toEqual({ start: 0, end: 19 })
  })

  it('indents the caret’s own line for the line command', () => {
    const editor = open({
      value: 'one\ntwo',
      keys: [{ key: 'Tab', command: 'indentLines' }],
    })
    editor.focus()
    editor.setSelection(5)
    press(editor, 'Tab')
    expect(editor.value).toBe('one\n  two')
  })

  it('does nothing, and takes nothing, when there is nothing to outdent', () => {
    // A line already at the margin: no edit, so no `preventDefault` either, and the key
    // still belongs to the browser rather than being swallowed by a no-op.
    const editor = open({
      value: 'alpha',
      keys: [{ key: 'Shift+Tab', command: 'outdent' }],
    })
    editor.focus()
    editor.setSelection(3)
    expect(press(editor, 'Tab', { shiftKey: true })).toBe(false)
    expect(editor.value).toBe('alpha')
  })

  it('announces an indent to the host, once', () => {
    const changed: string[] = []
    const editor = open({
      value: 'one\ntwo',
      keys: [{ key: 'Tab', command: 'indent' }],
      onChange: (next) => changed.push(next),
    })
    editor.focus()
    editor.setSelection(0, 7)
    press(editor, 'Tab')
    expect(changed).toEqual(['  one\n  two'])
  })

  it('still accepts on Enter while the list is open', () => {
    const editor = open({ value: 'be' })
    editor.focus()
    editor.setSelection(2)
    editor.showCompletions()
    expect(press(editor, 'Enter')).toBe(true)
    expect(editor.value).toBe('beta')
  })

  it('opens a block on Enter between a declared pair, with the configured unit', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const editor = createEditor(host, {
      grammar: defineGrammar({
        id: 'braces',
        rules: [{ kind: 'match', scope: 'punct', pattern: /[{}]/ }],
        pairs: [{ open: '{', close: '}' }],
      }),
      value: '{}',
      indent: { unit: '\t' },
    })
    mounted.push(editor)
    editor.focus()
    editor.setSelection(1)
    press(editor, 'Enter')
    expect(editor.value).toBe('{\n\t\n}')
  })
})
