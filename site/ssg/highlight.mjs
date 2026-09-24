// ─── a very small tokenizer, for the code these docs display ────────────────
//
// The library ships no syntax and neither does this. It is a tokenizer written for the
// three things the documentation quotes — TypeScript, shell, and JSON-ish data — and it is
// deliberately not a parser: when it is unsure it emits plain text, which is the one
// failure mode a documentation highlighter is allowed to have.
//
// It colours a static sample from the SAME custom properties the live editors on the page
// are coloured from, so a code block and the editor beside it cannot disagree about what a
// comment looks like. The library's own scope classes are not reused: those belong to the
// engine, and a page that hijacked them would go stale the first time a scope was renamed.

/** Words that are a colour of their own in TypeScript and JavaScript. */
const KEYWORDS = new Set([
  'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
  'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally',
  'for', 'from', 'function', 'get', 'if', 'implements', 'import', 'in', 'instanceof',
  'interface', 'let', 'new', 'null', 'of', 'return', 'satisfies', 'set', 'static',
  'super', 'switch', 'this', 'throw', 'true', 'try', 'type', 'typeof', 'undefined',
  'var', 'void', 'while', 'yield',
])

/** The built-in names worth a colour. Types, mostly: they are what a reader scans for. */
const TYPES = new Set([
  'Array', 'Boolean', 'Error', 'Map', 'Number', 'Omit', 'Partial', 'Pick', 'Promise',
  'Readonly', 'Record', 'RegExp', 'Set', 'String', 'WeakMap', 'boolean', 'number',
  'object', 'string', 'symbol', 'unknown', 'any', 'never',
])

/** Shell words, for the one `sh` fence in the docs. */
const SHELL = new Set(['npm', 'npx', 'node', 'pnpm', 'yarn', 'cd', 'git'])

/**
 * Whether a `/` at this position opens a regular expression rather than dividing.
 *
 * The standard heuristic: a slash after a value is a division; a slash after an operator,
 * a bracket, a comma, a keyword, or nothing at all opens a pattern. It is wrong in the
 * cases every linter knows about and right for every sample in this repository.
 * @param prev - the last non-space character emitted, or `''` at the start of a line.
 * @param previousWord - the identifier that ended just before, if one did.
 */
function regexAllowed(prev, previousWord) {
  if (prev === '' || '([{,;:=!&|?+-*%~^<>'.includes(prev)) return true
  return KEYWORDS.has(previousWord)
}

/**
 * Tokenize one sample.
 *
 * @param source - the code, exactly as the file holds it.
 * @param language - `ts`, `js`, `tsx`, `sh`, `json`, `text`, or anything else for plain.
 * @returns one token per piece, in order, with the text it covers.
 */
function tokenize(source, language) {
  const tokens = []
  const shell = language === 'sh' || language === 'bash' || language === 'console'
  let at = 0
  let previousWord = ''
  let lastChar = ''

  /** Push a token, keeping the last significant character for the next decision. */
  const push = (type, text) => {
    if (text === '') return
    tokens.push({ type, text })
    for (let index = text.length - 1; index >= 0; index -= 1) {
      const character = text[index]
      if (character !== ' ' && character !== '\t' && character !== '\n') {
        lastChar = character
        break
      }
    }
  }

  const readString = (quote, start) => {
    let index = start + 1
    while (index < source.length) {
      const character = source[index]
      if (character === '\\') index += 2
      else if (character === quote) return index + 1
      else if (character === '\n' && quote !== '`') return index
      else index += 1
    }
    return source.length
  }

  const readPattern = (start) => {
    let index = start + 1
    let inClass = false
    while (index < source.length) {
      const character = source[index]
      if (character === '\\') index += 2
      else if (character === '[') { inClass = true; index += 1 }
      else if (character === ']') { inClass = false; index += 1 }
      else if (character === '/' && !inClass) {
        index += 1
        while (index < source.length && /[a-z]/.test(source[index])) index += 1
        return index
      } else if (character === '\n') return index
      else index += 1
    }
    return index
  }

  while (at < source.length) {
    const character = source[at]

    // A comment, in either syntax. A `#` is a comment only where it starts a word, which is
    // what keeps `x#y` and a `#` inside a string out of this branch.
    if (character === '/' && source[at + 1] === '/') {
      const end = source.indexOf('\n', at)
      push('comment', source.slice(at, end === -1 ? source.length : end))
      at = end === -1 ? source.length : end
      continue
    }
    if (character === '/' && source[at + 1] === '*') {
      const end = source.indexOf('*/', at + 2)
      const stop = end === -1 ? source.length : end + 2
      push('comment', source.slice(at, stop))
      at = stop
      continue
    }
    if (shell && character === '#' && (lastChar === '' || lastChar === '\n')) {
      const end = source.indexOf('\n', at)
      push('comment', source.slice(at, end === -1 ? source.length : end))
      at = end === -1 ? source.length : end
      continue
    }

    if (character === '"' || character === "'" || character === '`') {
      const end = readString(character, at)
      push('string', source.slice(at, end))
      at = end
      previousWord = ''
      continue
    }

    if (character === '/' && regexAllowed(lastChar, previousWord)) {
      const end = readPattern(at)
      push('regex', source.slice(at, end))
      at = end
      previousWord = ''
      continue
    }

    if (/[0-9]/.test(character) && !/[\w$]/.test(lastChar)) {
      let end = at
      while (end < source.length && /[0-9a-fA-FxXoObB._]/.test(source[end])) end += 1
      push('number', source.slice(at, end))
      at = end
      previousWord = ''
      continue
    }

    if (/[A-Za-z_$]/.test(character)) {
      let end = at
      while (end < source.length && /[\w$]/.test(source[end])) end += 1
      const word = source.slice(at, end)
      const next = source[end]
      previousWord = word
      if (KEYWORDS.has(word) || (shell && SHELL.has(word))) push('keyword', word)
      else if (TYPES.has(word) || /^[A-Z]/.test(word)) push('type', word)
      // A word that a colon follows, and that is not a ternary's `?`, names a field — in an
      // object literal, in an interface, in a type. Every grammar sample is full of them.
      else if (next === ':' && lastChar !== '?') push('property', word)
      else push('plain', word)
      at = end
      continue
    }

    if ('()[]{}'.includes(character)) {
      push('bracket', character)
      previousWord = ''
      at += 1
      continue
    }

    if (',;.'.includes(character)) {
      push('separator', character)
      previousWord = ''
      at += 1
      continue
    }

    // Everything else — operators, whitespace, punctuation — is emitted as it stands. Whitespace
    // matters: a sample's indentation is part of what it is showing.
    push('plain', character)
    if (!/\s/.test(character)) previousWord = ''
    at += 1
  }

  return tokens
}

/**
 * Highlight one sample into HTML.
 *
 * @param source - the code.
 * @param language - the fence's language, or `''` for none.
 * @returns escaped HTML, with one span per coloured run.
 */
export function highlight(source, language) {
  const tokens = tokenize(source, language)
  return tokens
    .map((token) => {
      const text = token.text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
      return token.type === 'plain' ? text : `<span class="tok-${token.type}">${text}</span>`
    })
    .join('')
}
