import { describe, expect, it } from 'vitest'
import { keyCombo, matchesKey, resolveCommand, type KeyBinding, type KeyPress } from '../src/core/keys.js'

/** A press with nothing held but what is named. */
function press(key: string, held: Partial<KeyPress> = {}): KeyPress {
  return { key, ...held }
}

describe('matchesKey', () => {
  it('matches a bare key', () => {
    expect(matchesKey('Tab', press('Tab'))).toBe(true)
    expect(matchesKey('Tab', press('Enter'))).toBe(false)
  })

  it('treats Tab and Shift+Tab as two different chords', () => {
    // The property the whole feature rests on: modifiers are matched exactly, so a
    // binding that does not say Shift does not fire while Shift is held.
    expect(matchesKey('Tab', press('Tab', { shiftKey: true }))).toBe(false)
    expect(matchesKey('Shift+Tab', press('Tab', { shiftKey: true }))).toBe(true)
    expect(matchesKey('Shift+Tab', press('Tab'))).toBe(false)
  })

  it('reads Mod as Control or Command', () => {
    expect(matchesKey('Mod+/', press('/', { ctrlKey: true }))).toBe(true)
    expect(matchesKey('Mod+/', press('/', { metaKey: true }))).toBe(true)
    expect(matchesKey('Mod+/', press('/'))).toBe(false)
  })

  it('keeps Ctrl and Meta apart when a binding names one', () => {
    expect(matchesKey('Ctrl+/', press('/', { ctrlKey: true }))).toBe(true)
    expect(matchesKey('Ctrl+/', press('/', { metaKey: true }))).toBe(false)
    expect(matchesKey('Cmd+/', press('/', { metaKey: true }))).toBe(true)
  })

  it('requires every modifier a binding names', () => {
    expect(matchesKey('Ctrl+Alt+ArrowUp', press('ArrowUp', { ctrlKey: true }))).toBe(false)
    expect(matchesKey('Ctrl+Alt+ArrowUp', press('ArrowUp', { ctrlKey: true, altKey: true }))).toBe(true)
    expect(matchesKey('Ctrl+ArrowUp', press('ArrowUp', { ctrlKey: true, altKey: true }))).toBe(false)
  })

  it('ignores the case of a key name', () => {
    expect(matchesKey('tab', press('Tab'))).toBe(true)
    expect(matchesKey('TAB', press('Tab'))).toBe(true)
    expect(matchesKey('A', press('a'))).toBe(true)
  })

  it('accepts the spellings a host is likely to write', () => {
    expect(matchesKey('Esc', press('Escape'))).toBe(true)
    expect(matchesKey('Space', press(' '))).toBe(true)
    expect(matchesKey('Ctrl+Space', press(' ', { ctrlKey: true }))).toBe(true)
    expect(matchesKey('Up', press('ArrowUp'))).toBe(true)
    expect(matchesKey('PgDn', press('PageDown'))).toBe(true)
  })

  it('reads a plus key by its name', () => {
    expect(matchesKey('Mod+Plus', press('+', { ctrlKey: true }))).toBe(true)
  })

  it('does not match an unknown modifier name by accident', () => {
    // A typo must not quietly become a binding on the bare key: `Ctr+Tab` matching a
    // plain Tab would be a binding nobody asked for, firing on the commonest chord in
    // the editor.
    expect(matchesKey('Hyper+Tab', press('Tab'))).toBe(false)
    expect(matchesKey('Ctr+Tab', press('Tab'))).toBe(false)
    expect(matchesKey('Ctrl+Tab', press('Tab', { ctrlKey: true }))).toBe(true)
  })
})

describe('keyCombo', () => {
  it('writes a press the way a binding would', () => {
    expect(keyCombo(press('Tab'))).toBe('Tab')
    expect(keyCombo(press('Tab', { shiftKey: true }))).toBe('Shift+Tab')
    expect(keyCombo(press('ArrowUp', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+ArrowUp')
  })

  it('names the keys that have no character', () => {
    expect(keyCombo(press(' '))).toBe('Space')
    expect(keyCombo(press('ArrowDown'))).toBe('ArrowDown')
  })

  it('round-trips through matching', () => {
    const chords: KeyPress[] = [
      press('Tab'),
      press('Tab', { shiftKey: true }),
      press('/', { ctrlKey: true }),
      press('/', { metaKey: true }),
      press(' ', { ctrlKey: true }),
      press('ArrowDown'),
      press('PageUp', { altKey: true }),
    ]
    for (const chord of chords) {
      expect(matchesKey(keyCombo(chord), chord)).toBe(true)
    }
  })
})

describe('resolveCommand', () => {
  type Command = 'accept' | 'indent' | 'ignore' | 'never'

  const always = (): boolean => true

  it('returns the first matching binding', () => {
    const bindings: KeyBinding<Command>[] = [
      { key: 'Tab', command: 'accept' },
      { key: 'Tab', command: 'indent' },
    ]
    expect(resolveCommand(bindings, press('Tab'), always)).toBe('accept')
  })

  it('passes over a match whose command is not eligible', () => {
    // This is what replaces a `when` expression, and it is the whole mechanism behind
    // "Tab accepts while the list is open and indents while it is closed".
    const bindings: KeyBinding<Command>[] = [
      { key: 'Tab', command: 'accept' },
      { key: 'Tab', command: 'indent' },
    ]
    const eligible = (command: Command): boolean => command !== 'accept'
    expect(resolveCommand(bindings, press('Tab'), eligible)).toBe('indent')
  })

  it('answers with nothing when no binding matches', () => {
    expect(resolveCommand([{ key: 'Tab', command: 'indent' }], press('F2'), always)).toBeUndefined()
  })

  it('answers with nothing when every match is ineligible', () => {
    expect(
      resolveCommand([{ key: 'Tab', command: 'never' }], press('Tab'), () => false),
    ).toBeUndefined()
  })

  it('lets a binding suppress the ones below it', () => {
    // `ignore` is how a host takes a key away: it is eligible, it matches, and it does
    // nothing, so nothing further down gets a chance at the key either.
    const bindings: KeyBinding<Command>[] = [
      { key: 'Tab', command: 'ignore' },
      { key: 'Tab', command: 'indent' },
    ]
    expect(resolveCommand(bindings, press('Tab'), always)).toBe('ignore')
  })

  it('matches the whole chord, not just the key', () => {
    const bindings: KeyBinding<Command>[] = [
      { key: 'Shift+Tab', command: 'indent' },
      { key: 'Tab', command: 'accept' },
    ]
    expect(resolveCommand(bindings, press('Tab', { shiftKey: true }), always)).toBe('indent')
    expect(resolveCommand(bindings, press('Tab'), always)).toBe('accept')
  })
})
