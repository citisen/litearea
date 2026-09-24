// ─── plan: two kinds of block, nested ───────────────────────────────────────
//
//     group alpha
//       step one 10
//       step two 20
//
// A language whose whole point is that its blocks nest, so that the editor can pin more than one
// header while the reader is inside both. A `group` runs until the next group; a `step` runs
// until the next step or the next group.
//
// The blocks are DECORATIONS rather than a second declaration. A grammar already has exactly one
// place to say what a block is — the ranges `decorate` returns — and a separate list would be a
// second answer to the same question, which the two would disagree about the first time the
// language changed.

import type { Decoration } from '@citisen/litearea'
import { defineGrammar } from '@citisen/litearea'

/** Where each line begins. */
function lineStarts(text: string): number[] {
  const starts = [0]
  for (let at = 0; at < text.length; at += 1) {
    if (text.charCodeAt(at) === 10) starts.push(at + 1)
  }
  return starts
}

/**
 * One range per block.
 *
 * A real language would compute this from its own analysis; here the rule is stated in terms of
 * the lines themselves, so what the page shows is the SHAPE of the document rather than a
 * parser. That is also why a grammar shipping this much logic in `decorate` is honest: the work
 * is proportional to the document, not to the text, and it is recomputed without re-lexing.
 *
 * @param text - the document.
 * @returns the ranges, parents before children.
 */
function blocksOf(text: string): readonly Decoration[] {
  const starts = lineStarts(text)
  const headsOf = (word: string): number[] =>
    starts
      .map((_, line) => line)
      .filter((line) => text.slice(starts[line] ?? 0, (starts[line] ?? 0) + word.length + 1) === `${word} `)

  const groups = headsOf('group')
  const steps = headsOf('step')
  const ranges: Decoration[] = []

  groups.forEach((line, index) => {
    const next = groups[index + 1]
    ranges.push({
      kind: 'block',
      from: starts[line] ?? 0,
      to: next === undefined ? text.length : (starts[next] ?? text.length) - 1,
    })
  })

  // A step ends at whichever comes first, the next step or the group it is in — which is what
  // keeps a step's range inside its group's range, and what makes the pinned rows stack in the
  // order the document nests rather than in the order they were declared.
  steps.forEach((line) => {
    const after = [...steps, ...groups]
      .map((other) => starts[other] ?? text.length)
      .filter((start) => start > (starts[line] ?? 0))
    const next = after.length === 0 ? undefined : Math.min(...after)
    ranges.push({
      kind: 'block',
      from: starts[line] ?? 0,
      to: next === undefined ? text.length : next - 1,
    })
  })

  return ranges
}

export const planGrammar = defineGrammar({
  id: 'plan',
  name: 'plan',

  rules: [
    { kind: 'match', scope: 'comment', pattern: /#[^\n]*/ },
    { kind: 'match', scope: 'keyword', pattern: /group|step/, when: { prevNot: '\\w' } },
    { kind: 'match', scope: 'number', pattern: /\d+/ },
    { kind: 'match', scope: 'name', pattern: /[a-z][\w-]*/ },
  ],

  fallbackScope: 'text',
  comments: { line: '#' },

  // The header line of the block the caret is inside is copied to the top of the box while the
  // reader is in it, one row per level of nesting. Nothing here says how that is drawn: the
  // ranges say what a block is, and `sticky.kinds` says which blocks are worth pinning.
  decorate: (text) => blocksOf(text),
})
