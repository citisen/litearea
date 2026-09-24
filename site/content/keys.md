# Keys and commands

The keymap is data. `DEFAULT_KEYS` is exported and says exactly what the editor answers to; a host's
`keys` are tried before it, so a binding can be moved, added, or taken away without restating the
rest.

## The commands

`Command` is a closed set — the things the editor already knows how to do. A binding names one of
them, and it is not a callback, because a host's callback could not be kept consistent with state
the editor owns.

| Command | What it does | Applies when |
| --- | --- | --- |
| `indent` / `outdent` | A unit of indentation at the caret, or on every line the selection touches | The list is closed |
| `indentLines` / `outdentLines` | The same, always whole lines including the caret's | The list is closed |
| `toggleComment` | Add or remove the language's comment markers | The list is closed |
| `enterBracket` | Open an indented block between a declared pair | The list is closed |
| `openList` | Open the completion list, or close it when it is already open | Completions are on |
| `closeList` | Close the list | The list is open |
| `acceptRow` | Take the active row | The list is open |
| `moveRowUp` / `moveRowDown` / `moveRowPageUp` / `moveRowPageDown` | Move the active row | The list is open |
| `hideTooltip` | Hide the tooltip | Always |
| `ignore` | Nothing, and the key goes back to the browser | Always |

There is no `when` expression, and that is what keeps the table small: a binding whose command does
not apply right now is passed over, and the editor decides that rather than the host. One key can
therefore carry two bindings — which is how `Tab` accepts a row while the list is open and would
indent with it closed — with no condition syntax anywhere.

## The defaults

| Key | Command |
| --- | --- |
| `Enter` | `acceptRow`, then `enterBracket` |
| `Tab` | `acceptRow` |
| `ArrowDown` / `ArrowUp` | `moveRowDown` / `moveRowUp` |
| `PageDown` / `PageUp` | `moveRowPageDown` / `moveRowPageUp` |
| `Escape` | `closeList`, then `hideTooltip` |
| `Mod+Space` | `openList` |
| `Mod+/` | `toggleComment` |

`Mod` is `Ctrl` on Windows and Linux and `Cmd` on a Mac. The four indent commands are deliberately
absent: `Tab` is how a reader leaves a form, and a library that takes it away turns every field into
a keyboard trap.

## Rebinding

```ts
createEditor(target, {
  grammar,
  indent: { unit: '\t' },          // or 4, or '    '
  keys: [
    { key: 'Tab', command: 'indent' },
    { key: 'Shift+Tab', command: 'outdent' },
    { key: 'Mod+]', command: 'indentLines' },
    { key: 'Mod+[', command: 'outdentLines' },
    // Give a default key back to the browser.
    { key: 'Escape', command: 'ignore' },
  ],
})
```

A host's bindings are tried first and the defaults after them, so the list above is the whole of
what changed. `ignore` is how a key is handed back: it matches, it suppresses anything below it, and
it performs nothing, so the browser's own handling happens as if the editor had never seen the key.
It is also the honest answer for a command with nothing to do — an outdent at the margin does not
consume the keystroke either.

`keyCombo(event)` writes a press the way a binding spells it, which is what a host needs to log a
chord or to build a shortcut prompt.

## What is not a binding

Two things read a keystroke and are not in the table, both on purpose.

**A key that moved the caret closes a list the caret has walked out of.** No key is named for this —
not the arrows, not Home or End — because the key is beside the point: the editor asks whether the
caret is still inside the range the list was opened over, so `Ctrl+Arrow`, a word jump, and anything
bound later are covered.

**A completion row's `commitCharacters` take a keystroke while the list is open.** They are the
row's own data — a source declares them and nothing has any by default — so there is no chord to
bind. `completion: { commitCharacters: false }` switches the behaviour off for the whole editor.

## What the reader sees

| Key | What happens |
| --- | --- |
| `ArrowDown` / `ArrowUp` | Move the active row by one. It stops at the ends instead of wrapping |
| `PageDown` / `PageUp` | Move the active row by eight |
| `Enter` | Accept the active row; with no list open, open an indented block between a declared pair |
| `Tab` | Accept the active row. Not indent |
| `Escape` | Close the list; with no list open, hide the tooltip |
| `Ctrl+Space` | Open the list, or close it when it is already open |
| `Ctrl+/` | Toggle the language's comment markers |
| a row's `commitCharacters` | Accept the active row and write the character after it, so the keystroke is not swallowed |
| `Ctrl+Z`, `Ctrl+Shift+Z`, `Ctrl+Y` | **Not intercepted.** These are the browser's own undo and redo on the field |
| `Shift+Arrow`, `Home`, `End` | Not intercepted. They move the caret, and the editor then closes a list the caret has walked out of |
