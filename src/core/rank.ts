// ─── rank: how a completion list is ordered and filtered ────────────────────
//
// Two jobs that are easy to conflate and must not be. "Which rows does this
// needle match?" is a filter, and a row either matches or does not. "In what
// order?" is a ranking, and it is where the feel of a completer actually lives:
// typing `inter` should put `Inter` above `Inter Tight` above `Plex Inter`, and
// nothing about the matching itself decides that.
//
// The ranking is expressed as a TIER plus a local score rather than as one
// arithmetic blend. A single blend is the classic mistake — add enough bonuses
// and a longer subsequence eventually outscores an exact match, so the obvious
// answer sinks below a coincidence — and it is also untestable, because no one
// can say what the number 47.3 means. Tiers make the precedence a list you can
// read and a set of cases you can assert:
//
//   exact, case-sensitive   `Inter` → `Inter`
//   exact, any case         `inter` → `Inter`
//   prefix                  `inte`  → `Inter`
//   word-boundary           `fm`    → `Fira Mono`, `IPM` → `IBM Plex Mono`
//   substring               `lex`   → `Plex Inter`
//   subsequence             `jbmo`  → `JetBrains Mono`
//
// Nothing here knows anything about any language. A needle and a label go in, a
// score and the matched offsets come out, which is why this module has no import
// of the grammar contract at all.

/** The most of a score a local bonus may contribute, so a tier always dominates. */
const TIER_STRIDE = 1_000_000

/**
 * The precedence tiers, highest first. The numbers are grades, not weights: a
 * tier only has to be larger than the one below it.
 */
const TIER = {
  /** The needle is the label, in the same case. */
  exact: 5,
  /** The needle is the label, ignoring case. */
  exactFold: 4,
  /** The label starts with the needle. */
  prefix: 3,
  /**
   * Every needle character either starts a word or continues one the match has
   * already started. This is what makes initials work: `fm` finds `Fira Mono` and
   * `IPM` finds `IBM Plex Mono`, without `IPM` being a substring of anything.
   */
  boundary: 2,
  /** The needle appears as one unbroken run inside the label. */
  substring: 1,
  /** The needle's characters appear in order, with gaps. */
  subsequence: 0,
} as const

/** Characters that make the character after them the start of a word. */
const SEPARATORS = /[\s\-_./:@()+[\]]/

/** A needle and the positions in the label it matched. */
export interface FuzzyMatch {
  /** The ranking score. Higher is a better match. */
  score: number
  /** The matched offsets into the label, ascending, for showing what matched. */
  indices: number[]
  /** The tier the match reached, for tests and for explaining a ranking. */
  tier: number
}

/**
 * Whether a position in a label starts a word.
 *
 * Three things start one: the beginning, a separator, and a lower-to-upper
 * transition. The third is what makes camelCase names searchable by their humps,
 * and it is why `NotoSans` and `Noto Sans` behave the same way under a needle
 * like `ns`.
 * @param label - the text being searched.
 * @param index - a position in it.
 * @returns whether a word starts there.
 */
export function isWordStart(label: string, index: number): boolean {
  if (index <= 0) return index === 0
  const previous = label.charAt(index - 1)
  if (SEPARATORS.test(previous)) return true
  const current = label.charAt(index)
  return previous === previous.toLowerCase() && current !== current.toLowerCase()
}

/** Whether a needle wants case-sensitive matching: it does when it has any uppercase. */
function wantsExactCase(needle: string): boolean {
  return needle !== needle.toLowerCase()
}

/** A local bonus for a matched character. Never large enough to cross a tier. */
function localScore(
  label: string,
  needle: string,
  indices: readonly number[],
  exactCase: boolean,
): number {
  let score = 0
  for (let position = 0; position < indices.length; position += 1) {
    const index = indices[position]
    if (index === undefined) continue
    if (index === 0) score += 24
    else if (isWordStart(label, index)) score += 14
    if (position > 0 && index === (indices[position - 1] ?? -2) + 1) score += 10
    if (exactCase && label.charAt(index) === needle.charAt(position)) score += 4
  }
  const first = indices[0] ?? 0
  const last = indices[indices.length - 1] ?? 0
  // Gaps inside the matched span hurt, starting late hurts, and a short label
  // beats a long one that matched equally well — the same tie-break a reader
  // makes when two rows look alike.
  score -= (last - first + 1 - needle.length) * 1.5
  score -= first * 2
  score -= label.length * 0.05
  return score
}

/**
 * Match a needle against a label.
 *
 * Case follows the needle: a needle with an uppercase character is matched
 * case-sensitively, so `Inter` does not quietly match `inter`, while an
 * all-lowercase needle matches anything. That is the same "smart case" a
 * terminal has used for decades and the one VSCode applies.
 * @param needle - what the user has typed.
 * @param label - what is being searched.
 * @returns the score and matched offsets, or undefined when the needle does not match.
 */
export function fuzzyMatch(needle: string, label: string): FuzzyMatch | undefined {
  if (needle === '') return { score: 0, indices: [], tier: 0 }
  const exactCase = wantsExactCase(needle)
  const haystack = exactCase ? label : label.toLowerCase()
  const query = exactCase ? needle : needle.toLowerCase()

  // ── the cheap wins, in the order they should be believed ────────────────
  if (label === needle) {
    return { score: TIER.exact * TIER_STRIDE + localScore(label, needle, range(needle.length), true), indices: range(needle.length), tier: TIER.exact }
  }
  if (label.toLowerCase() === query) {
    const indices = range(needle.length)
    return {
      score: TIER.exactFold * TIER_STRIDE + localScore(label, needle, indices, exactCase),
      indices,
      tier: TIER.exactFold,
    }
  }
  if (haystack.startsWith(query)) {
    const indices = range(needle.length)
    return {
      score: TIER.prefix * TIER_STRIDE + localScore(label, needle, indices, exactCase),
      indices,
      tier: TIER.prefix,
    }
  }

  // ── the candidates ──────────────────────────────────────────────────────
  // A contiguous run is not automatically the best answer, which is why every
  // candidate is scored and the best one wins rather than the first one found.
  // `ns` against `notoSans` matches contiguously at the end and as two humps at the
  // start; only the second is what the typist meant, and a scorer that returned on
  // the first contiguous hit would never see it.
  let best: FuzzyMatch | undefined
  const consider = (candidate: FuzzyMatch): void => {
    if (best === undefined || candidate.score > best.score) best = candidate
  }

  for (let at = haystack.indexOf(query); at >= 0; at = haystack.indexOf(query, at + 1)) {
    const indices = range(needle.length, at)
    const tier = isWordStart(label, at) ? TIER.boundary : TIER.substring
    consider({ score: tier * TIER_STRIDE + localScore(label, needle, indices, exactCase), indices, tier })
  }

  // Every position the first character could have started at is tried, rather than
  // only the first one. Greedy-from-the-first-hit looks right and is wrong: `IPM`
  // against `IBM Plex Mono` would take the `P` of `Plex` and then fail to find an
  // `M`, when the `M` of `Mono` was available all along.
  for (let start = 0; start < haystack.length; start += 1) {
    if (haystack.charAt(start) !== query.charAt(0)) continue
    const indices: number[] = [start]
    let cursor = start + 1
    let complete = true
    for (let position = 1; position < query.length; position += 1) {
      const found = haystack.indexOf(query.charAt(position), cursor)
      if (found < 0) {
        complete = false
        break
      }
      indices.push(found)
      cursor = found + 1
    }
    if (!complete) continue
    // A match whose characters all start or continue a word reads as initials and
    // outranks one that merely happens to appear in order.
    const tier = indicesAreBoundaryish(label, indices) ? TIER.boundary : TIER.subsequence
    consider({ score: tier * TIER_STRIDE + localScore(label, needle, indices, exactCase), indices, tier })
  }
  return best
}

/**
 * Whether every matched position either starts a word or continues the run before it.
 * @param label - the searched text.
 * @param indices - the matched offsets.
 * @returns whether the match reads as initials rather than as scattered letters.
 */
function indicesAreBoundaryish(label: string, indices: readonly number[]): boolean {
  for (let position = 0; position < indices.length; position += 1) {
    const index = indices[position]
    if (index === undefined) continue
    if (isWordStart(label, index)) continue
    if (position > 0 && index === (indices[position - 1] ?? -2) + 1) continue
    return false
  }
  return true
}

/** `[from, from + count)`, as an array. */
function range(count: number, from = 0): number[] {
  const out: number[] = []
  for (let index = 0; index < count; index += 1) out.push(from + index)
  return out
}

/** One row of a ranked list, with the evidence for its position. */
export interface Ranked<T> {
  item: T
  score: number
  /** The offsets in the label that matched, for emphasising them in the list. */
  indices: number[]
}

/** How to read a row while ranking it. */
export interface RankOptions<T> {
  /** The text shown to the user. */
  label(item: T): string
  /** The text matched against the needle, when it differs from the label. */
  filterText?(item: T): string
  /**
   * The primary sort key, as VSCode's `sortText` is: rows are ordered by it
   * first and by match score only within an equal key. It is how a grammar puts
   * a whole group on top — the value already in effect, say — without pretending
   * its label starts with a `0`.
   */
  sortText?(item: T): string | undefined
}

/**
 * Filter and order rows for a needle.
 *
 * An empty needle keeps every row in the order the grammar declared, which is
 * what Ctrl+Space should show: the whole vocabulary, grouped the way the grammar
 * thinks about it, not alphabetised by a scorer that has nothing to go on.
 * @param items - the candidate rows.
 * @param needle - what the user has typed.
 * @param options - how to read a row.
 * @returns the matching rows, best first.
 */
export function rank<T>(items: readonly T[], needle: string, options: RankOptions<T>): Ranked<T>[] {
  const out: Ranked<T>[] = []
  for (const item of items) {
    if (needle === '') {
      out.push({ item, score: 0, indices: [] })
      continue
    }
    const label = options.label(item)
    const subject = options.filterText?.(item) ?? label
    const match = fuzzyMatch(needle, subject)
    if (match === undefined) continue
    // The offsets are only meaningful against the label, so a row matched on
    // different text is ranked without an emphasis rather than with the wrong one.
    out.push({ item, score: match.score, indices: subject === label ? match.indices : [] })
  }

  if (options.sortText === undefined) {
    // Sorting by score alone, on a stable sort, keeps the order the grammar
    // declared for everything the needle does not separate. That is load-bearing:
    // an empty needle must show a catalogue in catalogue order, and an alphabetical
    // tie-break would quietly rearrange a list the grammar had already ranked.
    out.sort((left, right) => right.score - left.score)
    return out
  }
  return out.sort((left, right) => {
    const leftKey = options.sortText?.(left.item) ?? options.label(left.item)
    const rightKey = options.sortText?.(right.item) ?? options.label(right.item)
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : right.score - left.score
  })
}

/**
 * Split a label around the characters a needle matched, for the list to emphasise.
 *
 * Returned as segments rather than as a marked-up string because the caller is
 * building DOM nodes, not HTML: a font family called `<b>` must be shown as
 * `<b>`, and a completer that returns markup has to escape what it was given or
 * it is wrong about a real font.
 * @param label - the row's text.
 * @param indices - the matched offsets, ascending.
 * @returns alternating plain and matched segments, in order.
 */
export function highlightSegments(
  label: string,
  indices: readonly number[],
): Array<{ text: string; matched: boolean }> {
  if (indices.length === 0) return label === '' ? [] : [{ text: label, matched: false }]
  const marked = new Set(indices)
  const segments: Array<{ text: string; matched: boolean }> = []
  let current: { text: string; matched: boolean } | undefined
  for (let index = 0; index < label.length; index += 1) {
    const matched = marked.has(index)
    if (current === undefined || current.matched !== matched) {
      if (current !== undefined) segments.push(current)
      current = { text: '', matched }
    }
    current.text += label.charAt(index)
  }
  if (current !== undefined) segments.push(current)
  return segments
}
