# Sticky headers

Two kinds of block, nested, with the header of the block the reader is inside pinned to the top of
the box — one row per level of nesting. The specimen is eight rows tall and its document is
nineteen, so the pinned rows are visible without scrolling first.

```
group alpha
  step one 10
  step two 20
group beta
  step wire 1
  step solder 2
```

Source: `site/pages/assets/live/grammars/plan.ts`.

## The language

::: code site/pages/assets/live/grammars/plan.ts
:::

`decorate` returns one range per block and nothing else: a `group` runs until the next group, a
`step` until the next step or group. Nesting is read from the ranges themselves, which is what makes
a nested block stack its own pinned row below its parent's without anything further being declared.

## Enabling it

```ts
createEditor(target, { grammar, sticky: { kinds: ['block'] } })
```

`kinds` names the DECORATION kinds that are blocks, so a language says what a block is in exactly
one place — the ranges `decorate` already returns. `sticky` is off unless it is passed.

| Behaviour | Detail |
| --- | --- |
| The pinned rows are copies of the painted line, class for class | So a pinned header keeps the colours it has in the text. They are rebuilt from the painted runs, not cloned as a `Range`: a line that lies inside one painted span is a partially selected node, and a range clone would drop its element and its colour |
| The strip takes no pointer events and sits between the layer and the field | The field's text is transparent, so a row shows through it and a click inside the row still places the caret |
| A header unpins when its block's last line leaves the top of the box | Compared by that line's BOTTOM edge. Comparing tops would unpin a line early and flash the next header into place |
| Nothing moves a glyph | Which is why pinning a row does not disturb the alignment between the layer and the field |

## Cost

One walk of the painted text nodes plus a `Range` for each edge of each block, cached until the
paint changes. A keystroke rebuilds it; a scroll reuses it.

## Try

- Scroll inside the box: the pinned row changes as you cross from group to group.
- Click into the text while a row is pinned: the caret still lands where you clicked.
- Put the caret in the last group and arrow down until the block's last line leaves the top: the
  header unpins exactly then.
