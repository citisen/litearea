import { describe, expect, it } from 'vitest'
import { LITEAREA_STYLES, decorationClass, scopeClass, severityClass } from '../src/styles.js'

/** The stylesheet with its comments removed, since prose here quotes selectors. */
const css = LITEAREA_STYLES.replace(/\/\*[\s\S]*?\*\//g, '')

/** The scope names a CSS variable or a rule mentions, folded the way a class is. */
function scopesIn(pattern: RegExp, text: string): Set<string> {
  return new Set([...text.matchAll(pattern)].map((match) => match[1] ?? '').filter((name) => name !== ''))
}

const declared = scopesIn(/--litearea-scope-([a-z-]+)\s*:/g, css)
const painted = scopesIn(/\.litearea-scope-([a-z-]+)\s*\{/g, css)

describe('the stylesheet', () => {
  it('declares a colour for every scope and spends it', () => {
    // The regression guard for a bug with nothing to see: twenty-nine scope variables were
    // declared with no rule that used one, so the tokenizer painted the right classes and every
    // scope rendered in the inherited colour. The editor had no syntax colouring at all, the
    // stylesheet looked complete, and the DOM was correct — which is why this is asserted on the
    // text rather than on any rendered result.
    expect(declared.size).toBeGreaterThan(15)
    expect(painted.size).toBeGreaterThan(15)
    const unused = [...declared].filter((scope) => !painted.has(scope))
    expect(unused).toEqual([])
  })

  it('paints a scope with its own variable rather than a literal', () => {
    // A rule that hard-coded a colour would work and would not be themeable, which is the
    // quieter half of the same mistake.
    for (const scope of painted) {
      expect(LITEAREA_STYLES).toContain(
        `.litearea-scope-${scope} { color: var(--litearea-scope-${scope}); }`,
      )
    }
  })

  it('gives each scope a colour of its own, so two scopes never look alike by accident', () => {
    const families = [...LITEAREA_STYLES.matchAll(/--litearea-scope-([a-z-]+):\s*([^;]+);/g)].map(
      (match) => [match[1] ?? '', (match[2] ?? '').trim()] as const,
    )
    const byValue = new Map<string, string[]>()
    for (const [scope, value] of families) {
      byValue.set(value, [...(byValue.get(value) ?? []), scope])
    }
    // `value.shape` and `value.color` are deliberately the same colour, so the rule is not "all
    // distinct" — it is that the shared ones are shared on purpose, and this records which.
    const shared = [...byValue.entries()].filter(([, scopes]) => scopes.length > 1)
    expect(shared.every(([value, scopes]) => value !== '' && scopes.length >= 2)).toBe(true)
  })

  it('describes the four severities with a decoration each', () => {
    for (const severity of ['error', 'warning', 'info', 'hint']) {
      expect(severityClass(severity)).toBe(`litearea-diag-${severity}`)
      expect(LITEAREA_STYLES).toContain(`.litearea-diag-${severity} {`)
    }
    // Wavy for the two that mean "fix this", dotted for the two that mean "worth knowing".
    expect(LITEAREA_STYLES).toMatch(/\.litearea-diag-error \{[^}]*text-decoration-style: wavy/)
    expect(LITEAREA_STYLES).toMatch(/\.litearea-diag-warning \{[^}]*text-decoration-style: wavy/)
    expect(LITEAREA_STYLES).toMatch(/\.litearea-diag-info \{[^}]*text-decoration-style: dotted/)
    expect(LITEAREA_STYLES).toMatch(/\.litearea-diag-hint \{[^}]*text-decoration-style: dotted/)
  })

  it('sets no text-decoration on every painted span', () => {
    // There was such a rule, and its specificity beat every severity class, which switched off
    // every squiggle in the library while leaving the DOM perfectly correct.
    expect(LITEAREA_STYLES).not.toContain('.litearea-paint > span')
  })

  it('gives the list its own scroller and pins the documentation outside it', () => {
    // The two must not be the same element, or a long explanation becomes unreachable: the
    // arrows move the active row rather than the scrollbar.
    expect(LITEAREA_STYLES).toMatch(/\.litearea-list \{[^}]*overflow-y: auto/)
    expect(LITEAREA_STYLES).toMatch(/\.litearea-docs \{[^}]*overflow-y: auto/)
    expect(LITEAREA_STYLES).toMatch(/\.litearea-popup \{[^}]*overflow: hidden/)
  })

  it('turns ligatures and kerning off, because the layer splits spans', () => {
    // A ligature draws one glyph where the field holds two characters, and a span boundary inside
    // a pair would leave one glyph in the field and two in the paint, at different widths.
    expect(LITEAREA_STYLES).toContain('font-variant-ligatures: none')
    expect(LITEAREA_STYLES).toContain('font-kerning: none')
  })

  it('has balanced braces', () => {
    const opens = (LITEAREA_STYLES.match(/\{/g) ?? []).length
    const closes = (LITEAREA_STYLES.match(/\}/g) ?? []).length
    expect(opens).toBe(closes)
    expect(opens).toBeGreaterThan(30)
  })

  it('declares the scrollbar compensation the layer needs when the field scrolls', () => {
    expect(LITEAREA_STYLES).toContain('var(--litearea-scrollbar, 0px)')
  })
})

describe('class names', () => {
  it('folds a dotted scope into a hyphenated class', () => {
    expect(scopeClass('value.shape')).toBe('litearea-scope-value-shape')
    expect(scopeClass('family.generic')).toBe('litearea-scope-family-generic')
    expect(scopeClass('state')).toBe('litearea-scope-state')
  })

  it('never leaves an empty or malformed class', () => {
    expect(scopeClass('')).toBe('litearea-scope-text')
    expect(scopeClass('...')).toBe('litearea-scope-text')
    expect(scopeClass('a b/c')).toBe('litearea-scope-a-b-c')
  })

  it('names a decoration and a severity', () => {
    expect(decorationClass('effective')).toBe('litearea-dec-effective')
    expect(severityClass('error')).toBe('litearea-diag-error')
  })

  it('folds punctuation out of a class so no selector needs escaping', () => {
    expect(scopeClass('a.b')).not.toContain('.')
    expect(decorationClass('a b')).not.toContain(' ')
  })
})
