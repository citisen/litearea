// ─── families: what the completion list is actually doing ───────────────────
//
//     font: Inter, "IBM Plex Mono", system-ui
//
// A font stack, which is the language this editor came out of and the one that made the ranking
// work necessary: four families whose names are one word, two words, or a quoted phrase; a
// separator that invites another; and a host catalogue big enough that a needle has to be scored
// rather than filtered.
//
// The four things worth reading here:
//
//   - `sortText` puts the families already in the stack last without pretending their labels
//     start with a `1`. Set it on every row or on none.
//   - `append: ', '` writes the separator, so accepting a row leaves the document ready for the
//     next one.
//   - `commitCharacters: ','` accepts the row when the reader types the comma themselves, so the
//     keystroke is not swallowed: the separator lands AFTER the insert.
//   - `mode: 'before'` is how a fallback is promoted: the new family is written ahead of the old
//     one, and nothing is destroyed.

import { defineGrammar, defineVocabulary } from '@citisen/litearea'

/** The families this host knows, in the order it would reach for them. */
export const FAMILIES: readonly { name: string; detail: string; body: string; generic?: boolean }[] = [
  { name: 'Inter', detail: 'sans', body: 'A neutral sans with a tall x-height.' },
  { name: 'Inter Tight', detail: 'sans, tighter', body: 'The same family with the spacing taken out.' },
  { name: 'IBM Plex Mono', detail: 'mono', body: 'A monospace with slab-ish terminals.' },
  { name: 'Iosevka', detail: 'mono, narrow', body: 'A narrow monospace for long lines.' },
  { name: 'Bricolage Grotesque', detail: 'display', body: 'Three axes, and an odd voice at display sizes.' },
  { name: 'Source Han Serif SC', detail: 'serif, CJK', body: 'Four words, which is the most a member may span.' },
]

const CATALOGUE = defineVocabulary({
  id: 'family',
  words: FAMILIES.map((family) => family.name),
  scope: 'family',
  docs: Object.fromEntries(
    FAMILIES.map((family) => [family.name, { detail: family.detail, body: family.body }]),
  ),
  // A member is not always insertable as it is written: a family with a space in it has to be
  // quoted, and the vocabulary is where that fact belongs rather than in every completion row.
  format: (word) => (word.includes(' ') ? `"${word}"` : word),
})

/** The words a stack is allowed to name instead of a family, plus the quotation and the comma. */
const GENERIC = ['system-ui', 'sans-serif', 'serif', 'monospace'] as const

export const familiesGrammar = defineGrammar({
  id: 'families',
  name: 'font stack',

  wordChars: /[\p{L}\p{N}_-]/u,

  rules: [
    { kind: 'match', scope: 'comment', pattern: /#[^\n]*/ },
    { kind: 'match', scope: 'property', pattern: /[a-z-]+(?=\s*:)/ },
    // A name with a space in it is written quoted, and the quotes are part of the family so a
    // completion replaces the whole phrase rather than the word under the caret.
    { kind: 'match', scope: 'family', pattern: /"(?:[^"\\]|\\.)*"/ },
    { kind: 'match', scope: 'separator', pattern: /,/ },
    { kind: 'match', scope: 'family.generic', pattern: /system-ui|sans-serif|serif|monospace/ },
    // A name may be two or four words long, and the separators are part of the match, so a
    // completion opened inside `Source Han Serif SC` replaces the whole phrase.
    { kind: 'words', words: CATALOGUE, phrase: { max: 4 }, when: { after: ['separator', 'property', 'family'] } },
  ],

  fallbackScope: 'text',

  describe: (context) => {
    const token = context.token
    if (token === undefined) return undefined
    if (token.scope === 'family.generic') {
      return { title: token.text, detail: 'generic', body: 'Resolved by the browser, not by the host.' }
    }
    const entry = CATALOGUE.entryFor(token.text)
    if (entry === undefined) return undefined
    return { title: token.text, detail: entry.detail, body: entry.body }
  },

  compose: [
    {
      id: 'family',
      // The list stays open over a name that spans several words, which is what `phrase` bought:
      // the needle is the words typed so far and a row may replace all of them.
      when: (context) => !context.firstWord || context.line.before.trim() === '',
      priority: 1,
      range: (context) => context.word,
      items: (context) => {
        // What is already in the stack, read from the tokens rather than from the text: a name
        // with a space in it is one token, and a search of the raw line would find halves.
        const used = new Set(
          context.tokens.filter((token) => token.scope === 'family').map((token) => token.text),
        )
        const catalogued = FAMILIES.map((family) => ({
          label: family.name,
          insert: CATALOGUE.format(family.name),
          append: ', ',
          commitCharacters: ',',
          kind: 'family',
          detail: used.has(family.name) ? 'already in the stack' : family.detail,
          documentation: family.body,
          sortText: used.has(family.name) ? '1' : '0',
        }))
        const generic = GENERIC.map((name) => ({
          label: name,
          append: ', ',
          commitCharacters: ',',
          kind: 'generic',
          detail: 'generic family',
          sortText: '2',
        }))
        return [...catalogued, ...generic]
      },
    },
    {
      id: 'promote',
      // `mode: 'before'` writes ahead of the range and keeps it, so a fallback is inserted in
      // FRONT of a family that is already written rather than replacing it. It is eligible only
      // on an empty word at the end of a line that already names a family, and its higher
      // priority is what lets it take the moment from the source above.
      priority: 2,
      when: (context) =>
        context.word.text === '' &&
        context.tokens.some((token) => token.scope === 'family' || token.scope === 'family.generic'),
      range: (context) => context.word,
      items: () => [
        {
          label: 'promote a monospace first',
          insert: '"IBM Plex Mono", ',
          mode: 'before' as const,
          kind: 'action',
          detail: 'written ahead of what is there',
        },
      ],
    },
  ],
})
