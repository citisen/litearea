// ─── segments: one pass over the document, for the painter ──────────────────
//
// The painted layer has to cover every character exactly once, in order, and it
// has to do it while three independent things want to say something about those
// characters: the scope that colours them, the decoration that marks them, and the
// diagnostic that underlines them.
//
// The naive way is three layers, and it does not work. Each would have to position
// its spans itself, so each would need its own idea of where a range starts, and a
// span positioned by measuring is a span that drifts as soon as the font, the
// wrapping, or the padding is even slightly different from what was measured.
//
// So they are merged into ONE stream of adjacent segments, and the renderer emits
// them back to back with no positioning at all: the characters lay out where the
// characters lay out, and the colours follow. Alignment stops being something the
// code maintains and becomes something the layout cannot get wrong.
//
// This is pure — text and ranges in, segments out — which is why the trickiest
// part of the painter is testable without a browser.

import type { Decoration, Diagnostic, Severity, Token } from './types.js'

/** One run of characters that all share the same presentation. */
export interface PaintSegment {
  from: number
  to: number
  /** The characters themselves, so the painter never re-slices. */
  text: string
  /** The scope that colours them. */
  scope: string
  /** The decoration kinds that mark them, in declaration order. */
  decorations: string[]
  /** The loudest diagnostic covering them, when one does. */
  severity: Severity | undefined
  /** A hover title donated by a decoration, when it has one. */
  title: string | undefined
}

/** What a segment builder needs: the three range lists and nothing else. */
export interface SegmentInput {
  tokens: readonly Token[]
  decorations: readonly Decoration[]
  diagnostics: readonly Diagnostic[]
}

/**
 * The order severities outrank each other.
 *
 * One segment shows one squiggle, because two underlines on the same characters
 * only make a messier line rather than a more informative one. The loudest wins,
 * which is also the one a reader needs to see first.
 */
const SEVERITY_RANK: Record<Severity, number> = { error: 4, warning: 3, info: 2, hint: 1 }

/**
 * Merge a scope, a decoration, and a diagnostic into adjacent segments.
 *
 * @param text - the document the ranges refer to.
 * @param input - the three range lists.
 * @param fallbackScope - the scope for characters no token covers.
 * @returns the segments, in order, covering the whole document.
 */
export function buildSegments(
  text: string,
  input: SegmentInput,
  fallbackScope = 'text',
): PaintSegment[] {
  const length = text.length
  if (length === 0) return []

  // ── the cut points ────────────────────────────────────────────────────────
  // Every range boundary is a potential change of presentation, so they are the
  // only places a segment can begin or end.
  const cuts = new Set<number>([0, length])
  for (const token of input.tokens) {
    cuts.add(Math.max(0, Math.min(token.from, length)))
    cuts.add(Math.max(0, Math.min(token.to, length)))
  }
  for (const decoration of input.decorations) {
    cuts.add(Math.max(0, Math.min(decoration.from, length)))
    cuts.add(Math.max(0, Math.min(decoration.to, length)))
  }
  for (const diagnostic of input.diagnostics) {
    cuts.add(Math.max(0, Math.min(diagnostic.from, length)))
    cuts.add(Math.max(0, Math.min(diagnostic.to, length)))
  }
  const bounds = [...cuts].sort((left, right) => left - right)

  const segments: PaintSegment[] = []
  for (let index = 0; index < bounds.length - 1; index += 1) {
    const from = bounds[index] ?? 0
    const to = bounds[index + 1] ?? 0
    if (to <= from) continue

    const scope = coverScope(input.tokens, from, fallbackScope)
    const decorations = coverDecorations(input.decorations, from, to)
    const severity = coverSeverity(input.diagnostics, from, to)
    const title = input.decorations.find(
      (decoration) => decoration.title !== undefined && from >= decoration.from && to <= decoration.to,
    )?.title

    const last = segments[segments.length - 1]
    if (
      last !== undefined &&
      last.scope === scope &&
      last.severity === severity &&
      last.title === title &&
      sameList(last.decorations, decorations)
    ) {
      // Extending the previous segment keeps the DOM small without changing what
      // is drawn, which is the only reason the merge exists.
      last.to = to
      last.text = text.slice(last.from, to)
      continue
    }
    segments.push({ from, to, text: text.slice(from, to), scope, decorations, severity, title })
  }
  return segments
}

/** The scope of the token covering a position, or the fallback. */
function coverScope(tokens: readonly Token[], offset: number, fallback: string): string {
  for (const token of tokens) {
    if (token.from > offset) break
    if (offset >= token.from && offset < token.to) return token.scope
  }
  return fallback
}

/** The decoration kinds covering a range, in the order they were declared. */
function coverDecorations(decorations: readonly Decoration[], from: number, to: number): string[] {
  const kinds: string[] = []
  for (const decoration of decorations) {
    if (decoration.from <= from && to <= decoration.to) kinds.push(decoration.kind)
  }
  return kinds
}

/** The loudest diagnostic severity covering a range. */
function coverSeverity(
  diagnostics: readonly Diagnostic[],
  from: number,
  to: number,
): Severity | undefined {
  let loudest: Severity | undefined
  for (const diagnostic of diagnostics) {
    if (diagnostic.from > from || diagnostic.to < to) continue
    if (loudest === undefined || SEVERITY_RANK[diagnostic.severity] > SEVERITY_RANK[loudest]) {
      loudest = diagnostic.severity
    }
  }
  return loudest
}

/** Whether two short lists say the same thing, in the same order. */
function sameList(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

/**
 * The class attribute for a segment.
 *
 * Order matters for a stylesheet author's sanity rather than for the cascade: the
 * scope comes first so a rule can target `scope + mark` if it ever needs to.
 * @param segment - the segment.
 * @param scopeClass - how a scope becomes a class.
 * @param decorationClass - how a decoration kind becomes a class.
 * @param severityClass - how a severity becomes a class.
 * @returns the class list.
 */
export function segmentClasses(
  segment: PaintSegment,
  scopeClass: (scope: string) => string,
  decorationClass: (kind: string) => string,
  severityClass: (severity: string) => string,
): string[] {
  const classes = [scopeClass(segment.scope)]
  for (const kind of segment.decorations) classes.push(decorationClass(kind))
  if (segment.severity !== undefined) classes.push(severityClass(segment.severity))
  return classes
}
