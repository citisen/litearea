// ─── the DOM layer's public surface ────────────────────────────────────────
//
// The engine is available without any of this, and this is available without any
// framework. Everything here needs a document.

export {
  LiteArea,
  type EditorDecoration,
  type EditorRange,
  type EditorSeverity,
  type LiteAreaCompletion,
  type LiteAreaHover,
  type LiteAreaOptions,
  type LiteAreaSizing,
  type LiteAreaSticky,
} from './editor.js'

export { createEditor } from './create.js'

export {
  dispatchInput,
  fieldLineHeight,
  readSelection,
  redoField,
  replaceThroughPipeline,
  undoField,
  writeDocument,
  writeSelection,
  type EditOutcome,
  type TextSelection,
} from './editing.js'

export { TextMirror, type CaretBox } from './mirror.js'

export { Ghost, type GhostAnchor } from './ghost.js'

export { Overlay, type OverlayClassNames } from './overlay.js'

export { Popup, type AnchorBox, type PopupHandlers } from './popup.js'

export { StickyHeaders, type StickyRenderInput } from './sticky.js'

export { Tooltip, type TooltipAnchor } from './tooltip.js'

export {
  canEditThroughPipeline,
  hasCaretHitTest,
  hasDocument,
  offsetFromPoint,
  withDefaults,
} from './support.js'
