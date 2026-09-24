# Examples

Six complete languages — rules, vocabularies, diagnostics, completion, hover — each running live on
its own page. None of them is in the package.

::: ledger
01 | Swatch | /examples/swatch/ | A vocabulary the host supplies rather than the file, a `sortText` that ranks unused colours first, and a decoration for the base coat.
02 | Form schema | /examples/form-schema/ | Two vocabularies, a `note` region, a declarative check, a walk of the whole document, and two completion sources that read it.
03 | Mini conf | /examples/mini-conf/ | A nesting region, commit characters that accept a row on a space, and a completion whose rows depend on the key before the caret.
04 | Sticky headers | /examples/sticky/ | Two kinds of block, nested, pinned one row per level — which needs a document taller than its box.
05 | Typing aids | /examples/typing-aids/ | Pairs that close themselves, a selection that wraps, an indented block on Enter, and a comment toggle.
06 | Completion | /examples/completion/ | Tiered ranking, a documentation panel, commit characters, and the inline preview that draws the rest of the row at the caret.
:::

Each page has the code the page actually runs, quoted from the file it runs it from, and one live
editor mounted with `createEditor`. Here is that editor in the flow of a page rather than pinned
beside it:

::: live swatch label=swatch
:::

The readouts under these editors come from the editor's own callbacks — `onDiagnostics`,
`onCompletion`, `onChange` — rather than from a second parse of the text.

## Why no grammar ships with it

There is no JavaScript, CSS, Markdown, or JSON grammar here, and that is a statement about the
library rather than about this page. A grammar belongs where the language is parsed: the two
production DSLs this editor came out of live beside the plugins that own them, as objects those
plugins hand to `createEditor`.

Shipping either one would be a scaling trap as much as an inconsistency. Every consumer that inlines
the library would carry every language, so adding a JavaScript grammar later would grow the bundle
of every host that uses none of them.
