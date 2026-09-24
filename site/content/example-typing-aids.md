# Typing aids

Two optional fields on a grammar, maintained by the editor while the reader types.

```
{
  name: "workbench",
  size: 12,
  # ctrl+/ toggles these markers
  tags: [alpha, beta]
}
```

Source: `site/pages/assets/live/grammars/aids.ts`.

## The language

::: code site/pages/assets/live/grammars/aids.ts
:::

| Field | Shape | Effect |
| --- | --- | --- |
| `pairs` | `{ open, close, notIn? }[]` | Typing `open` writes `close` and leaves the caret between them. A `notIn` list names the scopes where the delimiter is not a delimiter — a quote inside a string or a comment |
| `comments` | `{ line?, block?: [string, string] }` | Drives `Ctrl+/`: comment out every line the selection touches, or take the markers back |

| Reader action | Result |
| --- | --- |
| Types an opening delimiter | The pair closes itself |
| Types one over a selection | The selection is wrapped and stays selected |
| Types the closer the editor inserted | Nothing is written; the caret steps over it |
| Types an opening delimiter in front of a word | Nothing — `(` in front of `value` is how `(value` gets written |
| Enter between an empty pair | `{\n  \n}`, caret on the indented line. A line already indented with tabs steps with a tab |
| `Ctrl+/` on one or more lines | Adds or removes the line marker |

## Two things worth knowing

`pairs` and `comments` are the grammar's and not the editor's: only the language knows that a paren
inside a comment is prose and a paren inside an expression is a bracket. `indentSize` is the
opposite case and lives on `createEditor`, because two hosts may read the same file with different
tastes.

Every edit the editor makes here goes through the browser's editing pipeline, like a completion, so
one `Ctrl+Z` takes back both characters of an auto-closed pair and every marker of a multi-line
toggle. A block indent is one edit, not one per line.

`Tab` is deliberately not bound to indent. It is how a reader leaves a form, and a library that
takes it away turns every field into a keyboard trap. Two lines give it back:

```ts
keys: [
  { key: 'Tab', command: 'indent' },
  { key: 'Shift+Tab', command: 'outdent' },
]
```

`Ctrl+/` comments LINES whatever the selection spans. A language with no line marker would use a
block pair instead; a language with both wants a second command for the block form rather than
overloading the one everybody knows.

## Try

- Type `{`, `[`, `(` or `"`.
- Select `alpha, beta` and type `(`.
- Press Enter between the braces of an empty pair, then press `Ctrl+/` twice.
- Select three lines, press `Ctrl+]`, then press `Ctrl+Z` once.
