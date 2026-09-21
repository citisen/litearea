// ─── grammar: the two identity functions authors actually want ──────────────
//
// Neither does anything at runtime, and that is not a joke at the reader's
// expense: `defineGrammar` exists so `State` is inferred from `analyze` and then
// enforced everywhere else. Written as a bare object literal, a grammar whose
// `analyze` returns `{ entries: Entry[] }` would have every hook's `context.state`
// typed as `unknown`, and the author would spend the afternoon casting.
//
//     const grammar = defineGrammar({
//       id: 'my-language',
//       rules: [...],
//       analyze: (text) => ({ lines: text.split('\n') }),   // State is inferred
//       compose: [{
//         id: 'values',
//         range: (context) => ({ from: 0, to: context.caret }),
//         items: (context) => context.state.lines.map(...),  // typed, not cast
//       }],
//     })

import type { CompletionSource, Grammar } from './types.js'

/**
 * Declare a grammar, inferring its state type from `analyze`.
 * @param grammar - the grammar.
 * @returns the same grammar, typed.
 */
export function defineGrammar<State = unknown>(grammar: Grammar<State>): Grammar<State> {
  return grammar
}

/**
 * Declare a completion source, inferring the state type from its context.
 * @param source - the source.
 * @returns the same source, typed.
 */
export function defineCompletion<State = unknown>(
  source: CompletionSource<State>,
): CompletionSource<State> {
  return source
}
