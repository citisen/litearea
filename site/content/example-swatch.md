# Swatch

A palette language whose word set comes from the host rather than from the file. `red circle 20` is
a valid swatch in one application and an error in another, and the document does not change between
them.

Source: `site/pages/assets/live/grammars/swatch.ts`.

## The language

::: code site/pages/assets/live/grammars/swatch.ts lines=73-115
:::

::: code site/pages/assets/live/grammars/swatch.ts lines=117-265
:::

## What each part does

| Part | Behaviour |
| --- | --- |
| `wordChars: /[A-Za-z0-9-]/` | A hyphen belongs to a colour name, so `off-white` is one word and a completion replaces all of it |
| `comment` rule, first | `#[^\n]*`, tried before everything, so `#` never needs to consult anything |
| `number` rule, second | Must come before the vocabularies: a digit is a word character, so a vocabulary above it would claim `20` and report it |
| `COLORS` with `firstOnLine` and `unknown: {}` | A colour opens a line; a word that is not in the host palette is reported rather than painted as ordinary text |
| `SHAPES`, no `unknown` | A word that is not a shape is not thereby wrong, so the rule declines and a later rule gets its turn |
| `analyze` | One pass. Returns every entry it understood and every problem that is about the document |
| `validate` | Copies those problems into diagnostics with the ranges the walk recorded |
| `describe` | Answers a hover from the vocabulary entry, falling back to the token's scope |
| `compose[0]`, colours | Eligible while the caret is in the first word of a line. `sortText` puts colours the file has not used yet first |
| `compose[1]`, shapes | `priority: 1`, so it takes the moment from the colour source once a colour is on the line |
| `decorate` | Marks the host's base coat. A decoration, not a token, because it depends on the host's palette and not on the characters |

## Try

- Type `mauve circle 20` with the default palette: `mauve` earns one diagnostic.
- Type `teal blob 40`: `blob` earns another.
- Put the caret at the start of an empty line and press `Ctrl+Space`, accept a colour, then press it
  again for the shapes.
- Hover `rounded` for the entry the vocabulary carries.
- Type `red` on a second line: the word is a member and still earns a warning, because painting a
  colour twice is the document's business and not the word set's.
