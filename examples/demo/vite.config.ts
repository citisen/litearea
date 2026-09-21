import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// `root` is the demo directory itself, so `vite build --config examples/demo/vite.config.ts`
// treats this file's neighbours as the app and writes `examples/demo/dist`.
//
// The alias points at `src/` rather than at `dist/`, so the demo runs against the
// source and needs no prior `npm run build`. The subpath is declared before the bare
// package name: Vite walks the alias list in order, and the bare name is a prefix of
// its own subpaths, so a careless order would resolve `@citisen/litearea/react` to
// `src/index.ts/react`.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: {
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
