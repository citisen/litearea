// ─── every live thing on the page ───────────────────────────────────────────
//
// A page declares a live editor by id — `::: live swatch` in the prose, or `specimen: { id }` in
// the page record — and this is the one place that says what an id means. Adding an example is a
// grammar file, a factory in `examples.ts` (or a preset in the playground), and a line here.
//
// A frame that will not mount says so where it stands rather than disappearing. That matters more
// than it sounds: the failure this catches is a mistyped id in a page's prose, and a page with a
// silently empty well in it is the kind of thing that ships.

import {
  completionExample,
  formSchemaExample,
  miniConfExample,
  overviewExample,
  stickyExample,
  swatchExample,
  themedExample,
  typingAidsExample,
} from './examples.js'
import { hostFor, type LiveHost } from './kit.js'
import { mountBench } from '../playground.js'

/** What the registry holds: something that mounts an editor into a well. */
type Factory = (host: LiveHost) => void

/** The id a page writes, and what it mounts. */
const EXAMPLES: Readonly<Record<string, Factory>> = {
  swatch: (host) => swatchExample(host),
  'swatch-overview': (host) => overviewExample(host),
  'swatch-themed': (host) => themedExample(host),
  'form-schema': (host) => formSchemaExample(host),
  'mini-conf': (host) => miniConfExample(host),
  sticky: (host) => stickyExample(host),
  'typing-aids': (host) => typingAidsExample(host),
  completion: (host) => completionExample(host),
}

/** Say what went wrong, in the well. */
function report(frame: HTMLElement, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  const body = frame.querySelector('[data-body]')
  const readout = frame.querySelector('[data-readout]')
  if (readout !== null) readout.textContent = `this example did not mount: ${message}`
  if (body !== null) {
    const note = document.createElement('p')
    note.className = 'bench-error'
    note.textContent = message
    body.replaceChildren(note)
  }
  console.error(error)
}

/**
 * Mount every live frame on the page.
 *
 * The count is written onto `<body>` as a data attribute, which is not for a reader: it is what
 * makes "every well on this page has an editor in it" a thing that can be checked from outside
 * the browser, in a headless run, without a screenshot.
 */
export function mountLiveFrames(): void {
  const frames = [...document.querySelectorAll<HTMLElement>('[data-live], [data-specimen]')]
  let mounted = 0
  let failed = 0

  for (const frame of frames) {
    const id = frame.dataset.live ?? frame.dataset.specimen ?? ''
    const factory = EXAMPLES[id]
    try {
      if (factory === undefined) throw new Error(`no example is registered as "${id}"`)
      factory(hostFor(frame))
      mounted += 1
    } catch (error) {
      failed += 1
      report(frame, error)
    }
  }

  document.body.dataset.liveMounted = `${mounted}/${frames.length}`
  if (failed > 0) {
    const summary = document.createElement('p')
    summary.className = 'live-noscript'
    summary.textContent = `${failed} of ${frames.length} live examples did not mount; see the console.`
    document.querySelector('.masthead')?.after(summary)
  }

  mountBench()
}
