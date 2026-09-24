# The documentation site

The site at `https://citisen.github.io/litearea/`, and it is served from this
directory. Nothing here is part of the published package: `files` in
`package.json` lists `dist`, `docs`, `src`, `scripts`, and the READMEs, so
`site/` is exactly what a maintainer runs and a consumer never downloads.

```sh
npm run site          # development: http://localhost:5178
npm run site:build    # render and bundle into site/dist
npm run site:preview  # serve the built site
npm run site:check    # load every page in headless Chrome and report
```

`npm run site` starts two processes, and both are necessary. `site/build.mjs`
renders the markdown into HTML; Vite serves that HTML with the one stylesheet
and the one script it links. The generator watches `site/content/`, `site/ssg/`,
and the repository's own `docs/`, so editing a reference page rewrites the HTML
and Vite reloads. The stylesheet and the client modules are Vite's own hot path
and do not go through the generator at all.

## Why there is no framework

The site is a hand-written static generator and one stylesheet, and that is a
decision about how it should look rather than about how it should build. A
documentation framework arrives with an opinion — a sidebar, a hero, a grid of
feature cards, a theme with a gradient in it — and the fastest way to publish a
site that looks like every other project's is to accept it. The layout here is a
printed specimen sheet: a warm paper ground, hairline rules, marginalia, one
vermilion accent, and a live editor pinned beside the prose.

What that costs is a renderer, and the renderer is `site/ssg/markdown.mjs`: about
four hundred lines covering exactly the markdown this repository writes — ATX
headings, paragraphs, lists, tables, fences, inline code, bold, italic, links —
plus six directives, described below. It is not a Markdown implementation and
does not try to be.

## The shape of it

| Path | What it is |
| --- | --- |
| `ssg/markdown.mjs` | Markdown and the directives, in and HTML out |
| `ssg/highlight.mjs` | A small tokenizer, for the static code samples |
| `ssg/layout.mjs` | The shell: masthead, running head, margin index, colophon |
| `ssg/frames.mjs` | The one frame a live editor is shown in |
| `ssg/pages.mjs` | The page set: url, output path, title, sources, specimen |
| `content/*.md` | The prose, one file per page |
| `pages/assets/` | The hand-written half: stylesheet, client modules, favicon |
| `pages/assets/search.ts` | The search box, over the index the build writes |
| `pages/public/fonts/` | The two woff2 files, copied to the site root as they stand |
| `pages/public/*.md`, `llms*.txt`, `search.json` | GENERATED machine-readable output, gitignored |
| `pages/**/*.html` | GENERATED, gitignored, and the Vite root |
| `dist/` | The built site, gitignored |

`site/pages/` is both the Vite root and the output directory of the generator,
which is why a page's output path is also its URL: `docs/grammar/index.html` is
served at `/docs/grammar/`. Every link inside the site is relative, computed from
how deep the page sits, so the same output works from `/` in development and from
`/litearea/` on Pages with nothing rewritten.

## Adding a page

Add a fragment to `content/`, add a record to `PAGES` in `ssg/pages.mjs`, and run
the build. The record's `sources` are resolved against `site/`, so
`../docs/grammar.md` is the repository's own reference and `content/api.md` is a
file written for the site.

## The directives

Eight block directives, on top of plain markdown. They exist because a
documentation page is not only prose: it has editors in it, it has notes that
belong in the margin, and it quotes files that must not drift from the code.

| Directive | What it does |
| --- | --- |
| `::: live <id>` | Mounts the example registered under `<id>`, in the flow of the article |
| `::: try` | A list of things to do to the nearest editor, inside a ruled block |
| `::: note <label>` | A note that prints in the margin on a wide screen, and inline on a narrow one |
| `::: code <path>` | Includes a file, whole or by `lines=12-40`, with the file's own line numbers |
| `::: ledger` | A ruled list of pages: `number \| title \| url \| note`, one line each |
| `::: claims` | Numbered blocks, one per `###` heading in the body |
| `::: bench` | The playground's three panes, built by `pages/assets/playground.ts` |
| `::: raw` | Emitted as it stands, for the rare block that is markup |

Every one of them except `live`, `bench`, and `raw` also has a text form, which is
what the markdown mirrors are made of — see **For machines** above.

## Adding a live example

Three steps, and the first one is the language:

1. Write the grammar in `pages/assets/live/grammars/<name>.ts`. A grammar file
   holds the LANGUAGE and nothing else — no DOM, no page — so that a page can
   quote the whole file with `::: code` and be quoting exactly what it runs.
2. Add a factory to `pages/assets/live/examples.ts`: the document to start with,
   the options, and the line of small print fed by the editor's own callbacks.
3. Add the id to `EXAMPLES` in `pages/assets/live/index.ts`, and declare it on a
   page: `specimen: { id: '<name>', controls: ['reset'] }` in the page record, or
   `::: live <name>` in the prose.

An example added to a page that did not ask for its controls renders without
them, which is why the same factory can be used in the flow and pinned in the
specimen column.

## Publishing

`.github/workflows/pages.yml`, and the trigger is manual. Nothing redeploys on a
push: the published site should be something a maintainer decided to publish, not
whatever the last commit happened to build. Run it from Actions when the site is
ready, and set the repository's Pages source to "GitHub Actions" once.

The build sets `base` to `/litearea/`, which is where a project page lives. A
custom domain changes that one string in `vite.config.ts` and nothing else.

## For machines

The readers of a library's documentation are increasingly agents, and an agent should not have to
parse a layout to find a signature. So every page is also written out as markdown, and two files
tie them together:

| File | What it is |
| --- | --- |
| `llms.txt` | The index: every page and its markdown url, one line each |
| `llms-full.txt` | Every page concatenated, for something that would rather make one request |
| `/docs/grammar.md`, `/docs/options.md`, … | The page as text, at a url derived from the page's own |

The mirrors are generated from the same sources as the HTML by the same build, with the directives
resolved: `::: code` is inlined from the file it names, `::: ledger` and `::: try` become lists, and
`::: live` and `::: bench` are dropped because an editor has no text form. Links inside them are
absolute — a file fetched on its own has no base to resolve a relative link against — and each HTML
page carries `<link rel="alternate" type="text/markdown">` pointing at its own mirror.

## Checking it

`npm run site:check` has two passes, and neither needs the other.

The first reads the generated HTML and follows every link and anchor in it. A broken anchor is
invisible otherwise: the page renders, the link works, and the reader arrives at the top of the
right page wondering what they were meant to see.

The second loads every page in headless Chrome, at two widths, and reads three things back: how
many of the page's live editors mounted, whether anything is cut off, and whether the browser
logged an error. "Cut off" means an element wider than the window that is *not* inside something
that scrolls, because a code sample and the masthead index are both deliberately wider and both
scroll inside their own box — while a table two pixels too wide is silently clipped by the page's
own `overflow-x: hidden`, and that is the failure worth failing on.

It is not a test suite — nothing in it asserts what an example says — but the failures it does
catch are the silent ones, and a live editor that never mounted leaves a page that still looks
finished. Run it against `npm run site:preview` to check the built site under its deployment base:
`SITE_URL=http://localhost:5179/litearea npm run site:check`.
