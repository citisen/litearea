// ─── format: the small string helpers the messages share ────────────────────
//
// Kept apart from the vocabulary so that a grammar can raise its own diagnostics
// with the same phrasing the built-in ones use, and so that a translated host can
// reuse the substitution instead of writing a second one.

/** The most members a message will name before it stops counting. */
const DEFAULT_LIST_LIMIT = 12

/**
 * Substitute `{name}` placeholders in a template.
 *
 * A placeholder with no matching key is left exactly as it was rather than
 * blanked: a visible `{allowed}` in a message is a bug report, and an empty gap
 * is a mystery.
 * @param template - the template, with `{name}` placeholders.
 * @param values - the substitutions.
 * @returns the filled text.
 */
export function fillTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return String(template).replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : match,
  )
}

/**
 * A readable list: `a`, `a or b`, `a, b, or c`.
 *
 * The conjunction is a parameter because the same list reads differently as
 * "expected one of X, Y, or Z" and as "X, Y, and Z are installed".
 * @param items - the members.
 * @param options - `conjunction` (`'or'` by default) and `limit`, the most
 *   members to name before summarising the rest as `… and N more`.
 * @returns the phrase.
 */
export function listPhrase(
  items: readonly string[],
  options?: { conjunction?: string; limit?: number },
): string {
  const conjunction = options?.conjunction ?? 'or'
  const limit = options?.limit ?? DEFAULT_LIST_LIMIT
  const shown = items.slice(0, limit)
  const rest = items.length - shown.length
  if (shown.length === 0) return ''
  if (shown.length === 1) {
    return rest > 0 ? `${String(shown[0])} and ${String(rest)} more` : String(shown[0])
  }
  // Two members take no comma before the conjunction. "circle, or square" is not how
  // anyone writes it, and every diagnostic that lists a two-member vocabulary would
  // have said it that way.
  if (shown.length === 2) {
    const pair = `${String(shown[0])} ${conjunction} ${String(shown[1])}`
    return rest > 0 ? `${pair}, and ${String(rest)} more` : pair
  }
  const head = shown.slice(0, -1).join(', ')
  const tail = shown[shown.length - 1]
  const phrase = `${head}, ${conjunction} ${String(tail)}`
  return rest > 0 ? `${phrase}, and ${String(rest)} more` : phrase
}

/**
 * Collapse the whitespace in a snippet of user text so it can be quoted inside a
 * one-line message.
 * @param text - the text.
 * @param limit - the longest result, ellipsised beyond it.
 * @returns the excerpt.
 */
export function excerpt(text: string, limit = 24): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`
}
