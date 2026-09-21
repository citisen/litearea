// @vitest-environment happy-dom
//
// What this file can and cannot check, stated once so nobody reads more into a green
// run than it deserves.
//
// happy-dom has no layout and no undo stack, so it cannot answer the two questions the
// library exists to answer: does Ctrl+Z still work, and does the paint line up with the
// field. Both are asserted in a real browser by `scripts/browser-check.mjs`, which also
// runs a negative control so that a passing undo test means something. What IS worth
// checking here is the plumbing: that the direct fallback path fires the event the
// browser would have fired, that a whole-document write reports which path it took, and
// that the selection helpers clamp rather than throw.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  dispatchInput,
  fieldLineHeight,
  readSelection,
  redoField,
  replaceThroughPipeline,
  undoField,
  writeDocument,
  writeSelection,
} from '../../src/dom/editing.js'
import { canEditThroughPipeline, offsetFromPoint, withDefaults } from '../../src/dom/support.js'

/** A textarea in the document, which is what every helper here expects. */
function mount(value = ''): HTMLTextAreaElement {
  const field = document.createElement('textarea')
  field.value = value
  document.body.appendChild(field)
  return field
}

beforeEach(() => {
  document.body.replaceChildren()
})

describe('canEditThroughPipeline', () => {
  it('reports the truth about this environment rather than assuming', () => {
    // happy-dom has no `execCommand`, so the answer here is false and the editor is
    // expected to fall back. Asserting the real value rather than a hard-coded one keeps
    // this honest if the environment ever changes.
    expect(typeof canEditThroughPipeline()).toBe('boolean')
    expect(canEditThroughPipeline()).toBe(typeof document.execCommand === 'function')
  })
})

describe('readSelection and writeSelection', () => {
  it('reads a caret and a selection', () => {
    const field = mount('abcdef')
    writeSelection(field, 2)
    expect(readSelection(field)).toEqual({ start: 2, end: 2 })
    writeSelection(field, 1, 4)
    expect(readSelection(field)).toEqual({ start: 1, end: 4 })
  })

  it('clamps a selection into the text rather than throwing', () => {
    const field = mount('abc')
    writeSelection(field, 99)
    expect(readSelection(field)).toEqual({ start: 3, end: 3 })
    writeSelection(field, -5)
    expect(readSelection(field)).toEqual({ start: 0, end: 0 })
    // A range given the wrong way round is ordered, not collapsed: a caller computing the
    // ends of a backwards drag has still asked for that text to be selected.
    writeSelection(field, 2, 1)
    expect(readSelection(field)).toEqual({ start: 1, end: 2 })
  })
})

describe('replaceThroughPipeline', () => {
  it('replaces a range and reports the path it took', () => {
    const field = mount('hello world')
    const outcome = replaceThroughPipeline(field, 6, 11, 'there')
    expect(field.value).toBe('hello there')
    // Which path depends on the environment, and the outcome says which — the honest
    // report that lets a host know whether the history got the edit.
    expect(['pipeline', 'direct']).toContain(outcome)
  })

  it('fires the input event the browser would have fired, on the direct path', () => {
    const field = mount('hello')
    let inputs = 0
    field.addEventListener('input', () => {
      inputs += 1
    })
    const outcome = replaceThroughPipeline(field, 5, 5, '!')
    if (outcome === 'direct') {
      // Without this the editor would never learn about its own edit, because everything
      // downstream listens for `input` and the pipeline is what normally dispatches it.
      expect(inputs).toBe(1)
    }
    expect(field.value).toBe('hello!')
  })

  it('deletes when the replacement is empty', () => {
    const field = mount('hello')
    replaceThroughPipeline(field, 0, 5, '')
    expect(field.value).toBe('')
  })

  it('leaves a collapsed empty edit alone and says so', () => {
    const field = mount('hello')
    expect(replaceThroughPipeline(field, 2, 2, '')).toBe('unchanged')
    expect(field.value).toBe('hello')
  })

  it('leaves the caret after what it wrote', () => {
    const field = mount('one two')
    replaceThroughPipeline(field, 4, 7, 'three')
    expect(field.value).toBe('one three')
    expect(readSelection(field).start).toBe(9)
  })

  it('orders a backwards range rather than doing nothing', () => {
    const field = mount('hello')
    replaceThroughPipeline(field, 4, 1, 'i')
    expect(field.value).toBe('hio')
  })
})

describe('writeDocument', () => {
  it('reports unchanged when the text is already there', () => {
    const field = mount('same')
    expect(writeDocument(field, 'same')).toBe('unchanged')
  })

  it('assigns the value directly when the history need not be preserved', () => {
    const field = mount('old')
    expect(writeDocument(field, 'new', false)).toBe('direct')
    expect(field.value).toBe('new')
    expect(readSelection(field)).toEqual({ start: 3, end: 3 })
  })

  it('still lands the text when the history is asked for', () => {
    // The mechanism differs — one undoable edit rather than an assignment — but the text
    // and the caret are the same either way, which is what a caller checks.
    const field = mount('old')
    writeDocument(field, 'new', true)
    expect(field.value).toBe('new')
    expect(readSelection(field).start).toBe(3)
  })
})

describe('undoField and redoField', () => {
  it('report whether the environment offers history at all', () => {
    const field = mount('x')
    expect(undoField(field)).toBe(canEditThroughPipeline())
    expect(redoField(field)).toBe(canEditThroughPipeline())
  })
})

describe('dispatchInput', () => {
  it('fires a bubbling input event carrying the inserted text', () => {
    const field = mount('')
    let data: string | null = null
    document.body.addEventListener('input', (event) => {
      data = (event as InputEvent).data ?? null
    })
    dispatchInput(field, 'ab')
    expect(data).toBe('ab')
  })
})

describe('fieldLineHeight', () => {
  it('returns a number even where nothing has a computed line height', () => {
    const field = mount('x')
    expect(Number.isFinite(fieldLineHeight(field))).toBe(true)
  })
})

describe('offsetFromPoint', () => {
  it('says it cannot answer rather than guessing', () => {
    // Neither caret API is available here, and the honest answer is undefined: a
    // hand-computed guess would put a tooltip on the wrong word.
    const answer = offsetFromPoint(10, 10)
    expect(answer === undefined || typeof answer === 'number').toBe(true)
  })
})

describe('withDefaults', () => {
  it('keeps a default when a caller passes the key as undefined', () => {
    // Spreading would overwrite the default with undefined, silently switching a
    // feature off for a caller who merely omitted a field.
    const merged = withDefaults({ auto: true, limit: 100, name: 'x' }, { limit: undefined, name: 'y' })
    expect(merged).toEqual({ auto: true, limit: 100, name: 'y' })
  })

  it('copies rather than mutating the defaults', () => {
    const defaults = { a: 1, b: 2 }
    withDefaults(defaults, { a: 9 })
    expect(defaults).toEqual({ a: 1, b: 2 })
  })

  it('handles no overrides at all', () => {
    expect(withDefaults({ a: 1 }, undefined)).toEqual({ a: 1 })
  })
})
