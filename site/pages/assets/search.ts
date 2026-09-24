// ─── search ─────────────────────────────────────────────────────────────────
//
// A static site can still be searched, and it does not need a service or an index shipped to every
// reader. `site/build.mjs` writes `search.json` — one entry per section, with its heading, its
// anchor, and the first six hundred characters of its text — and this fetches it the first time
// somebody opens the box, which most readers never do.
//
// The ranking is deliberately small enough to read: a heading that starts with the needle beats a
// heading that contains it, which beats a mention in the body. Every term has to appear somewhere,
// so `keys Tab` finds the keymap page and not every page with the word "keys" in it.

/** One section of one page, as the build writes it. */
interface Entry {
  /** Page url, site-absolute. */
  u: string
  /** Page title. */
  p: string
  /** Section heading. */
  h: string
  /** Section anchor, empty for the top of the page. */
  i: string
  /** The section's text, already stripped of markup. */
  t: string
}

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character] ?? character)

/** Where a term is found in an entry, as a score. `-1` is not found. */
function scoreTerm(entry: Entry, term: string): number {
  const heading = entry.h.toLowerCase()
  const body = entry.t.toLowerCase()
  if (heading.startsWith(term)) return 100
  if (heading.includes(term)) return 60
  if (entry.p.toLowerCase().startsWith(term)) return 40
  if (body.includes(term)) return 20
  return -1
}

/** The whole needle's score for an entry, or `-1` when one of its terms is missing. */
function scoreEntry(entry: Entry, terms: readonly string[]): number {
  let total = 0
  for (const term of terms) {
    const score = scoreTerm(entry, term)
    if (score < 0) return -1
    total += score
  }
  return total
}

/** The piece of text around the first term, with every term marked. */
function snippet(entry: Entry, terms: readonly string[]): string {
  const body = entry.t
  const lower = body.toLowerCase()
  let at = -1
  for (const term of terms) {
    const found = lower.indexOf(term)
    if (found >= 0 && (at < 0 || found < at)) at = found
  }
  const from = at <= 60 ? 0 : at - 60
  const text = `${from === 0 ? '' : '…'}${body.slice(from, from + 180)}${body.length > from + 180 ? '…' : ''}`
  let html = escapeHtml(text)
  for (const term of [...terms].sort((a, b) => b.length - a.length)) {
    html = html.replace(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>')
  }
  return html
}

/** Build the panel once, and hand back the pieces the behaviour needs. */
function buildPanel(): { root: HTMLElement; input: HTMLInputElement; results: HTMLElement; note: HTMLElement } {
  const root = document.createElement('div')
  root.className = 'search'
  root.hidden = true
  root.innerHTML = `
    <div class="search-panel" role="dialog" aria-modal="true" aria-label="Search the documentation">
      <div class="search-field">
        <input type="search" class="search-input" autocomplete="off" spellcheck="false"
               placeholder="Search the documentation" aria-label="Search the documentation"
               aria-controls="search-results" aria-expanded="false" role="combobox">
        <button type="button" class="search-close" data-search-close>esc</button>
      </div>
      <ol class="search-results" id="search-results" role="listbox"></ol>
      <p class="search-note" data-search-note></p>
    </div>`
  document.body.append(root)
  const input = root.querySelector<HTMLInputElement>('.search-input')
  const results = root.querySelector<HTMLElement>('.search-results')
  const note = root.querySelector<HTMLElement>('[data-search-note]')
  if (input === null || results === null || note === null) throw new Error('the search panel is incomplete')
  return { root, input, results, note }
}

/**
 * Wire the search box.
 *
 * It is opened by the masthead button or by `Ctrl`/`Cmd`+`K`, and it is a plain list: arrow keys
 * move, Enter goes, Escape closes. Everything it shows comes from the index the build wrote, so
 * there is nothing here that can disagree with the pages.
 */
export function wireSearch(): void {
  const trigger = document.querySelector<HTMLButtonElement>('[data-search-open]')
  const keyHint = document.querySelector<HTMLElement>('[data-search-key]')
  if (trigger === null) return

  const isApple = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
  if (keyHint !== null) keyHint.textContent = isApple ? '⌘K' : 'Ctrl K'

  const { root, input, results, note } = buildPanel()
  const up = document.body.dataset.up ?? './'
  const linkTo = (entry: Entry): string => `${up}${entry.u.replace(/^\//, '')}${entry.i === '' ? '' : `#${entry.i}`}`

  let entries: Entry[] | undefined
  let loading: Promise<unknown> | undefined
  let shown: Entry[] = []
  let active = 0
  let previous: Element | null = null

  const load = (): Promise<unknown> => {
    loading ??= fetch(`${up}search.json`)
      .then((response) => (response.ok ? response.json() : []))
      .then((data: Entry[]) => {
        entries = data
        return data
      })
      .catch(() => {
        entries = []
        return []
      })
    return loading
  }

  const render = (): void => {
    results.replaceChildren()
    shown.forEach((entry, index) => {
      const item = document.createElement('li')
      item.className = index === active ? 'search-result is-active' : 'search-result'
      item.id = `search-result-${index}`
      item.setAttribute('role', 'option')
      item.setAttribute('aria-selected', String(index === active))
      const terms = input.value.toLowerCase().split(/\s+/).filter((term) => term !== '')
      item.innerHTML =
        `<a href="${linkTo(entry)}">` +
        `<span class="search-where">${escapeHtml(entry.p)}${entry.h === entry.p ? '' : ` <span class="search-sep">/</span> ${escapeHtml(entry.h)}`}</span>` +
        `<span class="search-what">${snippet(entry, terms)}</span>` +
        `</a>`
      results.append(item)
    })
    input.setAttribute('aria-expanded', String(shown.length > 0))
    input.setAttribute('aria-activedescendant', shown.length === 0 ? '' : `search-result-${active}`)
    note.textContent =
      input.value === ''
        ? 'Type to search every page.'
        : shown.length === 0
          ? 'Nothing here matches that.'
          : `${shown.length} result${shown.length === 1 ? '' : 's'}`
  }

  const search = (): void => {
    const terms = input.value.toLowerCase().split(/\s+/).filter((term) => term !== '')
    if (terms.length === 0 || entries === undefined) {
      shown = []
      active = 0
      render()
      return
    }
    shown = entries
      .map((entry) => ({ entry, score: scoreEntry(entry, terms) }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 20)
      .map((candidate) => candidate.entry)
    active = 0
    render()
  }

  const open = (): void => {
    previous = document.activeElement
    root.hidden = false
    document.body.classList.add('is-searching')
    input.focus()
    input.select()
    void load().then(search)
    search()
  }

  const close = (): void => {
    root.hidden = true
    document.body.classList.remove('is-searching')
    if (previous instanceof HTMLElement) previous.focus()
  }

  trigger.addEventListener('click', open)
  root.querySelector('[data-search-close]')?.addEventListener('click', close)
  root.addEventListener('mousedown', (event) => {
    if (event.target === root) close()
  })
  results.addEventListener('click', () => close())

  input.addEventListener('input', search)
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (shown.length === 0) return
      active = (active + (event.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length
      render()
      results.children[active]?.scrollIntoView({ block: 'nearest' })
    }
  })

  document.addEventListener('keydown', (event) => {
    const combo = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k'
    if (combo) {
      event.preventDefault()
      if (root.hidden) open()
      else close()
      return
    }
    if (event.key === 'Escape' && !root.hidden) {
      event.preventDefault()
      close()
    }
  })
}
