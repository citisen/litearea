// ─── styles: the one stylesheet ─────────────────────────────────────────────
//
// The CSS lives in a TypeScript string so it can be injected with no build step
// and no CSS loader, which is what keeps the library usable from a plain script
// tag. `scripts/build-css.mjs` also writes it out as `dist/styles.css` for the
// hosts that would rather link it, from this same string, so the two can never
// disagree.
//
// The alignment contract
// ----------------------
// The painted layer sits behind the real textarea and draws the same characters, so it may
// change only what does not move a glyph: colour, background, and text-decoration. Anything
// that changes an advance — a different font, a weight, letter-spacing, a font-feature —
// slides the paint off the character it belongs to, and by a different amount on every
// character, so it reads as a rendering glitch rather than as a styling mistake.
//
// The two elements therefore share ONE rule for their typography, and that rule is the only
// thing that has to hold. THE FONT ITSELF IS THE HOST'S CHOICE: a proportional face aligns just
// as well as a monospace one, because the layer, the field, and the measuring mirror all read
// the same computed font. `--litearea-font` is a variable like any other.
//
// What is NOT the host's choice is ligatures and kerning, which are forced off, and the reason
// is subtler than "a ligature would look wrong". A ligature draws one glyph where the field
// holds two characters — and the layer splits its spans wherever a diagnostic or a decoration
// begins, which cuts a ligature in half. The field would then render one glyph and the layer
// two, at different widths, and the rest of the line would slide. Turning them off removes the
// possibility rather than relying on no span boundary ever landing inside a pair.

/**
 * One colour per scope, in one list, because the variables and the rules that use them MUST
 * agree and once did not.
 *
 * Twenty-nine scope variables were declared here with no rule anywhere that consumed them. The
 * tokenizer painted the right classes, the variables were documented, the stylesheet looked
 * complete — and every scope rendered in the inherited text colour, so the editor had no syntax
 * colouring at all. Nothing in the DOM revealed it: the spans were correct. Generating both
 * halves from this list is the fix, and it is the kind of drift a browser check cannot catch
 * either, since a colourless token is a perfectly ordinary thing to find.
 *
 * A key is the FOLDED scope name, which is what a scope becomes as a class: `value.shape` is
 * written `value-shape` here because `scopeClass` turns its dots into hyphens.
 */
const SCOPE_PALETTE: ReadonlyArray<{ scope: string; light: string; dark?: string }> = [
  { scope: 'text', light: 'var(--litearea-fg)' },
  { scope: 'word', light: 'var(--litearea-fg)' },
  { scope: 'family', light: 'var(--litearea-fg)' },
  { scope: 'family-generic', light: '#7c3aed', dark: '#c4a2ff' },
  { scope: 'family-unknown', light: 'var(--litearea-warning)' },
  { scope: 'family-unclosed', light: 'var(--litearea-error)' },
  { scope: 'weight', light: 'var(--litearea-accent)' },
  { scope: 'weight-missing', light: 'var(--litearea-warning)' },
  { scope: 'state', light: 'var(--litearea-accent)' },
  { scope: 'property', light: '#7c3aed', dark: '#c4a2ff' },
  { scope: 'operator', light: 'var(--litearea-fg-dim)' },
  { scope: 'separator', light: 'var(--litearea-fg-dim)' },
  { scope: 'value-shape', light: '#0f766e', dark: '#5eead4' },
  { scope: 'value-color', light: '#0f766e', dark: '#5eead4' },
  { scope: 'value-pattern', light: '#0f766e', dark: '#5eead4' },
  { scope: 'value-motion', light: '#0f766e', dark: '#5eead4' },
  { scope: 'value-number', light: '#b45309', dark: '#fbbf24' },
  { scope: 'comment', light: 'var(--litearea-fg-dim)' },
  { scope: 'invalid', light: 'var(--litearea-error)' },
  { scope: 'keyword', light: 'var(--litearea-accent)' },
  { scope: 'string', light: '#0f766e', dark: '#5eead4' },
  { scope: 'number', light: '#b45309', dark: '#fbbf24' },
]

/**
 * The variable declarations for one colour scheme.
 * @param scheme - `light` declares every scope; `dark` declares only those that differ.
 * @returns one CSS declaration per line.
 */
function scopeVariables(scheme: 'light' | 'dark'): string {
  return SCOPE_PALETTE.filter((entry) => scheme === 'light' || entry.dark !== undefined)
    .map((entry) => {
      const value = scheme === 'light' ? entry.light : entry.dark
      return `  --litearea-scope-${entry.scope}: ${String(value)};`
    })
    .join('\n')
}

/**
 * The rules that spend those variables.
 * @returns one CSS rule per line.
 */
function scopeRules(): string {
  return SCOPE_PALETTE.map(
    (entry) =>
      `.litearea-scope-${entry.scope} { color: var(--litearea-scope-${entry.scope}); }`,
  ).join('\n')
}

/** Everything a scope or a mark is painted with comes from one of these. */
export const LITEAREA_STYLES = `
.litearea {
  --litearea-font: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  --litearea-font-size: 13px;
  --litearea-line-height: 20px;
  --litearea-padding-block: 6px;
  --litearea-padding-inline: 10px;
  --litearea-radius: 8px;
  --litearea-fg: #1f2328;
  --litearea-fg-dim: #6b7280;
  --litearea-fg-strong: #111827;
  --litearea-bg: #ffffff;
  --litearea-bg-raised: #ffffff;
  --litearea-border: #d8dbe0;
  --litearea-border-focus: #4d6bfe;
  --litearea-accent: #4d6bfe;
  --litearea-accent-soft: rgba(77, 107, 254, 0.12);
  --litearea-selection: rgba(77, 107, 254, 0.22);
  --litearea-error: #e5484d;
  --litearea-warning: #d97706;
  --litearea-info: #4d6bfe;
  --litearea-hint: #8b8f97;
  --litearea-shadow: 0 6px 24px rgba(15, 23, 42, 0.14);

${scopeVariables('light')}

  position: relative;
  display: block;
  color: var(--litearea-fg);
}

@media (prefers-color-scheme: dark) {
  .litearea {
    --litearea-fg: #e6e8eb;
    --litearea-fg-dim: #8b919b;
    --litearea-fg-strong: #ffffff;
    --litearea-bg: #1b1e24;
    --litearea-bg-raised: #23262c;
    --litearea-border: #363b44;
${scopeVariables('dark')}
    --litearea-error: #ff6b6b;
    --litearea-warning: #f59e0b;
    --litearea-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
  }
}

/* ── the box ─────────────────────────────────────────────────────────────── */

.litearea-box {
  position: relative;
  display: block;
  border: 1px solid var(--litearea-border);
  border-radius: var(--litearea-radius);
  background: var(--litearea-bg);
  transition: border-color 120ms ease;
}

.litearea-box:focus-within {
  border-color: var(--litearea-border-focus);
}

.litearea-invalid .litearea-box {
  border-color: var(--litearea-error);
}

/*
 * The layer and the field share this rule and nothing may be added to one alone.
 * Every property here is a property the mirror copies too — three elements, one
 * typography, or the paint drifts.
 */
.litearea-layer,
.litearea-input {
  box-sizing: border-box;
  width: 100%;
  margin: 0;
  padding: var(--litearea-padding-block) var(--litearea-padding-inline);
  border: none;
  font-family: var(--litearea-font);
  font-size: var(--litearea-font-size);
  font-weight: 400;
  font-style: normal;
  font-stretch: normal;
  font-variant-ligatures: none;
  font-kerning: none;
  font-feature-settings: "liga" 0, "calt" 0, "dlig" 0;
  line-height: var(--litearea-line-height);
  letter-spacing: normal;
  word-spacing: normal;
  text-transform: none;
  text-indent: 0;
  text-align: left;
  direction: ltr;
  tab-size: 2;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  word-break: break-word;
}

.litearea-layer {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  user-select: none;
}

/*
 * When the box is clamped to its maximum height the field grows a scrollbar, and a
 * scrollbar narrows the text. If the layer kept the full width it would wrap
 * differently from the field and every colour would slide off its character, so the
 * field's measured scrollbar width is published as --litearea-scrollbar and added
 * here. The value is 0 whenever no scrollbar is shown.
 */
.litearea-layer {
  padding-right: calc(var(--litearea-padding-inline) + var(--litearea-scrollbar, 0px));
}

.litearea-paint {
  position: relative;
  min-height: 100%;
  /*
   * min-height keeps the paint as tall as the BOX, which is what stops the box from
   * jumping when the document is shorter than its minimum. It does not cover a document
   * whose last line is empty, and it cannot: a trailing newline lays out a line in the
   * field and not in a pre-wrap div, so the paint earns that line with a trailing br
   * element instead — see Overlay.render. Without it the field scrolls one line further
   * than the text, which is the one failure that looks like the caret detaching from its
   * line.
   */
  will-change: transform;
}

/*
 * ── the pinned header rows ──────────────────────────────────────────────────
 *
 * The strip sits between the layer and the field, so it is painted over the ordinary
 * text and under the caret and the selection. Disabling pointer events is therefore
 * not needed to protect the editor's own gestures — it is here so that the empty part
 * of the strip, which spans the full width, cannot intercept a drag that began on the
 * text below it.
 */
.litearea-sticky {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  user-select: none;
}

/*
 * One row per pinned header. The typography is repeated from the layer rather than
 * inherited, because the strip's parent is the box and the box carries no type: the
 * layer and the field are the two elements that do, and a row must match them or its
 * characters would sit at different columns from the line it copies.
 */
.litearea-stickyRow {
  position: absolute;
  left: var(--litearea-padding-inline);
  right: calc(var(--litearea-padding-inline) + var(--litearea-scrollbar, 0px));
  overflow: hidden;
  white-space: pre;
  font-family: var(--litearea-font);
  font-size: var(--litearea-font-size);
  font-weight: 400;
  font-variant-ligatures: none;
  font-kerning: none;
  font-feature-settings: "liga" 0, "calt" 0, "dlig" 0;
  letter-spacing: normal;
  word-spacing: normal;
  tab-size: 2;
  /* Opaque, because the rows replace the text they cover rather than sitting beside
     it; a transparent row would let the scrolled line show through the pinned one. */
  background: var(--litearea-bg);
  box-shadow: 0 4px 8px color-mix(in oklab, var(--litearea-fg) 12%, transparent);
}

.litearea-input {
  position: relative;
  display: block;
  resize: none;
  background: transparent;
  color: transparent;
  caret-color: var(--litearea-fg);
  outline: none;
  overflow-y: hidden;
}

/*
 * ── the inline completion preview ───────────────────────────────────────────
 *
 * One chip, placed where the next character would land. It is opaque because it stands
 * where characters that really exist would stand: a transparent preview would put two
 * texts at the same place in the same font, one legible and one not. It has no padding
 * and no border for the same reason — its first glyph has to be exactly where the
 * caret is, or the preview would lie about the word it is growing into.
 */
.litearea-ghost {
  position: absolute;
  display: none;
  overflow: hidden;
  white-space: pre;
  pointer-events: none;
  user-select: none;
  color: var(--litearea-fg-dim);
  background: var(--litearea-bg-raised);
  border-radius: 2px;
  font-family: var(--litearea-font);
  font-size: var(--litearea-font-size);
  font-weight: 400;
  font-variant-ligatures: none;
  font-kerning: none;
  font-feature-settings: "liga" 0, "calt" 0, "dlig" 0;
  letter-spacing: normal;
  word-spacing: normal;
  tab-size: 2;
}

.litearea-ghost[data-open="true"] {
  display: block;
}

.litearea-growable .litearea-input {
  resize: none;
}

.litearea-resizable .litearea-input {
  resize: vertical;
}

.litearea-input::placeholder {
  color: var(--litearea-fg-dim);
}

.litearea-input::selection {
  background: var(--litearea-selection);
}

.litearea-readonly .litearea-input {
  caret-color: transparent;
}

/*
 * The rules that spend the variables, generated from the same list that declares them. There is
 * deliberately NO catch-all rule setting a property on every painted span: there was one, and a
 * class plus an element outranks a bare class on specificity, so it silently switched off every
 * squiggle in the library.
 *
 * A scope that is not in the list gets no colour from here, and a host writing a grammar of its
 * own styles it with a plain rule — .litearea-scope-my-thing { color: … } — since nothing in
 * this file competes for that selector.
 */
${scopeRules()}

.litearea-dec-effective {
  border-radius: 3px;
  background: var(--litearea-accent-soft);
  box-shadow: 0 0 0 1px var(--litearea-accent-soft);
}

/* The four shapes a diagnostic can take. Wavy for the two that mean "fix this", dotted for
   the two that mean "worth knowing" — the same distinction VSCode draws, and the reason
   severity is a class rather than an inline colour. */
.litearea-diag-error {
  text-decoration-line: underline;
  text-decoration-style: wavy;
  text-decoration-color: var(--litearea-error);
  text-decoration-skip-ink: none;
  text-underline-offset: 3px;
}

.litearea-diag-warning {
  text-decoration-line: underline;
  text-decoration-style: wavy;
  text-decoration-color: var(--litearea-warning);
  text-decoration-skip-ink: none;
  text-underline-offset: 3px;
}

.litearea-diag-info {
  text-decoration-line: underline;
  text-decoration-style: dotted;
  text-decoration-color: var(--litearea-info);
  text-decoration-skip-ink: none;
  text-underline-offset: 3px;
}

.litearea-diag-hint {
  text-decoration-line: underline;
  text-decoration-style: dotted;
  text-decoration-color: var(--litearea-hint);
  text-decoration-skip-ink: none;
  text-underline-offset: 3px;
}

/* ── the completion list ─────────────────────────────────────────────────── */

/*
 * The container holds two things and scrolls NEITHER of them: the list scrolls itself, and the
 * documentation is pinned below it. Putting the documentation inside the scroll range — which is
 * what this used to do — makes it unreachable with a long list and a long explanation: the
 * arrows move the active row rather than the scrollbar, so a keyboard user never sees it, and a
 * mouse user has to scroll down to read it and back up to reach the next row.
 */
.litearea-popup {
  position: absolute;
  z-index: 30;
  display: none;
  flex-direction: column;
  max-width: 460px;
  padding: 4px;
  border: 1px solid var(--litearea-border);
  border-radius: 10px;
  background: var(--litearea-bg-raised);
  box-shadow: var(--litearea-shadow);
  font-family: var(--litearea-font);
  font-size: 12px;
  line-height: 18px;
  color: var(--litearea-fg);
  overflow: hidden;
}

.litearea-popup[data-open="true"] {
  display: flex;
}

/* The rows, and the only part that scrolls. Its height is bounded so the documentation below
   always has somewhere to live. */
.litearea-list {
  min-height: 0;
  max-height: 208px;
  overflow-y: auto;
}

/*
 * The explanation, pinned. Its own height is bounded and it scrolls ITSELF, so a long
 * explanation stays readable while the rows stay put — and arrowing to the next row swaps the
 * text in place instead of requiring a scroll back up.
 */
.litearea-docs {
  flex: none;
  max-height: 132px;
  overflow-y: auto;
  margin: 4px -4px -4px;
  padding: 6px 10px;
  border-top: 1px solid var(--litearea-border);
  background: var(--litearea-bg);
  border-radius: 0 0 10px 10px;
  color: var(--litearea-fg);
  white-space: pre-wrap;
}

.litearea-popup[data-docs="false"] .litearea-docs {
  display: none;
}

.litearea-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 3px 6px;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
}

.litearea-row[aria-selected="true"] {
  background: var(--litearea-accent-soft);
}

.litearea-rowKind {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 2px;
  background: var(--litearea-fg-dim);
  transform: translateY(-1px);
}

.litearea-kind-family { background: var(--litearea-scope-family-generic); }
.litearea-kind-generic { background: var(--litearea-scope-family-generic); }
.litearea-kind-weight { background: var(--litearea-scope-weight); }
.litearea-kind-state { background: var(--litearea-scope-state); }
.litearea-kind-property { background: var(--litearea-scope-property); }
.litearea-kind-value { background: var(--litearea-scope-value-shape); }
.litearea-kind-number { background: var(--litearea-scope-value-number); }
.litearea-kind-custom { background: var(--litearea-fg-dim); }

.litearea-rowLabel {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.litearea-rowMatch {
  color: var(--litearea-accent);
  font-weight: 600;
}

.litearea-rowDetail {
  flex: none;
  color: var(--litearea-fg-dim);
  font-size: 11px;
}

.litearea-docsTitle {
  font-weight: 600;
}

.litearea-docsDetail {
  color: var(--litearea-fg-dim);
}

.litearea-docsBody {
  margin-top: 2px;
  color: var(--litearea-fg-dim);
}

/* ── the hover tooltip ───────────────────────────────────────────────────── */

.litearea-tooltip {
  position: absolute;
  z-index: 40;
  display: none;
  max-width: 340px;
  padding: 6px 10px;
  border: 1px solid var(--litearea-border);
  border-radius: 8px;
  background: var(--litearea-bg-raised);
  box-shadow: var(--litearea-shadow);
  font-family: var(--litearea-font);
  font-size: 11px;
  line-height: 16px;
  color: var(--litearea-fg);
  pointer-events: none;
  white-space: pre-wrap;
}

.litearea-tooltip[data-open="true"] {
  display: block;
}

.litearea-tooltipTitle {
  font-weight: 600;
}

.litearea-tooltipDetail {
  color: var(--litearea-fg-dim);
}

.litearea-tooltipBody {
  margin-top: 3px;
  color: var(--litearea-fg-dim);
}

.litearea-srOnly {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
`.trim()

/**
 * Put the stylesheet in a document, once.
 *
 * Marked with a data attribute so two editors on one page, or two copies of the
 * library, do not stack two identical sheets — and so a host can find and replace
 * it.
 * @param ownerDocument - the document to install into.
 * @param nonce - an optional CSP nonce for the style element.
 * @returns the style element, or undefined when there is no document.
 */
export function injectStyles(
  ownerDocument: Document,
  nonce?: string,
): HTMLStyleElement | undefined {
  if (ownerDocument === null || ownerDocument === undefined) return undefined
  const existing = ownerDocument.querySelector<HTMLStyleElement>('style[data-litearea-styles]')
  if (existing !== null) return existing
  const style = ownerDocument.createElement('style')
  style.dataset.liteareaStyles = ''
  if (nonce !== undefined) style.nonce = nonce
  style.textContent = LITEAREA_STYLES
  const head = ownerDocument.head ?? ownerDocument.documentElement
  if (head === null || head === undefined) return undefined
  head.appendChild(style)
  return style
}

/**
 * The class a scope is painted with.
 *
 * Dots and other punctuation are folded to hyphens, because a scope like
 * `value.shape` is a nice name to write and a terrible one to select: the CSS
 * would need a backslash before the dot at every use, and one forgotten escape
 * silently paints nothing.
 * @param scope - the scope name.
 * @returns the class name.
 */
export function scopeClass(scope: string): string {
  const folded = scope.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return folded === '' ? 'litearea-scope-text' : `litearea-scope-${folded}`
}

/** The class a decoration kind is painted with. */
export function decorationClass(kind: string): string {
  return `litearea-dec-${kind.replace(/[^A-Za-z0-9_-]+/g, '-')}`
}

/** The class a diagnostic severity is underlined with. */
export function severityClass(severity: string): string {
  return `litearea-diag-${severity.replace(/[^A-Za-z0-9_-]+/g, '-')}`
}
