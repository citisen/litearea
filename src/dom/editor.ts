// ─── editor: the element, and the interaction ───────────────────────────────
//
// This is where the four things the library promises are actually kept, and each
// is a decision made here rather than a behaviour that emerged.
//
// **Undo survives, because the DOM owns the text.** The textarea is never given a
// `value` after it is created. Every edit the user makes is the browser's own, and
// every edit the editor makes on the user's behalf goes through the browser's
// editing pipeline (`src/dom/editing.ts`). The highlight layer reads the text; it
// never writes it. A framework binding on top must leave the element alone for the
// same reason, which is why the React wrapper renders a bare div and hands the
// element to this class.
//
// **The caret does not move, because nothing rewrites the text under it.** The
// editors this replaces re-rendered the value on every keystroke and then tried to
// put the caret back — a race the browser wins eventually, and the same mistake
// that destroyed the undo stack. Here there is no re-render to lose a race with,
// and the only caret writes are the ones a completion asked for.
//
// **The list behaves, because its range is frozen when it opens.** Filtering runs
// against the recorded range instead of re-deriving one from a document that has
// changed since, so the target cannot slide out from under the list while the user
// types. Enter and Tab accept, Escape dismisses, Ctrl+Space opens on demand, and
// the arrows move the selection without wrapping — the behaviour every editor has,
// which is the whole point.
//
// **The box fits, because an offscreen mirror is measured instead of the field.**
// Asking a textarea for its `scrollHeight` means collapsing it first, which
// reflows the page and flickers on every keystroke. `src/dom/mirror.ts` keeps a
// second element with the same typography and asks that instead.

import type {
  Completion,
  Decoration,
  Diagnostic,
  Grammar,
  HoverInfo,
  Range,
  Severity,
  SuggestionItem,
} from '../core/types.js'
import type { Inspection } from '../core/inspect.js'
import type { SegmentInput } from '../core/segments.js'
import type { CompletionTrigger } from '../core/types.js'
import { applyCompletion, complete } from '../core/complete.js'
import { resolveHover } from '../core/hover.js'
import { inspect } from '../core/inspect.js'
import { resolveGrammar, isResolvedGrammar, type ResolvedGrammar } from '../core/scan.js'
import { clamp } from '../core/text.js'
import { decorationClass, injectStyles, scopeClass, severityClass } from '../styles.js'
import {
  readSelection,
  redoField,
  replaceThroughPipeline,
  undoField,
  writeDocument,
  writeSelection,
  type EditOutcome,
  type TextSelection,
} from './editing.js'
import { TextMirror } from './mirror.js'
import { Overlay } from './overlay.js'
import { Popup } from './popup.js'
import { Tooltip } from './tooltip.js'
import { withDefaults } from './support.js'

/** How the box follows its content. */
export interface LiteAreaSizing {
  /**
   * Whether the height follows the content, so that no scrollbar is shown while
   * the content fits. Default `true`.
   */
  autoGrow?: boolean
  /**
   * The fewest lines to show, written to the textarea's own `rows` attribute.
   *
   * The native attribute is set rather than only a pixel minimum, so the box has
   * the right height on the very first frame — before any measurement, and in a
   * document where the script never runs at all. Default 1.
   */
  minRows?: number
  /** The most lines to show before a scrollbar appears. */
  maxRows?: number
  /** A minimum height in pixels, in addition to `minRows`. */
  minHeight?: number
  /** A maximum height in pixels, in addition to `maxRows`. */
  maxHeight?: number
}

/** How the completion list behaves. */
export interface LiteAreaCompletion {
  /** Whether suggestions appear while typing. Default `true`. */
  auto?: boolean
  /**
   * Characters that open the list in addition to word characters.
   *
   * Default `' '`, and that default is doing real work: both reference languages
   * put a value after a name, so a space is exactly where the next word becomes
   * guessable.
   */
  triggerCharacters?: string
  /** The most rows to offer. Default 100. */
  limit?: number
  /** Whether the documentation panel is shown. Default `true`. */
  showDocumentation?: boolean
}

/** How the hover tooltip behaves. */
export interface LiteAreaHover {
  /** Whether tooltips appear at all. Default `true`. */
  enabled?: boolean
  /** How long the pointer must rest, in milliseconds. Default 140. */
  delay?: number
}

/** Everything a host may configure. */
export interface LiteAreaOptions<State = unknown> {
  /** The language. Nothing else in this library knows anything about syntax. */
  grammar: Grammar<State> | ResolvedGrammar<State>
  /** The initial text. */
  value?: string
  /** Shown while the box is empty. */
  placeholder?: string
  /** Whether the user may edit. */
  readOnly?: boolean
  /** Whether the browser may spell-check. Default `false`, because a DSL is not prose. */
  spellCheck?: boolean
  /** The accessible name. */
  ariaLabel?: string
  /** An extra class on the wrapper. */
  className?: string
  /**
   * CSS custom properties for THIS instance, for per-instance theming.
   *
   * A key may be written `font`, `--litearea-font`, or any other `--…` name; the first two
   * forms mean the same thing, and a key that already starts with `--` is used verbatim so a
   * host's own properties work too. The value is used as written, so `'13px'`,
   * `'var(--my-ui-font)'`, and `'1.6'` are all fine.
   *
   *     createEditor(target, {
   *       grammar,
   *       variables: { font: '"Fira Code", monospace', 'font-size': '14px', accent: '#c2410c' },
   *     })
   *
   * CSS stays the theme language on purpose — the editor's whole appearance is already
   * described by custom properties, and a second vocabulary for the same facts would mean two
   * places to keep in step. This exists only so that ONE instance can be themed without a host
   * writing a stylesheet rule for it, and so that two editors on a page can differ.
   */
  variables?: Record<string, string>
  /** How the box follows its content. */
  sizing?: LiteAreaSizing
  /** How the list behaves, or `false` to switch completions off entirely. */
  completion?: LiteAreaCompletion | false
  /** How tooltips behave, or `false` to switch them off entirely. */
  hover?: LiteAreaHover | false
  /** Whether semantic decorations are painted. Default `true`. */
  decorations?: boolean
  /** Whether to inject the stylesheet. Default `true`. */
  injectStyles?: boolean
  /** A CSP nonce for the injected stylesheet. */
  styleNonce?: string
  /** Called after a user edit, with the new text. Not called for programmatic writes. */
  onChange?: (value: string) => void
  /** Called when the caret or selection moves. */
  onSelectionChange?: (selection: TextSelection) => void
  /** Called when the problem list changes. */
  onDiagnostics?: (diagnostics: readonly Diagnostic[]) => void
  /** Called when the list opens, filters, or closes. */
  onCompletion?: (completion: Completion | undefined) => void
  /** Called when a tooltip appears or goes away. */
  onHover?: (info: HoverInfo | undefined) => void
}

/** The sizing with its defaults filled in. */
type ResolvedSizing = Required<Pick<LiteAreaSizing, 'autoGrow' | 'minRows'>> &
  Pick<LiteAreaSizing, 'maxRows' | 'minHeight' | 'maxHeight'>

/** The completion settings with their defaults filled in. */
type ResolvedCompletion = Required<LiteAreaCompletion>

/** The hover settings with their defaults filled in. */
type ResolvedHover = Required<LiteAreaHover>

/** How many rows a Page key moves through. */
const PAGE_STEP = 8

/**
 * A code editor over a textarea.
 *
 * The tree it builds:
 *
 *     div.litearea            ← the positioning container, and this.element
 *       div.litearea-box      ← the border, the radius, and the focus ring
 *         div.litearea-layer  ← the painted text, behind and inert
 *         textarea            ← the real field: transparent text, visible caret
 *       div.litearea-popup    ← the completion list
 *       div.litearea-tooltip  ← the hover tooltip
 *
 * The layer is inside the box while the floating elements are outside it, because
 * the box clips nothing and a list that had to fit inside a rounded border would be
 * cut off at the bottom.
 */
export class LiteArea<State = unknown> {
  /** The positioning container. Put this in the page. */
  readonly element: HTMLDivElement
  /** The real field. Exposed for a host that needs the element itself. */
  readonly input: HTMLTextAreaElement

  private readonly document: Document
  private readonly view: Window | undefined
  /**
   * The grammar as the host declared it, kept so {@link refresh} can re-resolve it.
   *
   * Mutable on purpose, and it is what lets a host pass a live object — a proxy
   * reading the newest props, say — without the editor having to be rebuilt when the
   * language changes. A rebuild would throw away the undo history, which is the one
   * thing this library must not do, so re-resolving is the only acceptable answer.
   */
  private declaredGrammar: Grammar<State>
  /** The grammar the engine is currently running, with its defaults filled in. */
  private grammar: ResolvedGrammar<State>
  private readonly box: HTMLDivElement
  private readonly overlay: Overlay
  private readonly popup: Popup
  private readonly tooltip: Tooltip
  private readonly mirror: TextMirror
  private readonly sizing: ResolvedSizing
  private readonly completion: ResolvedCompletion | undefined
  private readonly hover: ResolvedHover | undefined
  private readonly paintDecorations: boolean
  private readonly handlers: LiteAreaOptions<State>
  private readonly injectedStyle: HTMLStyleElement | undefined
  private readonly instanceId: string
  private readonly fontsReady: Promise<unknown> | undefined

  /** The current inspection, and the text it was computed from. */
  private current: Inspection<State> | undefined
  private currentText: string | undefined
  /** Bumped whenever the inspection changes, so the painter can skip work. */
  private revision = 0
  /** The list on screen, with the range frozen when it opened. */
  private completionState: Completion | undefined
  /** True during an IME composition, when no completion may run. */
  private composing = false
  /** True while the editor itself is writing, so its own edit does not re-open the list. */
  private applying = false
  /** The height and overflow last written, so unchanged values are not rewritten. */
  private appliedHeight = -1
  private appliedOverflow = ''
  private appliedScrollbar = -1
  /** The offset the tooltip last described, so a resting pointer does not re-query. */
  private hoverOffset: number | undefined
  /** The custom properties this instance set, so one that disappears can be removed. */
  private appliedVariables = new Set<string>()
  private hoverTimer: number | undefined
  /** Watches for a width change, which invalidates wrapping and the box height. */
  private resizeObserver: ResizeObserver | undefined
  private observedWidth = -1
  /**
   * A signature of the last announced problem list, so the host is told once.
   *
   * Starts as `undefined` rather than as the empty string, because "no problems" is a
   * real signature and a host waiting to be told that the list is clear would otherwise
   * never hear it — it would keep whatever it was showing before the editor existed.
   */
  private announced: string | undefined
  private destroyed = false

  /**
   * @param options - the grammar, the initial text, and the behaviour to use.
   */
  constructor(options: LiteAreaOptions<State>) {
    const probe = typeof document === 'undefined' ? undefined : document
    if (probe === undefined) {
      throw new Error('litearea: an editor needs a document, and there is none in this environment')
    }
    this.document = probe
    this.view = probe.defaultView ?? undefined
    this.handlers = options
    // A caller may hand over either the grammar as written or one already resolved;
    // both are accepted so a hot path can skip the work.
    const declared = options.grammar
    this.declaredGrammar = isResolvedGrammar(declared) ? declared.grammar : declared
    this.grammar = resolveGrammar(this.declaredGrammar)
    this.instanceId = `litearea-${Math.random().toString(36).slice(2, 9)}`

    this.sizing = withDefaults<ResolvedSizing>(
      { autoGrow: true, minRows: 1 },
      options.sizing as Partial<ResolvedSizing> | undefined,
    )
    this.completion =
      options.completion === false
        ? undefined
        : withDefaults<ResolvedCompletion>(
            { auto: true, triggerCharacters: ' ', limit: 100, showDocumentation: true },
            options.completion,
          )
    this.hover =
      options.hover === false
        ? undefined
        : withDefaults<ResolvedHover>({ enabled: true, delay: 140 }, options.hover)
    this.paintDecorations = options.decorations !== false

    if (options.injectStyles !== false) {
      this.injectedStyle = injectStyles(this.document, options.styleNonce)
    }

    // ── the element tree ───────────────────────────────────────────────────
    this.element = this.document.createElement('div')
    this.element.className =
      options.className === undefined ? 'litearea' : `litearea ${options.className}`
    this.element.classList.add(this.sizing.autoGrow ? 'litearea-growable' : 'litearea-resizable')
    if (options.readOnly === true) this.element.classList.add('litearea-readonly')
    if (options.variables !== undefined) this.applyVariables(options.variables)

    this.box = this.document.createElement('div')
    this.box.className = 'litearea-box'
    this.element.appendChild(this.box)

    this.overlay = new Overlay(this.document, {
      scope: scopeClass,
      decoration: decorationClass,
      severity: severityClass,
    })
    this.box.appendChild(this.overlay.element)

    this.input = this.document.createElement('textarea')
    this.input.className = 'litearea-input'
    this.input.dataset.liteareaPart = 'input'
    this.input.spellcheck = options.spellCheck === true
    this.input.autocomplete = 'off'
    this.input.setAttribute('autocorrect', 'off')
    this.input.setAttribute('autocapitalize', 'off')
    this.input.setAttribute('wrap', 'soft')
    this.input.readOnly = options.readOnly === true
    // The native attribute, so the first frame is already the right height.
    this.input.rows = this.sizing.minRows
    if (options.placeholder !== undefined) this.input.placeholder = options.placeholder
    if (options.ariaLabel !== undefined) this.input.setAttribute('aria-label', options.ariaLabel)
    this.input.setAttribute('aria-autocomplete', this.completion === undefined ? 'none' : 'list')
    this.input.setAttribute('aria-expanded', 'false')
    this.input.setAttribute('role', 'combobox')
    // Written exactly once, before any listener exists, so it is the element's own
    // initial content rather than a programmatic overwrite of it.
    this.input.value = options.value ?? ''
    this.box.appendChild(this.input)

    this.popup = new Popup(
      this.document,
      {
        accept: (index) => {
          this.acceptCompletion(index)
        },
        hover: (index) => {
          this.setActive(index)
        },
      },
      this.instanceId,
    )
    this.element.appendChild(this.popup.element)
    this.input.setAttribute('aria-controls', this.popup.listId)

    this.tooltip = new Tooltip(this.document)
    this.element.appendChild(this.tooltip.element)

    this.mirror = new TextMirror(this.document)
    this.mirror.mount(this.document.body ?? this.document.documentElement)

    // A width change invalidates both measurements: text wraps differently, and so
    // does the paint. This is also what performs the FIRST useful measurement, since
    // the constructor runs before the caller has mounted anything and an unmounted
    // field has no width to measure against.
    const Observer = (this.view as (Window & { ResizeObserver?: typeof ResizeObserver }) | undefined)
      ?.ResizeObserver
    if (typeof Observer === 'function') {
      this.resizeObserver = new Observer(() => {
        const width = this.element.clientWidth
        if (width === this.observedWidth) return
        this.observedWidth = width
        this.mirror.adopt(this.input)
        this.resize(this.input.value)
        this.placePopup()
      })
      this.resizeObserver.observe(this.element)
    }

    const fonts = (this.document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts
    this.fontsReady = fonts?.ready

    this.bind()
    this.sync()
    // A web font arriving after the first paint changes every metric the mirror
    // copied, so the box is re-measured once it lands. Without this the editor is a
    // few pixels off until something else makes it re-layout, which is the classic
    // "it looks wrong until you click it" bug.
    if (this.fontsReady !== undefined) {
      void this.fontsReady.then(() => {
        if (!this.destroyed) this.refresh()
      })
    }
  }

  // ── what a host reads ──────────────────────────────────────────────────────

  /** The current text. */
  get value(): string {
    return this.input.value
  }

  /** The caret or selection. */
  get selection(): TextSelection {
    return readSelection(this.input)
  }

  /** The last inspection, or undefined before the first one. */
  get inspection(): Inspection<State> | undefined {
    return this.current
  }

  /** The problems the grammar found. */
  get diagnostics(): readonly Diagnostic[] {
    return this.current?.diagnostics ?? []
  }

  /** The list on screen, when one is. */
  get currentCompletion(): Completion | undefined {
    return this.completionState
  }

  /** Whether the editor has focus. */
  get focused(): boolean {
    return this.document.activeElement === this.input
  }

  // ── what a host calls ─────────────────────────────────────────────────────

  /**
   * Replace the text.
   *
   * `preserveHistory` writes through the editing pipeline, so the replacement is
   * one undoable edit and Ctrl+Z brings the old text back — what a Reset button
   * wants. Without it the value property is assigned, which is faster and clears
   * the history, which is what loading a different document wants.
   *
   * This is the only path that writes the text, and it is never used for an edit
   * the user could have made.
   * @param next - the new text.
   * @param preserveHistory - whether Ctrl+Z should be able to undo it.
   * @returns how the write landed.
   */
  setValue(next: string, preserveHistory = false): EditOutcome {
    if (this.input.value === next) return 'unchanged'
    // Marked as the editor's own write, because a history-preserving write fires an
    // `input` event and everything downstream listens for one. Without this the caller is
    // handed its own change back through `onChange`, and a host that stores what it is
    // told would write its own value twice.
    this.applying = true
    let outcome: EditOutcome
    try {
      outcome = writeDocument(this.input, next, preserveHistory)
    } finally {
      this.applying = false
    }
    this.sync()
    return outcome
  }

  /**
   * Put the caret somewhere.
   * @param start - the anchor offset.
   * @param end - the moving offset; defaults to `start`.
   */
  setSelection(start: number, end: number = start): void {
    writeSelection(this.input, start, end)
    this.updateCompletionForCaret()
  }

  /** Move the caret into the field. */
  focus(): void {
    this.input.focus()
  }

  /** Undo, through the browser's history. */
  undo(): boolean {
    const done = undoField(this.input)
    if (done) this.sync()
    return done
  }

  /** Redo, through the browser's history. */
  redo(): boolean {
    const done = redoField(this.input)
    if (done) this.sync()
    return done
  }

  /**
   * Set CSS custom properties on the wrapper, replacing whatever this method set last time.
   *
   * A property that has disappeared from the record is removed rather than left behind, so a
   * host can un-theme by passing a smaller object. Properties set by other means — a stylesheet,
   * or the wrapper's inline style directly — are not touched, and a removed one falls back to
   * whatever CSS says.
   *
   * Safe to call at any time after construction. The constructor uses the private write-only
   * half, because re-measuring needs the field, the mirror, and the overlay, none of which exist
   * until it has finished.
   * @param next - the properties, keyed as {@link LiteAreaOptions.variables} describes.
   */
  setVariables(next: Readonly<Record<string, string>>): void {
    this.applyVariables(next)
    // A font or a line height changes every measurement, so the box is re-measured rather than
    // waiting for the next keystroke to notice.
    this.mirror.adopt(this.input)
    this.appliedHeight = -1
    this.sync()
  }

  /** Write the properties, and forget the ones that are gone. No re-measure. */
  private applyVariables(next: Readonly<Record<string, string>>): void {
    const keep = new Set<string>()
    for (const [key, value] of Object.entries(next)) {
      const name = variableName(key)
      keep.add(name)
      this.element.style.setProperty(name, value)
    }
    for (const name of this.appliedVariables) {
      if (!keep.has(name)) this.element.style.removeProperty(name)
    }
    this.appliedVariables = keep
  }

  /**
   * Re-read the document with the same text.
   *
   * For a host whose grammar depends on something outside it — an installed font
   * list that has just been re-read, a palette that changed — and for the moment a
   * web font finishes loading.
   *
   * The grammar is re-resolved here, which is what makes a live grammar object
   * work: a host that rebuilds its rules on every render can call `refresh()` and
   * the editor picks the new ones up without being rebuilt, so the undo history
   * survives a language change.
   */
  refresh(): void {
    this.grammar = resolveGrammar(this.declaredGrammar)
    this.current = undefined
    this.currentText = undefined
    this.mirror.adopt(this.input)
    this.overlay.invalidate()
    this.appliedHeight = -1
    this.appliedOverflow = ''
    this.appliedScrollbar = -1
    this.sync()
  }

  /** Open the completion list on demand, as Ctrl+Space does. */
  showCompletions(): void {
    if (this.completion === undefined) return
    this.openCompletion('explicit')
  }

  /** Close the completion list. */
  hideCompletions(): void {
    this.closeCompletion()
  }

  /** Remove the editor and every listener it owns. */
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.unbind()
    this.resizeObserver?.disconnect()
    this.resizeObserver = undefined
    if (this.hoverTimer !== undefined) this.view?.clearTimeout(this.hoverTimer)
    this.popup.destroy()
    this.tooltip.destroy()
    this.overlay.destroy()
    this.mirror.destroy()
    // The injected sheet is shared by every editor on the page, so it stays:
    // removing it would unstyle the others.
    void this.injectedStyle
    this.element.remove()
  }

  // ── the pipeline ──────────────────────────────────────────────────────────

  /**
   * Bring everything up to date with the field.
   *
   * The inspection is cached on the text, so moving the caret or scrolling costs
   * nothing beyond the paint — and the paint itself is skipped when neither the
   * text nor the analysis changed.
   */
  private sync(): void {
    const text = this.input.value
    if (this.current === undefined || this.currentText !== text) {
      this.current = inspect(text, this.grammar)
      this.currentText = text
      this.revision += 1
    }
    const inspection = this.current
    this.paint(inspection)
    this.resize(text)
    this.overlay.syncScroll(this.input)
    this.announceDiagnostics(inspection)
  }

  /** Paint the layer, and mark the box when a problem is an error. */
  private paint(inspection: Inspection<State>): void {
    const painting: SegmentInput = {
      tokens: inspection.tokens,
      decorations: this.paintDecorations ? inspection.decorations : [],
      diagnostics: inspection.diagnostics,
    }
    const key = [
      String(this.revision),
      this.paintDecorations ? 'd' : '-',
      String(painting.decorations.length),
      String(painting.diagnostics.length),
    ].join(':')
    this.overlay.render(inspection.text, painting, key, this.grammar.fallbackScope)
    const hasError = inspection.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
    this.element.classList.toggle('litearea-invalid', hasError)
    this.input.setAttribute('aria-invalid', hasError ? 'true' : 'false')
  }

  /** Tell the host, once, when the problem list actually changed. */
  private announceDiagnostics(inspection: Inspection<State>): void {
    if (this.handlers.onDiagnostics === undefined) return
    const key = inspection.diagnostics
      .map(
        (diagnostic) =>
          `${String(diagnostic.from)}:${diagnostic.code ?? ''}:${diagnostic.message}`,
      )
      .join('|')
    if (key === this.announced) return
    this.announced = key
    this.handlers.onDiagnostics(inspection.diagnostics)
  }

  /**
   * Size the box to its content.
   *
   * The mirror has no scrollbar, so its measurement is the height the content wants
   * with the full width available — which is exactly the number that decides whether
   * a scrollbar is needed at all. If it fits under the maximum, the height becomes
   * the content height and the overflow stays hidden, which is the promise of "grow
   * and shrink so no scrollbar is ever shown". If it does not fit, the height is
   * clamped and the overflow becomes `auto`.
   *
   * Clamping introduces a second problem that is easy to miss: a scrollbar narrows
   * the text, so the field rewraps, so the PAINT no longer wraps the same way and
   * every coloured span slides off its character. The measured scrollbar width is
   * therefore published as a custom property, and the stylesheet adds it to the
   * layer's own right padding so the two keep wrapping identically.
   *
   * An UNMOUNTED field is skipped rather than measured. Before the element is in the
   * document it has no layout, so its `clientWidth` is zero, the mirror wraps at every
   * character, and the measurement comes back several times too tall — a wrong height
   * that then has to be corrected on the next keystroke, which is what a box that
   * jumps on first focus actually is. The `ResizeObserver` installed at construction
   * does the first real measurement as soon as there is a width to measure against.
   * @param text - the current text.
   */
  private resize(text: string): void {
    if (!this.sizing.autoGrow) {
      // Still adopted, because caret geometry depends on the mirror being shaped like
      // the field even when the field's height is the host's business.
      this.mirror.adopt(this.input)
      return
    }
    if (!this.input.isConnected || this.input.clientWidth === 0) return
    const chrome = this.mirror.verticalPadding()
    const lineHeight = this.mirror.lineHeight(this.input)
    const minPx = Math.max(
      this.sizing.minHeight ?? 0,
      lineHeight * (this.sizing.minRows ?? 1) + chrome,
    )
    const maxCandidate = Math.min(
      this.sizing.maxHeight ?? Number.POSITIVE_INFINITY,
      this.sizing.maxRows === undefined
        ? Number.POSITIVE_INFINITY
        : lineHeight * this.sizing.maxRows + chrome,
    )
    // A maximum below the minimum is a host mistake, and honouring it would make
    // the box smaller than the host was told it could be.
    const maxPx = Math.max(maxCandidate, minPx)

    const content = this.mirror.contentHeight(this.input, text)
    const wanted = clamp(Math.max(content, minPx), minPx, maxPx)
    const overflow = content > wanted + 0.5 ? 'auto' : 'hidden'

    if (Math.abs(wanted - this.appliedHeight) > 0.5) {
      this.input.style.height = `${String(Math.round(wanted))}px`
      this.appliedHeight = wanted
    }
    if (overflow !== this.appliedOverflow) {
      this.input.style.overflowY = overflow
      this.appliedOverflow = overflow
    }
    // Read AFTER the overflow is applied, because that is when a scrollbar exists
    // and therefore when there is a width to report.
    const scrollbar = overflow === 'auto' ? this.input.offsetWidth - this.input.clientWidth : 0
    const width = Math.max(0, scrollbar)
    if (width !== this.appliedScrollbar) {
      this.element.style.setProperty('--litearea-scrollbar', `${String(width)}px`)
      this.appliedScrollbar = width
    }
  }

  // ── completion ────────────────────────────────────────────────────────────

  /** The caret's offset, clamped into the text. */
  private caret(): number {
    return clamp(readSelection(this.input).start, 0, this.input.value.length)
  }

  /** Resolve and show a list for the caret. */
  private openCompletion(trigger: CompletionTrigger): void {
    if (this.completion === undefined || this.current === undefined) return
    // The source that answered last time is passed back so the same one answers again
    // while it stays eligible. The RANGE is deliberately not held: it is recomputed from
    // the caret on every call, so it grows with the word being typed.
    const result = complete(this.current, this.grammar, {
      text: this.input.value,
      caret: this.caret(),
      trigger,
      previousSourceId: this.completionState?.sourceId,
      limit: this.completion.limit,
    })
    if (result === undefined || result.rows.length === 0) {
      this.closeCompletion()
      return
    }
    this.completionState = result
    this.popup.show(result.rows, 0, this.completion.showDocumentation)
    this.input.setAttribute('aria-expanded', 'true')
    this.syncActiveDescendant()
    this.placePopup()
    this.handlers.onCompletion?.(result)
  }

  /** Close the list and tell the host. */
  private closeCompletion(): void {
    if (this.completionState === undefined && !this.popup.isOpen) return
    this.completionState = undefined
    this.popup.close()
    this.input.setAttribute('aria-expanded', 'false')
    this.input.removeAttribute('aria-activedescendant')
    this.handlers.onCompletion?.(undefined)
  }

  /** Keep the field's `aria-activedescendant` pointing at the active row. */
  private syncActiveDescendant(): void {
    const id = this.popup.activeRowId
    if (id === undefined) this.input.removeAttribute('aria-activedescendant')
    else this.input.setAttribute('aria-activedescendant', id)
  }

  /** Put the list under the caret. */
  private placePopup(): void {
    if (this.completionState === undefined) return
    const box = this.mirror.caretBox(this.input, this.caret())
    if (box === undefined) return
    // The mirror reports relative to the field's border box; the list is positioned
    // against the wrapper. Measuring both rects is used rather than `offsetLeft`
    // arithmetic, because `offsetParent` changes as soon as a host wraps the editor
    // in something positioned, and the caret must not notice.
    const inputRect = this.input.getBoundingClientRect()
    const elementRect = this.element.getBoundingClientRect()
    this.popup.place(
      {
        x: inputRect.left - elementRect.left + box.x,
        y: inputRect.top - elementRect.top + box.y,
        height: box.height,
      },
      this.element,
      { width: this.view?.innerWidth ?? 0, height: this.view?.innerHeight ?? 0 },
    )
  }

  /**
   * Take the active row.
   * @param index - the row to take.
   * @param commitCharacter - a character typed to trigger the pick, written after
   *   the completion so the keystroke is not swallowed.
   */
  private acceptCompletion(index: number, commitCharacter?: string): void {
    const state = this.completionState
    const row: SuggestionItem | undefined = this.popup.items[index]?.item
    if (state === undefined || row === undefined) return
    const applied = applyCompletion(this.input.value, state.range, row)
    this.applying = true
    try {
      // Only the range that changed is written, and it goes through the editing
      // pipeline, so Ctrl+Z undoes the completion as one edit and the rest of the
      // document — and its history — is untouched.
      replaceThroughPipeline(this.input, applied.from, applied.to, applied.insert)
      writeSelection(this.input, applied.caret)
      if (commitCharacter !== undefined) {
        replaceThroughPipeline(this.input, applied.caret, applied.caret, commitCharacter)
        writeSelection(this.input, applied.caret + commitCharacter.length)
      }
    } finally {
      this.applying = false
    }
    this.closeCompletion()
    this.sync()
    const inspection = this.current
    if (inspection !== undefined) {
      this.grammar.grammar.onAccept?.({
        text: this.input.value,
        caret: this.caret(),
        item: row,
        state: inspection.state,
      })
    }
  }

  /** Decide what an edit does to the list. */
  private updateCompletionAfterInput(data: string, deletion: boolean): void {
    if (this.completion === undefined || this.applying || this.composing) return
    if (this.input.readOnly) return
    if (deletion) {
      // Deleting inside an open list re-filters it; deleting with no list open opens
      // nothing, because a backspace is not a request for suggestions.
      if (this.completionState !== undefined) this.openCompletion('auto')
      return
    }
    if (this.completionState !== undefined) {
      this.openCompletion('auto')
      return
    }
    if (!this.completion.auto) return
    if (!this.shouldAutoOpen(data)) return
    this.openCompletion('auto')
  }

  /** Whether a keystroke is a reason to offer suggestions. */
  private shouldAutoOpen(data: string): boolean {
    if (data === '' || this.completion === undefined) return false
    const last = data.slice(-1)
    if (this.completion.triggerCharacters.includes(last)) return true
    return this.grammar.wordChars.test(last)
  }

  /** Close a list the caret has left. */
  private updateCompletionForCaret(): void {
    const state = this.completionState
    if (state === undefined) return
    const caret = this.caret()
    if (caret < state.range.from || caret > state.range.to) this.closeCompletion()
    else this.placePopup()
  }

  // ── hover ─────────────────────────────────────────────────────────────────

  /** Start, or restart, the timer that shows a tooltip. */
  private queueHover(offset: number, event: MouseEvent): void {
    if (this.hover === undefined || !this.hover.enabled || this.current === undefined) return
    if (offset === this.hoverOffset && this.tooltip.isOpen) return
    this.hoverOffset = offset
    this.hideTooltip()
    const clientX = event.clientX
    const clientY = event.clientY
    this.hoverTimer = this.view?.setTimeout(() => {
      this.hoverTimer = undefined
      this.showHover(offset, clientX, clientY)
    }, this.hover.delay)
  }

  /** Resolve and show a tooltip. */
  private showHover(offset: number, clientX: number, clientY: number): void {
    if (this.current === undefined || this.destroyed) return
    const info = resolveHover(this.current, this.grammar, offset)
    if (info === undefined) {
      this.hideTooltip()
      return
    }
    const rect = this.element.getBoundingClientRect()
    const lineHeight = this.mirror.lineHeight(this.input)
    this.tooltip.show(
      info,
      { x: clientX - rect.left, y: clientY - rect.top, height: lineHeight },
      this.element,
      { width: this.view?.innerWidth ?? 0, height: this.view?.innerHeight ?? 0 },
    )
    this.handlers.onHover?.(info)
  }

  /** Hide the tooltip and forget what it described. */
  private hideTooltip(): void {
    if (this.hoverTimer !== undefined) {
      this.view?.clearTimeout(this.hoverTimer)
      this.hoverTimer = undefined
    }
    if (!this.tooltip.isOpen) return
    this.tooltip.hide()
    this.handlers.onHover?.(undefined)
  }

  // ── events ────────────────────────────────────────────────────────────────

  /** Attach every listener. */
  private bind(): void {
    this.input.addEventListener('input', this.onInput)
    this.input.addEventListener('keydown', this.onKeyDown)
    this.input.addEventListener('scroll', this.onScroll)
    this.input.addEventListener('click', this.onCaretMoved)
    this.input.addEventListener('keyup', this.onKeyUp)
    this.input.addEventListener('select', this.onCaretMoved)
    this.input.addEventListener('blur', this.onBlur)
    this.input.addEventListener('mousemove', this.onMouseMove)
    this.input.addEventListener('mouseleave', this.onMouseLeave)
    this.input.addEventListener('compositionstart', this.onCompositionStart)
    this.input.addEventListener('compositionend', this.onCompositionEnd)
    this.document.addEventListener('selectionchange', this.onSelectionChange)
  }

  /** Detach every listener. */
  private unbind(): void {
    this.input.removeEventListener('input', this.onInput)
    this.input.removeEventListener('keydown', this.onKeyDown)
    this.input.removeEventListener('scroll', this.onScroll)
    this.input.removeEventListener('click', this.onCaretMoved)
    this.input.removeEventListener('keyup', this.onKeyUp)
    this.input.removeEventListener('select', this.onCaretMoved)
    this.input.removeEventListener('blur', this.onBlur)
    this.input.removeEventListener('mousemove', this.onMouseMove)
    this.input.removeEventListener('mouseleave', this.onMouseLeave)
    this.input.removeEventListener('compositionstart', this.onCompositionStart)
    this.input.removeEventListener('compositionend', this.onCompositionEnd)
    this.document.removeEventListener('selectionchange', this.onSelectionChange)
  }

  private readonly onInput = (event: Event): void => {
    this.sync()
    const input = event as InputEvent
    const type = input.inputType ?? ''
    const deletion = type.startsWith('delete')
    const data = typeof input.data === 'string' ? input.data : ''
    // Typing is not a request for a tooltip, and leaving one up over text that has
    // moved is worse than not having shown it.
    this.hideTooltip()
    this.updateCompletionAfterInput(data, deletion)
    if (!this.applying) this.handlers.onChange?.(this.input.value)
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    // First, because a keystroke a row asked for is a pick and not text.
    if (this.commitCharacter(event)) return

    if (event.key === 'Escape') {
      if (this.popup.isOpen) {
        event.preventDefault()
        this.closeCompletion()
        return
      }
      this.hideTooltip()
      return
    }

    if (event.key === ' ' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      if (this.popup.isOpen) this.closeCompletion()
      else this.openCompletion('explicit')
      return
    }

    if (!this.popup.isOpen) return
    const last = this.popup.items.length - 1

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        // No wrapping, because a list that jumps from the end back to the start on
        // one arrow press is a list nobody can navigate deliberately.
        this.setActive(Math.min(this.popup.activeIndex + 1, last))
        return
      case 'ArrowUp':
        event.preventDefault()
        this.setActive(Math.max(this.popup.activeIndex - 1, 0))
        return
      case 'PageDown':
        event.preventDefault()
        this.setActive(Math.min(this.popup.activeIndex + PAGE_STEP, last))
        return
      case 'PageUp':
        event.preventDefault()
        this.setActive(Math.max(this.popup.activeIndex - PAGE_STEP, 0))
        return
      case 'Enter':
        event.preventDefault()
        this.acceptCompletion(this.popup.activeIndex)
        return
      case 'Tab':
        event.preventDefault()
        this.acceptCompletion(this.popup.activeIndex)
        return
      default:
        return
    }
  }

  /**
   * Whether a keystroke is a commit character for the active row.
   *
   * Typing `=` at the end of `shape` takes the `shape=` row and keeps the
   * character, rather than either swallowing the keystroke or leaving the row to be
   * clicked. A row opts in; nothing has a commit character by default.
   * @param event - the key event.
   * @returns whether the keystroke was consumed.
   */
  private commitCharacter(event: KeyboardEvent): boolean {
    if (!this.popup.isOpen) return false
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return false
    const characters = this.popup.activeRow?.item.commitCharacters
    if (characters === undefined || !characters.includes(event.key)) return false
    event.preventDefault()
    this.acceptCompletion(this.popup.activeIndex, event.key)
    return true
  }

  /** Make a row active and keep the ARIA pointer in step. */
  private setActive(index: number): void {
    this.popup.setActive(index)
    this.syncActiveDescendant()
  }

  private readonly onScroll = (): void => {
    this.overlay.syncScroll(this.input)
    this.placePopup()
    this.hideTooltip()
  }

  private readonly onCaretMoved = (): void => {
    this.updateCompletionForCaret()
    this.handlers.onSelectionChange?.(readSelection(this.input))
  }

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    // Shift+Arrow and Home/End move the caret without an `input` event, and a list
    // left open over a caret that has walked out of its range would complete the
    // wrong thing.
    if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') {
      this.updateCompletionForCaret()
    }
  }

  private readonly onSelectionChange = (): void => {
    if (this.document.activeElement !== this.input) return
    this.handlers.onSelectionChange?.(readSelection(this.input))
  }

  private readonly onBlur = (): void => {
    // A pick beats this, because the list cancels the default on `mousedown`; a
    // genuine blur closes everything.
    this.closeCompletion()
    this.hideTooltip()
  }

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (this.hover === undefined || !this.hover.enabled) return
    if (this.popup.isOpen) {
      this.hideTooltip()
      return
    }
    // The BROWSER is asked where the pointer is in the text, rather than the editor
    // measuring wrapped proportional glyphs by hand — which is exactly the geometry
    // a hand-written measurement always gets slightly wrong.
    const offset = caretOffsetFromPoint(this.document, event.clientX, event.clientY)
    if (offset === undefined) return
    this.queueHover(offset, event)
  }

  private readonly onMouseLeave = (): void => {
    this.hoverOffset = undefined
    this.hideTooltip()
  }

  private readonly onCompositionStart = (): void => {
    this.composing = true
    this.closeCompletion()
  }

  private readonly onCompositionEnd = (): void => {
    this.composing = false
    this.sync()
  }
}

/**
 * The full custom-property name for a key a host may have written in a few ways.
 *
 * `font`, `litearea-font`, and `--litearea-font` all mean the same property; a key that already
 * begins with `--` is used verbatim, so `--litearea-font` and a host's own `--my-brand` both
 * work without the editor having to guess which prefix was meant.
 * @param key - the key as written.
 * @returns the custom-property name.
 */
function variableName(key: string): string {
  if (key.startsWith('--')) return key
  return key.startsWith('litearea-') ? `--${key}` : `--litearea-${key}`
}

/**
 * The caret offset a viewport point falls on.
 *
 * A free function so the editor does not reach into the document for it, and so the
 * two spellings of the API live in one place.
 * @param ownerDocument - the document.
 * @param x - viewport x.
 * @param y - viewport y.
 * @returns the offset, or undefined when the browser cannot say.
 */
function caretOffsetFromPoint(
  ownerDocument: Document,
  x: number,
  y: number,
): number | undefined {
  const probe = ownerDocument as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  if (typeof probe.caretPositionFromPoint === 'function') {
    return probe.caretPositionFromPoint(x, y)?.offset
  }
  if (typeof probe.caretRangeFromPoint === 'function') {
    return probe.caretRangeFromPoint(x, y)?.startOffset
  }
  return undefined
}

/** A severity, re-exported so a host can narrow a diagnostic without importing core. */
export type EditorSeverity = Severity

/** A range, re-exported for the same reason. */
export type EditorRange = Range

/** A decoration, re-exported for the same reason. */
export type EditorDecoration = Decoration
