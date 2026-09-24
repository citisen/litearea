// ─── the page shell ─────────────────────────────────────────────────────────
//
// Every page is the same three things in the same order: a masthead, an article, and a colophon.
// What changes is the article's shape — a document with a margin index, a document with a live
// specimen pinned beside it, or the full-width playground — and that is a class on `<body>`
// rather than a second layout.
//
// The shell is generated in one function so the running head, the margin index, and the colophon
// cannot drift between pages. Links are RELATIVE, computed from how deep the page sits, which is
// what lets the same output be served from `/` in development and from `/litearea/` on Pages with
// nothing rewritten.
//
// A note on what is NOT here, because it used to be and it was wrong: there is no eyebrow line
// over the title, no reading-time estimate, and no strip of licence facts in the footer. Small
// print that describes the page rather than telling the reader something they came for is
// decoration, and decoration that has to be read is worse than none.

import { escapeHtml as escape, frame } from './frames.mjs'
import { PAGES } from './pages.mjs'

const REPOSITORY = 'https://github.com/citisen/litearea'

/** What each group of pages is called, for the two lists that make one reachable from another. */
const GROUP_LABEL = new Map([
  ['/docs/', 'Documentation'],
  ['/examples/', 'Examples'],
  ['/playground/', 'Playground'],
])

/**
 * The masthead's own index.
 *
 * Three entries and not eleven. The references are found from the documentation index, which is
 * the one page whose job is to list them; a masthead that lists every page is a masthead nobody
 * reads, and it cannot say which of nine references you are currently in.
 */
export const SITE_INDEX = [
  { label: 'Docs', url: '/docs/' },
  { label: 'Examples', url: '/examples/' },
  { label: 'Playground', url: '/playground/' },
]

/**
 * How deep a page sits, which is what every relative link is built from.
 *
 * It is read from the OUTPUT path and not from the url, because the two differ exactly where it
 * matters: `404.html` is served from the root but has no directory of its own.
 * @param out - the page's output path, relative to the Vite root.
 * @returns the number of directories between the site root and the page.
 */
function depthOf(out) {
  return out.split('/').length - 1
}

/**
 * The router every page is rendered with.
 * @param out - the page's output path.
 * @returns `{ up, depth, href(absolute) }`.
 */
export function routerFor(out) {
  const depth = depthOf(out)
  const up = depth === 0 ? './' : '../'.repeat(depth)
  return {
    up,
    depth,
    href: (absolute) => (absolute === '/' ? up : `${up}${absolute.replace(/^\//, '')}`),
  }
}

/**
 * The pages that sit beside this one: the same masthead group, in the order the site is read.
 *
 * This exists because of a hole that shipped: the masthead has three entries, and the only list of
 * the eight references was the documentation index. So a reader who was already IN the
 * documentation — on the grammar reference, say — had no way to discover that a theming page
 * existed at all. Search found it and nothing else did.
 *
 * @param page - the page record.
 * @returns its group, or an empty list when it belongs to none.
 */
function groupOf(page) {
  if (page.nav === undefined) return []
  return PAGES.filter((entry) => entry.nav === page.nav)
}

/**
 * The margin index: the other pages in this group, then the sections of this page.
 * @param page - the page record.
 * @param headings - the headings the renderer collected.
 * @returns the nav, or an empty string when there is nothing to list.
 */
function rail(page, headings) {
  const entries = headings.filter((heading) => heading.level === 2 || heading.level === 3)
  const group = groupOf(page)
  // The index is mono, so a heading's markup is taken back off rather than rendered: `` `words` ``
  // is a word here, not a code span, and a backtick set in a monospace face is a backtick.
  const label = (text) => escape(text.replace(/`/g, ''))

  const chapters = group.length < 3
    ? []
    : group.map(
        (entry) =>
          `<li class="rail-item"><a href="${routerFor(page.out).href(entry.url)}"` +
          `${entry.url === page.url ? ' aria-current="page"' : ''}>${escape(entry.title)}</a></li>`,
      )

  const sections = entries.map(
    (heading) =>
      `<li class="rail-item rail-level-${heading.level}">` +
      `<a href="#${heading.id}"><span class="rail-text">${label(heading.text)}</span></a></li>`,
  )

  if (chapters.length === 0 && sections.length < 2) return ''

  const groupLabel = GROUP_LABEL.get(page.nav ?? '') ?? 'Also here'
  return (
    `<nav class="rail" aria-label="On this page">` +
    (chapters.length === 0
      ? ''
      : `<p class="rail-label">${escape(groupLabel)}</p><ul class="rail-list rail-chapters">${chapters.join('')}</ul>`) +
    (sections.length < 2
      ? ''
      : `<p class="rail-label">On this page</p><ul class="rail-list">${sections.join('')}</ul>`) +
    `</nav>`
  )
}

/**
 * The same list at the foot of the article.
 *
 * The margin index is hidden below 1080px, so this is the entry point that survives on a narrow
 * screen — and it is also what a reader sees after finishing a page, which is where "what else is
 * there" is actually asked. It is skipped on a group's own index, whose whole body is that list.
 *
 * @param page - the page record.
 * @returns the nav, or an empty string when the page has no siblings.
 */
function footIndex(page) {
  const group = groupOf(page)
  if (group.length < 3 || page.url === page.nav) return ''
  const label = GROUP_LABEL.get(page.nav ?? '') ?? 'Also here'
  const items = group
    .map((entry) =>
      entry.url === page.url
        ? `<li><span aria-current="page">${escape(entry.title)}</span></li>`
        : `<li><a href="${routerFor(page.out).href(entry.url)}">${escape(entry.title)}</a></li>`,
    )
    .join('')
  return (
    `<nav class="more" aria-label="${escape(label)}">` +
    `<p class="more-label">${escape(label)}</p>` +
    `<ul class="more-list">${items}</ul>` +
    `</nav>`
  )
}

/**
 * One page, in full.
 *
 * @param page - the page record: `{ url, out, title, kind, nav, specimen, rail }`.
 * @param article - the rendered article HTML.
 * @param headings - the headings the renderer collected.
 * @returns the complete document.
 */
export function renderPage(page, article, headings) {
  const router = routerFor(page.out)
  const index = SITE_INDEX.map(
    (entry) =>
      `<li><a href="${router.href(entry.url)}"${entry.url === page.nav ? ' aria-current="page"' : ''}>` +
      `${entry.label}</a></li>`,
  ).join('')

  const sections = headings.filter((heading) => heading.level === 2).length
  const group = groupOf(page)
  const hasRail = page.rail !== false && (sections >= 2 || group.length >= 3)
  const hasSpecimen = page.specimen !== undefined
  // The margin column is reserved only where something could use it and nothing else already
  // does: a reference page with a margin index and no specimen pinned beside it.
  const hasMargin = hasRail && !hasSpecimen && page.kind === 'doc'

  const specimen = hasSpecimen
    ? frame('specimen', page.specimen.id, page.specimen.label ?? page.specimen.id, page.specimen.controls)
    : ''

  const bodyClass = [
    `kind-${page.kind}`,
    hasRail ? 'has-rail' : 'no-rail',
    hasSpecimen ? 'has-specimen' : '',
    hasMargin ? 'has-margin' : '',
  ]
    .filter((part) => part !== '')
    .join(' ')

  const titleBlock =
    page.kind === 'home'
      ? ''
      : `<header class="title-block">` +
        `<h1 class="page-title">${escape(page.title)}</h1>` +
        (page.standfirst === undefined ? '' : `<p class="standfirst">${page.standfirst}</p>`) +
        `</header>`

  return `<!doctype html>
<html lang="en" data-mode="paper">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(page.headTitle ?? `${page.title} — litearea`)}</title>
<meta name="description" content="${escape(page.description ?? '')}">
<meta name="color-scheme" content="light dark">
<meta property="og:title" content="${escape(page.title)}">
<meta property="og:description" content="${escape(page.description ?? '')}">
<meta property="og:type" content="website">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/fonts.css">
<link rel="stylesheet" href="/assets/site.css">
${page.mirror === undefined ? '' : `<link rel="alternate" type="text/markdown" href="${router.href(page.mirror)}">`}
<link rel="alternate" type="text/plain" href="${router.href('/llms.txt')}" title="llms.txt">
<script>
  // The mode is chosen before the first paint, because a page that repaints itself in the other
  // colour a moment after it arrives is worse than one that never offers the choice.
  try {
    var stored = localStorage.getItem('litearea-site-mode')
    document.documentElement.dataset.mode = stored === 'ink' || stored === 'paper'
      ? stored
      : (matchMedia('(prefers-color-scheme: dark)').matches ? 'ink' : 'paper')
  } catch (error) { /* a private window, or storage switched off: paper it is */ }
</script>
<script type="module" src="/assets/site.ts"></script>
</head>
<body class="${bodyClass}" data-up="${router.up}">
<a class="skip" href="#main">Skip to the article</a>
<header class="masthead">
  <div class="masthead-rule" aria-hidden="true"></div>
  <div class="masthead-row">
    <a class="wordmark" href="${router.href('/')}">litearea<span class="wordmark-dot" aria-hidden="true"></span></a>
    <button class="search-open" type="button" data-search-open>
      <span>Search</span><span class="search-key" data-search-key aria-hidden="true"></span>
    </button>
    <button class="mode-switch" type="button" data-mode-toggle aria-pressed="false">
      <span class="mode-word" data-mode-word="paper">paper</span>
      <span class="mode-slash" aria-hidden="true">/</span>
      <span class="mode-word" data-mode-word="ink">ink</span>
    </button>
  </div>
  <nav class="index" aria-label="The site">
    <ul class="index-list">${index}</ul>
  </nav>
</header>
<div class="running" data-running hidden>
  <div class="running-row">
    <a class="running-mark" href="${router.href('/')}">litearea</a>
    <p class="running-section" data-running-section>${escape(page.title)}</p>
  </div>
  <div class="running-progress" data-progress aria-hidden="true"></div>
</div>
<main class="page" id="main">
${hasRail ? rail(page, headings) : ''}
${titleBlock}
<article class="prose">
${article}
${footIndex(page)}
</article>
${specimen}
</main>
<footer class="colophon">
  <div class="colophon-grid">
    <section class="colophon-part">
      <h2 class="colophon-label">litearea</h2>
      <p>MIT. Set in Bricolage Grotesque and Geist Mono, both under the SIL Open Font License and both served from this site.</p>
    </section>
    <section class="colophon-part">
      <h2 class="colophon-label">Elsewhere</h2>
      <ul class="colophon-links">
        <li><a href="${REPOSITORY}" target="_blank" rel="noreferrer">github</a></li>
        <li><a href="https://www.npmjs.com/package/@citisen/litearea" target="_blank" rel="noreferrer">npm</a></li>
        <li><a href="${REPOSITORY}/blob/main/LICENSE" target="_blank" rel="noreferrer">licence</a></li>
        <li><a href="${REPOSITORY}/releases" target="_blank" rel="noreferrer">releases</a></li>
        <li><a href="${router.href('/llms.txt')}">llms.txt</a></li>
        ${page.mirror === undefined ? '' : `<li><a href="${router.href(page.mirror)}">this page as markdown</a></li>`}
      </ul>
    </section>
  </div>
</footer>
</body>
</html>
`
}
