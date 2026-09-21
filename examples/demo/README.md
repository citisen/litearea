# litearea demo

A Vite playground for typing into the real component:

```sh
npm run demo
```

## The grammars here are the demo's own

`@citisen/litearea` ships no syntax. Every panel below is the same React component
with a different grammar object, and both of those objects live in
`examples/demo/grammars/`:

| Panel | Grammar | What it shows |
| --- | --- | --- |
| swatch | `grammars/swatch.ts` | A vocabulary the HOST supplies (`palette` is an option), two vocabularies rejecting in place, a `sortText` completion, and a decoration for the colour the palette calls the base coat |
| mini-conf | `grammars/mini.ts` | A key/value language: a nesting `region`, rules placed by position, a declarative `check`, commit characters, and per-word hover docs |

The two production DSLs this editor came out of — dsh-font's font query and
dsh-sentry's appearance document — now live beside the plugins that own them.
The demo does not import or copy them, and it should not: a DSL belongs with the
product that reads it, and a library that shipped one would make every host pay
for a language it does not use.

Read the files as templates rather than as a menu of languages. A grammar is one
object; the [grammar reference](../../docs/grammar.md) documents every field of
it.
