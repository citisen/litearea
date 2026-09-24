// ─── what a live example is handed ──────────────────────────────────────────
//
// A live example is a function that mounts an editor into a well and then reports what the
// editor is doing, in one line, under it. Everything an example needs in order to do that —
// the element to mount into, the readout, and the controls in the bar — arrives as one object,
// so an example never reaches for the document and never has to know where it is on the page.

/** The five characters that have to be escaped, and what they become. */
const ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Escape text for the readout, which is HTML because it is mixed with emphasis. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ENTITIES[character] ?? character)
}

/**
 * A count, written the way a person would say it.
 * @param count - how many.
 * @param singular - the word for one.
 * @returns `1 token`, `4 tokens`, `no tokens`.
 */
export function plural(count: number, singular: string): string {
  if (count === 0) return `no ${singular}s`
  return count === 1 ? `1 ${singular}` : `${count} ${singular}s`
}

/** What an example is given. */
export interface LiveHost {
  /** The well to mount the editor into. */
  readonly body: HTMLElement
  /** Write the line of small print under the well. HTML is allowed; it is escaped for you. */
  readout(text: string): void
  /** Add a control to the bar, and say whether the frame asked for it. */
  button(name: string, label: string, run: () => void): void
  /** Add a two-state control, which reports its state. */
  toggle(name: string, label: string, initial: boolean, run: (on: boolean) => void): void
}

/**
 * Wire one frame on the page.
 *
 * The controls are MENU-like on purpose: a frame declares which controls it wants in
 * `data-controls`, and an example asks for one by name. An example added to a page that did not
 * ask for its button therefore renders without it rather than growing a control the page has no
 * room for, and the same example can be used in the flow and as a specimen.
 *
 * @param frame - the `[data-live]` or `[data-specimen]` element.
 * @returns the host the example is mounted with.
 */
export function hostFor(frame: HTMLElement): LiveHost {
  const body = frame.querySelector<HTMLElement>('[data-body]')
  const readout = frame.querySelector<HTMLElement>('[data-readout]')
  const controls = frame.querySelector<HTMLElement>('.live-controls')
  const wanted = new Set((controls?.dataset.controls ?? '').split(/\s+/).filter((name) => name !== ''))

  if (body === null) throw new Error('the frame has no [data-body] to mount into')

  const add = (name: string, make: () => HTMLButtonElement): void => {
    if (!wanted.has(name) || controls === null) return
    const button = make()
    controls.append(button)
  }

  return {
    body,
    readout: (text) => {
      if (readout !== null) readout.innerHTML = text
    },
    button: (name, label, run) => {
      add(name, () => {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = label
        button.addEventListener('click', run)
        return button
      })
    },
    toggle: (name, label, initial, run) => {
      add(name, () => {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = label
        let on = initial
        button.setAttribute('aria-pressed', String(on))
        button.addEventListener('click', () => {
          on = !on
          button.setAttribute('aria-pressed', String(on))
          run(on)
        })
        return button
      })
    },
  }
}

/** A document written as lines, which is how every example's own text is declared. */
export function lines(...text: string[]): string {
  return text.join('\n')
}
