# Completion

Ranking, a documentation panel, commit characters, and the inline preview. The specimen opens with
`font: Inter, Iosevka` and the list already open.

Source: `site/pages/assets/live/grammars/families.ts`.

## The catalogue, and the language

::: code site/pages/assets/live/grammars/families.ts lines=24-46
:::

::: code site/pages/assets/live/grammars/families.ts lines=47-134
:::

## What a source may read

Everything a source gets comes from the one inspection the editor already made: `text`, `caret`,
`word`, `line`, `tokens`, `diagnostics`, and `state` (whatever `analyze` returned). Which families
are already in the stack is read from `context.tokens` rather than by searching the line, because a
name with a space in it is ONE token and a search of the raw text would find halves.

`range` is recomputed from the caret on every filter, never held over from when the list opened.
Type `ru`, accept `running`: the range has to cover both letters, or the result is `running u`.

## What a row can say

| Field | Effect on accepting the row |
| --- | --- |
| `insert` | What is written, when it differs from the label. A name with a space is inserted quoted while the list shows it unquoted |
| `append` | Text written after the insert, such as `', '` |
| `commitCharacters` | Characters that accept this row when typed, so the keystroke is not swallowed: the character lands after the insert and the list closes |
| `mode: 'before'` | Writes ahead of the range and keeps it, which is how a fallback is promoted rather than replaced |
| `caretOffset` | Where the caret lands, counted back from the end of everything written |
| `sortText` | A ranking BUCKET, not a score. Rows are ordered by it first and by match score only within an equal key |
| `filterText` | Matched against the needle instead of the label |
| `data` | Opaque payload, handed back to the grammar on accept |

Set `sortText` on every row or on none. A row without one is keyed by its own label, and comparing a
label against another row's key is a comparison between two different things.

There is no `'commit'` trigger: `CompletionTrigger` is `'auto' | 'explicit'`. A commit character
accepts the row, writes the character and closes the list; the next keystroke is an ordinary
`'auto'` trigger.

## The inline preview

`completion: { inline: true }` draws the part of the active row that is not typed yet as an opaque
chip where the next character would land.

- It is not transparent: it stands where real characters would stand.
- It has no padding or border: its first glyph has to be exactly where the caret is.
- It shows nothing rather than something wrong. A row whose insertion does not begin with what is
  typed — a fuzzy match such as `rd` for `rounded` — has no suffix to draw.
- It is placed from the PAINTED layer rather than from the measuring mirror, because the mirror
  predicts where the field will put the caret and the two are about a pixel apart.
- `completion` is read when the editor mounts, so the specimen's switch re-mounts it.

## Try

- Type `ibm` after the comma, then press ArrowDown: the preview and the documentation panel follow
  the active row.
- Type `,` at the end of a family: the comma is the row's commit character.
- With a family on the line, put the caret at the end and look for `promote a monospace first`, which
  is written ahead of the range rather than over it.
