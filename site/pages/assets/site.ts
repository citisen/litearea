// ─── the site's one script ──────────────────────────────────────────────────
//
// Five small things and one large one. The small things are chrome: the paper/ink switch, the
// running head that arrives when the masthead leaves, the progress hairline, the margin index
// following the reader, and a copy button on every sample. The large one is that every live
// editor on the page is mounted from here.
//
// It is deliberately one file and no framework. The page is already HTML by the time this runs;
// nothing here builds content, and the only thing it knows how to make is an editor.

import { mountLiveFrames } from './live/index.js'
import { wireSearch } from './search.js'

const root = document.documentElement

// ── the paper and ink switch ────────────────────────────────────────────────
//
// The initial mode is chosen by the inline script in the page's head, before the first paint.
// This only has to change it afterwards and remember the choice.

function wireMode(): void {
  const button = document.querySelector<HTMLButtonElement>('[data-mode-toggle]')
  if (button === null) return

  const sync = (): void => {
    button.setAttribute('aria-pressed', String(root.dataset.mode === 'ink'))
    button.title = root.dataset.mode === 'ink' ? 'Switch to paper' : 'Switch to ink'
  }

  button.addEventListener('click', () => {
    const next = root.dataset.mode === 'ink' ? 'paper' : 'ink'
    root.dataset.mode = next
    try {
      localStorage.setItem('litearea-site-mode', next)
    } catch {
      // Storage is not essential: the switch still works for this page view.
    }
    sync()
  })

  sync()
}

// ── the running head, the progress hairline, and the margin index ───────────

function wireReading(): void {
  const masthead = document.querySelector('.masthead')
  const runningSection = document.querySelector<HTMLElement>('[data-running-section]')
  const railItems = [...document.querySelectorAll<HTMLElement>('.rail-item')]
  const railLinks = railItems.map((item) => item.querySelector('a'))
  const targets = railLinks
    .map((link) => (link === null ? null : document.getElementById(decodeURIComponent((link.getAttribute('href') ?? '').slice(1)))))
    .filter((element): element is HTMLElement => element !== null)

  /**
   * Follow the reader.
   *
   * It runs SYNCHRONOUSLY on the event rather than through `requestAnimationFrame`, and that is a
   * correction rather than a preference: a scroll handler is already coalesced to one call per
   * frame by the browser, the work here is a dozen `getBoundingClientRect` calls against elements
   * that are already being read for the paint, and a version that queued a frame could leave the
   * running head describing the section the reader was in a moment ago — or, on a page that never
   * produces another frame, never update at all.
   */
  const update = (): void => {
    const scrollable = root.scrollHeight - window.innerHeight
    root.style.setProperty('--progress', scrollable <= 0 ? '0' : String(Math.min(1, window.scrollY / scrollable)))

    // The running head arrives when the masthead has left. It is measured rather than observed:
    // an IntersectionObserver is the tidier way to say it and the wrong tool here, because it
    // reports nothing until it has computed a layout, and a bar that never appears because a
    // callback has not run yet is a worse failure than one that appears a frame late.
    const mastheadHeight = masthead?.getBoundingClientRect().height ?? 0
    document.body.classList.toggle('is-scrolled', window.scrollY > mastheadHeight - 8)

    if (railItems.length === 0) return
    // The active section is the LAST heading whose top edge has passed under the running head.
    // Reading positions rather than observing intersections is what makes a short section between
    // two long ones still count as reached.
    const line = window.innerHeight * 0.28
    let active = -1
    targets.forEach((target, index) => {
      if (target.getBoundingClientRect().top <= line) active = index
    })
    railItems.forEach((item, index) => item.classList.toggle('is-active', index === active))
    if (active >= 0 && runningSection !== null) {
      const text = railLinks[active]?.querySelector('.rail-text')?.textContent
      if (text !== null && text !== undefined) runningSection.textContent = text
    }
  }

  window.addEventListener('scroll', update, { passive: true })
  window.addEventListener('resize', update, { passive: true })
  update()
}

// ── copy a sample ───────────────────────────────────────────────────────────
//
// The library exists because `execCommand` is the only way to change a textarea without losing
// the browser's undo stack; the same call is the fallback here for a browser that will not give
// a page the clipboard without a permission prompt.

function wireCopy(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
    button.addEventListener('click', () => {
      const figure = button.closest('.code')
      const body = figure?.querySelector('pre')
      if (body === null || body === undefined) return
      const text = body.textContent ?? ''

      const done = (): void => {
        button.dataset.copied = 'true'
        button.textContent = 'copied'
        window.setTimeout(() => {
          delete button.dataset.copied
          button.textContent = 'copy'
        }, 1400)
      }

      const fallback = (): void => {
        const field = document.createElement('textarea')
        field.value = text
        field.setAttribute('readonly', '')
        field.style.position = 'fixed'
        field.style.opacity = '0'
        document.body.append(field)
        field.select()
        try {
          document.execCommand('copy')
          done()
        } catch {
          // Nothing to say: the reader can still select the sample by hand.
        }
        field.remove()
      }

      if (navigator.clipboard === undefined) {
        fallback()
        return
      }
      navigator.clipboard.writeText(text).then(done, fallback)
    })
  }
}

wireMode()
wireReading()
wireCopy()
wireSearch()
mountLiveFrames()
