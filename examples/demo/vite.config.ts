import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// `root` is the demo directory itself, so `vite build --config examples/demo/vite.config.ts`
// treats this file's neighbours as the app and writes `examples/demo/dist`.
//
// The alias points at `src/` rather than at `dist/`, so the demo runs against the
// source and needs no prior `npm run build`. The two entries are declared
// longest-first: Vite walks the alias list in order, and the bare package name is a
// prefix of the subpath, so a careless order makes `@citisen/litearea/grammars`
// resolve to `src/index.ts/grammars`.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: {
      '@citisen/litearea/grammars': fileURLToPath(
        new URL('../../src/grammars/index.ts', import.meta.url),
      ),
      '@citisen/litearea/react': fileURLToPath(new URL('../../src/react/index.tsx', import.meta.url)),
      '@citisen/litearea': fileURLToPath(new URL('../../src/index.ts', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
})
