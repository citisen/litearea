// ─── React binding ──────────────────────────────────────────────────────────
//
// This is a thin wrapper, and what makes it thin is a decision a reader should
// understand before changing it: **the component never passes the text through
// React.**
//
// The obvious React wrapper takes `value` and `onChange` and re-renders the
// textarea on every keystroke. That wrapper cannot work. Setting a textarea's value
// from script replaces its content, which discards the browser's undo stack and
// resets the caret to the end — so the two most common complaints about the editors
// this library replaces ("undo is gone", "the caret jumps") are not two bugs but
// one, and it is caused by exactly that pattern. The text belongs to the DOM node;
// React's job here is to create the node once and then leave it alone.
//
// So this component renders an empty div, mounts the imperative editor inside it,
// and keeps a ref to the latest props so the editor's callbacks are never stale. The
// grammar is handed over through a live proxy, which lets a host rebuild its grammar
// on every render without forcing the editor to be rebuilt: the editor re-resolves
// the rules on `refresh()`, and the undo history survives a language change.

import * as React from 'react'
import type { Completion, Diagnostic, Grammar, HoverInfo } from '../core/types.js'
import type { ResolvedGrammar } from '../core/scan.js'
import { LiteArea, type LiteAreaCompletion, type LiteAreaHover, type LiteAreaSizing } from '../dom/editor.js'
import type { TextSelection } from '../dom/editing.js'

/** Everything the React component accepts. */
export interface LiteAreaEditorProps<State = unknown> {
  /**
   * The language.
   *
   * It does NOT have to be stable: the component hands the engine a live view of
   * whatever was passed last, so rebuilding the object on every render is safe and
   * the editor is not rebuilt.
   */
  grammar: Grammar<State> | ResolvedGrammar<State>
  /**
   * The text to start with. Read ONCE, when the editor mounts.
   *
   * This is the prop to use. A changing initial value is what `value` is for, and it
   * cannot be done by re-rendering, because that is the thing that breaks undo.
   */
  defaultValue?: string
  /**
   * Text the host wants shown.
   *
   * When this differs from the field it is written — through the browser's editing
   * pipeline, so it stays undoable. Leaving it undefined is the normal case: the
   * field owns the text.
   */
  value?: string
  /** Whether a `value` write should be one undoable edit. Default `false`. */
  preserveHistory?: boolean
  /** Whether the user may edit. */
  readOnly?: boolean
  /** Shown while the box is empty. */
  placeholder?: string
  /** Whether the browser may spell-check. Default `false`. */
  spellCheck?: boolean
  /** The accessible name. */
  ariaLabel?: string
  /** A class on the wrapper element. */
  className?: string
  /** Styles for the wrapper element. */
  style?: React.CSSProperties
  /**
   * CSS custom properties for this instance — a theme, a font, or both.
   *
   * Unlike the options read at mount, this one is applied live, and an inline object literal is
   * fine: the records are compared by value, so a fresh `{ font: '…' }` on every render does not
   * mean work on every render.
   */
  variables?: Record<string, string>
  /** How the box follows its content. Read when the editor mounts. */
  sizing?: LiteAreaSizing
  /** How the list behaves, or `false` to switch completions off. Read when the editor mounts. */
  completion?: LiteAreaCompletion | false
  /** How tooltips behave, or `false` to switch them off. Read when the editor mounts. */
  hover?: LiteAreaHover | false
  /** Whether semantic decorations are painted. Read when the editor mounts. */
  decorations?: boolean
  /** Whether to inject the stylesheet. Read when the editor mounts. */
  injectStyles?: boolean
  /** A CSP nonce for the injected stylesheet. */
  styleNonce?: string
  /** Called after a user edit, with the new text. */
  onChange?: (value: string) => void
  /** Called when the caret or selection moves. */
  onSelectionChange?: (selection: TextSelection) => void
  /** Called when the problem list changes. */
  onDiagnostics?: (diagnostics: readonly Diagnostic[]) => void
  /** Called when the list opens, filters, or closes. */
  onCompletion?: (completion: Completion | undefined) => void
  /** Called when a tooltip appears or goes away. */
  onHover?: (info: HoverInfo | undefined) => void
  /**
   * Handed the editor once it exists, and `undefined` when it goes away.
   *
   * The escape hatch for anything the props do not cover: undo and redo, focusing
   * the field, or reading the diagnostics directly.
   */
  editorRef?: (editor: LiteArea<State> | undefined) => void
}

/** The props as the editor wants them, without the React-only ones. */
interface EditorCoreProps {
  placeholder?: string
  spellCheck?: boolean
  ariaLabel?: string
  sizing?: LiteAreaSizing
  completion?: LiteAreaCompletion | false
  hover?: LiteAreaHover | false
  decorations?: boolean
  injectStyles?: boolean
  styleNonce?: string
}

/**
 * A view of an object that always reads the newest value.
 *
 * Its purpose is narrower than a general proxy: the engine takes the grammar object
 * once and reads its rules from it, so a host that writes `grammar={{...}}` inline
 * would hand over a fresh object on every render. Passing a live view instead means
 * the object's identity never changes, so nothing is rebuilt, while `refresh()` still
 * sees the newest rules.
 * @param holder - the box holding the current value.
 * @returns the live view.
 */
function liveGrammar<State>(holder: { current: Grammar<State> | ResolvedGrammar<State> }): Grammar<State> | ResolvedGrammar<State> {
  return new Proxy({} as Grammar<State>, {
    get: (_target, key) => Reflect.get(holder.current as object, key),
    has: (_target, key) => Reflect.has(holder.current as object, key),
    ownKeys: () => Reflect.ownKeys(holder.current as object),
    getOwnPropertyDescriptor: (_target, key) =>
      Reflect.getOwnPropertyDescriptor(holder.current as object, key),
  }) as Grammar<State>
}

/**
 * Whether two variable records say the same thing.
 * @param left - one record, or undefined.
 * @param right - the other.
 * @returns whether every key and value matches.
 */
function sameVariables(
  left: Record<string, string> | undefined,
  right: Record<string, string> | undefined,
): boolean {
  if (left === right) return true
  const a = Object.entries(left ?? {})
  const b = Object.entries(right ?? {})
  if (a.length !== b.length) return false
  return a.every(([key, value]) => (right ?? {})[key] === value)
}

/**
 * A code editor, as a React component.
 *
 * See the module comment for why this does not take the text through React state.
 * @param props - the grammar and the behaviour.
 * @returns the wrapper element the editor mounts into.
 */
export function LiteAreaEditor<State = unknown>(
  props: LiteAreaEditorProps<State>,
): React.ReactElement {
  const hostRef = React.useRef<HTMLDivElement | null>(null)
  const editorRef = React.useRef<LiteArea<State> | undefined>(undefined)
  /** The newest props, so the editor's callbacks are never a render behind. */
  const latest = React.useRef(props)
  latest.current = props
  /** The grammar box every live view reads through. */
  const grammarBox = React.useRef(props.grammar)
  grammarBox.current = props.grammar
  const live = React.useMemo(() => liveGrammar<State>(grammarBox), [])
  /** The variable record last applied, so an unchanged one is not applied again. */
  const variablesRef = React.useRef<Record<string, string> | undefined>(undefined)

  React.useLayoutEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const core: EditorCoreProps = latest.current
    const editor = new LiteArea<State>({
      grammar: live,
      value: latest.current.defaultValue ?? latest.current.value ?? '',
      readOnly: latest.current.readOnly === true,
      ...core,
      // Every callback reads through `latest`, so a host that passes a new closure
      // on each render does not need the editor to know about it.
      onChange: (value) => {
        latest.current.onChange?.(value)
      },
      onSelectionChange: (selection) => {
        latest.current.onSelectionChange?.(selection)
      },
      onDiagnostics: (diagnostics) => {
        latest.current.onDiagnostics?.(diagnostics)
      },
      onCompletion: (completion) => {
        latest.current.onCompletion?.(completion)
      },
      onHover: (info) => {
        latest.current.onHover?.(info)
      },
    })
    host.appendChild(editor.element)
    editorRef.current = editor
    latest.current.editorRef?.(editor)
    return () => {
      editor.destroy()
      editorRef.current = undefined
      latest.current.editorRef?.(undefined)
    }
    // Mounted once, on purpose. Re-creating the editor would discard the DOM node the
    // browser's undo history belongs to, which is the one thing this library promises
    // not to do.
  }, [live])

  React.useLayoutEffect(() => {
    const editor = editorRef.current
    if (editor === undefined) return
    // The variable records are compared by VALUE, because a host writing
    // `variables={{ font: '…' }}` inline produces a fresh object on every render, and a
    // reference check would re-measure the box on every render for nothing.
    if (!sameVariables(props.variables, variablesRef.current)) {
      variablesRef.current = props.variables
      editor.setVariables(props.variables ?? {})
    }
    // The grammar may have been rebuilt this render, and the editor resolved its
    // rules when it last looked. Re-resolving is cheap and is what keeps a live
    // grammar honest.
    editor.refresh()
    // A `value` the field does not already have is a host asking for a write. Writing
    // it through the pipeline keeps it undoable; assigning it would not.
    if (props.value !== undefined && editor.value !== props.value) {
      editor.setValue(props.value, props.preserveHistory === true)
    }
    if (editor.input.readOnly !== (props.readOnly === true)) {
      editor.input.readOnly = props.readOnly === true
      editor.element.classList.toggle('litearea-readonly', props.readOnly === true)
    }
  })

  return React.createElement('div', {
    ref: hostRef,
    className: props.className,
    style: props.style,
  })
}
