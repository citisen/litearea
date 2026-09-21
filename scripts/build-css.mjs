/**
 * Write the stylesheet out as a plain CSS file.
 *
 * The CSS is authored once, as a string in `src/styles.ts`, so that an editor can
 * inject it with no CSS loader and no build step. A host that would rather link a
 * file needs it as a file, and the alternative — a second copy maintained by hand —
 * is a stylesheet that drifts from the one that is actually used. So the built ESM
 * module is imported and its string is written here.
 *
 * Usage:
 *   node scripts/build-css.mjs
 */

import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const built = join(root, 'dist', 'styles.js')

if (!existsSync(built)) {
  console.error('build-css: dist/styles.js is missing; run `npm run build` first')
  process.exit(1)
}

const { LITEAREA_STYLES } = await import(pathToFileURL(built).href)

if (typeof LITEAREA_STYLES !== 'string' || LITEAREA_STYLES.trim() === '') {
  console.error('build-css: dist/styles.js did not export a stylesheet')
  process.exit(1)
}

const target = join(root, 'dist', 'styles.css')
writeFileSync(target, `${LITEAREA_STYLES.trimEnd()}\n`, 'utf8')
console.log(`build-css: wrote ${String(LITEAREA_STYLES.length)} characters to dist/styles.css`)
