# Theming

Everything about how the editor looks is a CSS custom property on the wrapper. There is no theme
object and no style props: set the properties, and the layer, the field, and the measuring mirror
all read them, which is what keeps the paint aligned with the text.

## The properties

| Property | Default | What it affects |
| --- | --- | --- |
| `--litearea-font` | `ui-monospace, SFMono-Regular, Menlo, monospace` | The face, for all three elements |
| `--litearea-font-size` | `13px` | Type size |
| `--litearea-line-height` | `20px` | Line box, and therefore the height of the box |
| `--litearea-padding-block` | `6px` | Vertical padding inside the field and the layer |
| `--litearea-padding-inline` | `10px` | Horizontal padding, on both |
| `--litearea-radius` | `8px` | The box and the floating panels |
| `--litearea-fg` | `#1f2328` | Text |
| `--litearea-fg-dim` | `#6b7280` | Comments, separators, dimmed detail |
| `--litearea-fg-strong` | `#111827` | Emphasised text |
| `--litearea-bg` | `#ffffff` | The box, and the pinned header rows |
| `--litearea-bg-raised` | `#ffffff` | The completion list and the tooltip |
| `--litearea-border` | `#d8dbe0` | The box border |
| `--litearea-border-focus` | `#4d6bfe` | The border while the field has focus |
| `--litearea-accent` | `#4d6bfe` | The active completion row, the inline preview |
| `--litearea-accent-soft` | `rgba(77,107,254,.12)` | Selected row background |
| `--litearea-selection` | `rgba(77,107,254,.22)` | The text selection |
| `--litearea-error` | `#e5484d` | Error squiggles and error-painted scopes |
| `--litearea-warning` | `#d97706` | Warnings |
| `--litearea-info` | `#4d6bfe` | Information |
| `--litearea-hint` | `#8b8f97` | Hints |
| `--litearea-shadow` | `0 6px 24px rgba(15,23,42,.14)` | The floating panels |
| `--litearea-scope-*` | one per scope | A scope's colour — see below |

`--litearea-scrollbar` is written by the editor, not by you. It carries the measured width of the
field's scrollbar so the layer can subtract the same amount, and setting it by hand is the one way
to make the paint wrap differently from the field.

## Scopes

A token's colour comes from `--litearea-scope-<scope>`, generated from the grammar's `scope`. The
package ships a colour for each scope in its own palette and nothing for any other, so a scope a
grammar invents renders in the ordinary text colour until you give it one.

| Scope | Default | Scope | Default |
| --- | --- | --- | --- |
| `comment` | `--litearea-fg-dim` | `string` | `#0f766e` |
| `keyword` | `--litearea-accent` | `number` | `#b45309` |
| `invalid` | `--litearea-error` | `property` | `#7c3aed` |
| `family-generic` | `#7c3aed` | `value-color`, `value-shape`, `value-pattern`, `value-motion` | `#0f766e` |
| `family-unknown`, `weight-missing` | `--litearea-warning` | `value-number` | `#b45309` |
| `family-unclosed` | `--litearea-error` | `operator`, `separator` | `--litearea-fg-dim` |
| `weight`, `state` | `--litearea-accent` | `text`, `word`, `family` | `--litearea-fg` |

A decoration kind becomes `--litearea-dec-<kind>` as a class, not as a variable: `decorate` returns
ranges rather than words, so the styling hook is the class `litearea-dec-base-coat` and whatever you
write for it. The same is true of `litearea-diag-<severity>` and `litearea-kind-<kind>`.

## Two ways to set them

From a stylesheet, scoped to whatever you like:

```css
.myEditor .litearea {
  --litearea-font: "IBM Plex Mono", ui-monospace, monospace;
  --litearea-font-size: 12px;
  --litearea-line-height: 18px;
  --litearea-scope-comment: #8b919b;
  --litearea-scope-swatch-color: #0f766e;
}
```

Or per instance, without writing a rule — which is the only way to give two editors on one page two
different faces:

```ts
createEditor(target, {
  grammar,
  variables: {
    font: 'Georgia, serif',      // any face, including a proportional one
    'font-size': '16px',
    'line-height': '26px',
    accent: '#c2410c',
    'scope-state': '#b91c1c',
    '--my-own-property': '1px',  // a name that starts with `--` is used verbatim
  },
})
```

A key may be written `font`, `litearea-font`, or `--litearea-font`. `editor.setVariables({…})`
replaces whatever that method set last time, so a property you drop falls back to the stylesheet
instead of lingering. In React the same prop is applied live, and an inline object literal is fine:
the records are compared by value.

The specimen beside this column is one grammar mounted twice. The second editor sets nothing but
`variables` — a serif face, a different line height, a different radius, and two scope colours — and
it stays aligned because all three elements read the same computed font.

## A different font

Any font works, including a proportional one. The painted layer, the real textarea, and the mirror
that measures them all read the same computed style, so they wrap identically whatever the face is.
Monospace is the default, not a requirement.

What is not yours to change is anything that moves a glyph INSIDE a span. A scope span may change
`color`, `background`, and `text-decoration`; a `font-weight`, a `font-style`, a `letter-spacing`, or
a font feature changes an advance, and since the layer splits its spans wherever a diagnostic or a
decoration begins, the rest of the line slides out from under its colour. Ligatures and kerning are
therefore forced off on the layer and the field rather than merely discouraged: a ligature draws one
glyph where the field holds two characters, and a split inside that pair would put one glyph in the
field and two in the paint.

## Dark schemes

The shipped stylesheet applies a dark palette from `prefers-color-scheme`, so an editor in a dark
application is dark without being asked. To drive it yourself, set the properties somewhere that
beats that rule — `.page .litearea` rather than `.litearea` — or do it per instance with
`variables`, which is what this site does for both of its modes.
