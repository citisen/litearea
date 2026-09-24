# Mini conf

A configuration format with one brace-delimited block that may contain another.

```
# a deployment
service api {
  image "ghcr.io/citisen/api:1.4"
  replicas 3
  port 8080
  health /healthz
}
```

Source: `site/pages/assets/live/grammars/mini-conf.ts`.

## The table the language is built from

::: code site/pages/assets/live/grammars/mini-conf.ts lines=20-50
:::

Each key carries the values it accepts, so the completion can offer them without a second list that
would drift from the first.

## The grammar

::: code site/pages/assets/live/grammars/mini-conf.ts lines=51-185
:::

| Decision | Consequence |
| --- | --- |
| `wordChars: /[A-Za-z0-9_.-]/` | `cache.ttl` is one word, so accepting a completion replaces the whole key rather than the part after the dot |
| `nested: true` on the region | A block may open inside a block. A plain region would treat the second `{` as text and the first `}` as the closer |
| `firstOnLine: true` on the key rule | A key is a word at the head of a line; a word anywhere else is a value |
| `priority` on the two sources | Both are eligible while a line has one word; the number decides which wins |
| `commitCharacters: ' '` on key rows | A space accepts the row and is then written, rather than being swallowed by the list |
| `analyze` | Records where each key was found, so a duplicate can be reported on the second occurrence |
| `checks`, no `allow`, with `except` | Every `key` token whose text fails the pattern is reported. A shape rule, not a membership rule |

## Diagnostics

| Diagnostic | Severity | Origin |
| --- | --- | --- |
| `vocabulary:conf-key` | error | A key at the head of a line that is not in the table |
| `value-style` | warning | `checks`, for a key that is not lower case |
| `repeated-key` | info | `validate`: the key is set twice, and the last one wins |
| `unclosed-region` | error | A block that was never closed |

## Try

- Put the caret after `port ` and press `Ctrl+Space`: the rows are the ports.
- Accept a row with the space: the space is the commit character, so it lands after the insert.
- Rename `replicas` to `Replicas`: the check fires and the list still offers the lower-case spelling.
- Open a block inside the block and type `}` twice.
- Delete the final `}`: the region reports itself unclosed over its opening brace.
