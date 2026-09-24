# Form schema

A declaration of a signup form:

```
# the signup form
form signup
  text    email     required
  text    password  secret   "at least 12 characters"
  number  age       optional
  choice  plan      required  [free, pro]
```

Source: `site/pages/assets/live/grammars/form-schema.ts`.

## The vocabularies

::: code site/pages/assets/live/grammars/form-schema.ts lines=38-63
:::

`TYPES` is used with `unknown: {}` and `OPTIONS` is used without it, and that one difference is the
whole of how the two are treated: a wrong field type is reported, while a word that is not an option
is left for a later rule to claim.

## The grammar

::: code site/pages/assets/live/grammars/form-schema.ts lines=65-218
:::

| Rule | Why it is in that position |
| --- | --- |
| `comment` | `#` is unambiguous and never consults anything |
| `keyword` with `prevNot: '\\w'` | `form` is a keyword; `platform` is not |
| `form.name`, `after: ['keyword']` | The name after `form` is free text |
| `TYPES`, `firstOnLine: true`, `unknown: {}` | The first word of a row is a type or it is a mistake |
| `OPTIONS`, no `unknown` | Declines unknown words so the rules below get their turn |
| `name`, `after: ['field.type']` | A field's name follows its type. A field therefore cannot be called `required` |
| `note` region | Quotes make the body opaque: `secret` inside a note is text, not an option. `unclosed` is a warning |
| `invalid` | Anything with no other home is reported rather than silently falling through |

## Diagnostics

| Diagnostic | Origin |
| --- | --- |
| `vocabulary:field-type` | The `words` rule's `unknown: {}`, at token resolution |
| `name-style` | `checks` — a token whose text fails `except`, with no `allow` list, so every token in scope is a candidate |
| `duplicate-field` | `validate`, reported on the range the walk recorded for the second occurrence |
| `choice-without-options` | `validate`, an `info`: a `choice` field with no bracketed list |
| `unclosed-region` | The `note` region's `end` was never found, as a warning |

A `checks` entry sees only a token's own text, which is enough to require that a name look like a
name. `validate` sees the whole document and whatever `analyze` returned. A rule about the SHAPE of
a word can run while scanning; a rule about its PLACE cannot.

## Try

- Change `email` to `Email`: the check fires.
- Add a second `text email required` row: the validator fires on the duplicate.
- Put the caret inside `number` and type: the list stays eligible while the word is being spelled.
- Delete the closing quote of the note: the region reports itself unclosed.
