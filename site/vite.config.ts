import { readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// ─── the site's bundler ─────────────────────────────────────────────────────
//
// The content is already HTML when Vite sees it: `site/build.mjs` writes `site/pages/**`, and
// this configuration only bundles the one stylesheet and the one script those pages link. There
// is no framework in the loop deciding what a page is, which is the whole reason the site does
// not look like the sites a framework makes.
//
// Two things are worth knowing about the shape of it:
//
//   - The root is `site/pages`, so a page's filename is its URL and `npm run site` serves the
//     site at `/` -- the same paths GitHub Pages will serve from `/litearea/`.
//   - `base` follows the command rather than the file. A build is served from the project page
//     `citisen.github.io/litearea`, and development is served from the root of a local server,
//     so the two need different prefixes and the same source.

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url))
const ROOT = here('.')

/**
 * Every generated page, as a Rollup input.
 *
 * It is discovered rather than listed: the page set is already declared once, in
 * `ssg/pages.mjs`, and a second list here would be a second thing to keep in step.
 *
 * @param directory - where to look.
 * @returns one entry per HTML file, keyed by its path with the separators folded.
 */
function htmlInputs(directory: string): Record<string, string> {
  const inputs: Record<string, string> = {}
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'assets' || entry.name === 'public') continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      Object.assign(inputs, htmlInputs(path))
      continue
    }
    if (!entry.name.endsWith('.html')) continue
    const key = relative(ROOT, path).split(sep).join('_').replace(/\.html$/, '') || 'index'
    inputs[key] = path
  }
  return inputs
}

export default defineConfig(({ command, isPreview }) => ({
  root: here('pages'),
  // The base follows what the server is FOR rather than whether it is a build. A build and a
  // preview of that build are both served from the project page, and `preview` reports itself as
  // `command: 'serve'` — so asking only about the command would serve the built site from the
  // root of the preview server and 404 every absolute url in it.
  base: command === 'build' || isPreview ? '/litearea/' : '/',
  // A multi-page application, and saying so is not a detail: the default is a single-page app,
  // whose server answers every unknown path with the root `index.html`. Under that default
  // `vite preview` serves the front page for `/docs/grammar/` — a site that looks like it works
  // and has one page in it. In `mpa` mode the requested file is the answer, and a path that is
  // not a file is a 404, which is also what GitHub Pages does.
  appType: 'mpa',
  // The two font files. They are copied as they stand rather than hashed through the bundler,
  // because a font is fetched by a `url()` in a stylesheet and Vite rewrites a public url with
  // the deployment's base path — which is what makes one stylesheet work from `/` in
  // development and from `/litearea/` on Pages.
  publicDir: here('pages/public'),
  resolve: {
    alias: {
      // The subpath is declared BEFORE the bare name: Vite walks the list in order and the
      // bare name is a prefix of its own subpath, so the other order would resolve
      // `@citisen/litearea/react` to `src/index.ts/react`.
      '@citisen/litearea/react': here('../src/react/index.tsx'),
      '@citisen/litearea': here('../src/index.ts'),
    },
  },
  server: {
    port: 5178,
    strictPort: true,
    // The pages import the library and the demo grammars from outside the Vite root, and the
    // served filesystem is the repository rather than the site directory.
    fs: { allow: [here('../..')] },
  },
  preview: { port: 5179, strictPort: true },
  build: {
    outDir: here('dist'),
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
    rollupOptions: { input: htmlInputs(here('pages')) },
  },
}))
