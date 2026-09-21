// ─── the demo's entry point ─────────────────────────────────────────────────
//
// React 19's `createRoot`, one component, and the page's own stylesheet. The
// library's stylesheet is not imported here: the editor injects it when the first
// editor is constructed, which is what makes the library usable without a CSS
// loader — and it is why `demo.css` can override a custom property and nothing
// else.

import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './demo.css'

const host = document.getElementById('root')
if (host === null) throw new Error('the demo needs a #root element')

// No StrictMode on purpose. Development StrictMode mounts, unmounts, and mounts
// again — which for an editor means the textarea holding the browser's undo
// history is thrown away and rebuilt, and the one thing this demo is about would
// be the first thing the demo broke.
createRoot(host).render(<App />)
