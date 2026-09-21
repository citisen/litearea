# litearea

[English](README.md) | [中文](README.zh.md)

**A code editor over a plain `<textarea>`: undo and redo that work, highlighting from rules you write, and VSCode-shaped completion — with no runtime dependency.**

`@citisen/litearea` is a library, not a plugin. Nothing here registers with an
interface, reads a settings namespace, or knows what a favicon is. It is a small
engine that turns a string and a grammar into tokens, diagnostics, decorations,
and a list of suggestions, plus a thin DOM layer that puts all of that behind a
real textarea. The React binding is optional and separate.

The interesting decision is what the library does *not* do: it does not own the
text. The textarea owns it, the browser's editing pipeline edits it, and the
library only ever reads it.

## Why

The two DeepSeek Harness plugins this came out of — `dsh-font` and `dsh-sentry` —
each contain a small DSL, and each grew its own editor over a textarea. Both went
wrong in the same three ways:

- the completion list felt like it was fighting the typist,
- Ctrl+Z stopped working as soon as a suggestion was accepted,
- the caret jumped to the end while the user was editing the middle of a line.

Those were not three bugs. They were one bug with three faces: the text lived in
component state, was written back into the textarea on every keystroke, and was
then read three separate times — once to paint, once to diagnose, once to
suggest — by three passes that could disagree.

Assigning a textarea's `value` from script is not an edit. It replaces the
element's content, and with it the browser's undo stack, and it resets the
selection to the end. That single call is why undo was gone *and* why the caret
moved. The third symptom is the three passes: a word could be painted as a valid
value while the completer called it unknown and the squiggle pointed at a range
that had already moved.

So this library makes the opposite choices, and each one is load-bearing:

- **Undo and redo survive, because the DOM owns the text.** The field is written
  once, at construction, before any listener exists. Every edit the library makes
  on the user's behalf goes through `document.execCommand('insertText')`, so the
  browser records it in its own undo stack — one edit, undoable with the
  browser's own Ctrl+Z. There is deliberately no replacement API: a synthetic
  `input` event is untrusted and the browser refuses to run it through the
  editing pipeline, and `setRangeText` changes the text while bypassing the
  history.
- **The caret does not move, because nothing rewrites the text under it.** The
  layer reads the field; it never writes it. The only selection writes are
  `setSelectionRange` calls a completion asked for.
- **One parse per text.** `inspect(text, grammar)` runs once, and the paint, the
  squiggles, the semantic marks, the completion list, and the hover tooltip all
  read that same value. They cannot drift because there is nothing to drift from.

## Install

```sh
npm install @citisen/litearea
```

Three entry points and one stylesheet:

| Import | What it is |
| --- | --- |
| `@citisen/litearea` | The pure engine plus the DOM layer (`createEditor`, `LiteArea`) |
| `@citisen/litearea/react` | The React binding (`LiteAreaEditor`) |
| `@citisen/litearea/grammars` | The two worked example grammars |
| `@citisen/litearea/styles.css` | The same stylesheet the editor injects, for hosts that link CSS |

React is an optional peer dependency (`react >= 18`) and the only peer. The
package has no runtime dependencies at all. The stylesheet is injected into the
document once, on the first editor, unless `injectStyles: false` is passed.

## Quick start

Vanilla, with a grammar small enough to read:

```ts
import { createEditor, defineGrammar, defineVocabulary } from '@citisen/litearea'

// A vocabulary declares the four facts a closed word set needs — the words, the
// scope they are painted with, the message a non-member earns, and the
// documentation a hover shows — which is why they cannot drift apart.
const COLORS = defineVocabulary({
  id: 'color',
  words: ['red', 'green', 'blue'],
  unknownMessage: '"{word}" is not a colour — expected {allowed}.',
  docs: { red: 'The default swatch.' },
})

const grammar = defineGrammar({
  id: 'swatch',
  // Rules are tried in order at every position; the first match wins.
  rules: [
    { kind: 'match', scope: 'comment', pattern: /#[^\n]*/ },
    { kind: 'words', words: COLORS, unknown: {} },
  ],
  compose: [
    {
      id: 'color',
      range: (context) => context.word,
      items: () =>
        ['red', 'green', 'blue'].map((color) => ({ label: color, kind: 'color' })),
    },
  ],
})

const editor = createEditor(document.querySelector('#editor')!, {
  grammar,
  value: 'red  # a comment',
  placeholder: 'red, green, blue',
  onChange: (value) => {
    // Reports the user's own edits. A write the library performs — a completion, or
    // setValue below — is marked before it happens and is not reported back.
    console.log(value)
  },
})

// A host-driven write. `true` makes it one undoable edit, so Ctrl+Z brings the
// previous text back; the default is a plain assignment, which clears the history.
editor.setValue('green', true)
```

React, with the same `grammar` object:

```tsx
import * as React from 'react'
import type { LiteArea } from '@citisen/litearea'
import { LiteAreaEditor } from '@citisen/litearea/react'
import { grammar } from './swatch-grammar'

export function SwatchEditor() {
  const [text, setText] = React.useState('')
  const editorRef = React.useRef<LiteArea | null>(null)

  return (
    <>
      <LiteAreaEditor
        grammar={grammar}
        defaultValue="red  # a comment"
        onChange={setText}
        sizing={{ minRows: 2, maxRows: 10 }}
        editorRef={(editor) => {
          editorRef.current = editor ?? null
        }}
      />
      <button type="button" onClick={() => editorRef.current?.undo()}>
        Undo
      </button>
      <pre>{text}</pre>
    </>
  )
}
```

`LiteAreaEditor` renders one empty `div` and mounts the imperative editor inside
it. It never passes the text through React, for the reason in [Why](#why): doing
so is what breaks undo. `defaultValue` is the prop to use for the starting text;
`value` exists for a host that wants to write text (a Reset button, loading a
different document), it is written through the editing pipeline so it stays
undoable, and it does not call `onChange` — the caller already knows what it wrote.

## What it does

| Feature | The mechanism behind it |
| --- | --- |
| Undo and redo | The field is written once, at construction. Every library edit goes through `execCommand('insertText')`, so the browser's own history records it |
| A caret that stays put | Nothing rewrites the text under it; the only selection writes are the ones a completion asked for |
| Custom highlighting | `rules` paint scopes; a scope becomes the class `litearea-scope-<scope>`, and the stylesheet decides the rest. The core ships no syntax at all |
| Completion | Sources over a range recomputed from the caret on every filter, tiered fuzzy ranking, a documentation panel, commit characters, and mouse picks that do not blur the field |
| Diagnostics | A vocabulary's rejection, declarative `checks`, and a `validate` hook, merged, deduplicated, and painted as squiggles in four severities |
| Hover tooltips | `resolveHover`: a diagnostic outranks everything else; otherwise a decoration's title and the grammar's own `describe` are shown together |
| Semantic marks | `decorate` returns ranges that are deliberately not tokens, painted as `litearea-dec-<kind>` and recomputed without re-lexing |
| Auto-sizing | An offscreen mirror is measured instead of the live field; height and overflow are written, and the measured scrollbar width is published for the layer |
| One parse per text | `inspect` produces tokens, diagnostics, decorations, and the analysis together, cached on the text; the paint is skipped when text and analysis are unchanged |
| Keyboard and a11y | `role="combobox"`, `aria-expanded`, `aria-activedescendant`, `aria-invalid`, `aria-label`, and a listbox with real row ids |
| Weight | No runtime dependencies, no CodeMirror, no Monaco, no virtual DOM in the engine |

## Writing a grammar

A grammar is one object. This one describes a tiny form schema:

```
# the signup form
form signup
  text    email     required
  text    password  secret   "at least 12 characters"
  number  age       optional
```

```ts
import { defineGrammar, defineVocabulary } from '@citisen/litearea'

const FIELD_TYPES = ['text', 'number', 'bool'] as const
const OPTION_WORDS = ['required', 'optional', 'secret'] as const

const TYPES = defineVocabulary({
  id: 'field-type',
  words: FIELD_TYPES,
  scope: 'field.type',
  unknownMessage: '"{word}" is not a field type — expected {allowed}.',
  docs: {
    text: { detail: 'one line of text', body: 'The only type that can be `secret`.' },
    number: { detail: 'a number' },
    bool: { detail: 'yes or no' },
  },
})

const OPTIONS = defineVocabulary({
  id: 'option',
  words: OPTION_WORDS,
  scope: 'option',
  docs: {
    required: { detail: 'cannot be left empty' },
    optional: { detail: 'may be left empty' },
    secret: { detail: 'never shown again' },
  },
})

export const formSchema = defineGrammar({
  id: 'form-schema',
  name: 'form schema',
  // A name may contain a hyphen, so `email-address` is ONE word: completion
  // replaces the whole name and a double click selects all of it.
  wordChars: /[\p{L}\p{N}_-]/u,
  rules: [
    { kind: 'match', scope: 'comment', pattern: /#[^\n]*/ },
    { kind: 'match', scope: 'keyword', pattern: /form/, when: { prevNot: '\\w' } },
    {
      kind: 'match',
      scope: 'form.name',
      pattern: /[A-Za-z][\w-]*/,
      when: { after: ['keyword'] },
    },
    // A row starts with a field type. Anything else at the head of a line is
    // reported rather than quietly falling through to plain text.
    { kind: 'words', words: TYPES, when: { firstOnLine: true }, unknown: {} },
    { kind: 'words', words: OPTIONS },
    { kind: 'match', scope: 'name', pattern: /[A-Za-z][\w-]*/, when: { after: ['field.type'] } },
    { kind: 'region', scope: 'note', begin: /"/, end: /"/, unclosed: { severity: 'warning' } },
    { kind: 'match', scope: 'invalid', pattern: /\S+/ },
  ],
  fallbackScope: 'text',
  compose: [
    {
      id: 'field-type',
      // `firstWord` rather than `firstOnLine`: the list has to stay eligible while
      // the first word is being spelled, not only when the line is still empty.
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
          (token) =>
            token.line === context.line.number &&
            token.scope === 'name' &&
            token.to <= context.caret,
        ),
      range: (context) => context.word,
      items: () =>
        OPTION_WORDS.map((word) => ({
          label: word,
          kind: 'option',
          detail: OPTIONS.entryFor(word)?.detail,
        })),
    },
  ],
  describe: (context) => {
    const token = context.token
    if (token === undefined) return undefined
    if (token.scope === 'note') return { title: 'note', body: 'Shown under the field.' }
    const entry =
      token.scope === 'field.type' ? TYPES.entryFor(token.text) : OPTIONS.entryFor(token.text)
    return entry === undefined ? undefined : { title: token.text, body: entry.body }
  },
})
```

That is the whole language: eight rules, two vocabularies, two completion
sources, and a hover. `TYPES` is painted through a vocabulary, so a word in the
wrong place earns one message instead of being silently plain; `OPTIONS` is a
plain rule that never rejects, so a rule lower down still gets its turn at a word
it does not know.

The complete reference — every field of every rule kind, precedence, the
diagnostic vocabulary, and an end-to-end walkthrough that adds `analyze`,
`checks`, and `validate` to this same language — is in
[docs/grammar.md](docs/grammar.md).

## The two reference grammars

The core ships no syntax: there is no built-in language, no language identifier
to switch on, and nothing in `src/core/` that knows what a font stack is. The two
grammars in `@citisen/litearea/grammars` exist to check that claim rather than
merely assert it. Both are real DSLs from the two plugins this library came out
of, and both are importable by a host that does not want to retype a language
that already exists:

| Grammar | The language | What it exercises |
| --- | --- | --- |
| `dshSentryStyleGrammar()` | dsh-sentry's appearance document: one line per session state, then positional values or `key=value` pairs | A first-word vocabulary with rejection, an analysis that both fills slots and records the problems it found, a declarative `check`, two completion sources using `sortText`, and hover from vocabulary documentation |
| `dshFontQueryGrammar()` | dsh-font's font query: a CSS font-family list with the weight written beside the family it belongs to | Quote handling in the lexical rules, a `scope` function that reads the analysis, dynamic vocabularies resolved from the host's installed catalogue, multi-word phrases, completion that inserts *before* an entry, and a semantic decoration |

Neither is built in. Nothing in `src/core/` imports them, no option switches them
on, and an editor constructed without one of them has no syntax whatsoever.

Two decisions in `dshSentryStyleGrammar` are worth stating, because both were
found by comparing the grammar against the parser it edits for:

- **It is deliberately stricter than the host parser.** `parseStyle` in the
  plugin does no value checking for a known option: it writes `shape=bogus` into
  the rule and lets `resolveLook` substitute the shipped default later, so a typo
  shows up as an icon that simply never changed. The grammar reports it — as a
  warning rather than an error, because the document still works, it just does
  not mean what it says.
- **It does not accept `fallback` as a state.** The plugin's own module comment
  shows a `fallback none` line, but `STYLE_STATES` holds only the four states and
  `fallback` is derived internally from `STYLE_FALLBACK_LOOK`; it has never been
  parseable. That comment is stale, and copying it into the grammar would have
  made the editor disagree with the parser it edits for.

## Auto-sizing

Five options, one behaviour each:

| Option | Default | What it does |
| --- | --- | --- |
| `autoGrow` | `true` | The height follows the content. With `false` the field gets `resize: vertical` and the host owns the height |
| `minRows` | `1` | The fewest lines to show. Written to the textarea's native `rows` attribute, so the first frame is already right |
| `maxRows` | — | The most lines to show before a scrollbar appears |
| `minHeight` | — | A minimum height in pixels, in addition to `minRows` |
| `maxHeight` | — | A maximum height in pixels, in addition to `maxRows` |

The three behaviours the brief above adds up to:

- **It grows and shrinks to fit, and shows no scrollbar while it fits.** When the
  measured content height is under the maximum, that height is written to the
  field and `overflow-y` stays `hidden`.
- **A maximum introduces a scrollbar.** Past the clamp the height is fixed and
  `overflow-y` becomes `auto`. A scrollbar narrows the text, so the measured
  scrollbar width is published as `--litearea-scrollbar` and added to the layer's
  own padding, or the paint would wrap differently from the field and every
  colour would slide off its character.
- **A minimum sets the floor**: `minHeight`, or `minRows` worth of line boxes,
  plus the field's vertical padding and border. A maximum below the minimum is
  raised to the minimum rather than honoured, because honouring it would make the
  box smaller than the host said it could be.

An unmounted field is not measured at all: before the element is in the document
it has no layout, so its width is zero and the measurement comes back several
times too tall. `createEditor` does the first measurement synchronously after
mounting for exactly this reason, and a host constructing `LiteArea` directly
should call `refresh()` after appending `editor.element`.

## Keyboard

Everything the editor intercepts, and what it deliberately leaves alone:

| Key | What it does |
| --- | --- |
| `ArrowDown` / `ArrowUp` | Move the active row by one. It stops at the ends instead of wrapping |
| `PageDown` / `PageUp` | Move the active row by eight |
| `Enter` | Accept the active row |
| `Tab` | Accept the active row |
| `Escape` | Close the list; with no list open, hide the tooltip |
| `Ctrl+Space` / `Cmd+Space` | Open the list, or close it when it is already open |
| a row's `commitCharacters` | Accept the active row and write the character after it, so the keystroke is not swallowed. The list then closes |
| `Ctrl+Z`, `Ctrl+Shift+Z`, `Ctrl+Y` | **Not intercepted.** These are the browser's own undo and redo on the field, which is the whole point of being uncontrolled |
| `Shift+Arrow`, `Home`, `End` | Not intercepted. They move the caret without an `input` event, so the editor just closes a list the caret has walked out of |

## Theming

A scope becomes a class (`litearea-scope-value-color`), a decoration kind becomes
a class (`litearea-dec-effective`), and a severity becomes a class
(`litearea-diag-error`). Dots and other punctuation fold to hyphens, so
`value.color` is selected as `litearea-scope-value-color` and never needs a
backslash.

Colours, spacing, and the type scale come from custom properties on the wrapper:

| Property | Default |
| --- | --- |
| `--litearea-font` | A monospace stack starting at `ui-monospace` |
| `--litearea-font-size` | `13px` |
| `--litearea-line-height` | `20px` |
| `--litearea-padding-block` / `--litearea-padding-inline` | `6px` / `10px` |
| `--litearea-radius` | `8px` |
| `--litearea-fg` / `--litearea-fg-dim` / `--litearea-fg-strong` | `#1f2328` / `#6b7280` / `#111827` |
| `--litearea-bg` / `--litearea-bg-raised` | `#ffffff` |
| `--litearea-border` / `--litearea-border-focus` | `#d8dbe0` / `#4d6bfe` |
| `--litearea-accent` / `--litearea-accent-soft` / `--litearea-selection` | `#4d6bfe` and two alpha variants |
| `--litearea-error` / `--litearea-warning` / `--litearea-info` / `--litearea-hint` | The four severity colours |
| `--litearea-shadow` | The floating panel's shadow |
| `--litearea-scope-*` | One colour per scope the two reference grammars use |

A dark scheme is applied automatically from `prefers-color-scheme`.

### A custom theme, or a custom font

Both are the same mechanism, and there are two ways to reach it. From CSS, scoped to whatever
you like:

```css
.myEditor .litearea {
  --litearea-font: "IBM Plex Mono", ui-monospace, monospace;
  --litearea-font-size: 12px;
  --litearea-line-height: 18px;
  --litearea-scope-comment: #8b919b;
  --litearea-scope-value-color: #0f766e;
}
```

Or per instance, without writing a stylesheet rule — which is what the `variables` option is
for, and the only way to give two editors on one page two different faces:

```ts
createEditor(target, {
  grammar,
  value: 'running circle blue turn 3',
  variables: {
    font: 'Georgia, serif',      // any face: see below
    'font-size': '15px',
    'line-height': '26px',
    'scope-state': '#b91c1c',
    accent: '#c2410c',
    '--my-brand': 'hotpink',     // a name that starts with -- is used verbatim
  },
})
```

A key may be written `font`, `litearea-font`, or `--litearea-font`. Calling
`editor.setVariables({ … })` replaces what that method set last time, so a property you drop
falls back to CSS rather than lingering. In React the same prop is applied live, and an inline
object literal is fine — the records are compared by value.

**Any font works, including a proportional one.** The question a host asks first is whether
alignment survives a face the editor did not choose, and it does: the painted layer, the real
textarea, and the offscreen mirror that measures them all read the same computed font, so they
wrap identically whatever it is. Monospace is the *default*, not a requirement, and a
proportional face will look odd for code while still being perfectly aligned.

What is not yours to change is ligatures and kerning, which are forced off. A ligature draws one
glyph where the field holds two characters, and the layer splits its spans wherever a diagnostic
or a decoration begins — so a split would leave one glyph in the field and two in the paint, at
different widths, and the rest of the line would slide out from under its colour. Turning them
off removes the possibility rather than hoping no span boundary ever lands inside a pair.

Changing those properties is safe because the layer, the field, and the mirror
all read them. Adding a text property to the layer alone is not: the layer may
change colour, background, and `text-decoration`, and nothing that moves a glyph.
`--litearea-scrollbar` is written by the editor; do not set it.

## Limits and honest notes

- **`document.execCommand` is deprecated and there is no replacement.** It is
  also the only way to change a textarea's value while keeping the browser's undo
  stack. Where it is missing, an edit still lands through `setRangeText` but the
  history does not get it — `canEditThroughPipeline()` reports which environment
  you are in, and `EditOutcome` tells you per edit whether it was `'pipeline'`,
  `'direct'`, or `'unchanged'`.
- **The layer's typography is fixed to one monospace face and ligatures are off.**
  A ligature draws one glyph in the layer where the field draws two, so every
  character after it would be painted in the wrong place.
- **`onChange` reports the user's edits only.** Every write the library performs — a
  completion, or `setValue` in either mode — is marked as its own before it happens,
  so the caller is never handed its own change back. The React `value` prop goes
  through `setValue`, so it is silent too.
- **`onDiagnostics` fires once when the editor mounts**, even when the document is
  clean, and then only when the problem list really changed — compared on position,
  code, and message. A host waiting to be told its list was clear therefore hears it.
- **In the React binding, `sizing`, `completion`, `hover`, `decorations`,
  `injectStyles`, and `styleNonce` are read when the editor mounts.** Changing
  one of them later re-renders the wrapper and nothing else. Only `grammar`,
  `value`, and `readOnly` are re-read on every render, and only the grammar is
  safe to rebuild on every render (`refresh()` re-resolves it without rebuilding
  the element, which is what keeps the undo history across a language change).
- **The painted layer can only change colour, background, and text-decoration.**
  Anything that changes an advance — another font, a weight, letter spacing, a
  font feature — slides the paint off the character it belongs to by a different
  amount on every character.
- **`inspect` runs the whole scan for each new text.** There is no incremental
  re-lex, so a very large document costs a full pass per keystroke. The paint is
  skipped when the text and the analysis are unchanged, which is what keeps
  caret moves and hovers cheap.
- **Hover needs a caret hit-test.** It asks
  `caretPositionFromPoint`/`caretRangeFromPoint` where the pointer is;
  `hasCaretHitTest()` reports whether the environment has either. Without one the
  tooltip simply never appears.
- **Nothing here is a full editor.** There are no line numbers, no search, no
  multiple cursors, no bracket matching, no folding, no snippets, and no undo
  button — the browser's own history is the undo stack, and `editor.undo()` and
  `editor.redo()` are thin wrappers over it that report only whether the call was
  possible.
- **Hover tooltips and the documentation panel are plain text.** There is no
  markdown rendering and no HTML: a font family called `<b>` is shown as `<b>`.
- **There is no `'commit'` completion trigger.** A commit character accepts the row,
  writes the character and closes the list; whatever is typed next is an ordinary
  `'auto'` trigger. `CompletionTrigger` is `'auto' | 'explicit'`.

## License

MIT
