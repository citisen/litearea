// ─── one command for the site in development ────────────────────────────────
//
// Two processes are needed and neither is optional: the generator renders the markdown into
// HTML, and Vite serves that HTML with the stylesheet and the script it links. They are started
// together so that `npm run site` is one thing to remember, and both write to this terminal.
//
// The generator watches, so editing a page's prose or one of the repository's reference files
// rewrites the HTML and Vite reloads the browser. Editing the stylesheet or a client module is
// Vite's own hot path and does not go through the generator at all.

import { spawn } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(HERE)

/** One child, with its output going straight to this terminal. */
function run(command, args) {
  // Inherited stdio, deliberately: a piped child would have to be drained, and a build tool's
  // colours and progress belong to the terminal that started it. No shell either — both children
  // are Node itself, and a shell would only add a quoting layer between this file and them.
  const child = spawn(command, args, { cwd: ROOT, stdio: 'inherit' })
  child.on('exit', (code) => {
    // Either half going away ends the session: a site with no server, or a server with stale
    // HTML, is worse than no site at all.
    process.exit(code ?? 0)
  })
  return child
}

const build = run(process.execPath, [fileURLToPath(new URL('build.mjs', import.meta.url)), '--watch'])
const vite = run(process.execPath, [
  fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)),
  '--config',
  fileURLToPath(new URL('vite.config.ts', import.meta.url)),
])

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    build.kill()
    vite.kill()
    process.exit(0)
  })
}
