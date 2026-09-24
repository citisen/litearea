# Options and methods

`createEditor(target, options)` returns an editor. The options are read once, when it mounts, with
three exceptions the last table lists; everything else changes through a method.

## What it needs

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `grammar` | `Grammar` \| `ResolvedGrammar` | — | Required. The language; nothing else in the library knows any syntax |
| `value` | `string` | `''` | The starting text, written once at construction, before any listener exists |
| `placeholder` | `string` | — | Shown while the box is empty |
| `readOnly` | `boolean` | `false` | Whether the reader may edit |
| `spellCheck` | `boolean` | `false` | A DSL is not prose |
| `ariaLabel` | `string` | — | The accessible name of the textarea |
| `className` | `string` | — | An extra class on the wrapper |

## Sizing

| Option | Default | What it does |
| --- | --- | --- |
| `sizing.autoGrow` | `true` | The height follows the content. `false` gives the field `resize: vertical` and the host owns the height |
| `sizing.minRows` | `1` | The fewest lines to show. Written to the textarea's native `rows`, so the first frame is already right |
| `sizing.maxRows` | — | The most lines before a scrollbar appears |
| `sizing.minHeight` | — | A minimum height in pixels, in addition to `minRows` |
| `sizing.maxHeight` | — | A maximum height in pixels, in addition to `maxRows` |

A maximum below the minimum is raised to the minimum rather than honoured. Past the clamp the field
scrolls, and the measured scrollbar width is published as `--litearea-scrollbar` so the layer wraps
where the field wraps.

## Behaviour

| Option | Default | What it does |
| --- | --- | --- |
| `completion` | `{}` | The completion list. `false` switches it off entirely |
| `completion.auto` | `true` | Whether the list opens while typing |
| `completion.triggerCharacters` | `''` | Extra characters that open it, such as `' '`. Empty by default, because a separator is the wrong moment to interrupt |
| `completion.limit` | `100` | The most rows to offer |
| `completion.showDocumentation` | `true` | The documentation panel |
| `completion.inline` | `false` | Draw the rest of the active row at the caret as an opaque chip |
| `completion.commitCharacters` | `true` | Whether a row's own `commitCharacters` may take a keystroke |
| `hover` | `{}` | Tooltips. `false` switches them off |
| `hover.enabled` | `true` | Whether tooltips appear at all |
| `hover.delay` | `140` | Milliseconds the pointer must rest |
| `sticky` | — | `{ kinds: ['block'] }` pins the header of the block the reader is inside, one row per level. Off unless passed |
| `indent.unit` | `2` | One level of indentation: a width in spaces, or the characters themselves (`'\t'`) |
| `keys` | `[]` | Extra bindings, tried BEFORE the defaults |
| `decorations` | `true` | Whether `decorate`'s ranges are painted |
| `injectStyles` | `true` | Whether the stylesheet is injected. `false` for a host that links `styles.css` |
| `styleNonce` | — | A CSP nonce for that injected stylesheet |
| `variables` | — | Custom properties for this instance. See [Theming](/docs/theming/) |

## Callbacks

| Callback | Called with | When |
| --- | --- | --- |
| `onChange` | the new text | After a USER edit. A write the library performs is marked as its own first and is not reported |
| `onSelectionChange` | `{ start, end, direction }` | When the caret or the selection moves |
| `onDiagnostics` | the problem list | Once at mount, then only when the list really changed — compared on position, code, and message |
| `onCompletion` | the open list, or `undefined` | When the list opens, filters, or closes |
| `onHover` | the tooltip, or `undefined` | When a tooltip appears or goes away |

## What the editor offers

| Member | What it does |
| --- | --- |
| `element` | The wrapper. Put it in the page |
| `input` | The real `<textarea>` |
| `value` | The text, as a getter |
| `setValue(text, preserveHistory?)` | Writes the field through the editing pipeline. `true` makes it one undoable edit; the default assigns, which clears the history |
| `selection` / `setSelection(start, end?)` | The selection, read and written |
| `inspection` | The last `inspect`: tokens, diagnostics, decorations, and the analysis |
| `diagnostics` | The problem list on its own |
| `currentCompletion` | The open list, if there is one |
| `focus()` / `focused` | Focus the field, and whether it has it |
| `undo()` / `redo()` | The browser's own history. Each reports whether the call was possible |
| `showCompletions()` / `hideCompletions()` | What `Ctrl+Space` and `Escape` do |
| `setVariables(record)` | Replaces the custom properties this method set last time |
| `refresh()` | Re-resolves the grammar and re-measures. This is what makes a live grammar object work, and what keeps the undo history across a language change |
| `destroy()` | Removes the editor and every listener it owns |

## In React

`LiteAreaEditor` takes the options above plus `defaultValue`, `value`, `preserveHistory`,
`editorRef`, and `className`, and renders one empty `div` that the editor is mounted inside. The
text never passes through React — assigning a textarea's `value` is what clears the undo history —
so `defaultValue` is the prop for the starting text and `value` is for a host that wants to write
one.

Three props are re-read on every render: `grammar`, `value`, and `readOnly`. The grammar is the one
that is safe to rebuild on every render, because `refresh()` re-resolves it without rebuilding the
element. Everything else — `sizing`, `completion`, `hover`, `sticky`, `indent`, `keys`,
`decorations`, `injectStyles`, `styleNonce` — is read when the editor mounts.
