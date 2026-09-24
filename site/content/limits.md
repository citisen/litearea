# Limits

What the library does not do, what it cannot do, and where the platform decides. Every one of these
is a decision that was made deliberately; the ones that are not decisions are marked.

## Not in it

- **No line numbers, no search, no multiple cursors, no folding, no snippets.** These are whole
  features, not options, and the library is small on purpose.
- **No bracket matching.** A declared pair is closed while you type, but a bracket's partner is
  never highlighted.
- **No undo button.** The browser's own history is the undo stack; `editor.undo()` and
  `editor.redo()` report only whether the call was possible.
- **No grammar.** No built-in language, no language identifier, no bundled tokenizer, and no
  grammar entry point. A caller supplies the rules.
- **No Markdown and no HTML** in hover tooltips or the documentation panel. Text that says
  `<b>` reaches the reader as a literal `<b>`, not as a bold word.

## Where the platform decides

- **`document.execCommand` is deprecated and there is no replacement.** It is also the only way to
  change a textarea's value while keeping the browser's undo stack. Where it is missing an edit
  still lands, through `setRangeText`, but the history does not get it — `canEditThroughPipeline()`
  reports which environment you are in, and every edit reports whether it was `'pipeline'`,
  `'direct'`, or `'unchanged'`.
- **Hover needs a caret hit-test.** It asks `caretPositionFromPoint` or `caretRangeFromPoint` where
  the pointer is; `hasCaretHitTest()` reports whether the environment has either. Without one the
  tooltip simply never appears.
- **A web font arriving late moves the metrics.** The mirror re-measures when `document.fonts.ready`
  resolves, without which the editor is a few pixels off until something else causes a re-layout.

## What the paint may change

The painted layer sits behind the field and draws the same characters, so it may change colour,
background, and `text-decoration`, and nothing that moves a glyph. Another font, a weight, a
letter-spacing, or a font feature changes an advance, and the rest of the line slides out from under
its colour. This is why the theming hooks are a colour per scope plus a class per decoration kind,
and why ligatures and kerning are forced off.

## Two things that surprise people

- **`onChange` reports the reader's edits, including an accepted completion.** Every write the
  library performs by itself — the initial text, and `setValue` in either mode — is marked as its
  own before it happens, so a host is never handed its own change back. Accepting a row is the
  reader's edit, so it is announced.
- **`onDiagnostics` fires once when the editor mounts**, even when the document is clean, and then
  only when the list really changed, compared on position, code, and message. A host waiting to be
  told its list was clear therefore hears it.

## Cost

`inspect` runs the whole scan for each new text. There is no incremental re-lex, so a very large
document costs a full pass per keystroke; the paint is skipped when the text and the analysis are
unchanged, which is what keeps a caret move and a hover cheap. Sticky headers add one walk of the
painted text nodes, cached until the paint changes.

## In React

`sizing`, `completion`, `hover`, `sticky`, `indent`, `keys`, `decorations`, `injectStyles`, and
`styleNonce` are read when the editor mounts; changing one later re-renders the wrapper and nothing
else. Only `grammar`, `value`, and `readOnly` are re-read on every render, and only the grammar is
safe to rebuild on every render.
