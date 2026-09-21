import { defineConfig } from 'vitest/config'

/**
 * Tests run in Node by default, because the engine is pure — the tokenizer, the
 * diagnostics, and the completion are functions of text and a grammar, and a DOM
 * would only hide that.
 *
 * The files under `test/dom/` opt into happy-dom with a
 * `// @vitest-environment happy-dom` docblock of their own. What a *real* browser
 * does — undo, redo, and textarea selection — is not testable here at any
 * fidelity, and is asserted by `scripts/browser-check.mjs` instead.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['src/grammars/**'],
    },
  },
})
