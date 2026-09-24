# Documentation

litearea is a textarea-based code editor with no runtime dependencies. The engine is pure — text
and a grammar in, tokens and diagnostics out — and the DOM layer puts that behind a real
`<textarea>`. React is an optional peer and the only one.

## Install

```sh
npm install @citisen/litearea
```

Three entry points:

| Import | What it is |
| --- | --- |
| `@citisen/litearea` | The engine plus the DOM layer: `createEditor`, `LiteArea` |
| `@citisen/litearea/react` | The React binding: `LiteAreaEditor` |
| `@citisen/litearea/styles.css` | The stylesheet the editor injects, for hosts that link CSS |

## A first editor

```ts
import { createEditor, defineGrammar } from '@citisen/litearea'

const grammar = defineGrammar({
  id: 'greeting',
  rules: [
    { kind: 'match', scope: 'comment', pattern: /#[^\n]*/ },
    { kind: 'match', scope: 'keyword', pattern: /hello|goodbye/ },
    { kind: 'match', scope: 'name', pattern: /[a-z]+/ },
  ],
})

createEditor(document.querySelector('#editor')!, {
  grammar,
  value: 'hello world  # a comment',
  onChange: (text) => console.log(text),
})
```

A grammar is one object. Rules are tried in order at every position and the first match wins;
`scope` decides the class the characters are painted with, and your CSS decides the colour. Nothing
in the package knows any syntax.

## Reference

::: ledger
01 | Grammar | /docs/grammar/ | Rule kinds, precedence, vocabularies, diagnostics, decorations, hover, and a walkthrough that builds a whole language.
02 | Completion | /docs/completion/ | How the list opens, what a source is asked for, how rows are ranked, and what accepting one writes.
03 | Theming | /docs/theming/ | Every custom property, the `variables` option, two editors with two faces, and what must not change.
04 | Options and methods | /docs/options/ | Every option with its default, every method on the editor, and what the React binding does differently.
05 | Keys and commands | /docs/keys/ | The keymap as data: the commands, the defaults, rebinding, and what is left to the browser.
06 | API | /docs/api/ | Every export of the three entry points, by group.
07 | Architecture | /docs/architecture/ | The one-parse rule, the uncontrolled textarea, layer alignment, the mirror, and what was rejected.
08 | Limits | /docs/limits/ | What it does not do, what it cannot do, and where the platform decides.
:::

## How to read a page here

The editor in the right-hand column of the front page and of every example page is live: it is
`createEditor` running the language that page is about, and the line of small print under it comes
from the editor's own callbacks. Code samples marked with a file path are quoted from the file the
page runs, so a page cannot show one grammar and run another. Headings link to their own anchors;
press `Ctrl`/`Cmd`+`K` for search.
