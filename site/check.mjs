// ─── check the site: its links, and then its pages in a real browser ────────
//
//   npm run site            (in one terminal)
//   node site/check.mjs     (in another)
//
// Two passes. The first reads the generated HTML and follows every link and anchor in it, because
// a broken anchor is invisible: the page renders, the link works, and the reader arrives at the
// top of the right page wondering what they were meant to see. The second loads every page in
// headless Chrome and reads three things back — how many of the page's live editors mounted,
// whether anything is cut off, and whether the browser logged an error. The last one matters
// because the browser log is the only place a JavaScript error that nothing caught will appear.
//
// This exists because the failure mode of a page like this is silent. A live editor that does not
// mount leaves an empty well on a page that still looks finished, and a table two pixels too wide
// leaves a horizontal scrollbar nobody notices on a wide screen. Neither shows up in a build.
//
// It is not a test suite and does not pretend to be one: nothing here asserts what any example
// SAYS, only that the page ran, mounted, fitted, and that its links go somewhere.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGES_ROOT = join(HERE, 'pages')
const BASE = process.env.SITE_URL ?? 'http://localhost:5178'

// ── pass one: every link and every anchor ───────────────────────────────────

/** Every generated page, as a path relative to the Vite root. */
function generatedPages(directory = PAGES_ROOT, found = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'assets' || entry.name === 'public' || entry.name.startsWith('.')) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) generatedPages(path, found)
    else if (entry.name.endsWith('.html')) found.push(relative(PAGES_ROOT, path).split('\\').join('/'))
  }
  return found
}

/**
 * Follow every link in every page.
 *
 * Only what the site itself serves is checked. An external link is somebody else's uptime, and a
 * `mailto:` is not a fetch — but a relative link that lands on a missing file, or an anchor that
 * names a heading that no longer exists, is a mistake this repository made.
 *
 * @returns the number of broken links found.
 */
function checkLinks() {
  const pages = generatedPages()
  const ids = new Map()
  const body = new Map()
  for (const page of pages) {
    const html = readFileSync(join(PAGES_ROOT, page), 'utf8')
    body.set(page, html)
    ids.set(page, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1])))
  }

  const broken = []
  for (const page of pages) {
    const absolute = join(PAGES_ROOT, page)
    for (const match of body.get(page).matchAll(/href="([^"]+)"/g)) {
      const href = match[1]
      // External links are somebody else's uptime, and a root-absolute url belongs to the bundler:
      // Vite rewrites those at build time, and a relative page link never looks like one.
      if (/^(https?:|mailto:|tel:|data:|\/)/.test(href)) continue

      const [path, fragment] = href.split('#')
      const target = path === undefined || path === ''
        ? absolute
        : path.endsWith('/')
          ? resolve(dirname(absolute), path, 'index.html')
          : resolve(dirname(absolute), path)

      const key = relative(PAGES_ROOT, target).split('\\').join('/')

      // A link may point at a page, at a markdown mirror, or at a file the build writes into the
      // public directory — which is served from the root, not from `pages/public/`. Only a page has
      // anchors to check; the rest have to exist.
      if (!ids.has(key)) {
        if (existsSync(target) || existsSync(join(PAGES_ROOT, 'public', key))) continue
        broken.push(`${page} → ${href}  (no such page: ${key})`)
        continue
      }
      if (fragment !== undefined && fragment !== '' && !ids.get(key).has(fragment)) {
        broken.push(`${page} → ${href}  (no such anchor in ${key})`)
      }
    }
  }

  console.log(`links: ${pages.length} pages`)
  for (const problem of broken) console.log(`  FAIL ${problem}`)
  if (broken.length === 0) console.log('  ok   every link and anchor resolves')
  return broken.length
}

const linkFailures = checkLinks()

// The link pass needs no server and no browser, so it can be asked for on its own:
// `SITE_LINKS_ONLY=1 node site/check.mjs`.
if (process.env.SITE_LINKS_ONLY !== undefined && process.env.SITE_LINKS_ONLY !== '') {
  process.exit(linkFailures === 0 ? 0 : 1)
}

/** Where Chrome might be, in the order it is worth looking. */
const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter((path) => path !== undefined)

const chrome = CANDIDATES.find((path) => existsSync(path))
if (chrome === undefined) {
  console.error('site: no Chrome found. Set CHROME_PATH to one, or skip the browser pass.')
  process.exit(linkFailures === 0 ? 0 : 1)
}

/**
 * Every page, at two widths.
 *
 * The narrow pass is not a phone: headless Chrome on Windows will not make a window much narrower
 * than 500 pixels. It is under every breakpoint in the stylesheet, which is what the pass is for.
 */
const PAGES = [
  ['/', 1512],
  ['/docs/', 1512],
  ['/docs/grammar/', 1512],
  ['/docs/completion/', 1512],
  ['/docs/architecture/', 1512],
  ['/docs/theming/', 1512],
  ['/docs/options/', 1512],
  ['/docs/keys/', 1512],
  ['/docs/api/', 1512],
  ['/docs/limits/', 1512],
  ['/examples/', 1512],
  ['/examples/swatch/', 1512],
  ['/examples/form-schema/', 1512],
  ['/examples/mini-conf/', 1512],
  ['/examples/sticky/', 1512],
  ['/examples/typing-aids/', 1512],
  ['/examples/completion/', 1512],
  ['/playground/', 1512],
  ['/404.html', 1512],
  ['/', 700],
  ['/examples/swatch/', 700],
  ['/examples/completion/', 700],
  ['/playground/', 700],
]

/**
 * One browser profile for the whole run, and a hard deadline on every launch.
 *
 * The profile is isolated from the reader's own Chrome on purpose, and that is not only hygiene:
 * a headless instance that attaches to the DEFAULT profile, or one that hangs and is never reaped,
 * can leave the browser they are actually typing in unable to start an IME composition — the
 * candidate window loses its caret and the keystrokes commit straight into the field. That is a
 * spectacular way to ruin somebody's afternoon from a script that was only taking screenshots.
 *
 * The deadline is the other half of it. `--virtual-time-budget` waits for the page to go idle, and
 * a page that never idles waits forever; five minutes of a stuck browser is five minutes of a
 * stuck browser. `execFileSync` kills it at the deadline and the page is reported as failed.
 */
const PROFILE = mkdtempSync(join(tmpdir(), 'litearea-check-'))
let removed = false

/** Remove the run's profile, once, on the way out — including on ctrl-c. */
function cleanProfile() {
  if (removed) return
  removed = true
  rmSync(PROFILE, { recursive: true, force: true })
}
process.on('exit', cleanProfile)
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { cleanProfile(); process.exit(130) })

/**
 * Load one url and hand back its DOM and the browser's log.
 * @param url - what to load.
 * @param width - the window to lay it out in.
 * @returns `{ dom, log }`.
 */
function load(url, width) {
  try {
    const dom = execFileSync(
      chrome,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        `--user-data-dir=${PROFILE}`,
        `--window-size=${width},1300`,
        '--virtual-time-budget=9000',
        '--enable-logging=stderr',
        '--log-level=0',
        '--dump-dom',
        url,
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 64 * 1024 * 1024,
        timeout: 45_000,
        killSignal: 'SIGKILL',
      },
    )
    return { dom, log: '' }
  } catch (error) {
    // A non-zero exit still carries the DOM on stdout for most failures, so it is used rather
    // than thrown away, and the log comes with it. A timeout says so, because a page that never
    // went idle is a different problem from a page that failed to load.
    const timedOut = error.signal === 'SIGKILL' || error.code === 'ETIMEDOUT'
    return { dom: String(error.stdout ?? ''), log: `${String(error.stderr ?? '')}${timedOut ? '\nTIMEOUT' : ''}` }
  }
}

// ── measuring a page's own overflow ─────────────────────────────────────────
//
// A page cannot report its own overflow without shipping a debug hook, and a debug hook is not
// worth a byte of what a reader downloads. So this COPIES the generated page, appends the script
// below, loads the copy, and removes it again. The copy is written beside the page it copies so
// that every relative link and asset in it still resolves.
//
// WHAT COUNTS AS OVERFLOW, and this took a second pass to get right: not "is anything wider than
// the window", because a code sample and the masthead index are both deliberately wider and both
// scroll inside their own box. What counts is an element wider than the window that is NOT inside
// something that scrolls — because the page's `overflow-x: hidden` will simply cut it off, and a
// silently cut-off table is exactly the failure this check exists to find.

const MEASURE = `<pre id="probe">pending</pre>
<script>
  window.addEventListener('load', function () {
    var root = document.documentElement
    var limit = root.clientWidth
    function scrolls(el) {
      for (var parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        var overflow = getComputedStyle(parent).overflowX
        if (overflow === 'auto' || overflow === 'scroll' || overflow === 'hidden') return true
      }
      return false
    }
    var cut = []
    var all = document.querySelectorAll('body *')
    for (var i = 0; i < all.length && cut.length < 5; i += 1) {
      var box = all[i]
      if (scrolls(box)) continue
      if (getComputedStyle(box).position === 'fixed') continue
      if (box.getBoundingClientRect().right > limit + 1) {
        cut.push(box.tagName.toLowerCase() + '.' + (box.className || '-') + '@' + Math.round(box.getBoundingClientRect().right))
      }
    }
    document.getElementById('probe').textContent =
      'cut=' + cut.length + ' page=' + (root.scrollWidth - root.clientWidth) + ' at=' + cut.join(' ')
  })
</script>`

/**
 * The file one page is generated into.
 * @param path - the url, as the list above writes it.
 * @returns the output path relative to the Vite root.
 */
function outputOf(path) {
  if (path === '/') return 'index.html'
  if (path.endsWith('.html')) return path.slice(1)
  return `${path.replace(/^\//, '').replace(/\/$/, '')}/index.html`
}

/**
 * Measure one page's overflow, by looking at a copy of it with the script above in it.
 *
 * The copy is written beside BOTH the generated page and the built one, because the check is run
 * against whichever server is up: `npm run site` serves `site/pages`, and `npm run site:preview`
 * serves `site/dist`. Whichever directory does not exist is skipped, and both are cleaned up.
 *
 * @param path - the page's url.
 * @param width - the window to look at it in.
 * @returns `{ overflow, blame }`, or `undefined` when the copy could not be measured.
 */
/**
 * Measure one page's overflow, by looking at a copy of it with the script above in it.
 *
 * The copy is made BESIDE the page it copies, in every root that has one, because a page's links
 * and assets are relative to where it sits: a copy at the site root loads nothing and is measured
 * as an unstyled document. The content comes from the same root the copy goes into, and that
 * matters more than it looks — the generated page in `site/pages` carries the development base
 * (`/assets/…`) and the built page in `site/dist` carries the deployment one (`/litearea/assets/…`),
 * so copying the wrong one into the wrong root is a 404 stylesheet and a measurement of nothing.
 *
 * @param path - the page's url.
 * @param width - the window to look at it in.
 * @returns `{ cut, page, blame }`, or `undefined` when it could not be measured.
 */
function measure(path, width) {
  const out = outputOf(path)
  const directory = dirname(out)
  const copies = []
  for (const root of ['pages', 'dist']) {
    const original = join(HERE, root, out)
    if (!existsSync(original)) continue
    const target = join(HERE, root, directory, '.measure.html')
    writeFileSync(target, readFileSync(original, 'utf8').replace('</body>', `${MEASURE}</body>`))
    copies.push(target)
  }
  if (copies.length === 0) return undefined
  const url = path.endsWith('.html') ? `${BASE}/.measure.html` : `${BASE}${path}.measure.html`
  try {
    const { dom } = load(url, width)
    const reading = /cut=(\d+) page=(-?\d+) at=([^<]*)</.exec(dom)
    if (reading === null) return undefined
    return { cut: Number(reading[1]), page: Number(reading[2]), blame: reading[3].trim() }
  } finally {
    for (const file of copies) rmSync(file, { force: true })
  }
}

// ── the run ─────────────────────────────────────────────────────────────────

let failures = 0

// One page can be checked on its own while working on it: `SITE_ONLY=swatch node site/check.mjs`.
const only = process.env.SITE_ONLY
const pages = only === undefined ? PAGES : PAGES.filter(([path]) => path.includes(only))

for (const [path, width] of pages) {
  const { dom, log } = load(`${BASE}${path}`, width)
  const measured = measure(path, width)

  const live = /data-live-mounted="(\d+)\/(\d+)"/.exec(dom)
  const editors = (dom.match(/class="litearea-input"/g) ?? []).length
  const cut = measured?.cut ?? 0
  const unmeasured = measured === undefined
  const errors = log
    .split('\n')
    .filter((line) => /Uncaught|ERROR:CONSOLE/.test(line))
    .filter((line) => !/favicon|net::ERR/.test(line))

  const wanted = live === null ? 0 : Number(live[2])
  const mounted = live === null ? 0 : Number(live[1])
  const ok = mounted === wanted && cut === 0 && !unmeasured && errors.length === 0
  if (!ok) failures += 1

  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${String(width).padStart(4)}px  ${path.padEnd(26)}` +
      `live ${mounted}/${wanted}  editors ${editors}  cut ${unmeasured ? '?(not measured)' : `${cut}`}` +
      (cut > 0 && measured !== undefined ? ` (${measured.blame})` : '') +
      (errors.length === 0 ? '' : `\n       ${errors.slice(0, 3).join('\n       ')}`),
  )
}

const total = failures + linkFailures
console.log(
  total === 0
    ? 'site: every link resolves, and every page ran, mounted, and fitted its window'
    : `site: ${total} problem(s) need attention`,
)
process.exit(total === 0 ? 0 : 1)
