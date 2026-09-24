/**
 * Drive the built library in a real browser and assert what only a browser can.
 *
 * The unit tests answer everything that is a decision, because the engine is pure
 * and a DOM would only hide that. Four things here are not decisions, though, and no
 * stub can judge them:
 *
 * 1. **Undo.** A textarea's undo stack is the browser's, kept by its editing
 *    pipeline. There is no API to read it and no way to fake it, so the only honest
 *    test is to make an edit and then undo it in a browser that has a real one. This
 *    check also runs a CONTROL first — a direct `value` assignment, which must NOT be
 *    undoable — because without it a passing test would only show that
 *    `execCommand('undo')` returned true.
 * 2. **The caret.** Where a caret ends up after an edit is layout, and layout is the
 *    browser's.
 * 3. **Alignment.** The painted layer and the transparent textarea are two elements
 *    and one typography. Whether they actually agree is a question about font
 *    metrics, wrapping, and scrollbar widths, and it can only be asked of a renderer
 *    that has them.
 * 4. **Auto-sizing.** Whether a box has a scrollbar is `scrollHeight` against
 *    `clientHeight`, measured after a real layout.
 *
 * The checks are about the ENGINE, so the language they run against is a FIXTURE
 * defined inside the checklist itself. The package ships no syntax and no grammar
 * to import: a harness that borrowed a real DSL would be checking that DSL rather
 * than the artifact this exists to check, and proving a particular product DSL
 * belongs beside the plugin that owns it.
 *
 * Usage:
 *   node scripts/browser-check.mjs [path/to/chrome]
 *
 * Environment:
 *   LITEAREA_CHROME    browser executable, when it is not found automatically
 *   LITEAREA_REQUIRE   set to 1 to turn "no browser here" into a failure
 *
 * The check SKIPS (exit 0) when no Chromium-based browser is present, because a
 * clean CI runner may have none and a release must not fail for that.
 */

import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Give up (or fail, under LITEAREA_REQUIRE) because no browser is usable here. */
function skip(reason) {
  console.log(`browser-check: SKIP — ${reason}`)
  if (process.env.LITEAREA_REQUIRE === '1') {
    console.error('browser-check: LITEAREA_REQUIRE=1, treating the skip as a failure')
    process.exit(1)
  }
  process.exit(0)
}

/**
 * Find a Chromium-based browser.
 *
 * Only Chromium matters: the undo stack this check exists for, the caret APIs, and
 * the scrollbar behaviour are all its behaviour. A Firefox build would answer
 * different questions.
 * @returns the executable path, or undefined.
 */
function findBrowser() {
  const explicit = process.argv[2] ?? process.env.LITEAREA_CHROME
  if (explicit !== undefined) return existsSync(explicit) ? explicit : undefined
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const localAppData = process.env.LOCALAPPDATA ?? ''
  const candidates = [
    join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]
  return candidates.find((candidate) => existsSync(candidate))
}

const browser = findBrowser()
if (browser === undefined) {
  skip('no Chromium-based browser found (pass one as an argument, or set LITEAREA_CHROME)')
}

/**
 * Bundle the built library into one classic script.
 *
 * The page is opened over `file://`, and Chromium refuses to fetch an ES module from
 * a file URL — so the library is bundled to an IIFE and inlined. The entry is built
 * from the SHIPPED files rather than from `src/`, so what this check drives is the
 * artifact a host would actually install — and it is the root entry ALONE, because
 * that is all the package publishes.
 * @returns the script source.
 */
async function bundle() {
  const index = join(root, 'dist', 'index.js')
  if (!existsSync(index)) {
    console.error('browser-check: dist/ is missing; run `npm run build` first')
    process.exit(1)
  }
  const { build } = await import('esbuild')
  const result = await build({
    stdin: {
      contents: `export * from ${JSON.stringify(index)}\n`,
      resolveDir: root,
      sourcefile: 'litearea-browser-entry.js',
      loader: 'js',
    },
    bundle: true,
    format: 'iife',
    globalName: 'litearea',
    target: 'es2022',
    platform: 'browser',
    write: false,
    logLevel: 'silent',
  })
  return result.outputFiles[0].text
}

/**
 * The in-page checklist.
 *
 * Written against the public API and the public DOM only. It is a template literal
 * so the harness page reads as one document, which is why it contains no backticks
 * and no `${` of its own.
 */
const CHECKLIST = String.raw`
      const problems = []
      const notes = []
      const check = (condition, message) => {
        if (!condition) problems.push(message)
      }
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      // Named api rather than litearea, because the inlined bundle declares a global
      // of that name and a second top-level binding for it is a syntax error in the
      // whole page.
      const api = window.litearea

      const host = document.createElement('div')
      host.style.width = '420px'
      host.style.margin = '0'
      document.body.appendChild(host)

      const mount = (grammar, value, options) => {
        const target = document.createElement('div')
        host.appendChild(target)
        return api.createEditor(target, Object.assign({ grammar: grammar, value: value }, options || {}))
      }

      const paintOf = (editor) => editor.element.querySelector('.litearea-paint')
      const layerOf = (editor) => editor.element.querySelector('.litearea-layer')
      const tipOf = (editor) => editor.element.querySelector('.litearea-tooltip')
      const rowsOf = (editor) => editor.element.querySelectorAll('.litearea-row')

      // The key name is the one a KeyboardEvent reports — Tab, not Shift+Tab — and
      // anything held comes in the third argument. Without that, a modifier silently
      // disappears and the check quietly drives a different chord than it says it does.
      const press = (field, key, held) => {
        field.dispatchEvent(new KeyboardEvent('keydown', Object.assign(
          { key: key, bubbles: true, cancelable: true },
          held || {},
        )))
      }

      // ── the fixture grammar ─────────────────────────────────────────────
      // The package ships no syntax, so the checklist defines the language it
      // drives. This is a FIXTURE and not a product DSL: one closed vocabulary,
      // three rules, one completion source, and it is published nowhere. The two
      // checks that need a differently-shaped grammar — the naive one in section
      // 10 and the bulky one in section 8 — define their own, for the same reason.
      const SHAPES = api.defineVocabulary({
        id: 'shape',
        words: ['circle', 'square', 'rounded'],
        scope: 'shape',
        unknownMessage: '"{word}" is not a shape — expected {allowed}.',
        docs: {
          circle: { detail: 'a disc', body: 'Fixture documentation for circle.' },
          square: { detail: 'four corners', body: 'Fixture documentation for square.' },
          rounded: { detail: 'a rounded box', body: 'Fixture documentation for rounded.' },
        },
      })

      const fixture = api.defineGrammar({
        id: 'browser-fixture',
        name: 'browser fixture',
        rules: [
          // The number rule sits ABOVE the vocabulary: digits are word characters,
          // so a words rule placed first would swallow and reject them.
          { kind: 'match', scope: 'keyword', pattern: /draw|fill/ },
          { kind: 'match', scope: 'number', pattern: /\d+(?:\.\d+)?/ },
          { kind: 'words', words: SHAPES, unknown: {} },
        ],
        compose: [
          {
            id: 'shape',
            range: (context) => context.word,
            items: (context) => {
              const written = context.text.slice(0, context.caret)
              return ['circle', 'square', 'rounded'].map((shape) => {
                // A shape the document already uses leads the list, which is what
                // sortText is for: the ranking must put that group first without
                // pretending its label starts with a zero.
                const used = written.indexOf(shape) >= 0
                return {
                  label: shape,
                  append: ' ',
                  kind: 'shape',
                  detail: SHAPES.entryFor(shape)?.detail,
                  documentation: SHAPES.entryFor(shape)?.body,
                  sortText: used ? '0' : '1',
                }
              })
            },
          },
        ],
      })

      ;(async () => {
        check(typeof api.LiteArea === 'function', 'the bundle did not expose LiteArea')
        check(typeof api.createEditor === 'function', 'the bundle did not expose createEditor')

        // ── 1. the layer reproduces the document, and lines up with it ──────
        const one = mount(fixture, 'draw  circle  fill  rounded  10')
        const paint = paintOf(one)
        check(
          paint.textContent === one.input.value,
          'the layer must reproduce the document character for character (got ' +
            JSON.stringify(paint.textContent) + ', wanted ' + JSON.stringify(one.input.value) + ')',
        )
        check(paint.children.length >= 4, 'the layer must be split into more than one span (got ' + paint.children.length + ')')
        const layer = layerOf(one)
        const drift = Math.abs(layer.scrollHeight - one.input.scrollHeight)
        check(
          drift <= 2,
          'the layer and the field must lay out to the same height (layer ' + layer.scrollHeight +
            ' vs field ' + one.input.scrollHeight + ')',
        )

        // ── 1b. a problem is DRAWN, not merely computed ────────────────────
        // The ranges, the severity, and the class can all be right while nothing appears on
        // screen: a stylesheet rule of higher specificity once set text-decoration on every
        // painted span, which quietly switched off every squiggle in the library. Nothing in
        // the DOM reveals that, so the only honest check is the browser's own computed style.
        const marked = mount(fixture, 'draw bogus 10')
        const markedSpans = [...marked.element.querySelectorAll('.litearea-paint > span')]
        const flaggedSpan = markedSpans.find((span) => span.className.indexOf('litearea-diag-error') >= 0)
        check(flaggedSpan !== undefined, 'a rejected word must carry a severity class')
        if (flaggedSpan !== undefined) {
          const flagged = getComputedStyle(flaggedSpan)
          check(
            flagged.textDecorationLine === 'underline',
            'an error must be underlined (text-decoration-line is ' + flagged.textDecorationLine + ')',
          )
          check(
            flagged.textDecorationStyle === 'wavy',
            'an error must be wavy (text-decoration-style is ' + flagged.textDecorationStyle + ')',
          )
          const clean = markedSpans.find((span) => span.className.indexOf('litearea-diag-') < 0)
          check(clean !== undefined, 'the document must have a token with nothing wrong with it')
          if (clean !== undefined) {
            check(
              getComputedStyle(clean).textDecorationLine === 'none',
              'a clean token must carry no underline at all',
            )
          }
        }

        // ── 1c. a custom font and a custom theme ───────────────────────────
        // The font is the HOST'S choice: the layer, the field, and the measuring mirror all read
        // the same computed font, so a proportional face aligns as well as a monospace one. That
        // is the first thing a host asks about, so it is measured rather than asserted in prose.
        // Georgia is chosen precisely because it is unlike the default in every metric.
        const themed = mount(
          fixture,
          'draw circle 10\nfill square 20',
          {
            variables: {
              font: 'Georgia, Times New Roman, serif',
              'font-size': '15px',
              'line-height': '26px',
              'scope-keyword': '#b91c1c',
              accent: '#c2410c',
            },
          },
        )
        check(
          getComputedStyle(themed.input).fontFamily.indexOf('Georgia') >= 0,
          'the font variable must reach the field (got ' + getComputedStyle(themed.input).fontFamily + ')',
        )
        check(
          getComputedStyle(themed.input).fontSize === '15px',
          'the size variable must reach the field (got ' + getComputedStyle(themed.input).fontSize + ')',
        )
        check(
          getComputedStyle(themed.input).lineHeight === '26px',
          'the line-height variable must reach the field (got ' + getComputedStyle(themed.input).lineHeight + ')',
        )
        check(
          getComputedStyle(themed.input).fontVariantLigatures === 'none',
          'ligatures must stay off: the layer splits spans, and a split ligature would be one glyph in the field and two in the paint',
        )
        check(
          paintOf(themed).textContent === themed.input.value,
          'a themed layer must still reproduce the document',
        )
        const themedState = [...themed.element.querySelectorAll('.litearea-paint > span')]
          .find((span) => span.className.indexOf('litearea-scope-keyword') >= 0)
        check(themedState !== undefined, 'the themed document must have a keyword token')
        if (themedState !== undefined) {
          check(
            getComputedStyle(themedState).color === 'rgb(185, 28, 28)',
            'a custom scope colour must reach the paint (got ' + getComputedStyle(themedState).color + ')',
          )
        }
        const themedDrift = Math.abs(layerOf(themed).scrollHeight - themed.input.scrollHeight)
        check(
          themedDrift <= 2,
          'A PROPORTIONAL CUSTOM FONT MUST STILL ALIGN (the layer and the field differ by ' +
            themedDrift + 'px)',
        )

        // ── 2. a box that fits never scrolls; more lines grow it; fewer shrink it ──
        check(
          getComputedStyle(one.input).overflowY === 'hidden',
          'a field whose content fits must not scroll (overflow-y is ' +
            getComputedStyle(one.input).overflowY + ')',
        )
        check(
          one.input.scrollHeight <= one.input.clientHeight + 1,
          'a field whose content fits must have no overflow (' + one.input.scrollHeight +
            ' > ' + one.input.clientHeight + ')',
        )
        const oneLine = one.input.offsetHeight
        one.setValue('draw circle 10\nfill square 20\ndraw rounded 30', true)
        const threeLines = one.input.offsetHeight
        check(threeLines > oneLine, 'more lines must grow the box (was ' + oneLine + ', now ' + threeLines + ')')
        one.setValue('draw circle 10', true)
        const backToOne = one.input.offsetHeight
        check(
          Math.abs(backToOne - oneLine) <= 1,
          'deleting the lines must shrink the box back (was ' + oneLine + ', now ' + backToOne + ')',
        )

        // ── 3. a maximum height clamps the box and introduces a scrollbar ───
        const clamped = mount(
          fixture,
          'draw circle 1\nfill square 2\ndraw rounded 3\nfill circle 4',
          { sizing: { maxRows: 2 } },
        )
        check(
          getComputedStyle(clamped.input).overflowY === 'auto',
          'a field clamped to its maximum height must scroll (overflow-y is ' +
            getComputedStyle(clamped.input).overflowY + ')',
        )
        check(
          clamped.input.scrollHeight > clamped.input.clientHeight,
          'a clamped field must actually have overflow to scroll (' + clamped.input.scrollHeight +
            ' vs ' + clamped.input.clientHeight + ')',
        )
        // The scrollbar narrows the text, so the layer has to widen its own padding or
        // the two wrap differently and every colour slides off its character.
        const clampedDrift = Math.abs(layerOf(clamped).scrollHeight - clamped.input.scrollHeight)
        check(
          clampedDrift <= 2,
          'a clamped field must still align with its layer (layer ' + layerOf(clamped).scrollHeight +
            ' vs field ' + clamped.input.scrollHeight + ')',
        )

        // ── 4. the control: a direct assignment is NOT undoable ────────────
        // Without this, a passing undo test below would only prove that
        // execCommand('undo') returned true.
        const control = document.createElement('textarea')
        control.value = 'abc'
        document.body.appendChild(control)
        control.focus()
        control.value = 'abcd'
        document.execCommand('undo')
        check(
          control.value === 'abcd',
          'CONTROL FAILED: assigning .value was undoable here, so the undo test below proves nothing (value is ' +
            JSON.stringify(control.value) + ')',
        )
        control.remove()
        notes.push('control: a direct value assignment is not undoable, as expected')

        // ── 5. undo and redo survive a completion ──────────────────────────
        const undoable = mount(fixture, '')
        undoable.focus()
        document.execCommand('insertText', false, 'rou')
        check(
          undoable.value === 'rou',
          'typing through the editing pipeline must land (value is ' + JSON.stringify(undoable.value) + ')',
        )
        check(
          undoable.currentCompletion !== undefined,
          'typing a shape prefix must open the completion list',
        )
        check(rowsOf(undoable).length > 0, 'the completion list must render rows')
        const beforeCompletion = undoable.value
        press(undoable.input, 'Enter')
        check(
          undoable.value.indexOf('rounded') === 0,
          'Enter must accept the highlighted completion (value is ' + JSON.stringify(undoable.value) + ')',
        )
        check(
          undoable.currentCompletion === undefined,
          'accepting must close the list',
        )
        const afterCompletion = undoable.value
        check(
          paintOf(undoable).textContent === afterCompletion,
          'the layer must be repainted to match after a completion',
        )
        const undone = document.execCommand('undo')
        check(undone === true, 'the browser refused to undo')
        check(
          undoable.value === beforeCompletion,
          'UNDO MUST RESTORE THE TEXT BEFORE THE COMPLETION (wanted ' +
            JSON.stringify(beforeCompletion) + ', got ' + JSON.stringify(undoable.value) + ')',
        )
        document.execCommand('redo')
        check(
          undoable.value === afterCompletion,
          'REDO MUST PUT THE COMPLETION BACK (wanted ' + JSON.stringify(afterCompletion) +
            ', got ' + JSON.stringify(undoable.value) + ')',
        )

        // ── 6. a list that opened on the first letter must cover the second ─
        // The bug this guards, and it is worth spelling out because it is invisible to any
        // test that types a word in one go: the list opens over the first letter, the user
        // types a second, and a range held from the first keystroke replaces only that one
        // letter — so accepting the suggestion produced the completion followed by the
        // leftover character. Every character must be typed SEPARATELY here, so that the list
        // is filtered once per keystroke exactly as a person would drive it.
        const grown = mount(fixture, '')
        grown.focus()
        document.execCommand('insertText', false, 'r')
        check(grown.currentCompletion !== undefined, 'the first letter must open the list')
        document.execCommand('insertText', false, 'u')
        check(grown.currentCompletion !== undefined, 'the list must stay open while typing')
        const grownRange = grown.currentCompletion && grown.currentCompletion.range
        check(
          grownRange !== undefined && grownRange.to === 2,
          'the range must grow with the typed word (got ' + JSON.stringify(grownRange) + ')',
        )
        press(grown.input, 'Enter')
        check(
          grown.value === 'rounded ',
          'accepting after two letters must replace BOTH of them (got ' + JSON.stringify(grown.value) + ')',
        )

        // The same thing with a longer word and a middle-of-document caret, because the
        // off-by-one is easiest to miss when the range is not anchored at zero. The
        // inserted letters are a subsequence of the word rather than its next letters, so
        // the row is still offered and the replacement has to cover everything typed.
        const midword = mount(fixture, 'draw circle 1\nrounded square 2')
        midword.focus()
        const lineStart = midword.input.value.indexOf('rounded')
        midword.setSelection(lineStart + 1)
        document.execCommand('insertText', false, 'ou')
        press(midword.input, 'Enter')
        check(
          midword.input.value.split('\n')[1] === 'rounded square 2',
          'completing a word in the middle of a document must leave no debris (line is ' +
            JSON.stringify(midword.input.value.split('\n')[1]) + ')',
        )

        // ── 7. a repaint does not move the caret ───────────────────────────
        const careful = mount(fixture, 'draw  circle  fill  rounded  10\nfill square 20')
        careful.focus()
        const at = careful.input.value.indexOf('rounded')
        careful.setSelection(at)
        document.execCommand('insertText', false, 'X')
        const afterTyping = careful.input.selectionStart
        check(
          afterTyping === at + 1,
          'the caret must follow the typed character (wanted ' + (at + 1) + ', got ' + afterTyping + ')',
        )
        // A full re-read and repaint, which is what a re-render used to trigger.
        careful.refresh()
        check(
          careful.input.selectionStart === afterTyping,
          'A REPAINT MUST NOT MOVE THE CARET (was ' + afterTyping + ', now ' + careful.input.selectionStart + ')',
        )
        check(
          careful.input.value.charAt(at) === 'X',
          'the typed character must still be where it was typed',
        )

        // ── 7. the list opens, navigates, and dismisses ─────────────────────
        const listed = mount(fixture, 'draw ')
        listed.focus()
        listed.setSelection(listed.input.value.length)
        listed.showCompletions()
        check(listed.currentCompletion !== undefined, 'showCompletions must open the list')
        check(rowsOf(listed).length > 1, 'the list must offer more than one row (got ' + rowsOf(listed).length + ')')
        const firstActive = listed.input.getAttribute('aria-activedescendant')
        check(firstActive !== null, 'the field must point at the active row')
        press(listed.input, 'ArrowDown')
        check(
          listed.input.getAttribute('aria-activedescendant') !== firstActive,
          'ArrowDown must move the active row',
        )
        const activeRow = listed.element.querySelector('.litearea-row[aria-selected="true"]')
        check(activeRow !== null, 'exactly one row must be marked active')
        press(listed.input, 'Escape')
        check(listed.currentCompletion === undefined, 'Escape must close the list')
        check(listed.element.querySelectorAll('.litearea-row').length === 0, 'a closed list must be emptied')

        // A pick with the mouse must not blur the field, or the caret is lost.
        listed.showCompletions()
        const target = listed.element.querySelector('.litearea-row')
        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
        check(
          document.activeElement === listed.input,
          'picking a row with the mouse must leave the field focused',
        )
        check(listed.currentCompletion === undefined, 'picking a row must close the list')

        // ── 8. a long explanation must not be pushed out of reach ──────────
        // The documentation used to live inside the scrolling element, after the rows. With a
        // long list and a long explanation that made it unreachable: the arrows move the active
        // row rather than the scrollbar, so a keyboard user never saw it, and a mouse user had
        // to scroll down to read it and back up to reach the next row. The fix is positional, so
        // this asks the layout rather than the DOM.
        const bulky = api.defineGrammar({
          id: 'bulky',
          rules: [{ kind: 'match', scope: 'word', pattern: /[a-z]+/ }],
          wordChars: /[\p{L}]/u,
          compose: [
            {
              id: 'many',
              range: (context) => context.word,
              items: () =>
                Array.from({ length: 40 }, (_, index) => ({
                  label: 'option ' + String(index),
                  detail: 'row ' + String(index),
                  documentation:
                    'A long explanation for option ' + String(index) + '. ' +
                    'It goes on at length so that the panel has to bound its own height and scroll itself, ' +
                    'rather than being carried along by the list. '.repeat(3),
                })),
            },
          ],
        })
        const bulkyEditor = mount(bulky, '')
        bulkyEditor.focus()
        bulkyEditor.showCompletions()

        const bulkyPopup = bulkyEditor.element.querySelector('.litearea-popup')
        const bulkyList = bulkyEditor.element.querySelector('.litearea-list')
        const bulkyDocs = bulkyEditor.element.querySelector('.litearea-docs')
        check(bulkyPopup !== null && bulkyList !== null && bulkyDocs !== null, 'the popup needs a list and a documentation panel')
        if (bulkyPopup !== null && bulkyList !== null && bulkyDocs !== null) {
          check(bulkyDocs.parentElement === bulkyPopup, 'the documentation must sit in the popup container')
          check(!bulkyList.contains(bulkyDocs), 'THE DOCUMENTATION MUST NOT BE INSIDE THE SCROLLING LIST')
          check(
            bulkyList.scrollHeight > bulkyList.clientHeight + 1,
            'the list must actually be scrollable, or this check proves nothing (' +
              bulkyList.scrollHeight + ' vs ' + bulkyList.clientHeight + ')',
          )
          check(bulkyDocs.hidden === false, 'a row with an explanation must show the panel')
          check(bulkyDocs.getBoundingClientRect().height > 0, 'the documentation panel must have a box')

          const popupBox = bulkyPopup.getBoundingClientRect()
          const docsBox = bulkyDocs.getBoundingClientRect()
          check(
            docsBox.bottom <= popupBox.bottom + 1,
            'the documentation must fit inside the popup rather than hang below it (docs bottom ' +
              docsBox.bottom + ', popup bottom ' + popupBox.bottom + ')',
          )
          check(docsBox.top >= popupBox.top - 1, 'the documentation must not start above the popup')
          check(docsBox.bottom <= window.innerHeight, 'the documentation must be inside the viewport')

          // The whole point: the list scrolls, the explanation does not move.
          const docsTopBefore = docsBox.top
          bulkyList.scrollTop = bulkyList.scrollHeight
          const movedBy = bulkyDocs.getBoundingClientRect().top - docsTopBefore
          check(
            Math.abs(movedBy) <= 1,
            'scrolling the list must not move the documentation (it moved ' + movedBy + 'px)',
          )

          // And the arrows still drive the list with it scrolled to the end.
          const beforeArrow = bulkyEditor.currentCompletion && bulkyEditor.currentCompletion.rows.length
          press(bulkyEditor.input, 'ArrowDown')
          press(bulkyEditor.input, 'ArrowUp')
          check(
            bulkyEditor.currentCompletion !== undefined &&
              bulkyEditor.currentCompletion.rows.length === beforeArrow,
            'arrowing with the list scrolled must still drive the list',
          )
        }

        // ── 9. the tooltip explains a problem ───────────────────────────────
        const hovered = mount(fixture, 'draw bogus 10', { hover: { enabled: true, delay: 0 } })
        const flagged = [...hovered.element.querySelectorAll('.litearea-paint > span')]
          .find((span) => span.className.indexOf('litearea-diag-') >= 0)
        check(flagged !== undefined, 'an unknown shape must be underlined')
        if (flagged !== undefined) {
          const box = flagged.getBoundingClientRect()
          hovered.input.dispatchEvent(new MouseEvent('mousemove', {
            bubbles: true,
            clientX: box.left + 2,
            clientY: box.top + box.height / 2,
          }))
          await wait(60)
          const tip = tipOf(hovered)
          check(tip.dataset.open === 'true', 'hovering a problem must open a tooltip')
          check(
            tip.textContent.indexOf('Error') >= 0,
            'the tooltip must lead with the severity (got ' + JSON.stringify(tip.textContent) + ')',
          )
          check(
            tip.textContent.indexOf('bogus') >= 0,
            'the tooltip must say what is wrong (got ' + JSON.stringify(tip.textContent) + ')',
          )
          // Moving off the text must take it away again.
          hovered.input.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
          check(tip.dataset.open === 'false', 'leaving the field must close the tooltip')
        }

        // ── 9b. the fixture's own completion offers its own vocabulary ─────
        // This replaced a check that drove the dsh-font DSL in a browser. Proving
        // that a particular product DSL works is the plugin's job and not the
        // library's: a DSL belongs beside the plugin that owns it. What is left is
        // the engine claim the old check was reaching for — rows carry an append
        // and a sortText, and the list honours both.
        const offered = mount(fixture, 'draw circle 1\nfill ')
        offered.focus()
        offered.setSelection(offered.input.value.length)
        offered.showCompletions()
        check(
          rowsOf(offered).length === 3,
          'the fixture completion must offer its whole vocabulary (got ' + rowsOf(offered).length + ')',
        )
        const offeredState = offered.currentCompletion
        check(offeredState !== undefined, 'showCompletions must open the list over an empty word')
        if (offeredState !== undefined) {
          const firstRow = offeredState.rows[0]
          check(
            firstRow !== undefined && firstRow.item.sortText === '0',
            'A ROW THAT LEADS BY sortText MUST LEAD THE LIST (got ' +
              JSON.stringify(firstRow === undefined ? null : firstRow.item.label) + ')',
          )
          check(
            firstRow !== undefined && firstRow.item.label === 'circle',
            'the shape the document already uses must be offered first (got ' +
              JSON.stringify(firstRow === undefined ? null : firstRow.item.label) + ')',
          )
          check(
            offeredState.rows.some((row) => row.item.append === ' '),
            'a row must carry the append a host would type next',
          )
        }
        check(
          paintOf(offered).textContent === offered.input.value,
          'the fixture layer must reproduce the document it is showing a list over',
        )

        // ── 10. resting on blank space must explain nothing ────────────────
        // Whitespace is painted with a scope like every other character, so a token IS found in a
        // gap. Left alone, that produced a tooltip whose entire content was the name of the
        // fallback scope — a user resting the pointer between two words was told "text", which is
        // an implementation detail and not an explanation of anything.
        //
        // The grammar here is naive ON PURPOSE: it describes every token it is handed, including
        // whitespace. Testing this against a grammar that happens to stay quiet about a scope it
        // has no documentation for would prove nothing — the check has to exercise the ENGINE's
        // refusal to ask, not a grammar's manners.
        const naive = api.defineGrammar({
          id: 'naive',
          rules: [{ kind: 'match', scope: 'word', pattern: /[a-z]+/ }],
          describe: (context) =>
            context.token === undefined
              ? undefined
              : { title: context.token.text, detail: context.token.scope },
        })
        const gaps = mount(naive, 'alpha  beta', { hover: { enabled: true, delay: 0 } })

        // The spans are looked up fresh on every use, and that is not fussiness: the editor
        // repaints the layer when document.fonts.ready resolves, which REPLACES every span
        // element. A reference held across an await is detached by then, and
        // getBoundingClientRect on a detached node returns zeros — which reads exactly like a
        // layout bug and is not one.
        const spanFor = (scope) =>
          [...gaps.element.querySelectorAll('.litearea-paint > span')].find(
            (span) => span.className.indexOf(scope) >= 0,
          )
        const hoverScope = async (scope) => {
          const span = spanFor(scope)
          if (span === undefined) return false
          const box = span.getBoundingClientRect()
          gaps.input.dispatchEvent(new MouseEvent('mousemove', {
            bubbles: true,
            clientX: box.left + Math.max(1, box.width / 2),
            clientY: box.top + box.height / 2,
          }))
          await wait(60)
          return true
        }

        check(spanFor('litearea-scope-word') !== undefined, 'the naive document must have a word')
        check(spanFor('litearea-scope-text') !== undefined, 'the naive document must have a gap')

        // First the control: hovering a WORD must open a tooltip, or "no tooltip on the gap"
        // would pass simply because hovering is broken.
        const hoveredWord = await hoverScope('litearea-scope-word')
        const gapTip = tipOf(gaps)
        check(hoveredWord && gapTip.dataset.open === 'true', 'hovering a word must open a tooltip')
        check(
          gapTip.textContent.indexOf('word') >= 0,
          'the tooltip must be the grammar\'s own (got ' + JSON.stringify(gapTip.textContent) + ')',
        )

        // Then the gap, which must close the tooltip the word opened.
        await hoverScope('litearea-scope-text')
        check(
          gapTip.dataset.open === 'false',
          'resting on blank space must not open a tooltip (it said ' + JSON.stringify(gapTip.textContent) + ')',
        )

        // And a point past the end of the document, which is where the pointer lands when it
        // rests in the empty part of the box.
        const farBox = gaps.input.getBoundingClientRect()
        gaps.input.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true,
          clientX: farBox.right - 4,
          clientY: farBox.bottom - 4,
        }))
        await wait(60)
        check(
          gapTip.dataset.open === 'false',
          'resting in the empty part of the box must not open a tooltip (it said ' + JSON.stringify(gapTip.textContent) + ')',
        )

        // ── 11. one stylesheet, however many editors ───────────────────────
        check(
          document.querySelectorAll('style[data-litearea-styles]').length === 1,
          'the stylesheet must be injected exactly once (got ' +
            document.querySelectorAll('style[data-litearea-styles]').length + ')',
        )

        // ── 12. the pinned header sits on the line it replaces ─────────────
        // A pinned row is a copy of a line, placed from a measurement of that line, and
        // every part of that sentence is layout: whether the line box was found at all,
        // whether the row landed on the box's top edge rather than a line above or
        // below it, and whether the row that stays pinned is the one whose block the
        // reader is inside. None of it can be staged without a renderer.
        //
        // The language is a second fixture, because the first one has no blocks: a
        // document of groups and items, where a group runs until the next group. A
        // host would write this in the grammar's decorate hook; it is written out here
        // in plain offsets so the check reads as the shape of a document and not as a
        // parser.
        const grouped = api.defineGrammar({
          id: 'sticky-fixture',
          rules: [
            { kind: 'match', scope: 'keyword', pattern: /group/ },
            { kind: 'match', scope: 'name', pattern: /[a-z]+/ },
          ],
          decorate: (text) => {
            const starts = [0]
            for (let at = 0; at < text.length; at += 1) {
              if (text.charCodeAt(at) === 10) starts.push(at + 1)
            }
            const headers = []
            for (let line = 0; line < starts.length; line += 1) {
              if (text.slice(starts[line], starts[line] + 5) === 'group') headers.push(line)
            }
            // A group runs from its own header line to the character before the next
            // group's header, and the last one runs to the end of the document.
            return headers.map((line, index) => {
              const next = headers[index + 1]
              const end = next === undefined ? text.length : starts[next] - 1
              return { kind: 'group', from: starts[line], to: end }
            })
          },
        })

        const stickyLines = ['group alpha']
        for (let item = 1; item <= 8; item += 1) stickyLines.push('  item ' + item)
        stickyLines.push('group beta')
        for (let item = 1; item <= 10; item += 1) stickyLines.push('  item ' + item)
        const stickyText = stickyLines.join('\n')

        // The control first: without the option there must be no strip at all, or a strip
        // that appeared for some other reason would make the checks below pass.
        const unpinned = mount(grouped, stickyText, { sizing: { maxRows: 3 } })
        check(
          unpinned.element.querySelectorAll('.litearea-stickyRow').length === 0,
          'an editor that declared no blocks must pin nothing',
        )

        const pinnedEditor = mount(grouped, stickyText, {
          sticky: { kinds: ['group'] },
          sizing: { maxRows: 3 },
        })
        const scrollTo = (editor, offset) => {
          editor.input.scrollTop = offset
          editor.input.dispatchEvent(new Event('scroll'))
        }

        scrollTo(pinnedEditor, 60)
        const firstPinned = pinnedEditor.element.querySelectorAll('.litearea-stickyRow')
        check(
          firstPinned.length === 1,
          'scrolling inside a block must pin exactly its own header (got ' + firstPinned.length + ')',
        )
        if (firstPinned.length > 0) {
          const row = firstPinned[0]
          const box = pinnedEditor.element.querySelector('.litearea-box').getBoundingClientRect()
          const at = row.getBoundingClientRect()
          check(
            row.textContent.indexOf('group alpha') >= 0,
            'the pinned row must be the header of the block under the reader (got ' +
              JSON.stringify(row.textContent) + ')',
          )
          check(
            row.textContent.indexOf('\n') < 0,
            'a pinned row must be one line, not a copy of the block (got ' +
              JSON.stringify(row.textContent) + ')',
          )
          check(
            // Against the LAYER's top, which is where the paint begins, and to half a
            // pixel: the row's whole job is to line up with the text it stands in for, so
            // a tolerance that swallows a pixel is a tolerance that hides the bug.
            Math.abs(at.top - layerOf(pinnedEditor).getBoundingClientRect().top) <= 0.5,
            'the pinned row must sit on the top edge of the paint (row ' + at.top +
              ', layer ' + layerOf(pinnedEditor).getBoundingClientRect().top + ')',
          )
          check(
            Math.abs(at.height - 20) <= 6,
            'a pinned row must be one line tall (got ' + at.height + ')',
          )
          check(
            at.bottom <= pinnedEditor.input.getBoundingClientRect().bottom,
            'a pinned row must stay inside the box',
          )
        }

        // At the bottom of the document the first group is behind the reader and the
        // second one is not, so the row that stays pinned has to be the second header.
        scrollTo(pinnedEditor, 100000)
        const lastPinned = pinnedEditor.element.querySelectorAll('.litearea-stickyRow')
        check(
          lastPinned.length === 1,
          'a block that has scrolled past must unpin (got ' + lastPinned.length + ' rows)',
        )
        if (lastPinned.length > 0) {
          check(
            lastPinned[0].textContent.indexOf('group beta') >= 0,
            'the pinned row must follow the reader into the next block (got ' +
              JSON.stringify(lastPinned[0].textContent) + ')',
          )
        }

        // A header still on screen is not pinned, because there is nothing to replace.
        scrollTo(pinnedEditor, 0)
        check(
          pinnedEditor.element.querySelectorAll('.litearea-stickyRow').length === 0,
          'a header that is visible must not be copied into the strip',
        )

        // ── 13. the inline preview grows out of the caret ──────────────────
        // The preview stands where the next character would land, which is a claim about
        // the caret's geometry and the painter's — and the other half of the claim is
        // that it changes NEITHER: the layer must still reproduce the document exactly
        // while a preview of an edit sits on top of it.
        const previewed = mount(fixture, 'draw cir', {
          completion: { inline: true },
          sizing: { maxRows: 3 },
        })
        previewed.focus()
        previewed.setSelection(previewed.input.value.length)
        previewed.showCompletions()
        const ghost = previewed.element.querySelector('.litearea-ghost')
        check(ghost !== null, 'an inline completion must build a preview element')
        if (ghost !== null) {
          check(
            ghost.dataset.open === 'true',
            'opening the list must show the preview of the active row',
          )
          check(
            ghost.textContent === 'cle ',
            'the preview must be the part of the row that is not typed yet (got ' +
              JSON.stringify(ghost.textContent) + ')',
          )
          const typedSpan = [...paintOf(previewed).children]
            .reverse()
            .find((span) => span.textContent === 'cir')
          check(typedSpan !== undefined, 'the fixture must paint the typed prefix')
          if (typedSpan !== undefined) {
            const typedBox = typedSpan.getBoundingClientRect()
            const ghostBox = ghost.getBoundingClientRect()
            // The comparison has to be glyph to glyph. A bounding rect on an inline box
            // reports the font's CONTENT area while a positioned block reports the LINE
            // box it was given — two different rectangles, which is how a pixel of
            // misalignment passed a check that compared them, with a tolerance that
            // swallowed exactly the error being looked for.
            const ghostGlyphs = document.createRange()
            ghostGlyphs.selectNodeContents(ghost)
            const ghostText = ghostGlyphs.getBoundingClientRect()
            check(
              Math.abs(ghostText.top - typedBox.top) <= 0.5,
              'the preview glyphs must sit on the painted line (preview ' + ghostText.top +
                ', line ' + typedBox.top + ')',
            )
            check(
              Math.abs(ghostText.height - typedBox.height) <= 0.5,
              'the preview must be painted at the same size as the text it continues (preview ' +
                ghostText.height + ', line ' + typedBox.height + ')',
            )
            check(
              Math.abs(ghostText.left - typedBox.right) <= 1,
              'the preview must start where the next character would land (preview ' +
                ghostText.left + ', caret ' + typedBox.right + ')',
            )
            // And the chip covers the whole line, so it does not read as a smaller thing
            // floating inside it.
            const paintLineHeight = Number.parseFloat(getComputedStyle(paintOf(previewed)).lineHeight)
            check(
              Math.abs(ghostBox.height - paintLineHeight) <= 0.5,
              'the preview box must be one line tall (box ' + ghostBox.height +
                ', line ' + paintLineHeight + ')',
            )
          }
          check(
            paintOf(previewed).textContent === previewed.input.value,
            'a preview of an edit must not change the painted document',
          )
          // Accepting is the ordinary accept, and the preview goes with the list.
          press(previewed.input, 'Tab')
          check(
            previewed.input.value === 'draw circle ',
            'accepting a previewed row must write it, append and all (got ' +
              JSON.stringify(previewed.input.value) + ')',
          )
          check(
            ghost.dataset.open === 'false',
            'accepting must take the preview away',
          )
        }

        // ── 14. the edits the editor makes on the reader's behalf ──────────
        // Auto-closing, skipping the closer it inserted, wrapping a selection, the
        // comment toggle, and the block Enter are all edits the LIBRARY performs, which
        // makes one claim about them worth more than the rest put together: they go
        // through the browser's editing pipeline, so Ctrl+Z takes them back as one edit.
        // No stub can answer that, and getting it wrong is the exact failure this
        // library exists to correct — an editor that writes text it cannot undo.
        //
        // The harness drives beforeinput the way a browser does: it dispatches the
        // event and, when nothing cancelled it, performs the insertion the browser would
        // have performed. That is what makes the control meaningful — a handler that
        // cancelled nothing would still see the text appear.
        const editable = api.defineGrammar({
          id: 'editable-fixture',
          rules: [{ kind: 'match', scope: 'word', pattern: /[a-z]+/ }],
          pairs: [
            { open: '(', close: ')' },
            { open: '{', close: '}' },
            { open: '"', close: '"', notIn: ['quote'] },
          ],
          comments: { line: '#', block: ['/*', '*/'] },
        })

        const type = (field, text) => {
          const event = new InputEvent('beforeinput', {
            inputType: 'insertText',
            data: text,
            bubbles: true,
            cancelable: true,
          })
          if (field.dispatchEvent(event)) document.execCommand('insertText', false, text)
        }

        const blank = mount(editable, '')
        blank.focus()
        type(blank.input, '(')
        check(
          blank.input.value === '()',
          'typing an opening delimiter must close it (got ' + JSON.stringify(blank.input.value) + ')',
        )
        check(
          blank.input.selectionStart === 1,
          'the caret must be left between the delimiters (at ' + blank.input.selectionStart + ')',
        )

        // The closer the editor inserted is stepped over, not doubled.
        type(blank.input, ')')
        check(
          blank.input.value === '()' && blank.input.selectionStart === 2,
          'typing the closing delimiter must step over the one already there (got ' +
            JSON.stringify(blank.input.value) + ' at ' + blank.input.selectionStart + ')',
        )

        // An edit the editor made is ONE edit in the browser's history. This is the claim
        // the whole section exists for.
        document.execCommand('undo')
        check(
          blank.input.value === '',
          'undoing an auto-closed pair must take back both characters (got ' +
            JSON.stringify(blank.input.value) + ')',
        )

        const wrapped = mount(editable, 'alpha')
        wrapped.focus()
        wrapped.setSelection(0, 5)
        type(wrapped.input, '(')
        check(
          wrapped.input.value === '(alpha)',
          'typing a delimiter over a selection must wrap it (got ' +
            JSON.stringify(wrapped.input.value) + ')',
        )
        check(
          wrapped.input.selectionStart === 1 && wrapped.input.selectionEnd === 6,
          'the wrapped text must stay selected (got ' + wrapped.input.selectionStart + '..' +
            wrapped.input.selectionEnd + ')',
        )

        const commented = mount(editable, 'one\ntwo')
        commented.focus()
        commented.setSelection(0, commented.input.value.length)
        commented.input.dispatchEvent(
          new KeyboardEvent('keydown', { key: '/', ctrlKey: true, bubbles: true, cancelable: true }),
        )
        check(
          commented.input.value === '# one\n# two',
          'the comment toggle must comment out every line the selection touches (got ' +
            JSON.stringify(commented.input.value) + ')',
        )
        document.execCommand('undo')
        check(
          commented.input.value === 'one\ntwo',
          'undoing the comment toggle must take the markers back (got ' +
            JSON.stringify(commented.input.value) + ')',
        )

        const opened = mount(editable, '{}')
        opened.focus()
        opened.setSelection(1)
        press(opened.input, 'Enter')
        check(
          opened.input.value === '{\n  \n}',
          'Enter between a declared pair must open an indented block (got ' +
            JSON.stringify(opened.input.value) + ')',
        )
        check(
          opened.input.selectionStart === 4,
          'the caret must land on the indented line (at ' + opened.input.selectionStart + ')',
        )

        // A control for the pair rules: in front of a word the pair stays open, because
        // an opening paren followed by the word is how that gets written.
        const beforeWord = mount(editable, 'value')
        beforeWord.focus()
        beforeWord.setSelection(0)
        type(beforeWord.input, '(')
        check(
          beforeWord.input.value === '(value',
          'a delimiter typed in front of a word must not close itself (got ' +
            JSON.stringify(beforeWord.input.value) + ')',
        )

        // ── 15. the layer scrolls exactly as far as the field ──────────────
        // The claim the paint exists for is that it shows the same characters in the same
        // places as the field. Scrolling is where that can break silently, and it broke in
        // two ways that no unit test could see:
        //
        //   1. a document ending in a newline has a final EMPTY line, which a textarea
        //      lays out and a pre-wrap div does not — so the paint was one line short and
        //      the field could scroll past the end of the text;
        //   2. a field with a scrollbar of its OWN (the resizable mode, where the host
        //      owns the height) wraps in a narrower space than the layer, so the two
        //      disagreed about where every line ends.
        //
        // Both are measured here, and the scroll offsets are compared directly: a layer
        // that lags by even one line is the failure that looks like the caret detaching
        // from the word under it.
        const scrolling = api.defineGrammar({
          id: 'scrolling-fixture',
          rules: [{ kind: 'match', scope: 'word', pattern: /[a-z]+/ }],
        })

        /** A document of N numbered lines, ending in a newline or not. */
        const linesText = (lines, trailing) => {
          const out = []
          for (let line = 1; line <= lines; line += 1) out.push('line ' + line)
          return out.join('\n') + (trailing ? '\n' : '')
        }

        /** The geometry of one editor, with its content scrolled to the bottom. */
        const scrolledToBottom = (editor) => {
          editor.input.scrollTop = 1000000
          const padOf = (element) => {
            const styles = getComputedStyle(element)
            return parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight)
          }
          const layer = layerOf(editor)
          return {
            fieldTop: editor.input.scrollTop,
            layerTop: layer.scrollTop,
            fieldHeight: editor.input.scrollHeight,
            layerHeight: layer.scrollHeight,
            fieldWidth: editor.input.clientWidth - padOf(editor.input),
            layerWidth: layer.clientWidth - padOf(layer),
          }
        }

        const cases = [
          ['a document ending in a newline', linesText(20, true), { maxRows: 5 }],
          ['a document ending in a character', linesText(20, false), { maxRows: 5 }],
          ['a field with its own scrollbar', linesText(20, true), { autoGrow: false, minRows: 5 }],
        ]

        for (const [label, text, sizing] of cases) {
          const editor = mount(scrolling, text, { sizing: sizing, completion: false })
          editor.focus()
          // One frame for the measurement that writes the box's height, then the scroll.
          await wait(60)
          const geometry = scrolledToBottom(editor)
          await wait(60)
          check(
            geometry.fieldTop === geometry.layerTop,
            label + ': the layer must scroll with the field (field ' + geometry.fieldTop +
              ', layer ' + geometry.layerTop + ')',
          )
          check(
            geometry.fieldHeight === geometry.layerHeight,
            label + ': the layer and the field must have the same scrollable height (field ' +
              geometry.fieldHeight + ', layer ' + geometry.layerHeight + ')',
          )
          check(
            Math.abs(geometry.fieldWidth - geometry.layerWidth) <= 1,
            label + ': the layer must wrap in the same width as the field (field ' +
              geometry.fieldWidth + ', layer ' + geometry.layerWidth + ')',
          )
          check(
            paintOf(editor).textContent === editor.input.value,
            label + ': the paint must still reproduce the document exactly',
          )
        }

        // ── 16. a block indent is ONE edit, and the browser says so ─────────
        // The claim that separates a real implementation from a plausible one: indenting
        // five lines must be ONE undoable edit, not five. Nothing but the browser's own
        // history can answer it, and an editor that gets it wrong leaves the reader
        // pressing Ctrl+Z once per line.
        //
        // The selection is checked at the same time, because the other half of the same
        // mistake is collapsing it: a reader who selected three lines to indent them
        // should not have to select them again to indent them once more.
        const indenting = mount(editable, 'one\ntwo\nthree', {
          keys: [
            { key: 'Tab', command: 'indent' },
            { key: 'Shift+Tab', command: 'outdent' },
          ],
          indent: { unit: '  ' },
          sizing: { maxRows: 10 },
        })
        indenting.focus()
        indenting.setSelection(0, indenting.input.value.length)
        press(indenting.input, 'Tab')
        check(
          indenting.input.value === '  one\n  two\n  three',
          'Tab over a selection must indent every line it touches (got ' +
            JSON.stringify(indenting.input.value) + ')',
        )
        check(
          indenting.input.selectionStart === 0 && indenting.input.selectionEnd === 19,
          'the indented block must stay selected (got ' + indenting.input.selectionStart +
            '..' + indenting.input.selectionEnd + ')',
        )
        document.execCommand('undo')
        check(
          indenting.input.value === 'one\ntwo\nthree',
          'ONE undo must take back the whole block indent (got ' +
            JSON.stringify(indenting.input.value) + ')',
        )

        // And back out again, which is the same edit in the other direction.
        press(indenting.input, 'Tab')
        press(indenting.input, 'Tab')
        check(
          indenting.input.value === '    one\n    two\n    three',
          'two more presses must indent to two levels (got ' +
            JSON.stringify(indenting.input.value) + ')',
        )
        press(indenting.input, 'Tab', { shiftKey: true })
        check(
          indenting.input.value === '  one\n  two\n  three',
          'Shift+Tab must take one level back off every line it touches (got ' +
            JSON.stringify(indenting.input.value) + ')',
        )

        // The control: with no binding, Tab must stay the browser's key. The editor is
        // asked whether it cancelled the keystroke, because "the text did not change" is
        // also what swallowing the key and doing nothing would look like.
        const unbounded = mount(editable, 'alpha', { sizing: { maxRows: 3 } })
        unbounded.focus()
        unbounded.setSelection(0)
        const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
        check(
          unbounded.input.dispatchEvent(tab) === true,
          'an unbound Tab must be left to the browser rather than swallowed',
        )

        // ── 13b. the preview on a line with nothing painted ────────────────
        // The one case the paint cannot measure: an empty line has no glyphs, so the
        // mirror's prediction is used instead — and it has to agree with the paint about
        // where a line IS. Both must correct the font's content box by half the leading,
        // or the chip lands a couple of pixels low, which is exactly what a reader
        // notices and what a check comparing two different kinds of rectangle misses.
        //
        // The reference is the line below it: an empty line is one line tall, so its text
        // belongs exactly one line height above the text under it.
        const emptyLine = mount(fixture, 'draw cir\n\nfill', {
          completion: { inline: true },
          sizing: { maxRows: 6 },
        })
        emptyLine.focus()
        emptyLine.setSelection(9)
        press(emptyLine.input, ' ', { ctrlKey: true })
        const emptyGhost = emptyLine.element.querySelector('.litearea-ghost')
        check(
          emptyGhost !== null && emptyGhost.dataset.open === 'true',
          'a preview must appear on an empty line too',
        )
        if (emptyGhost !== null) {
          const emptyPaint = paintOf(emptyLine)
          const walker = document.createTreeWalker(emptyPaint, 4)
          let offset = 0
          let node = walker.nextNode()
          let third = null
          while (node !== null) {
            const length = (node.textContent || '').length
            if (offset + length > 10 && offset <= 14) {
              third = { node: node, start: 10 - offset, end: 14 - offset }
              break
            }
            offset += length
            node = walker.nextNode()
          }
          check(third !== null, 'the fixture must paint the line below the empty one')
          if (third !== null) {
            const range = document.createRange()
            range.setStart(third.node, Math.max(0, third.start))
            range.setEnd(third.node, Math.min(third.end, (third.node.textContent || '').length))
            const belowBox = range.getBoundingClientRect()
            const ghostRange = document.createRange()
            ghostRange.selectNodeContents(emptyGhost)
            const ghostBox2 = ghostRange.getBoundingClientRect()
            const lineHeight = Number.parseFloat(getComputedStyle(emptyPaint).lineHeight)
            check(
              Math.abs(ghostBox2.top - (belowBox.top - lineHeight)) <= 0.5,
              'a preview on an empty line must sit one line above the text below it (' +
                'preview ' + ghostBox2.top + ', wanted ' + (belowBox.top - lineHeight) + ')',
            )
          }
        }

        // A host's own write at the very end: it must be accepted without throwing,
        // and it is deliberately not a check, because a direct assignment is exactly
        // what the control above proved the pipeline does not record.
        const edits = one.input.value
        one.input.value = edits

        document.title = 'LITEAREA-RESULT ' + problems.length + ' ' + problems.join(' | ')
      })().catch((error) => {
        document.title = 'LITEAREA-RESULT 1 the checklist itself threw: ' + (error && error.message)
      })
`

/**
 * The harness page.
 * @param library - the inlined bundle.
 * @returns the HTML source.
 */
function harnessPage(library) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>litearea harness</title>
    <style>
      body { margin: 0; padding: 8px; font-family: system-ui, sans-serif; }
    </style>
    <script>
      // A page whose only output channel is its title has to report its own
      // failures through that channel. Without this a syntax error in the library
      // bundle, or an uncaught throw before the checklist's own catch, shows up as
      // an unchanged title and no evidence at all.
      window.addEventListener('error', function (event) {
        document.title = 'LITEAREA-RESULT 1 page error: ' + (event.message || String(event.error))
      })
      window.addEventListener('unhandledrejection', function (event) {
        document.title = 'LITEAREA-RESULT 1 unhandled rejection: ' + String(event.reason)
      })
    </script>
  </head>
  <body>
    <script>${library}</script>
    <script>
${CHECKLIST}
    </script>
  </body>
</html>
`
}

const library = await bundle()
const scope = mkdtempSync(join(tmpdir(), 'litearea-browser-check-'))

/**
 * Kill any browser process still holding this run's profile directory.
 *
 * Chromium does not reliably take its helper processes with it when `--dump-dom` returns, and a
 * handful of runs of this script is enough to leave dozens of them resident — which is how a
 * check script turns into a memory problem on a development machine.
 *
 * Only processes whose command line names OUR temporary profile are touched, so a browser the
 * user has open is never affected. Best effort throughout: a stray process is untidy, and that is
 * not a reason to fail a release check.
 * @param executable - the browser that was launched.
 * @param profile - the profile directory this run created.
 */
function reapBrowser(executable, profile) {
  const name = executable.replace(/\\/g, '/').split('/').pop() ?? ''
  try {
    if (process.platform === 'win32') {
      const script =
        `Get-CimInstance Win32_Process -Filter "Name='${name}'" | ` +
        `Where-Object { $_.CommandLine -like '*${profile}*' } | ` +
        'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }'
      spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
        stdio: 'ignore',
      })
      return
    }
    spawnSync('pkill', ['-f', profile], { stdio: 'ignore' })
  } catch {
    // Nothing to be done, and nothing worth failing over.
  }
}

/**
 * Run the browser and collect what it dumped.
 *
 * The output goes to FILES rather than through a pipe, and that is not a style
 * choice: a browser's stdout cannot be captured through piped stdio in a confined
 * environment, where it silently comes back empty — a failure that looks exactly
 * like the harness page having produced no output at all. Passing file descriptors
 * sidesteps it and works everywhere.
 * @param url - the page to open.
 * @returns the dumped DOM and whatever the browser said on stderr.
 */
function runBrowser(url) {
  const domPath = join(scope, 'dump.html')
  const errPath = join(scope, 'stderr.txt')
  const profile = join(scope, 'profile')
  const domFd = openSync(domPath, 'w')
  const errFd = openSync(errPath, 'w')
  let result
  try {
    result = spawnSync(
      browser,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        // The crash reporter is no use to a page that is loaded, measured, and thrown away, and
        // turning it off keeps a couple of helper processes out of the way. Chromium may still
        // leave others behind, which `reapBrowser` clears up.
        '--disable-crash-reporter',
        '--no-crashpad',
        `--user-data-dir=${profile}`,
        '--window-size=900,700',
        '--virtual-time-budget=15000',
        '--dump-dom',
        url,
      ],
      { stdio: ['ignore', domFd, errFd] },
    )
  } finally {
    closeSync(domFd)
    closeSync(errFd)
    reapBrowser(browser, profile)
  }
  return {
    dom: existsSync(domPath) ? readFileSync(domPath, 'utf8') : '',
    stderr: existsSync(errPath) ? readFileSync(errPath, 'utf8') : '',
    error: result.error,
  }
}

try {
  writeFileSync(join(scope, 'index.html'), harnessPage(library), 'utf8')

  const url = `file:///${join(scope, 'index.html').replaceAll('\\', '/')}`
  const { dom, stderr, error } = runBrowser(url)

  const title = /<title>([^<]*)<\/title>/.exec(dom)?.[1]
  if (title === undefined || !title.startsWith('LITEAREA-RESULT ')) {
    if (error !== undefined) throw error
    // The page produced no verdict, which means the bundle or the checklist threw
    // before it could report. The dumped DOM and the browser's own log are the only
    // evidence there is, so both are shown rather than a bare failure.
    console.error('browser-check: the harness did not report a verdict')
    console.error(`  title: ${JSON.stringify(title ?? null)}`)
    console.error(`  dom bytes: ${String(dom.length)}`)
    console.error(`  stderr: ${stderr.slice(0, 1500)}`)
    if (process.env.LITEAREA_KEEP === '1') {
      console.error(`  kept: ${scope}`)
    } else {
      rmSync(scope, { recursive: true, force: true })
    }
    process.exit(1)
  }

  const parsed = /^LITEAREA-RESULT (\d+)\s*(.*)$/.exec(title)
  const failures = Number(parsed?.[1] ?? '1')
  const detail = parsed?.[2] ?? title
  if (failures > 0) {
    console.error(`browser-check: ${String(failures)} problem(s) in ${browser}:`)
    for (const problem of detail.split(' | ')) console.error(`  - ${problem}`)
    process.exit(1)
  }
  console.log(`browser-check: OK — ${browser}`)
  console.log(
    'browser-check: undo survives a completion, the caret survives a repaint, the layer aligns, and the box sizes itself',
  )
} finally {
  rmSync(scope, { recursive: true, force: true })
}
