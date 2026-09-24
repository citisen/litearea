// ─── form schema: the README's language, finished ───────────────────────────
//
// A tiny declaration of a signup form:
//
//     # the signup form
//     form signup
//       text    email     required
//       text    password  secret   "at least 12 characters"
//       number  age       optional
//
// Eight rules, two vocabularies, two completion sources, a hover, a declarative check, and a
// walk of the whole document that the validator reads. It is the language the README builds in
// pieces, assembled here as one object so the page can run it.

import type { Diagnostic, HoverInfo, Range } from '@citisen/litearea'
import { defineGrammar, defineVocabulary } from '@citisen/litearea'

/** The field types this language knows. */
export const FIELD_TYPES = ['text', 'number', 'bool', 'choice'] as const

/** The options a field may carry. */
export const OPTION_WORDS = ['required', 'optional', 'secret'] as const

/** One field the walk found, located, so the validator can point at the second of two. */
export interface Field {
  type: string
  name: string
  at: Range
  line: number
  /** Whether a bracketed list follows the name, which is what a `choice` field needs. */
  listed: boolean
}

/** What one pass over the document produced. */
export interface FormState {
  form?: string
  fields: Field[]
}

const TYPES = defineVocabulary<FormState>({
  id: 'field-type',
  words: FIELD_TYPES,
  scope: 'field.type',
  unknownMessage: '"{word}" is not a field type — expected {allowed}.',
  unknownCode: 'unknown-field-type',
  docs: {
    text: { detail: 'one line of text', body: 'The only type that can be `secret`.' },
    number: { detail: 'a number', body: 'Digits, an optional sign, and at most one dot.' },
    bool: { detail: 'yes or no', body: 'Shown as a switch rather than as a field.' },
    choice: { detail: 'one of a list', body: 'A list follows the name in square brackets.' },
  },
})

const OPTIONS = defineVocabulary<FormState>({
  id: 'option',
  words: OPTION_WORDS,
  scope: 'option',
  docs: {
    required: { detail: 'cannot be left empty' },
    optional: { detail: 'may be left empty' },
    secret: { detail: 'never shown again' },
  },
})

export const formSchemaGrammar = defineGrammar<FormState>({
  id: 'form-schema',
  name: 'form schema',

  // A name may contain a hyphen, so `email-address` is ONE word: a completion replaces the whole
  // name and a double click selects all of it.
  wordChars: /[\p{L}\p{N}_-]/u,

  rules: [
    { kind: 'match', scope: 'comment', pattern: /#[^\n]*/ },
    { kind: 'match', scope: 'keyword', pattern: /form/, when: { prevNot: '\\w' } },
    { kind: 'match', scope: 'form.name', pattern: /[A-Za-z][\w-]*/, when: { after: ['keyword'] } },
    // A row starts with a field type. Anything else at the head of a line is reported rather
    // than quietly falling through to plain text.
    { kind: 'words', words: TYPES, when: { firstOnLine: true }, unknown: {} },
    { kind: 'words', words: OPTIONS },
    { kind: 'match', scope: 'name', pattern: /[A-Za-z][\w-]*/, when: { after: ['field.type'] } },
    { kind: 'region', scope: 'note', begin: /"/, end: /"/, unclosed: { severity: 'warning' } },
    { kind: 'match', scope: 'invalid', pattern: /\S+/ },
  ],

  fallbackScope: 'text',

  analyze: (text) => {
    const state: FormState = { fields: [] }
    const rows = text.split('\n')
    let offset = 0

    for (let index = 0; index < rows.length; index += 1) {
      const raw = rows[index] ?? ''
      const lineFrom = offset
      offset += raw.length + 1
      const declaration = /^\s*(\w+)\s+([\w-]+)/.exec(raw)
      if (declaration === null) continue

      const [whole, first, second] = declaration
      if (first === undefined || second === undefined) continue
      if (first === 'form') {
        state.form = second
        continue
      }
      const nameFrom = lineFrom + whole.indexOf(second)
      state.fields.push({
        type: first,
        name: second,
        at: { from: nameFrom, to: nameFrom + second.length },
        line: index,
        listed: raw.slice(whole.length).includes('['),
      })
    }

    return state
  },

  // ── a declaration that sees only a token ────────────────────────────────
  //
  // The check has no `allow` list, which is what makes it a shape rule rather than a membership
  // rule: every token in scope whose text does not match `except` is reported. It is the one
  // kind of complaint a lexical layer can raise without knowing anything about the document.
  checks: [
    {
      code: 'name-style',
      severity: 'warning',
      scopes: ['name'],
      except: /^[a-z][a-z0-9-]*$/,
      message: '"{word}" is not a field name — lower case, digits, and hyphens.',
      detail: 'The name is written into the form data as it stands.',
    },
  ],

  // ── a declaration that sees the whole document ──────────────────────────
  validate: (context) => {
    const seen = new Set<string>()
    for (const field of context.state.fields) {
      if (field.type === 'choice' && !field.listed) {
        context.report({
          from: field.at.from,
          to: field.at.to,
          message: `A choice field lists its options: ${field.name} [a, b].`,
          severity: 'info',
          code: 'choice-without-options',
        })
      }
      if (seen.has(field.name)) {
        context.report({
          from: field.at.from,
          to: field.at.to,
          severity: 'error',
          code: 'duplicate-field',
          message: `"${field.name}" is declared twice; the second row wins.`,
        })
      }
      seen.add(field.name)
    }
    if (context.state.fields.length === 0) {
      context.report({
        from: 0,
        to: context.text.length,
        severity: 'info',
        code: 'empty-form',
        message: 'A form with no fields collects nothing.',
      })
    }
  },

  describe: (context) => {
    const token = context.token
    if (token === undefined) return undefined
    if (token.scope === 'note') return { title: 'note', body: 'Shown under the field.' }
    const entry = token.scope === 'field.type' ? TYPES.entryFor(token.text) : OPTIONS.entryFor(token.text)
    if (entry === undefined) return undefined
    const info: HoverInfo = { title: token.text }
    if (entry.detail !== undefined) info.detail = entry.detail
    if (entry.body !== undefined) info.body = entry.body
    return info
  },

  compose: [
    {
      id: 'field-type',
      // `firstWord` rather than `firstOnLine`: the list has to stay eligible while the first
      // word is being spelled, not only when the line is still empty.
      when: (context) => context.firstWord,
      range: (context) => context.word,
      items: () =>
        FIELD_TYPES.map((type) => ({
          label: type,
          append: '  ',
          kind: 'type',
          detail: TYPES.entryFor(type)?.detail,
          documentation: TYPES.entryFor(type)?.body,
        })),
    },
    {
      id: 'option',
      // An option follows a name, and the name may itself still be half-typed.
      when: (context) =>
        context.tokens.some(
          (token) => token.line === context.line.number && token.scope === 'name' && token.to <= context.caret,
        ),
      range: (context) => context.word,
      items: () =>
        OPTION_WORDS.map((word) => ({
          label: word,
          kind: 'option',
          detail: OPTIONS.entryFor(word)?.detail,
          documentation: OPTIONS.entryFor(word)?.body,
        })),
    },
  ],
})

/** One diagnostic's worth, for a page that wants to show the shape of the state. */
export type FormProblem = Diagnostic
