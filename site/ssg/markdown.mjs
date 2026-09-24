// ─── the markdown the site is written in ────────────────────────────────────
//
// A renderer, not a Markdown implementation. It covers exactly what this repository's prose
// uses and refuses the rest, which is: ATX headings, paragraphs, unordered and ordered lists
// with hanging continuations, pipe tables, fenced code, inline code, bold, italic, and links.
// There is no blockquote, no reference link, no HTML passthrough, and no nested list anywhere
// in the three references — so there is no code here for them either, and the renderer is
// small enough to read in one sitting.
//
// What it adds to Markdown is four directives, because a documentation page is not only
// prose: `::: live` mounts a real editor, `::: try` is the list of things to do to it,
// `::: note` is a note that prints in the margin, and `::: code` includes a file by path so a
// sample cannot drift from the file it quotes.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { liveFrame } from './frames.mjs'
import { highlight } from './highlight.mjs'

/** The five characters that have to be escaped, and what they become. */
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/**
 * Escape text for HTML.
 * @param text - anything.
 * @returns the same text, safe to interpolate.
 */
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (character) => ENTITIES[character])
}

/**
 * The id a heading gets, from its text.
 *
 * Deliberately plain: lowercase, punctuation dropped, spaces to hyphens. A heading whose
 * text is only code still gets an id, and two headings with the same text get `-2`, `-3`.
 * @param text - the heading's text, with markup already stripped.
 * @returns a fragment identifier.
 */
export function slugify(text) {
  const slug = text
    .toLowerCase()
    .replace(/[`*_]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
  return slug === '' ? 'section' : slug
}

/** The roman-ish label a section number uses: 1 → `01`. */
function pad(number) {
  return number < 10 ? `0${number}` : String(number)
}

/**
 * Inline markup: code spans, bold, italic, and links.
 *
 * Code spans are lifted out first and put back last, which is what keeps a `*` inside a code
 * span from opening an emphasis and an `&` inside one from being escaped twice.
 *
 * @param text - one block of text, newlines already joined.
 * @param env - the render environment; `env.link` rewrites an href.
 * @returns HTML with no block structure.
 */
function inline(text, env) {
  /** @type {string[]} */
  const codes = []
  let out = text.replace(/`([^`]+)`/g, (_whole, code) => {
    codes.push(code)
    return `\u0000${codes.length - 1}\u0000`
  })

  out = escapeHtml(out)

  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_whole, label, href) => {
    const target = env.link(href)
    if (target === '') return label
    const external = /^https?:/.test(target)
    const attributes = external ? ' target="_blank" rel="noreferrer"' : ''
    return `<a href="${escapeHtml(target)}"${attributes}>${label}</a>`
  })

  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[\s(—-])\*([^*\n]+)\*(?=[\s).,;:!?—-]|$)/g, '$1<em>$2</em>')
  out = out.replace(/(^|[\s(—-])_([^_\n]+)_(?=[\s).,;:!?—-]|$)/g, '$1<em>$2</em>')

  return out.replace(/\u0000(\d+)\u0000/g, (_whole, index) => `<code>${escapeHtml(codes[Number(index)])}</code>`)
}

/** Whether a line is blank. */
function isBlank(line) {
  return line === undefined || line.trim() === ''
}

/** Whether a line starts a list item, and which kind. */
function listKind(line) {
  if (/^[-*] /.test(line)) return 'ul'
  if (/^\d+\. /.test(line)) return 'ol'
  return null
}

/** Split a table row into cells, honouring `\|` and code spans that contain a bar. */
function tableCells(line) {
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells = []
  let current = ''
  for (let at = 0; at < body.length; at += 1) {
    const character = body[at]
    if (character === '\\' && body[at + 1] === '|') {
      current += '|'
      at += 1
    } else if (character === '|') {
      cells.push(current.trim())
      current = ''
    } else {
      current += character
    }
  }
  cells.push(current.trim())
  return cells
}

/** The alignment a delimiter cell asks for. */
function alignmentOf(cell) {
  const left = cell.startsWith(':')
  const right = cell.endsWith(':')
  if (left && right) return 'center'
  if (right) return 'right'
  if (left) return 'left'
  return ''
}

/**
 * A fenced code block, framed the way every sample on the site is framed.
 *
 * @param code - the source, without its fences.
 * @param language - the fence's info string.
 * @param label - what the frame's bar says; the language by default.
 * @returns the figure.
 */
function codeFigure(code, language, label) {
  const name = label === undefined || label === '' ? language : label
  const bar =
    `<figcaption class="code-bar">` +
    `<span class="code-name">${escapeHtml(name === '' ? 'text' : name)}</span>` +
    `<button class="code-copy" type="button" data-copy>copy</button>` +
    `</figcaption>`
  return (
    `<figure class="code">${bar}` +
    `<pre class="code-body"><code>${highlight(code, language)}</code></pre>` +
    `</figure>`
  )
}

/**
 * Render a whole document.
 *
 * @param source - the markdown.
 * @param env - `{ link(href), code(path, attributes), root, sourcePath }`.
 * @returns `{ html, headings }`, where a heading is `{ level, id, text, number }`.
 */
export function renderMarkdown(source, env) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  /** @type {Array<{ level: number, id: string, text: string, number: string }>} */
  const headings = []
  const used = new Map()
  const out = []
  let at = 0
  let section = 0
  let note = 0
  let sawTitle = false

  /** A unique id for a heading. */
  const uniqueId = (text) => {
    const base = slugify(text)
    const seen = used.get(base) ?? 0
    used.set(base, seen + 1)
    return seen === 0 ? base : `${base}-${seen + 1}`
  }

  while (at < lines.length) {
    const line = lines[at]

    if (isBlank(line)) {
      at += 1
      continue
    }

    // ── a fence ─────────────────────────────────────────────────────────────
    const fence = /^```(\S*)\s*$/.exec(line)
    if (fence !== null) {
      const language = fence[1] ?? ''
      const body = []
      at += 1
      while (at < lines.length && !/^```\s*$/.test(lines[at])) {
        body.push(lines[at])
        at += 1
      }
      at += 1
      out.push(codeFigure(body.join('\n'), language, language))
      continue
    }

    // ── a directive ─────────────────────────────────────────────────────────
    const directive = /^::: *(\w+)\s*(.*)$/.exec(line)
    if (directive !== null) {
      const name = directive[1]
      const rest = (directive[2] ?? '').trim()
      const body = []
      at += 1
      while (at < lines.length && !/^:::\s*$/.test(lines[at])) {
        body.push(lines[at])
        at += 1
      }
      at += 1

      if (name === 'live') {
        const [id, ...pairs] = rest.split(/\s+/)
        const attributes = Object.fromEntries(pairs.map((pair) => pair.split('=')))
        const controls = attributes.controls === undefined ? [] : attributes.controls.split(',')
        const extra = attributes.height === undefined ? '' : ` data-height="${escapeHtml(attributes.height)}"`
        out.push(liveFrame(id ?? '', attributes.label ?? id ?? '', controls, extra))
        continue
      }

      if (name === 'bench') {
        out.push(`<div class="bench" data-bench></div>`)
        continue
      }

      if (name === 'ledger') {
        // A list of pages, set as a ruled ledger: a number, a title, and a line about it. One line
        // per entry, `|`-separated, in the order `number | title | url | note`.
        const rows = body
          .filter((line) => line.trim() !== '')
          .map((line) => {
            const [number, title, url, ...note] = line.split('|').map((part) => part.trim())
            return (
              `<a class="ledger-row" href="${escapeHtml(env.link(url ?? '/'))}">` +
              `<span class="ledger-num">${escapeHtml(number ?? '')}</span>` +
              `<span class="ledger-title">${escapeHtml(title ?? '')}</span>` +
              `<span class="ledger-note">${inline(note.join('|'), env)}</span>` +
              `</a>`
            )
          })
          .join('')
        out.push(`<nav class="ledger" aria-label="Examples">${rows}</nav>`)
        continue
      }

      if (name === 'claims') {
        // A numbered block per claim. Each claim is an `###` line and the prose under it, which
        // is what keeps the content a markdown document rather than a page of markup: the
        // numbers are the renderer's, and a claim that is inserted in the middle renumbers the
        // ones below it.
        const claims = []
        let current = null
        for (const line of body) {
          const head = /^### +(.*)$/.exec(line)
          if (head !== null) {
            if (current !== null) claims.push(current)
            current = { title: head[1].trim(), lines: [] }
            continue
          }
          current?.lines.push(line)
        }
        if (current !== null) claims.push(current)
        out.push(
          `<div class="claims">` +
            claims
              .map(
                (claim, index) =>
                  `<div class="claim">` +
                  `<span class="claim-num">${pad(index + 1)}</span>` +
                  `<div class="claim-text"><p class="claim-title">${inline(claim.title, env)}</p>` +
                  renderMarkdown(claim.lines.join('\n'), env).html +
                  `</div></div>`,
              )
              .join('') +
            `</div>`,
        )
        continue
      }

      if (name === 'try') {
        out.push(
          `<div class="try"><p class="try-label">Try</p>` +
            renderMarkdown(body.join('\n'), env).html +
            `</div>`,
        )
        continue
      }

      if (name === 'note') {
        note += 1
        const label = rest === '' ? String.fromCharCode(96 + note) : rest
        out.push(
          `<aside class="note" id="note-${escapeHtml(label)}">` +
            `<span class="note-label" aria-hidden="true">${escapeHtml(label)}</span>` +
            renderMarkdown(body.join('\n'), env).html +
            `</aside>`,
        )
        continue
      }

      if (name === 'code') {
        const [path, ...pairs] = rest.split(/\s+/)
        out.push(env.code(path ?? '', Object.fromEntries(pairs.map((pair) => pair.split('=')))))
        continue
      }

      if (name === 'raw') {
        out.push(body.join('\n'))
        continue
      }

      throw new Error(`unknown directive ::: ${name} in ${env.sourcePath ?? 'markdown'}`)
    }

    // ── a heading ───────────────────────────────────────────────────────────
    const heading = /^(#{1,4}) +(.*)$/.exec(line)
    if (heading !== null) {
      const level = heading[1].length
      const text = heading[2].trim()
      const id = uniqueId(text)
      at += 1
      // The page's own `<h1>` is rendered by the layout from the page record, so the first one in
      // a source file is the title and is not repeated in the flow. A page with no title block --
      // the front page, whose `<h1>` IS the manifesto -- keeps it.
      if (level === 1 && !sawTitle) {
        sawTitle = true
        if (env.dropTitle !== false) {
          headings.push({ level: 1, id, text, number: '' })
          continue
        }
      }
      if (level === 2) section += 1
      headings.push({ level, id, text, number: level === 2 ? pad(section) : '' })
      const tag = `h${level}`
      out.push(
        `<${tag} id="${id}" class="heading h${level}">` +
          `<a class="heading-anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>` +
          `<span class="heading-text">${inline(text, env)}</span>` +
          `</${tag}>`,
      )
      continue
    }

    // ── a table ─────────────────────────────────────────────────────────────
    if (line.trimStart().startsWith('|') && /^\|[\s:|-]+\|$/.test((lines[at + 1] ?? '').trim())) {
      const head = tableCells(line)
      const align = tableCells(lines[at + 1]).map(alignmentOf)
      at += 2
      const rows = []
      while (at < lines.length && lines[at].trimStart().startsWith('|')) {
        rows.push(tableCells(lines[at]))
        at += 1
      }
      const cell = (text, index, tag) => {
        const style = align[index] === undefined || align[index] === '' ? '' : ` style="text-align:${align[index]}"`
        return `<${tag}${style}>${inline(text, env)}</${tag}>`
      }
      out.push(
        `<div class="table-wrap"><table>` +
          `<thead><tr>${head.map((text, index) => cell(text, index, 'th')).join('')}</tr></thead>` +
          `<tbody>${rows
            .map((row) => `<tr>${row.map((text, index) => cell(text, index, 'td')).join('')}</tr>`)
            .join('')}</tbody>` +
          `</table></div>`,
      )
      continue
    }

    // ── a list ──────────────────────────────────────────────────────────────
    const kind = listKind(line)
    if (kind !== null) {
      const items = []
      let current = null
      while (at < lines.length) {
        const entry = lines[at]
        if (isBlank(entry)) {
          // A blank line continues the list only when what follows is an indented
          // continuation of the item above rather than a new block.
          const next = lines[at + 1]
          if (next !== undefined && /^ {2,}\S/.test(next) && listKind(next.trim()) === null) {
            current?.push('')
            at += 1
            continue
          }
          break
        }
        const item = kind === 'ul' ? /^[-*] (.*)$/.exec(entry) : /^\d+\. (.*)$/.exec(entry)
        if (item !== null) {
          current = [item[1]]
          items.push(current)
          at += 1
          continue
        }
        if (/^ {2,}\S/.test(entry) && current !== null) {
          current.push(entry.replace(/^ {1,4}/, ''))
          at += 1
          continue
        }
        break
      }
      const rendered = items
        .map((item) => {
          const paragraphs = item
            .join('\n')
            .split(/\n\s*\n/)
            .map((part) => `<p>${inline(part.replace(/\n/g, ' ').trim(), env)}</p>`)
            .join('')
          return `<li>${paragraphs}</li>`
        })
        .join('')
      out.push(`<${kind} class="list">${rendered}</${kind}>`)
      continue
    }

    // ── a paragraph ─────────────────────────────────────────────────────────
    const paragraph = []
    while (at < lines.length && !isBlank(lines[at]) && !/^```/.test(lines[at]) && !/^::: /.test(lines[at])) {
      if (/^#{1,4} /.test(lines[at]) || listKind(lines[at]) !== null) break
      if (lines[at].trimStart().startsWith('|')) break
      paragraph.push(lines[at].trim())
      at += 1
    }
    if (paragraph.length === 0) {
      // Nothing above claimed this line; step over it rather than looping forever.
      paragraph.push(lines[at].trim())
      at += 1
    }
    out.push(`<p>${inline(paragraph.join(' '), env)}</p>`)
  }

  return { html: out.join('\n'), headings }
}

/**
 * Read a file for a `::: code` directive.
 *
 * The `lines` attribute takes `12-40`, `12-` for the rest of the file, or `12` for one line, and
 * the numbers are the file's own — so a sample can quote a range and the reader can find it in the
 * file the page links to.
 *
 * @param root - the repository root.
 * @param path - the path, relative to the root.
 * @param attributes - the directive's attributes.
 * @returns the framed sample.
 */
export function readCode(root, path, attributes) {
  const text = readFileSync(resolve(root, path), 'utf8').replace(/\r\n?/g, '\n')
  const range = attributes.lines
  let body = text
  if (range !== undefined) {
    const [from, to] = range.split('-')
    const start = Number(from)
    const end = to === '' || to === undefined ? undefined : Number(to)
    body = text.split('\n').slice(start - 1, end).join('\n')
  }
  return codeFigure(body.replace(/\n+$/, ''), attributes.lang ?? inferLanguage(path), attributes.label ?? path)
}

/** The fence language a file's extension implies. */
function inferLanguage(path) {
  if (/\.(ts|tsx)$/.test(path)) return path.endsWith('x') ? 'tsx' : 'ts'
  if (/\.(mjs|cjs|js)$/.test(path)) return 'js'
  if (/\.css$/.test(path)) return 'css'
  if (/\.json$/.test(path)) return 'json'
  if (/\.md$/.test(path)) return 'md'
  return 'sh'
}
