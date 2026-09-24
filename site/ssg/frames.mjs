// ─── the one frame a live editor is shown in ────────────────────────────────
//
// A live example appears in two places — in the flow of an article, and pinned in the specimen
// column beside it — and both are the same object at two sizes: a labelled well, a bar above it,
// and a readout below. The markup is built here rather than in the client so that a page without
// JavaScript still shows the frame, its label, and a sentence saying what it would have been.

/** Escape text for HTML. */
export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
}

/**
 * One frame.
 *
 * @param kind - `live` in the flow, `specimen` beside it: the two differ only in position.
 * @param id - the example's id, which is what the client looks up in its registry.
 * @param label - what the bar says. Defaults to the id.
 * @param controls - the named controls the example wants.
 * @param attributes - extra attributes for the element.
 * @returns the frame's HTML.
 */
export function frame(kind, id, label, controls, attributes = '') {
  const name = label === undefined || label === '' ? id : label
  const controlAttribute =
    controls === undefined || controls.length === 0 ? '' : ` data-controls="${escapeHtml(controls.join(' '))}"`
  return (
    `<figure class="${kind}" data-${kind}="${escapeHtml(id)}"${attributes}>` +
    `<figcaption class="live-bar"><span class="live-name">${escapeHtml(name)}</span>` +
    `<span class="live-controls"${controlAttribute}></span></figcaption>` +
    `<div class="live-body" data-body></div>` +
    `<p class="live-foot" data-readout></p>` +
    `<noscript class="live-noscript">This is a real editor rather than a picture of one, and it needs JavaScript.</noscript>` +
    `</figure>`
  )
}

/**
 * The frame an in-flow `::: live` directive becomes.
 *
 * It is the same frame as the specimen's, which is the point: an example's markup does not change
 * when the page decides to pin it beside the prose instead of leaving it in the flow.
 *
 * @param id - the example's id.
 * @param label - what the bar says.
 * @param controls - the named controls the example wants.
 * @param attributes - extra attributes for the element.
 * @returns the frame's HTML.
 */
export function liveFrame(id, label, controls, attributes = '') {
  return frame('live', id, label, controls, attributes)
}
