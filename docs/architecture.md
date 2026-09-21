# Architecture

Why litearea is shaped the way it is. The README says what it does; this says what
each decision costs and what it was chosen over, because most of them are only
obvious once you have watched the alternative fail.

The tree the editor builds:

```
div.litearea            ← the positioning container, and editor.element
  div.litearea-box      ← the border, the radius, and the focus ring
    div.litearea-layer  ← the painted text, behind and inert
    textarea            ← the real field: transparent text, visible caret
  div.litearea-popup    ← the completion list
  div.litearea-tooltip  ← the hover tooltip
```

The layer is inside the box while the two floating elements are outside it,
because the box clips nothing and a list that had to fit inside a rounded border
would be cut off at the bottom.

## The one-parse rule

`inspect(text, grammar)` produces the tokens, the diagnostics, the decorations, and
the analysis together, as one value. Everything downstream reads that value and
nothing re-derives it:

| Reader | What it takes from the inspection |
| --- | --- |
| The layer | `tokens`, `decorations`, `diagnostics` and the text |
| The completion list | `tokens`, `diagnostics`, `state`, and the document text |
| The tooltip | `tokens`, `diagnostics`, `decorations`, `state` |
| `onDiagnostics` | `diagnostics` |
| `onAccept` | `state` |

The editor caches it on the text: `sync()` re-inspects only when
`input.value` differs from the text the last inspection was computed from, so
moving the caret, scrolling, or hovering costs nothing beyond the paint. The paint
itself carries a key — the revision, whether decorations are painted, and the
decoration and diagnostic counts — and `Overlay.render` returns immediately when
both the text and the key match the last call. That is what keeps a caret move
from rebuilding every span on the page.

The failure this prevents is not abstract. The editors this library replaces
re-derived the tokens, the parse, and the suggestions separately, from the same
string, in three places, and the three drifted: a word could be painted as a valid
value while the completer thought it was unknown, and a diagnostic pointed at a
range that had already moved. Those were not three bugs to fix one at a time; they
were one missing value. The completion list and the coloured text cannot disagree
here, because there is only one answer to disagree with.

The same idea reaches into the DOM layer: `buildSegments` takes the three range
lists and produces one stream, `complete` takes an inspection and produces rows,
and `resolveHover` takes an inspection and produces a tooltip. None of them read
the document again.

## Why the textarea is uncontrolled

A textarea owns its own undo stack, and that stack is maintained by the browser's
editing pipeline — not by the `value` property. Assigning `field.value` replaces
the text and destroys the history, and it resets the caret to the end. So the
editor never writes `value` for an edit the user could have made:

```ts
field.setSelectionRange(from, to)
document.execCommand('insertText', false, text)   // ← undoable
```

Three details in that path are all load-bearing:

- **The field is focused first**, because the pipeline only runs on the focused
  element, and a completion accepted by mouse click arrives after the click has
  blurred the field.
- **The return value is not trusted.** It differs across browsers and does not
  need to be trusted: the *value* decides. A change the editor did not make
  itself is a change the browser's history already knows about, which is the whole
  point, so `field.value !== before` is what tells the two paths apart.
- **Only the changed range is written.** A completion writes `insert` over
  `[from, to)` and then moves the selection with `setSelectionRange`, which
  touches no text and cannot disturb the history.

`execCommand` is deprecated and there is no replacement, and that is not an
oversight anyone can route around. A synthetic `beforeinput` or `InputEvent` is
untrusted, so the browser refuses to run it through the editing pipeline, and
`setRangeText` is the standard API that changes the text while bypassing the
history entirely. Every editor that supports undo on a textarea uses this call.

Where it is missing, the edit still happens: `replaceThroughPipeline` falls back
to `setRangeText`, dispatches the `input` event the browser would have dispatched,
and returns `'direct'` instead of `'pipeline'`. The caller is told plainly that the
history did not get the edit, so a host can decide whether that matters.
`canEditThroughPipeline()` reports which environment you are in, `EditOutcome` is
`'pipeline' | 'direct' | 'unchanged'`, and `setValue(next, preserveHistory)` is the
one place that assigns `value` outright — for loading a different document, where
clearing the history is the right answer rather than a casualty.

`undoField` and `redoField` are thin wrappers over `execCommand('undo'/'redo')`.
They report only whether the call was possible, never whether anything was
actually undone, because no browser exposes that.

## Layer alignment

The painted layer draws the same characters as the field, behind it and inert
(`aria-hidden`, `pointer-events: none`, `user-select: none`), and the field's own
text is transparent with a visible caret. Two elements showing one document is
only stable if they cannot disagree about where a glyph goes, so:

**One typography, shared.** `.litearea-layer` and `.litearea-input` share a single
rule, and the mirror copies the same computed properties. Adding a text property
to one of them and not the other is the only way to break the stylesheet.

**The layer may change three things.** Colour, background, and `text-decoration`.
Anything that changes an advance — another font, a weight, letter spacing, a font
feature — slides the paint off the character it belongs to, and it does so by a
different amount on every character, which reads as a rendering glitch rather than
as a styling mistake. That is why the box declares one monospace face and refuses
ligatures: a ligature draws one glyph in the layer where the field draws two, so
every character after it would be painted in the wrong place.

**The scrollbar is compensated, not ignored.** When the box is clamped to its
maximum height the field grows a scrollbar, and a scrollbar narrows the text. If
the layer kept the full width it would wrap differently from the field and every
colour would slide off its character. So the field's measured scrollbar width is
published as `--litearea-scrollbar` and added to the layer's own right padding —
and it is read *after* the overflow is applied, because that is when a scrollbar
exists and therefore when there is a width to report.

**Wrapping is not maintained by positioning.** `buildSegments` collects every
range boundary — every token edge, decoration edge, and diagnostic edge — as a
cut point, then emits one segment per interval, merging neighbours whose
presentation is identical. The renderer appends those spans back to back with no
positioning at all: the characters lay out where the characters lay out, and the
colours follow. Alignment stops being something the code maintains and becomes
something the layout cannot get wrong. The traditional alternative is three
overlay layers, one per range list, and it does not work — each would need its own
idea of where a range starts, and a span positioned by measuring drifts the moment
the font, the wrapping, or the padding differs even slightly from what was
measured.

One segment shows one squiggle: the loudest diagnostic covering it wins, because
two underlines on the same characters only make a messier line. The layer is also
scrolled by copying the field's `scrollTop`/`scrollLeft` rather than by a
transform, which is more reliable than a transform that can leave text on a half
pixel.

## The mirror

Two measurements are needed and the field cannot supply either:

- **How tall the content is.** A textarea can report `scrollHeight`, but not
  while its own height is being changed: asking for it means collapsing the
  element first, which reflows the page and makes the box flicker on every
  keystroke.
- **Where the caret is.** A textarea has no API for it at all.

So a second element is kept offscreen with the field's exact typography and box,
and the question is asked of it. One mirror, not two, because both jobs are
measurements of text with the same copied styles and both are wrong in the same
way if a single property is missed. It uses `visibility: hidden` rather than
`display: none`, because a hidden element still lays out and a removed one does
not.

**The property list is deliberately exhaustive**, not "the ones that seemed to
matter": font family, size, weight, style, stretch, variant ligatures, kerning,
feature settings, line height, letter spacing, word spacing, text transform,
indent, align, direction, tab size, white space, overflow wrap, word break,
hyphens, padding, border widths and styles, and box sizing. A missing
`letter-spacing` moves the caret a fraction of a character per character, so the
popup drifts further off the longer the line is — a bug that looks like a
placement problem and is a copied-style problem.

The width is the interesting part. It has to be the field's **content** width or
text wraps in one and not the other, and the field's `clientWidth` is its content
plus padding but *not* its border, while the mirror is `border-box`. So the
borders are added back, and the scrollbar is deliberately left out: a field
clamped to its maximum height has one, and its text wraps inside the narrower area
above it.

**The line height is measured, not assumed.** `line-height: normal` is a real and
common value and cannot be parsed as a number, so one line of text is laid out and
its height taken; a font that reports nothing usable falls back to 1.2 × the font
size.

**The trailing-newline sentinel.** A `white-space: pre-wrap` element whose content
ends in `\n` does not lay out a final empty line — the newline breaks the line and
nothing follows it — so the measured height comes back one line short, and the box
grows a scrollbar exactly when the user presses Enter at the end. A zero-width
space after the newline gives that last line something to be.

**The caret marker technique.** To find the caret, the mirror is rebuilt with the
text before the caret as a text node, the character *after* the caret inside a
`white-space: pre` span, and the rest after it. Everything before the caret lays
out normally, so the marker lands exactly where the next glyph will be, which is
where the caret is. A span that could wrap would let the marker jump to the next
line on its own, which is exactly the wrong answer at a line end. At the end of the
document a zero-width space stands in for the next character. The field's own
scroll offsets are then subtracted, because the caret's position on screen is what
the popup is placed against, and a scrolled field moves its text without moving
its border box. The mirror is rebuilt rather than patched: it is offscreen, so
measuring it is cheap, while keeping incremental DOM in step with a fast typist is
not.

**The unmounted trap.** An element that is not in the document has no layout, so
its width is zero, the mirror wraps at every character, and the measurement comes
back several times too tall. That wrong height then has to be corrected on the
next keystroke, which is what a box that jumps on first focus actually is. So an
unmounted field is skipped rather than measured (`!isConnected || clientWidth ===
0`), a `ResizeObserver` installed at construction performs the first real
measurement as soon as there is a width to measure against, and `createEditor`
re-measures synchronously after mounting so that the very first frame is already
right. A web font arriving later changes every metric the mirror copied, so
`document.fonts.ready` triggers one refresh when it lands — without it the editor
is a few pixels off until something else causes a re-layout.

## Auto-sizing

The decision procedure, in the order it runs:

1. With `autoGrow: false`, only adopt the mirror and return. Caret geometry still
   needs the mirror to be shaped like the field even when the height is the host's
   business; the stylesheet gives the field `resize: vertical`.
2. `chrome` is the vertical padding plus the vertical borders, which every height
   includes; `lineHeight` comes from the mirror.
3. `minPx = max(minHeight ?? 0, lineHeight × minRows + chrome)` — the floor is
   whichever of the two is larger.
4. `maxCandidate = min(maxHeight ?? ∞, maxRows ? lineHeight × maxRows + chrome : ∞)`,
   then `maxPx = max(maxCandidate, minPx)`. A maximum below the minimum is a host
   mistake, and honouring it would make the box smaller than the host was told it
   could be.
5. `content = mirror.contentHeight(field, text)` — the height the text wants with
   the full width available, and no scrollbar to narrow it.
6. `wanted = clamp(max(content, minPx), minPx, maxPx)`; `overflow` becomes `'auto'`
   when the content exceeds what was granted by more than half a pixel, and
   `'hidden'` otherwise.
7. Write the height only when it moved by more than half a pixel, write
   `overflow-y` only when it changed, and then read the scrollbar width (now that
   one may exist) and publish it.

The mirror has no scrollbar, which is what makes step 5 the number that decides
whether a scrollbar is needed at all. That is also why **wrapping has to agree
with the layer**: the decision to clamp is a claim that the text fits in the width
the layer will be given, so the width the mirror measures at, the width the field
wraps at, and the width the layer wraps at are the same width — including the
scrollbar compensation above. `minRows` is additionally written to the textarea's
native `rows` attribute, so the box has the right height on the very first frame,
before any measurement, and in a document where the script never runs at all.

## Pure engine, thin DOM

`src/core/` imports nothing from `src/dom/`, and nothing in it touches the DOM. Text
and a grammar go in, values come out:

| Testable in plain Node | Needs a browser |
| --- | --- |
| `scan` / `inspect`: the paint, the diagnostics, the decorations, the analysis | Whether an edit is undoable |
| `complete` / `applyCompletion`: eligibility, source stability, the recomputed range, ranking, the edit | Where the caret ends up after an edit |
| `rank`, `fuzzyMatch`, `highlightSegments` | Whether the layer and the field really line up |
| `buildSegments`: the merge order | Whether the box has a scrollbar |
| `resolveHover` and the precedence | Anything about font metrics, wrapping, or scrollbar widths |
| `defineVocabulary`, `lineStarts`, `wordInfoAt`, `tokenAt` | |

Everything in the left column has a decision in it, and a decision is what a unit
test asserts. Everything in the right column is a fact about a renderer. The four
of them are exactly why `scripts/browser-check.mjs` exists: a textarea's undo
stack has no API to read and no way to fake, so the only honest test is to make an
edit and undo it in a browser that has a real one.

The harness bundles the **shipped** `dist/` files rather than `src/` — so what it
drives is the artifact a host installs — inlines them as an IIFE (Chromium refuses
to fetch an ES module from a `file://` URL), and drives the public API and the
public DOM only: it mounts editors, types through `execCommand('insertText')`,
presses keys, dispatches a `mousedown` on a row, and hovers a squiggle. The page
reports through `document.title`, with `error` and `unhandledrejection` listeners
that write to the same channel, because a page whose only output channel is its
title has to report its own failures through that channel — otherwise a syntax
error in the bundle shows up as an unchanged title and no evidence at all. The
browser's stdout is written to files rather than read through a pipe, because a
browser's stdout cannot be captured through piped stdio in a confined environment
and comes back empty in a way that looks exactly like the page having produced no
output.

The part of that harness worth copying is the **negative control**. Before it
tests that a completion can be undone, it asserts that a direct `value` assignment
is **not** undoable:

```js
control.value = 'abc'
control.focus()
control.value = 'abcd'
document.execCommand('undo')
// control.value must still be 'abcd'
```

Without it, a passing undo test would only show that `execCommand('undo')` returned
true. The check skips cleanly, with exit 0, when no Chromium-based browser is
present, so a clean CI runner does not fail for it; `LITEAREA_REQUIRE=1` turns the
skip into a failure for the environments that must not skip.

The DOM layer itself is deliberately thin: `LiteArea` is the only class that holds
state, and every other module in `src/dom/` is one job — `editing` the
undo-preserving write, `mirror` the measurement, `overlay` the paint, `popup` the
list, `tooltip` the hover, `support` the one place that asks the environment a
question. `createEditor(target, options)` is the class plus "append it and measure
again", which is all most hosts need.

## What was rejected

| Rejected | Why |
| --- | --- |
| A controlled component (state → `value` → re-render) | This is the bug the library exists to fix: assigning `value` clears the undo history and resets the caret, and re-rendering text to reposition the caret is a race the browser wins. A grammar worth writing is worth keeping the browser's undo stack for |
| `contenteditable` | It makes the document a DOM tree that the browser edits in ways you do not control — nested elements, `<br>` for a blank line, pasted HTML — so the value would have to be re-serialised on every keystroke, which is the same re-render problem with more failure modes and no native undo semantics worth having |
| A second highlighting layer per range list (one for scopes, one for decorations, one for squiggles) | Each layer would have to position its own spans, so each would need its own idea of where a range starts, and a span positioned by measuring drifts as soon as the font, the wrapping, or the padding is even slightly different from what was measured. One merged stream cannot drift because nothing is positioned |
| Measuring the live field (`scrollHeight` after collapsing it) | It reflows the page and flickers on every keystroke — the measurement that is supposed to decide the height is what makes the height unstable. The offscreen mirror pays one extra layout and keeps the field's geometry out of the question |
| A bundled grammar (a default language, or a language registry) | The claim of the library is that the core knows no syntax. A default grammar would make that claim false, and it would be the thing every host inherited. The two reference grammars are importable and deliberately outside `src/core/` |
| Synthetic `beforeinput`/`InputEvent` edits | Untrusted, so the browser will not run them through the editing pipeline: the text changes and the history does not, which is worse than a documented `'direct'` fallback because it fails silently |
| Tracking the caret as a character index in one module and a screen position in another | Every position that crosses a module boundary is a character offset; pixels enter only in `src/dom/`, only to place a floating element, and never travel back inward. Two coordinate systems for one caret is what produced the range that "had already moved" |
