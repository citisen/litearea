// ─── aids: delimiters and comment markers the grammar declares ──────────────
//
//     {
//       name: "workbench",
//       size: 12,
//       # ctrl+/ toggles these markers
//       tags: [alpha, beta]
//     }
//
// The two things here are OPTIONAL FIELDS on the grammar and not options on the editor, and that
// is a language decision rather than an API one: only the language knows that a paren inside a
// comment is prose and a paren inside an expression is a bracket. `indentSize` is a taste, so it
// lives on the editor; this is a fact about the syntax, so it lives beside the rules.
//
// Every edit the editor makes from these declarations goes through the browser's own editing
// pipeline, so one Ctrl+Z takes back both characters of an auto-closed pair and every marker of a
// multi-line comment toggle.

import { defineGrammar } from '@citisen/litearea'

export const aidsGrammar = defineGrammar({
  id: 'aids',
  name: 'data',

  rules: [
    { kind: 'match', scope: 'comment', pattern: /#[^\n]*/ },
    { kind: 'match', scope: 'string', pattern: /"(?:[^"\\]|\\.)*"/ },
    { kind: 'match', scope: 'keyword', pattern: /true|false|null/, when: { prevNot: '\\w' } },
    { kind: 'match', scope: 'number', pattern: /-?\d+(?:\.\d+)?/ },
    { kind: 'match', scope: 'name', pattern: /[A-Za-z_][\w-]*/ },
    { kind: 'match', scope: 'punctuation', pattern: /[{}()[\],:]/ },
  ],

  fallbackScope: 'text',

  // Typing any of these writes the closer and leaves the caret between the two. The quote is
  // refused inside a string or a comment, where it is a quotation mark and not a delimiter —
  // which is the argument for `pairs` being the language's: the editor cannot know that.
  pairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"', notIn: ['string', 'comment'] },
  ],

  comments: { line: '#', block: ['/*', '*/'] },
})
