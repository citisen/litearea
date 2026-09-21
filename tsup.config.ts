import { defineConfig } from 'tsup'

/**
 * The JavaScript build: three entries, dual ESM/CJS.
 *
 * `styles` is its own entry so `scripts/build-css.mjs` can read the stylesheet back
 * out of the built ESM and emit `dist/styles.css` — one source of truth for the CSS,
 * usable either as a string at runtime or as a plain stylesheet.
 *
 * Types are NOT built here. tsup's declaration bundler embeds a `rollup-plugin-dts`
 * that predates TypeScript 7's compiler API, so it cannot run against the compiler
 * this package is checked with. `npm run build` therefore follows this with
 * `tsc -p tsconfig.build.json`, which emits `dist/types/` — a mirrored tree rather
 * than one bundled file, which the `exports` map accounts for.
 *
 * React is external, never bundled: the core must stay dependency-free, and the React
 * binding must use the application's own React instance.
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    react: 'src/react/index.tsx',
    styles: 'src/styles.ts',
  },
  outDir: 'dist',
  format: ['esm', 'cjs'],
  target: 'es2022',
  dts: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  external: ['react'],
})
