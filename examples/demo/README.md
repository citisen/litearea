# litearea demo

A Vite playground for typing into the real component:

```sh
npm run demo
```

Two pages are served by that one command:

| Page | What it is |
| --- | --- |
| `/` | The React demo: two panels, a toolbar, and panels beside each editor that show the text, the diagnostics, and the completion the editor reported |
| `/showcase.html` | A standalone vanilla page for three features — sticky block headers, the inline completion preview, and the typing aids. One file, `showcase.ts`, mounting `createEditor` three times with a grammar each |

The showcase is deliberately not a React app: the engine and the DOM layer are the
library, and the React binding is optional. `showcase.ts` is also the shortest complete
example of a host in the repository — three grammars of a dozen lines each.

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
