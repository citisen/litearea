# A code editor over a plain `<textarea>`.

`@citisen/litearea` turns a string and a grammar into tokens, diagnostics, decorations, and
completion rows, and puts the result behind a real `<textarea>`: highlighting, squiggles, a
completion list, and hover tooltips, with the browser's own undo stack intact.

The library does not own the text. The textarea owns it, the browser's editing pipeline edits it,
and litearea only reads it. That one decision is why undo survives an accepted completion, why the
caret never jumps to the end mid-word, and why the colours cannot disagree with the field they are
painted over.

```sh
npm install @citisen/litearea
```

::: claims

### The field is written once.

At construction, before any listener exists. Every edit litearea makes on the reader's behalf goes
through `document.execCommand('insertText')`, so the browser records it in its own history: one
edit, one Ctrl+Z. Assigning `value` from script is what clears that history and resets the caret,
which is why no API does it.

### Nothing rewrites the text under the caret.

The coloured layer reads the field and never writes it. The only selection writes are the ones a
completion asked for.

### One parse per text.

`inspect(text, grammar)` runs once per change, and the paint, the squiggles, the semantic marks, the
completion list, and the tooltip all read that one value. A word cannot be painted as valid while
the completer calls it unknown, because there is no second parse to disagree with.

:::

## What it does

| Feature | How |
| --- | --- |
| Undo and redo | The browser's own history on the field. Every library edit goes through `execCommand('insertText')` |
| Highlighting | `rules` paint scopes. A scope becomes the class `litearea-scope-<scope>`, and your stylesheet decides the rest |
| Completion | Sources over a range recomputed from the caret on every filter, tiered fuzzy ranking, a documentation panel, commit characters |
| Diagnostics | Vocabulary rejections, declarative `checks`, and a `validate` hook, merged and painted in four severities |
| Hover tooltips | A diagnostic outranks everything; otherwise the decoration's title and the grammar's `describe` |
| Typing aids | Declared `pairs` close themselves, wrap a selection, and step over their own closer; `Ctrl+/` toggles comments |
| Sticky headers | Decoration kinds named by `sticky.kinds` are blocks, and the header you are inside is pinned to the top of the box |
| Auto-sizing | An offscreen mirror is measured instead of the live field, and the measured scrollbar width is published so the paint cannot wrap differently |
| Weight | No runtime dependencies, no CodeMirror, no Monaco, no virtual DOM in the engine |

## What it is not

There are no line numbers, no search, no multiple cursors, no bracket matching, no folding, and no
snippets. There is no bundled language: a caller supplies the rules, and the six
[examples](/examples/) are six grammars written for this site rather than six that ship with the
package. [Limits](/docs/limits/) lists the rest, including the two or three places where the
platform decides for the library.

## Start here

- [Documentation](/docs/) — install, a first editor, and every reference page.
- [Examples](/examples/) — six languages, each one running on its own page.
- [Playground](/playground/) — write a grammar and watch the parse.
