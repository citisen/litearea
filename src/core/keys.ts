// ─── keys: turning a press into a command, without a language for it ────────
//
// The editor has always known what to do with Tab, Enter, Escape, Ctrl+Space, and the
// four arrows. What it did not have was a way to SAY so: the knowledge was an if/switch
// chain in the DOM layer, which meant a host could not move a binding, could not add
// one, and could not take one away.
//
// This module is that way of saying so, and it is deliberately the smallest one that
// answers the question. A binding is a key combination and a command name. Nothing
// else. In particular there is no `when` expression, no `&&`, no `||`, and no
// parentheses — the machinery react-codearea carried for conditions like
// `suggestionOpen && hasSuggestionItems && !(typing || escaping)`.
//
// What replaces it is eligibility: a command that only makes sense with the completion
// list open is simply not eligible while it is closed, and the resolver moves on to the
// next binding. That is enough for every case a real host has, it needs no parser, and
// it keeps a second description of the editor's state out of the host's config. The
// same key can therefore carry two bindings and the first eligible one wins:
//
//     { key: 'Tab', command: 'acceptRow' }   // eligible only while the list is open
//     { key: 'Tab', command: 'indent' }      // eligible only while it is closed
//
// `ignore` is the escape hatch for taking a key away entirely: it is always eligible,
// it suppresses any binding below it, and it performs no action — so the browser's own
// handling of that key happens as if the editor had never seen it.

/** A key press, in the shape a `KeyboardEvent` reports one. */
export interface KeyPress {
  /** `KeyboardEvent.key`: a character, or a name such as `Tab` or `ArrowUp`. */
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}

/** One line of a keymap. */
export interface KeyBinding<Command extends string = string> {
  /**
   * The combination, written the way a reader would say it: `Tab`, `Shift+Tab`,
   * `Mod+/`, `Ctrl+Alt+ArrowUp`.
   *
   * `Mod` is Control on every platform and also Command on a Mac, which is what a host
   * that wants one binding for both should write. `Ctrl` and `Cmd`/`Meta` name one
   * modifier each, for the rarer binding that must know the difference. Modifiers are
   * matched exactly: a binding that does not say `Shift` does not fire when Shift is
   * held.
   */
  key: string
  /** What to do. An unknown command is ignored rather than fatal. */
  command: Command
}

/** Modifier spellings that mean the same thing. */
const MODIFIER_ALIASES: Readonly<Record<string, string>> = {
  mod: 'mod',
  ctrl: 'ctrl',
  control: 'ctrl',
  cmd: 'meta',
  command: 'meta',
  meta: 'meta',
  super: 'meta',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  shift: 'shift',
}

/** Key spellings that mean the same thing, lowercased. */
const KEY_ALIASES: Readonly<Record<string, string>> = {
  ' ': ' ',
  space: ' ',
  spacebar: ' ',
  esc: 'escape',
  escape: 'escape',
  return: 'enter',
  enter: 'enter',
  tab: 'tab',
  del: 'delete',
  delete: 'delete',
  backspace: 'backspace',
  ins: 'insert',
  insert: 'insert',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  arrowup: 'arrowup',
  arrowdown: 'arrowdown',
  arrowleft: 'arrowleft',
  arrowright: 'arrowright',
  home: 'home',
  end: 'end',
  pageup: 'pageup',
  pgup: 'pageup',
  pagedown: 'pagedown',
  pgdn: 'pagedown',
  pgdown: 'pagedown',
  plus: '+',
}

/** The key names a combination is written with, for `keyCombo`. */
const DISPLAY_NAMES: Readonly<Record<string, string>> = {
  ' ': 'Space',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  escape: 'Escape',
  enter: 'Enter',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
}

/** One parsed side of a comparison. */
interface ParsedKey {
  key: string
  ctrl: boolean
  meta: boolean
  alt: boolean
  shift: boolean
  /** Whether the combination asked for `Mod`, which is Control or Command. */
  mod: boolean
  /** Whether a modifier name was written that this library does not know. */
  unknown: boolean
}

/**
 * Read one written combination.
 *
 * The last `+`-separated part is the key and everything before it is a modifier. A key
 * whose name is a plus sign is written `Plus`, because `Mod++` splits into an empty
 * final part and there is no way to read that as anything but a mistake.
 *
 * A modifier this library does not recognise makes the whole combination match nothing.
 * The alternative — ignoring it — turns a typo into a binding on the bare key, so
 * `Ctr+Tab` would quietly become `Tab`.
 * @param combo - the combination as a host wrote it.
 * @returns the parts, with the key normalized.
 */
function parseKey(combo: string): ParsedKey {
  const parts = combo.split('+')
  const rawKey = (parts.pop() ?? '').trim()
  const parsed: ParsedKey = {
    key: normalizeKey(rawKey),
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
    mod: false,
    unknown: false,
  }
  for (const part of parts) {
    const name = part.trim().toLowerCase()
    if (name === '') continue
    const modifier = MODIFIER_ALIASES[name]
    if (modifier === 'mod') parsed.mod = true
    else if (modifier === 'ctrl') parsed.ctrl = true
    else if (modifier === 'meta') parsed.meta = true
    else if (modifier === 'alt') parsed.alt = true
    else if (modifier === 'shift') parsed.shift = true
    else parsed.unknown = true
  }
  return parsed
}

/** Fold a key's spelling to the one form comparisons use. */
function normalizeKey(key: string): string {
  const lower = key.toLowerCase()
  return KEY_ALIASES[lower] ?? lower
}

/**
 * Whether a press matches a written combination.
 *
 * Modifiers are matched EXACTLY, which is the property that makes `Tab` and `Shift+Tab`
 * two different bindings rather than one that depends on what else is held. `Mod`
 * matches Control or Command, so one binding can serve both platforms.
 * @param combo - the combination as a host wrote it.
 * @param press - the press to test.
 * @returns whether they are the same chord.
 */
export function matchesKey(combo: string, press: KeyPress): boolean {
  const wanted = parseKey(combo)
  if (wanted.unknown) return false
  if (wanted.key !== normalizeKey(press.key)) return false
  const ctrl = press.ctrlKey === true
  const meta = press.metaKey === true
  if (wanted.mod) {
    if (!ctrl && !meta) return false
  } else if (wanted.ctrl !== ctrl || wanted.meta !== meta) {
    return false
  }
  return wanted.alt === (press.altKey === true) && wanted.shift === (press.shiftKey === true)
}

/**
 * How a press would be written, for a message or a test.
 *
 * @param press - the press.
 * @returns the combination in the same spelling `KeyBinding.key` accepts, with `Mod`
 *   spelled as the modifiers actually held.
 */
export function keyCombo(press: KeyPress): string {
  const parts: string[] = []
  if (press.ctrlKey === true) parts.push('Ctrl')
  if (press.metaKey === true) parts.push('Meta')
  if (press.altKey === true) parts.push('Alt')
  if (press.shiftKey === true) parts.push('Shift')
  const key = normalizeKey(press.key)
  parts.push(DISPLAY_NAMES[key] ?? key)
  return parts.join('+')
}

/**
 * The command a press asks for.
 *
 * Bindings are tried in order and the first one that matches AND whose command is
 * eligible wins; a match that is not eligible is passed over rather than stopping the
 * search, which is what lets one key hold two bindings for two states of the editor.
 *
 * @param bindings - the keymap, lower priority last.
 * @param press - the press.
 * @param eligible - whether a command makes sense right now.
 * @returns the command, or `undefined` when the key belongs to the browser.
 */
export function resolveCommand<Command extends string>(
  bindings: readonly KeyBinding<Command>[],
  press: KeyPress,
  eligible: (command: Command) => boolean,
): Command | undefined {
  for (const binding of bindings) {
    if (!matchesKey(binding.key, press)) continue
    if (eligible(binding.command)) return binding.command
  }
  return undefined
}
