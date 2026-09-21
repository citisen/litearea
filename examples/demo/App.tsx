// ─── the demo app ───────────────────────────────────────────────────────────
//
// One page, three sections, and one rule the whole layout obeys: nothing here ever
// writes text into an editor except `setValue`. The editor owns its document, so
// React state holds a MIRROR of the text for the panels beside it and never a
// source of truth — which is the subject of the last section.
//
// The grammars here are the demo's OWN, both of them beside this file under
// `examples/demo/grammars/`. The library ships no syntax, and the two production
// DSLs this editor came out of — dsh-font's font query and dsh-sentry's
// appearance document — now live with the plugins that own them. The demo neither
// imports nor copies them: it demonstrates the engine with grammars written for
// the demo, so a host should take these grammar objects as templates rather than
// the directory as a menu of languages.

import * as React from 'react'
import type {
  Completion,
  Diagnostic,
  Grammar,
  HoverInfo,
  LiteArea,
  LiteAreaHover,
  LiteAreaSizing,
} from '@citisen/litearea'
import { LiteAreaEditor } from '@citisen/litearea/react'
import { MINI_DEFAULT, miniConfGrammar, type MiniState } from './grammars/mini'
import {
  SWATCH_DEFAULT,
  swatchGrammar,
  type SwatchOptions,
  type SwatchState,
} from './grammars/swatch'

// ── the languages ───────────────────────────────────────────────────────────
// Built once at module scope. A grammar object is pure data, and rebuilding one on
// every render would only give the editor something new to re-resolve.

/**
 * The palette is the HOST's: it is handed to the grammar as an option, and the
 * grammar resolves it once per scan, so the same document reads differently on a
 * machine whose palette differs. `mauve` is deliberately absent from this list
 * while the seeded document paints with it, so the panel has a squiggle to
 * explain.
 */
const SWATCH_PALETTE: readonly string[] = ['red', 'teal', 'amber', 'slate', 'off-white']

const swatchOptions: SwatchOptions = {
  palette: SWATCH_PALETTE,
  // The colour the host calls the base coat. It is marked by a decoration rather
  // than by a token, because it is a fact about the palette and not about the
  // characters in the file.
  base: 'teal',
}

const swatch = swatchGrammar(swatchOptions)

const miniGrammar = miniConfGrammar()

// ── the controls ────────────────────────────────────────────────────────────

/** Whether suggestions open while typing, only on Ctrl+Space, or never. */
type CompletionMode = 'off' | 'auto' | 'explicit'

/** The two states a `sizing` prop can be in, as the toolbar offers them. */
interface Sizing {
  autoGrow: boolean
  minRows: 1 | 3 | 6
  /** `null` is "no maximum", which only the absent option can say. */
  maxRows: number | null
}

/** Everything the toolbar owns, as one object, so the panels read it in one place. */
interface Settings {
  sizing: Sizing
  completion: CompletionMode
  hover: LiteAreaHover
  readOnly: boolean
}

const COMPLETION_LABEL: Readonly<Record<CompletionMode, string>> = {
  off: 'off — completion: false',
  auto: 'auto — { auto: true }',
  explicit: 'explicit only — { auto: false }',
}

/**
 * The completion option a mode maps to.
 *
 * The two shapes are genuinely different and the library keeps them apart: `false`
 * switches the feature off, while `{ auto: false }` keeps the list but stops it
 * opening on its own, which is what leaves Ctrl+Space working.
 * @param mode - the toolbar's choice.
 * @returns the prop.
 */
function completionProp(mode: CompletionMode): false | { auto: boolean } {
  if (mode === 'off') return false
  return { auto: mode === 'auto' }
}

/**
 * The React `key` every panel's editor is given.
 *
 * `sizing`, `completion`, and `hover` are read when the editor mounts, so changing
 * one has to remount the editor. The key is a string derived from those settings
 * alone, which is what keeps an unrelated re-render from rebuilding an editor and
 * throwing away its undo history with it.
 * @param settings - the toolbar's state.
 * @returns the key.
 */
function remountKeyOf(settings: Settings): string {
  return [
    settings.sizing.autoGrow ? 'grow' : 'fixed',
    String(settings.sizing.minRows),
    String(settings.sizing.maxRows),
    settings.completion,
    settings.hover.enabled ? 'hover' : 'nohover',
  ].join('|')
}

/** The app. */
export function App(): React.ReactElement {
  const [sizing, setSizing] = React.useState<Sizing>({ autoGrow: true, minRows: 3, maxRows: 6 })
  const [completion, setCompletion] = React.useState<CompletionMode>('auto')
  const [hover, setHover] = React.useState<LiteAreaHover>({ enabled: true })
  const [readOnly, setReadOnly] = React.useState(false)
  const [dark, setDark] = React.useState(false)

  /** Every mounted editor, by panel. */
  const editors = React.useRef(new Map<string, LiteArea<unknown>>())
  /** The one Undo and Redo operate on: the focused editor, or the last one focused. */
  const [focused, setFocused] = React.useState<string | undefined>(undefined)

  const target = (): LiteArea<unknown> | undefined => {
    if (focused !== undefined) {
      const editor = editors.current.get(focused)
      if (editor !== undefined) return editor
    }
    return [...editors.current.values()][0]
  }

  const settings: Settings = { sizing, completion, hover, readOnly }

  /**
   * The editor props the toolbar owns, built once here.
   *
   * `readOnly` is deliberately kept out of the remount key below: it is the one
   * option the React binding applies live, so toggling it must NOT rebuild the
   * editor and lose the history. `sizing`, `completion`, and `hover` are read at
   * mount, so they only reach a live editor through a new key.
   */
  const editorProps = {
    key: remountKeyOf(settings),
    sizing: {
      autoGrow: sizing.autoGrow,
      minRows: sizing.minRows,
      ...(sizing.maxRows === null ? {} : { maxRows: sizing.maxRows }),
    },
    completion: completionProp(completion),
    hover,
    readOnly,
  }

  return (
    <div className={dark ? 'demo-app demo-dark' : 'demo-app'}>
      <header className="demo-head">
        <h1>litearea</h1>
        <p>
          Two grammars written for this demo, one editor, and no text ever pushed back into it.
          Each panel below is the same React component with different data; the last section shows
          why that component has no <code>value</code>/<code>onChange</code> loop to fight over.
          The library ships no syntax, and the real DSLs it came out of live beside the plugins
          that own them — so the panels here use the demo&rsquo;s own grammars and nothing else.
        </p>
      </header>

      <div className="demo-toolbar">
        <div className="demo-toolbarRow">
          <strong>History</strong>
          <button type="button" onClick={() => void target()?.undo()}>
            Undo
          </button>
          <button type="button" onClick={() => void target()?.redo()}>
            Redo
          </button>
          <span className="demo-note">
            Undo and Redo act on the focused editor, or the last one that was. Each panel&rsquo;s{' '}
            <em>Reset</em> calls <code>setValue(default, true)</code>, so the reset is one undoable
            edit and Ctrl+Z brings the old text back.
          </span>
        </div>

        <div className="demo-toolbarRow">
          <strong>Sizing</strong>
          <label>
            <input
              type="checkbox"
              checked={sizing.autoGrow}
              onChange={(event) =>
                setSizing((current) => ({ ...current, autoGrow: event.target.checked }))
              }
            />
            auto-grow
          </label>
          <label>
            minRows
            <select
              value={String(sizing.minRows)}
              onChange={(event) =>
                setSizing((current) => ({
                  ...current,
                  minRows: Number(event.target.value) as Sizing['minRows'],
                }))
              }
            >
              <option value="1">1</option>
              <option value="3">3</option>
              <option value="6">6</option>
            </select>
          </label>
          <label>
            maxRows
            <select
              value={sizing.maxRows === null ? 'none' : String(sizing.maxRows)}
              onChange={(event) =>
                setSizing((current) => ({
                  ...current,
                  maxRows: event.target.value === 'none' ? null : Number(event.target.value),
                }))
              }
            >
              <option value="none">none</option>
              <option value="2">2</option>
              <option value="4">4</option>
              <option value="8">8</option>
            </select>
          </label>
          <span className="demo-note">
            A <code>maxRows</code> below the content&rsquo;s height is what introduces a scrollbar;
            below it there is none. With auto-grow off the box keeps the height{' '}
            <code>minRows</code> gave it and scrolls.
          </span>
        </div>

        <div className="demo-toolbarRow">
          <strong>Behaviour</strong>
          <label>
            completion
            <select
              value={completion}
              onChange={(event) => setCompletion(event.target.value as CompletionMode)}
            >
              {(Object.keys(COMPLETION_LABEL) as CompletionMode[]).map((mode) => (
                <option key={mode} value={mode}>
                  {COMPLETION_LABEL[mode]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={hover.enabled === true}
              onChange={(event) => setHover({ enabled: event.target.checked })}
            />
            hover
          </label>
          <label>
            <input
              type="checkbox"
              checked={readOnly}
              onChange={(event) => setReadOnly(event.target.checked)}
            />
            readOnly
          </label>
          <label>
            <input type="checkbox" checked={dark} onChange={(event) => setDark(event.target.checked)} />
            dark theme
          </label>
          <span className="demo-note">
            The dark switch flips one class on this page; the editors follow because they read the
            same custom properties. <code>readOnly</code> applies live. <code>completion</code>,{' '}
            <code>hover</code>, and <code>sizing</code> are mount-time options, so the panels are
            keyed on them and changing one remounts the editors — which is also why it discards
            their undo history.
          </span>
        </div>
      </div>

      <div className="demo-panels">
        <DemoPanels editorProps={editorProps} editors={editors} onFocus={setFocused} />
      </div>

      <Comparison />

      <footer className="demo-foot">
        <p>
          The editor is the only thing that ever writes its own text. A host may replace the document
          through <code>setValue</code>, and that call goes through the browser&rsquo;s own editing
          pipeline — which is why an <em>uncontrolled</em> React <code>textarea</code> is the
          mechanism underneath, and why a controlled wrapper cannot be.
        </p>
      </footer>
    </div>
  )
}

/** The demo's two grammar panels. */
function DemoPanels(props: {
  editorProps: EditorProps
  editors: React.RefObject<Map<string, LiteArea<unknown>>>
  onFocus: (id: string) => void
}): React.ReactElement {
  const { editorProps, editors, onFocus } = props
  const shared = { editors, onFocus, editorProps }

  return (
    <>
      <SwatchPanel {...shared} />
      <MiniPanel {...shared} />
    </>
  )
}

/** The props the toolbar hands to every editor. */
interface EditorProps {
  /** The React key, which is what makes a mount-time option take effect. */
  key: string
  sizing: LiteAreaSizing
  completion: false | { auto: boolean }
  hover: LiteAreaHover
  /** The one option the binding applies live, so it is deliberately not in the key. */
  readOnly: boolean
}

/** What every panel is handed. */
interface PanelProps {
  editors: React.RefObject<Map<string, LiteArea<unknown>>>
  onFocus: (id: string) => void
  editorProps: EditorProps
}

// ── panel 1: swatch (a grammar written for this demo) ───────────────────────

function SwatchPanel(props: PanelProps): React.ReactElement {
  const state = useEditorPanel<SwatchState>({
    id: 'swatch',
    title: 'swatch',
    grammar: swatch,
    defaultValue: SWATCH_DEFAULT,
    ...props,
  })

  const analysis = state.analysis
  return (
    <section className="demo-panel">
      <PanelHead
        title="swatch (a grammar written for this demo)"
        subtitle="A palette the HOST supplies, the shapes this language knows, and a size. Try `ma`, pick a shape from the list, hover a shape name, or leave the size off a line."
      />
      {state.editor}
      <Diagnostics diagnostics={state.diagnostics} />
      <section className="demo-readout">
        <h4>Grammar analysis — entries, and the host palette behind them</h4>
        {analysis === undefined ? (
          <p className="demo-empty">waiting for the first inspection…</p>
        ) : (
          <>
            <ul className="demo-facts">
              <li>
                host palette: <code>{SWATCH_PALETTE.join(' | ')}</code>
              </li>
              <li>
                base coat: <code>{swatchOptions.base ?? '—'}</code>{' '}
                <span className="demo-note">
                  marked by a decoration, because which colour is the base is the palette&rsquo;s
                  fact and not the document&rsquo;s
                </span>
              </li>
              <li>
                swatches read: <code>{analysis.entries.length}</code>
              </li>
              <li>
                structural problems: <code>{analysis.problems.length}</code>{' '}
                <span className="demo-note">
                  reported through <code>validate</code>, so the diagnostics above are{' '}
                  <code>inspect</code>&rsquo;s own list rather than a second opinion
                </span>
              </li>
            </ul>
            <table>
              <thead>
                <tr>
                  <th>line</th>
                  <th>colour</th>
                  <th>shape</th>
                  <th>size</th>
                </tr>
              </thead>
              <tbody>
                {analysis.entries.map((entry) => (
                  <tr
                    key={`${String(entry.line)}:${entry.color.name}`}
                    className={entry.color.name === swatchOptions.base ? 'demo-effective' : undefined}
                  >
                    <td>{entry.line + 1}</td>
                    <td>{entry.color.name}</td>
                    <td>{entry.shape}</td>
                    <td>{entry.size}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
      <CompletionPanel completion={state.completion} />
      <HoverPanel hover={state.hover} />
      <PanelFoot label="Reset to the shipped swatch document" onReset={state.reset} />
    </section>
  )
}

// ── panel 2: mini-conf (a grammar written for this demo) ────────────────────

function MiniPanel(props: PanelProps): React.ReactElement {
  const state = useEditorPanel<MiniState>({
    id: 'mini',
    title: 'mini-conf',
    grammar: miniGrammar,
    defaultValue: MINI_DEFAULT,
    ...props,
  })

  const analysis = state.analysis
  return (
    <section className="demo-panel">
      <PanelHead
        title="mini-conf (a grammar written for this demo)"
        subtitle="Sections, `key = value`, `#` and `;` comments, and a nested `/* … */` block comment. Try `po` and then `=`, hover a boolean, or close a section wrongly."
      />
      {state.editor}
      <Diagnostics diagnostics={state.diagnostics} />
      <section className="demo-readout">
        <h4>Grammar analysis — sections, keys, and what the reader found</h4>
        {analysis === undefined ? (
          <p className="demo-empty">waiting for the first inspection…</p>
        ) : (
          <>
            <ul className="demo-facts">
              <li>
                sections:{' '}
                <code>{analysis.sections.map((entry) => `[${entry.name}]`).join(' ') || '—'}</code>
              </li>
              <li>
                settings read: <code>{analysis.properties.length}</code>
              </li>
              <li>
                block-comment depth at the end: <code>{analysis.blockDepth}</code>
              </li>
              <li>
                structural problems: <code>{analysis.problems.length}</code>{' '}
                <span className="demo-note">
                  reported through <code>validate</code>, so the diagnostics above are{' '}
                  <code>inspect</code>&rsquo;s own list rather than a second opinion
                </span>
              </li>
            </ul>
            <table>
              <thead>
                <tr>
                  <th>line</th>
                  <th>section</th>
                  <th>key</th>
                  <th>value</th>
                  <th>quoted</th>
                </tr>
              </thead>
              <tbody>
                {analysis.properties.map((entry) => (
                  <tr key={`${String(entry.line)}:${entry.key}`}>
                    <td>{entry.line + 1}</td>
                    <td>{entry.section ?? '(top level)'}</td>
                    <td>{entry.key}</td>
                    <td>{entry.value || '—'}</td>
                    <td>{entry.quoted ? 'yes' : 'no'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
      <CompletionPanel completion={state.completion} />
      <HoverPanel hover={state.hover} />
      <PanelFoot label="Reset to the mini-conf example" onReset={state.reset} />
    </section>
  )
}

// ── the piece every panel shares ────────────────────────────────────────────

/** What {@link useEditorPanel} hands back. */
interface PanelState<State> {
  editor: React.ReactElement
  diagnostics: readonly Diagnostic[]
  completion: Completion | undefined
  hover: HoverInfo | undefined
  analysis: State | undefined
  reset: () => void
}

/**
 * Mount one `LiteAreaEditor` and mirror everything it reports into React state.
 *
 * The editor owns the text: this hook never passes a `value`, and `defaultValue` is
 * read once, when the editor mounts. What it does instead is keep a copy for the
 * readouts beside the editor, refreshed from the editor's own inspection so the
 * diagnostics and the analysis cannot disagree about which text they describe.
 * @param config - the grammar, the default document, and the panel's identity.
 * @returns the element to render, and the latest state to render beside it.
 */
function useEditorPanel<State>(config: {
  id: string
  title: string
  grammar: Grammar<State>
  defaultValue: string
  editors: React.RefObject<Map<string, LiteArea<unknown>>>
  onFocus: (id: string) => void
  editorProps: EditorProps
}): PanelState<State> {
  const { id, defaultValue, grammar, editors, onFocus, editorProps } = config
  const { key: remountKey, sizing, completion, hover, readOnly } = editorProps
  const [diagnostics, setDiagnostics] = React.useState<readonly Diagnostic[]>([])
  const [completionState, setCompletionState] = React.useState<Completion | undefined>(undefined)
  const [hoverState, setHoverState] = React.useState<HoverInfo | undefined>(undefined)
  const [inspection, setInspection] = React.useState<
    { text: string; state: State; diagnostics: readonly Diagnostic[] } | undefined
  >(undefined)

  /** Re-read what the editor has already computed, rather than computing it twice. */
  const pull = React.useCallback((editor: LiteArea<State>): void => {
    const current = editor.inspection
    setDiagnostics(editor.diagnostics)
    if (current !== undefined) {
      setInspection({ text: current.text, state: current.state, diagnostics: current.diagnostics })
    }
  }, [])

  const onEditor = React.useCallback(
    (editor: LiteArea<State> | undefined): void => {
      if (editor === undefined) {
        editors.current.delete(id)
        return
      }
      editors.current.set(id, editor as LiteArea<unknown>)
      // The editor exposes no focus callback, and the field it built is right
      // there: this is what makes Undo and Redo act on the editor the user was
      // actually in.
      editor.input.addEventListener('focus', () => {
        onFocus(id)
      })
      pull(editor)
    },
    [editors, id, onFocus, pull],
  )

  return {
    editor: (
      <LiteAreaEditor<State>
        // The key belongs to the wrapper, and changing it unmounts the editor and
        // mounts a new one — the only way a mount-time option can take effect.
        key={remountKey}
        grammar={grammar}
        defaultValue={defaultValue}
        className="demo-editor"
        ariaLabel={config.title}
        placeholder="type here"
        sizing={sizing}
        completion={completion}
        hover={hover}
        readOnly={readOnly}
        onDiagnostics={setDiagnostics}
        onCompletion={setCompletionState}
        onHover={setHoverState}
        onChange={() => {
          const current = editors.current.get(id)
          if (current !== undefined) pull(current as LiteArea<State>)
        }}
        editorRef={onEditor}
      />
    ),
    diagnostics,
    completion: completionState,
    hover: hoverState,
    analysis: inspection?.state,
    // `true` is what makes the reset undoable, which is the whole point of the button.
    reset: () => {
      void editors.current.get(id)?.setValue(defaultValue, true)
    },
  }
}

// ── the readouts ────────────────────────────────────────────────────────────

function PanelHead(props: { title: string; subtitle: string }): React.ReactElement {
  return (
    <header className="demo-panelHead">
      <h2>{props.title}</h2>
      <p>{props.subtitle}</p>
    </header>
  )
}

function PanelFoot(props: { label: string; onReset: () => void }): React.ReactElement {
  return (
    <footer className="demo-panelFoot">
      <button type="button" onClick={props.onReset}>
        Reset
      </button>
      <span className="demo-note">{props.label} — as one undoable edit.</span>
    </footer>
  )
}

function Diagnostics(props: { diagnostics: readonly Diagnostic[] }): React.ReactElement {
  const { diagnostics } = props
  return (
    <section className="demo-readout">
      <h4>
        Diagnostics <span className="demo-count">{diagnostics.length}</span>
      </h4>
      {diagnostics.length === 0 ? (
        <p className="demo-empty">no problems</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>severity</th>
              <th>code</th>
              <th>range</th>
              <th>message</th>
            </tr>
          </thead>
          <tbody>
            {diagnostics.map((diagnostic) => (
              <tr key={`${String(diagnostic.from)}:${diagnostic.code ?? ''}`}>
                <td>
                  <span className={`demo-sev demo-sev-${diagnostic.severity}`}>
                    {diagnostic.severity}
                  </span>
                </td>
                <td>
                  <code>{diagnostic.code ?? '—'}</code>
                </td>
                <td>
                  <code>
                    {diagnostic.from}–{diagnostic.to}
                  </code>
                </td>
                <td>{diagnostic.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function CompletionPanel(props: { completion: Completion | undefined }): React.ReactElement {
  const { completion } = props
  return (
    <section className="demo-readout">
      <h4>Completion state</h4>
      {completion === undefined ? (
        <p className="demo-empty">
          closed — put the caret in the editor and type a letter, or press Ctrl+Space
        </p>
      ) : (
        <>
          <ul className="demo-facts">
            <li>
              source: <code>{completion.sourceId}</code>
            </li>
            <li>
              frozen range:{' '}
              <code>
                {completion.range.from}–{completion.range.to}
              </code>{' '}
              <span className="demo-note">
                resolved when the list opened, and held while the needle grows
              </span>
            </li>
            <li>
              needle: <code>{completion.needle === '' ? '(empty)' : completion.needle}</code>
            </li>
            <li>
              rows: <code>{completion.rows.length}</code>
            </li>
          </ul>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>label</th>
                <th>kind</th>
                <th>detail</th>
                <th>commit</th>
                <th>score</th>
              </tr>
            </thead>
            <tbody>
              {completion.rows.slice(0, 12).map((row, index) => (
                <tr key={`${String(index)}:${row.item.label}`}>
                  <td>{index + 1}</td>
                  <td>
                    <code>{row.item.label}</code>
                  </td>
                  <td>{row.item.kind ?? '—'}</td>
                  <td>{row.item.detail ?? '—'}</td>
                  <td>
                    <code>{row.item.commitCharacters ?? '—'}</code>
                  </td>
                  <td>{row.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}

function HoverPanel(props: { hover: HoverInfo | undefined }): React.ReactElement {
  return (
    <section className="demo-readout">
      <h4>Hover</h4>
      {props.hover === undefined ? (
        <p className="demo-empty">
          nothing — rest the pointer on a word (the tooltip needs the hover option on)
        </p>
      ) : (
        <ul className="demo-facts">
          <li>
            title: <strong>{props.hover.title ?? '—'}</strong>
          </li>
          <li>
            detail: <span className="demo-note">{props.hover.detail ?? '—'}</span>
          </li>
          <li>body: {props.hover.body ?? '—'}</li>
        </ul>
      )}
    </section>
  )
}

// ── the comparison ──────────────────────────────────────────────────────────

const COMPARISON_TEXT = [
  'first line — type a few characters here',
  'second line',
  'third line',
].join('\n')

/**
 * Two plain textareas, and the reason the library does not wrap one.
 *
 * Nothing here touches litearea. The left field is given `defaultValue` once, so
 * the browser keeps its own edit history. The right one is given `value` on every
 * keystroke, which replaces the element's content — discarding that history and
 * resetting the caret to the end.
 * @returns the section.
 */
function Comparison(): React.ReactElement {
  const [value, setValue] = React.useState(COMPARISON_TEXT)
  return (
    <section className="demo-compare">
      <h2>Why not a controlled textarea</h2>
      <p>
        Type a few characters into each box below and press <kbd>Ctrl</kbd>+<kbd>Z</kbd>. The
        uncontrolled field keeps its history, because React wrote its content once and then left it
        alone. The controlled field has none to keep: every keystroke re-renders it, and setting a
        textarea&rsquo;s <code>value</code> from script replaces its content — the same operation
        that empties the browser&rsquo;s undo stack and puts the caret back at the end.
      </p>
      <div className="demo-compareGrid">
        <div>
          <h3>uncontrolled — defaultValue only</h3>
          <textarea defaultValue={COMPARISON_TEXT} rows={6} aria-label="uncontrolled textarea" />
          <p className="demo-note">React never touches it again. Undo works.</p>
        </div>
        <div>
          <h3>controlled — value + setState</h3>
          <textarea
            value={value}
            rows={6}
            aria-label="controlled textarea"
            onChange={(event) => setValue(event.target.value)}
          />
          <p className="demo-note">
            React rewrites the node on every keystroke. Undo is gone, and the caret jumps to the end
            whenever a write races the browser.
          </p>
        </div>
      </div>
      <p>
        That is exactly why <code>LiteAreaEditor</code> has no <code>value</code>/
        <code>onChange</code> loop to fall into. It renders an empty <code>div</code>, hands the
        element to the editor, and reads <code>onChange</code> as a report rather than as a request.
        The editor does still have a <code>value</code> prop for a host that must replace the
        document — the Reset buttons above use <code>setValue(text, true)</code>, which writes
        through the browser&rsquo;s editing pipeline so the replacement is itself one undoable edit
        instead of a stack-clearing assignment.
      </p>
    </section>
  )
}
