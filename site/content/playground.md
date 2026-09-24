# Playground

The left pane is a document. The right pane is the language, as source, and it is a litearea editor
too — painted by a litearea grammar written for litearea grammars. Under both, what the engine says
about the document right now.

Type in the document and the readout follows. Edit the grammar, press apply, and the document is
re-read against it. The document's undo history survives the change of language.

::: bench
:::

## How a grammar is applied

The grammar pane's text is run with `new Function`, with `defineGrammar` and `defineVocabulary`
passed in as parameters. That is why the three presets are expressions with no imports, and it is
also the limit of what a grammar can reach: nothing on the page except the two definitions it is
handed.

A source that does not evaluate is reported beside the pane it came from, and the last working
language stays in force. A syntax error is the most likely thing to happen here, so it must not be
able to take the page with it.

## What the readout is

The panel under the editors calls `inspect` on the same text with the same grammar, which is the
call the editor itself makes on every keystroke.

| Section | Where it comes from |
| --- | --- |
| Tokens | Every token the rule list produced, with its scope. Whitespace is left out; nothing paints it |
| Problems | The vocabulary rejections, the `checks`, and the `validate` hook, merged and deduplicated — the same list the squiggles come from |
| Decorations | The ranges `decorate` returned, which are deliberately not tokens |
| Completion rows | The rows the editor last reported, ranked, with the kind and detail each one carries |
| Analysis | Whatever `analyze` returned, which is what `validate`, `describe`, and every completion source read |

## Things to try

- Put the caret at the end of `red circle 20` and press `Ctrl+Space`: accepting a row writes the
  trailing space, so the next word can be typed straight away.
- In the **conf** preset, type a key that is not in the `words` array, then add it, press apply, and
  watch the squiggle go.
- Change `firstOnLine` to `minColumn: 4` in the palette's colour rule and press apply. The colour
  set stops applying at the head of a line and every colour below it becomes plain text.
- Delete a closing brace and press apply: the message names the line, and the document keeps the
  language it had.
- Add a `describe` hook that returns `{ title: context.token.text }` and hover a token.
- Change a `scope` to a name of your own and watch those tokens go plain: a scope with no custom
  property behind it falls back to the text colour.
