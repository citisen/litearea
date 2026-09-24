// ─── generate the site's HTML ───────────────────────────────────────────────
//
//   node site/build.mjs            once
//   node site/build.mjs --watch    rebuild when a source file changes
//
// This writes `site/pages/**/*.html`, which is the Vite root. Vite then bundles the one
// stylesheet and the one script those pages link, and nothing else: the content is already
// HTML by the time Vite sees it, so there is no framework in the loop deciding what a page is.

import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, statSync, watch, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readCode, renderMarkdown } from './ssg/markdown.mjs'
import { renderPage, routerFor } from './ssg/layout.mjs'
import { PAGES } from './ssg/pages.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SITE = HERE
const ROOT = resolve(HERE, '..')
const OUT = join(SITE, 'pages')
const REPOSITORY = 'https://github.com/citisen/litearea'

/**
 * Where the site is published.
 *
 * It appears in exactly one place: the links inside the machine-readable copies. Those are written
 * for something fetching a single file and resolving nothing, so a relative link would be a link it
 * cannot follow — while a browser reading the HTML gets relative links that work from any base.
 * Changing the deployment therefore changes this constant and `base` in `vite.config.ts`.
 */
const SITE_ORIGIN = 'https://citisen.github.io/litearea'

/** The router the machine-readable copies are written with: every link absolute. */
const ABSOLUTE_ROUTER = {
  up: `${SITE_ORIGIN}/`,
  depth: 0,
  href: (absolute) => (absolute === '/' ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${absolute}`),
}

/**
 * Where a page's markdown mirror lives.
 *
 * A mirror is the page as text, at a url derived from the page's own, so an agent that has one can
 * guess the other: `/docs/grammar/` is also `/docs/grammar.md`. `404.html` has none — there is no
 * text form of "not here".
 *
 * @param url - the page's url.
 * @returns the mirror's site-absolute path, or `undefined`.
 */
function mirrorOf(url) {
  if (url.endsWith('.html')) return undefined
  return url === '/' ? '/index.md' : `${url.replace(/\/$/, '')}.md`
}

/**
 * Where a link written in a source file should point on the site.
 *
 * The README is the case worth reading: it is not a page here, and the two links into it from the
 * references both name its "writing a grammar" section — which is the grammar reference's own
 * walkthrough. Mapping it there keeps the link meaning what it says; mapping it anywhere else
 * would either lose the reader at the top of a page or, on the grammar page, link a page to
 * itself.
 */
const PAGE_OF_SOURCE = new Map([
  ['docs/grammar.md', '/docs/grammar/'],
  ['docs/completion.md', '/docs/completion/'],
  ['docs/architecture.md', '/docs/architecture/'],
  ['README.md', '/docs/grammar/'],
  ['README.zh.md', ''],
])

/** A fragment that names a section of the README, and the site's heading for the same section. */
const FRAGMENT_OF = new Map([['writing-a-grammar', 'a-worked-walkthrough']])

/**
 * Turn an href written in one of the sources into a URL that works from the page it is on.
 *
 * Three things happen here, and each one is a decision:
 *
 *   - a link to one of the rendered references becomes a link to that page, so a reader of the
 *     site never lands in a raw `.md` file;
 *   - a link to any other file in the repository becomes a link to that file on GitHub, because
 *     the site does not serve the repository and a dead relative link is worse than an external
 *     one;
 *   - a link to the Chinese README is dropped to its own text, because this site is English
 *     and there is no Chinese page for it to reach.
 *
 * @param href - the href as written.
 * @param router - the page's router.
 * @param fromFile - the file the link was written in, which is what makes it resolvable.
 * @returns the href to emit.
 */
function resolveLink(href, router, fromFile) {
  if (/^(https?:|mailto:|#)/.test(href)) return href

  const [path, fragment] = href.split('#')
  const bare = (path ?? '').replace(/^\.\//, '')
  // A link may be written relative to the file it is in (`../../docs/grammar.md`) or to the
  // repository root (`docs/grammar.md`). Both are normalised to the repository-root form,
  // because that is the only form the map above can be keyed on, and the page's own source file
  // is what makes the first form resolvable.
  const normalised = relative(ROOT, resolve(dirname(fromFile), bare)).split('\\').join('/')

  const known = PAGE_OF_SOURCE.get(normalised)
  if (known !== undefined) {
    if (known === '') return ''
    // A fragment is carried when it names a heading the target page has: another reference file's
    // headings are rendered as they are, and the README's one deep link is translated to the
    // site's heading for the same section. Anything else is dropped rather than left to land
    // nowhere, because a link to the top of the right page beats a dead anchor.
    const carried = normalised === 'README.md'
      ? (FRAGMENT_OF.get(fragment ?? '') ?? '')
      : (fragment ?? '')
    return router.href(`${known}${carried === '' ? '' : `#${carried}`}`)
  }

  if (normalised.startsWith('..')) return href
  return `${REPOSITORY}/blob/main/${normalised}${fragment === undefined ? '' : `#${fragment}`}`
}

/** The five entities the renderer emits, back as characters, so a search matches what it shows. */
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }

/**
 * A page as plain markdown, for something that is not going to render HTML.
 *
 * The directives are the whole reason this exists: `::: live` mounts an editor and `::: code`
 * includes a file, and a text copy has to resolve them rather than leave them in. Code is inlined
 * from the file it names — the same file the page runs — and the four prose directives become the
 * markdown they were standing in for.
 *
 * @param source - the page's markdown, directives and all.
 * @param env - a link rewriter, which for a mirror is the absolute one.
 * @returns markdown, with no directives left in it.
 */
function toMarkdown(source, env) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const out = []
  let at = 0

  while (at < lines.length) {
    const directive = /^::: *(\w+)\s*(.*)$/.exec(lines[at])
    if (directive === null) {
      out.push(lines[at])
      at += 1
      continue
    }

    const name = directive[1]
    const rest = (directive[2] ?? '').trim()
    const body = []
    at += 1
    while (at < lines.length && !/^:::\s*$/.test(lines[at])) {
      body.push(lines[at])
      at += 1
    }
    at += 1

    if (name === 'code') {
      const [path, ...pairs] = rest.split(/\s+/)
      const attributes = Object.fromEntries(pairs.map((pair) => pair.split('=')))
      const text = readFileSync(resolve(ROOT, path ?? ''), 'utf8').replace(/\r\n?/g, '\n')
      let shown = text
      if (attributes.lines !== undefined) {
        const [from, to] = attributes.lines.split('-')
        const end = to === '' || to === undefined ? undefined : Number(to)
        shown = text.split('\n').slice(Number(from) - 1, end).join('\n')
      }
      out.push(`\`\`\`${inferFence(path ?? '')}`, shown.replace(/\n+$/, ''), '```', '')
      continue
    }

    if (name === 'ledger') {
      for (const line of body.filter((entry) => entry.trim() !== '')) {
        const [number, title, url, ...note] = line.split('|').map((part) => part.trim())
        out.push(`- ${number}. [${title}](${env.link(url ?? '/')}) — ${note.join('|')}`)
      }
      out.push('')
      continue
    }

    // `try`, `note`, `claims`, and `raw` are markdown already, minus the wrapper; `live` and `bench`
    // are editors and have no text form, so they are dropped rather than described.
    if (name === 'try' || name === 'note' || name === 'claims' || name === 'raw') {
      out.push(...body, '')
    }
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** The fence language a file's extension implies. */
function inferFence(path) {
  if (/\.tsx$/.test(path)) return 'tsx'
  if (/\.ts$/.test(path)) return 'ts'
  if (/\.(mjs|cjs|js)$/.test(path)) return 'js'
  if (/\.css$/.test(path)) return 'css'
  if (/\.json$/.test(path)) return 'json'
  return 'sh'
}

/** The text of a fragment of HTML, without its tags. */
function textOf(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Cut a page into the pieces a search result can point at.
 *
 * A section, not a page: a hit that says "Grammar" and drops the reader at the top of a
 * twelve-section reference has told them almost nothing. So the article is split at every heading
 * and each piece carries its own anchor — which is why this runs on the RENDERED html, where the
 * ids are, rather than on the markdown.
 *
 * @param url - the page's url.
 * @param title - the page's title, which stands in for the intro before the first heading.
 * @param html - the rendered article.
 * @returns one entry per section.
 */
function sectionsOf(url, title, html) {
  const entries = []
  const pieces = html.split(/(?=<h[23]\s)/)
  for (const [index, piece] of pieces.entries()) {
    const heading = /^<h[23][^>]*\sid="([^"]+)"[^>]*>([\s\S]*?)<\/h[23]>/.exec(piece)
    const id = heading === null ? '' : heading[1]
    const name = heading === null ? (index === 0 ? title : title) : textOf(heading[2]).replace(/^#\s*/, '')
    const text = textOf(piece).slice(0, 600)
    if (text === '') continue
    entries.push({ u: url, p: title, h: name, i: id, t: text })
  }
  return entries
}

/** Render one page, write it and its markdown mirror, and hand back what the index needs. */
function buildPage(page) {
  const router = routerFor(page.out)
  const files = page.sources.map((path) => resolve(SITE, path))
  const source = files.map((file) => readFileSync(file, 'utf8')).join('\n\n')
  const mirror = mirrorOf(page.url)

  const env = {
    sourcePath: files[0] ?? '',
    // The front page has no title block, so its `<h1>` is content and must survive the renderer.
    dropTitle: page.kind !== 'home',
    link: (href) => resolveLink(href, router, files[0] ?? ''),
    code: (path, attributes) => readCode(ROOT, path, attributes),
  }

  const { html, headings } = renderMarkdown(source, env)
  const document = renderPage({ ...page, mirror }, html, headings)
  const target = join(OUT, page.out)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, document)

  // The mirror, in the same shape as the page it copies: `docs/grammar/index.html` has
  // `docs/grammar.md` beside it, and the link rewriter is the absolute one because a file fetched
  // on its own has no base to resolve a relative link against.
  const markdown = mirror === undefined
    ? undefined
    : toMarkdown(source, { ...env, link: (href) => resolveLink(href, ABSOLUTE_ROUTER, files[0] ?? '') })
  if (mirror !== undefined && markdown !== undefined) {
    const mirrorFile = join(OUT, 'public', mirror.replace(/^\//, ''))
    mkdirSync(dirname(mirrorFile), { recursive: true })
    writeFileSync(mirrorFile, `${markdown}\n`)
  }

  return {
    page: page.url,
    title: page.title,
    description: page.description,
    mirror,
    markdown,
    out: relative(SITE, target),
    headings: headings.filter((heading) => heading.level === 2).length,
    sections: page.kind === 'home' ? sectionsOf(page.url, page.title, html).slice(0, 1) : sectionsOf(page.url, page.title, html),
  }
}

/** Render every page, the search index, and the two files written for non-browsers. */
function buildAll() {
  const results = PAGES.map((page) => buildPage(page))
  const total = results.reduce((sum, result) => sum + result.headings, 0)
  const search = results.flatMap((result) => result.sections)
  // The index is a public file rather than a bundled module, so it is fetched the first time
  // somebody opens the search box: a reader who never searches downloads none of it.
  writeFileSync(join(OUT, 'public', 'search.json'), JSON.stringify(search))

  // llms.txt is the index of the text copies, and llms-full.txt is all of them in one file, which
  // is what something with a large context and one request wants. Both are generated from the same
  // mirrors the pages link to, so the three cannot disagree.
  const indexable = results.filter((result) => result.mirror !== undefined && result.markdown !== undefined)
  const index = [
    '# litearea',
    '',
    '> A code editor over a plain textarea: highlighting from rules you write, VSCode-shaped',
    '> completion, diagnostics, and hover. No runtime dependencies, and no grammar shipped.',
    '',
    'Every page below is also available as markdown, at the url given. Options and methods are in',
    '`options.md`; the exports of the package are in `api.md`.',
    '',
    ...indexable.map((result) => `- [${result.title}](${SITE_ORIGIN}${result.mirror}): ${result.description}`),
    '',
    `- [Everything in one file](${SITE_ORIGIN}/llms-full.txt): every page above, concatenated.`,
    '',
  ].join('\n')
  writeFileSync(join(OUT, 'public', 'llms.txt'), index)
  writeFileSync(
    join(OUT, 'public', 'llms-full.txt'),
    `${indexable
      .map((result) => `<!-- ${result.page} -->\n\n${result.markdown}`)
      .join('\n\n---\n\n')}\n`,
  )

  console.log(
    `site: ${results.length} pages, ${total} numbered sections, ${search.length} search entries, ` +
      `${indexable.length} markdown mirrors (${Math.round(index.length / 1024)} KB index)`,
  )
  for (const result of results) console.log(`  ${result.page.padEnd(24)} → ${result.out}`)
}

// A page whose source has gone missing should say so at build time rather than at click time.
for (const page of PAGES) {
  for (const path of page.sources) {
    const stat = statSync(resolve(SITE, path), { throwIfNoEntry: false })
    if (stat === undefined) throw new Error(`site: ${page.url} lists a source that is not there: ${path}`)
  }
}

buildAll()

if (process.argv.includes('--watch')) {
  // What the build READS. The grammar files are in the list because `::: code` includes them, so a
  // page that quotes a grammar has to be re-rendered when the grammar changes.
  const watched = [
    join(SITE, 'content'),
    join(SITE, 'ssg'),
    join(OUT, 'assets', 'live', 'grammars'),
    join(ROOT, 'docs'),
    join(ROOT, 'README.md'),
  ]
  console.log('site: watching for changes')

  /**
   * A signature of everything the build reads: each file's path, size, and modification time.
   *
   * This is what makes the watcher idempotent, and it is not belt-and-braces — it is the fix for a
   * loop that had the site rebuilding several times a second and Vite reloading the page with it.
   * The event itself is not a fact about the sources: on Windows a directory watcher reports a
   * good deal that is not a write to the file you care about — a build's own reads, an antivirus
   * pass, an editor touching a temp file. Rebuilding on the event and reading the sources again
   * can therefore feed itself. Comparing what the build actually depends on cannot.
   *
   * @param paths - the files and directories the build reads.
   * @returns one line per file, sorted, so two signatures compare as strings.
   */
  const signatureOf = (paths) => {
    const entries = []
    const walk = (path) => {
      const stat = statSync(path, { throwIfNoEntry: false })
      if (stat === undefined) return
      if (!stat.isDirectory()) {
        entries.push(`${path}:${stat.size}:${stat.mtimeMs}`)
        return
      }
      for (const entry of readdirSync(path)) walk(join(path, entry))
    }
    for (const path of paths) walk(path)
    return entries.sort().join('\n')
  }

  let built = signatureOf(watched)

  /**
   * Rebuild, if a source really changed — in a CHILD process.
   *
   * The child is not tidiness either. The generator's own modules are cached by the module loader,
   * so calling `buildAll()` again from this process would rebuild every page with the code as it
   * was when the watcher started: editing `ssg/markdown.mjs` and watching nothing change costs an
   * hour before anyone suspects the watcher rather than the edit.
   */
  const rebuild = () => {
    const now = signatureOf(watched)
    if (now === built) return
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { stdio: 'inherit' })
    // A failed build leaves the signature alone, so the next event tries again rather than
    // recording a state that was never produced.
    if (child.status === 0) built = now
    else console.error('site: that build failed; the previous output is still on disk')
  }

  let pending = null
  for (const path of watched) {
    try {
      watch(path, { recursive: true }, () => {
        clearTimeout(pending)
        pending = setTimeout(rebuild, 60)
      })
    } catch (error) {
      console.warn(`site: not watching ${path}: ${error.message}`)
    }
  }
  // Nothing here may end the process: the watcher is the process.
  setInterval(() => {}, 1 << 30)
}
