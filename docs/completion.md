# Completion reference

How a caret becomes a list, and how a list becomes an edit. Two pure functions do
the work and the editor only drives them:

```ts
complete(inspection, grammar, request): Completion | undefined
applyCompletion(text, range, item): AppliedCompletion
```

They are separate because they fail differently. `complete` answers "what could go
here?" and returns rows; `applyCompletion` answers "what does the document
become?" and returns text plus a caret. Keeping them apart is what makes the hard
half — the interaction — testable in Node without a browser, and it is where the
two bugs that make a completer feel broken have somewhere to live:

- **A source that swaps mid-typing loses the thread.** The list opens over a family
  name, the user types `=` and it becomes a value list, and the row they were
  looking at is gone. So once a source has answered, it keeps answering for as long
  as it stays eligible, and priority only decides which source *opens* the list.
- **A range that does not grow leaves text behind.** The range is recomputed from
  the caret on every filter, never held over: type `ru`, accept `running`, and the
  range has to cover both letters. An earlier version of this library held the range
  resolved when the list opened, which replaces only the `r` and leaves `running u`
  behind — a bug invisible to a test that only ever types one character before
  accepting, and the reason this rule is written down here.
- **A caret computed from the wrong end lands in the wrong place.** Every offset
  here is counted in the same coordinate system as the document, and the final
  caret is computed from the pieces actually written, never re-derived by
  searching the result.

## How the editor decides to open the list

| Event | What happens |
| --- | --- |
| A word character is typed | The list opens, in `'auto'` mode. The predicate is the grammar's `wordChars` |
| A character typed through `triggerCharacters` | Also opens it, in `'auto'` mode. **Empty by default**, so a separator does not open the list — see below |
| More characters are typed while the list is open | Re-resolved: the same source answers again if it is still eligible, the range is recomputed from the caret, and the rows are re-filtered |
| A character is deleted while the list is open | Re-filtered. A backspace with no list open opens nothing, because a deletion is not a request for suggestions |
| `Ctrl+Space` / `Cmd+Space` | Opens with no needle (`'explicit'`), or closes the list when it is already open |
| A row's commit character is typed | The row is accepted and the character is written after it. The list then closes, and whatever is typed next is an ordinary `'auto'` trigger |
| `Escape` | Closes the list. With no list open it hides the tooltip instead |
| The caret walks out of the range the list last resolved | Closes the list. A caret move raises no `input` event, so the range is not recomputed for it |
| An IME composition starts | The list closes and no completion runs until the composition ends |
| The editor itself is writing | Nothing re-opens: the editor knows its own edit from the user's |
| Any `input` event while `readOnly` | Nothing |

`triggerCharacters` is empty by default, so a separator does not open the list. A
space is where the next token starts, which is the argument for opening there,
and it loses to the habit a reader already has: the editor this is modelled on
offers nothing on a space and waits for a letter or for `Ctrl+Space`. Nothing is
stranded by it — the list stays open while the next token is typed, so a value
after a name is still suggested in place — and a language whose separator really
is the moment the next token becomes guessable names it explicitly.

`auto: false` (or `completion: false` on the editor) switches off every row above
except `Ctrl+Space`, `Escape`, and the arrows; `showCompletions()` and
`hideCompletions()` drive the same open and close by hand, and `currentCompletion`
reads what is on screen.

## The request

| `CompletionRequest` field | Notes |
| --- | --- |
| `text` | The document. It is passed rather than taken from the inspection so the two can never disagree about which version is being completed |
| `caret` | The caret offset; clamped into the text |
| `trigger` | `'auto'` (a keystroke) or `'explicit'` (the user asked). There is no `'commit'`: a commit character accepts the row and closes the list |
| `previousSourceId` | The source that answered last time, when a list is already open. The same source answers again while it stays eligible; the range is not part of it |
| `limit` | The most rows to return. Default 100 |

## The source

| `CompletionSource` field | Notes |
| --- | --- |
| `id` | Required and stable. It is how a re-open finds the same source again, and what the host sees in `Completion.sourceId` |
| `when` | Eligible only when this holds. Absent, always eligible |
| `range` | The range a chosen row replaces: a `Range` or `(context) => Range`. A function's result is normalised so `from <= to` |
| `items` | `(context) => readonly SuggestionItem[]` — the rows, in whatever order the grammar wants them scored |
| `priority` | Higher wins when several sources could open the list. Default 0, and ties go to the source declared first |
| `merge` | Adds this source's rows to the winner's instead of competing with it |

Several sources may be declared, and **priority only decides which one opens the
list**. Once a source has answered, it is the one asked again while the list is
open, for as long as its `when` still holds; only when it stops being eligible does
the list fall back to the highest-priority eligible source. That is what keeps the
rows from changing identity under the reader's hands — typing a character that makes
a different source eligible does not swap the list out from under them.

Rows from a source that sets `merge: true` are appended to the winner's rows, which
is how a document-wide source (every property already used elsewhere) sits alongside
a closed vocabulary without having to win anything.

The range is a separate question, and it is answered fresh on every call:

```ts
// The range is recomputed from the caret on every filter. Never reused.
//   1. the caret sits at the end of `ru`, and the source's range is the word `ru`
//   2. the list offers `running` and the user accepts it
//   3. the range covers both letters, so the entry becomes `running`
//
// A range held over from the keystroke that OPENED the list would cover only the
// `r` and leave `running u` behind. That was this library's first design, and it
// was wrong: the range has to describe the text the rows are being matched
// against now, not the text that happened to be there when the list appeared.
```

The winner's `range` — a `Range`, or a `(context) => Range` whose result is
normalised so `from <= to` — is therefore resolved on every call, and only the
winner's is resolved at all, so two sources cannot disagree about it. A word-shaped
range grows with the word and an entry-shaped range grows with the entry.

The needle is the text the user has typed *inside* that range, clamped to the range
at both ends — `text.slice(clamp(range.from, 0, caret), clamp(caret, range.from,
range.to))`. Clamping the far end matters: a caret can sit past the range, after the
trailing space of an entry, and slicing straight to the caret there would pull the
separator into the needle and filter the list by a character nobody meant to search
for. Reading the needle inside the range is also the only reading that stays
meaningful when the range is a whole entry rather than a word.

## The rows

`SuggestionItem`:

| Field | Notes |
| --- | --- |
| `label` | The text the row shows, and, unless `insert` says otherwise, the text it writes |
| `insert` | What is written. Defaults to `label` |
| `detail` | A short dimmed annotation at the right edge, and the first line of the documentation panel |
| `documentation` | The paragraph in the documentation panel |
| `kind` | A kind name, drawn as `litearea-kind-<kind>`: a small coloured dot whose colour comes from the stylesheet |
| `sortText` | The ranking bucket: rows are ordered by it first and by score only within an equal key. Set it on every row or on none — see the trap below |
| `filterText` | Matched against the needle instead of `label` |
| `mode` | `'replace'` (the default) writes over the range; `'before'` writes ahead of it and keeps it |
| `append` | Text written after the insert, such as `', '` to invite another entry |
| `commitCharacters` | Characters that accept this row when typed |
| `caretOffset` | Where the caret lands, counted back from the end of everything written. Negative moves it left |
| `data` | Opaque payload. Passed to `onAccept` inside the `item` |

`mode: 'before'` is how a value is placed in front of an existing one without
destroying it: promoting a fallback font, or adding a state above a line that
already exists. It inserts at the range's start, drops the whitespace that
followed the old entry and restores a single separating space when one is needed,
and reports `from` and `to` as the same offset, because nothing was removed.

`caretOffset` is one fixed offset, not a set of snippet stops — there is no
placeholder support, so a `caretOffset: -1` on `insert: '()'` is the whole of what
a snippet would be here.

## The context

Every field a source may look at:

| `CompletionContext` field | What it is |
| --- | --- |
| `text`, `caret` | The document and the clamped caret |
| `word` | The word around the caret: `{ from, to, text, prefix, suffix }`. The word is expanded in both directions, so a caret at `Geist\|` is still inside `Geist` |
| `line` | `{ from, to, text, number, column, before, after }` |
| `tokens` | The tokens for the whole document |
| `diagnostics` | The diagnostics for the whole document |
| `state` | Whatever `analyze` returned |
| `scope` | The scope of the token under the caret, when the caret is inside one |
| `scopeBefore` | The scope of the nearest token before the caret. Note that a half-typed word *is* a token, so this is the scope before that word, not before the word you are inside |
| `firstOnLine` | Only whitespace precedes the caret on its line. A caret in a line's indentation counts |
| `firstWord` | The caret is inside the **first word** of its line, or before it |
| `firstToken` | The first non-whitespace token on the caret's line, when there is one |
| `trigger` | How the list came to be open |

`firstOnLine` and `firstWord` both exist because a line-oriented language puts
something special at the head of every line, and a completion for it has to stay
eligible while that head is being spelled out. `runn\|` is no longer "at the start
of the line" in the strict sense — the line already has content — but it is
unmistakably completing the first word. A source that asked `firstOnLine` would
switch itself off after the very first keystroke, which is the bug the second field
exists to prevent. A line-oriented grammar's first-word completion asks
`firstWord` for exactly this reason, and it is the difference between a list that
helps and a list that keeps disappearing.

## Ranking

Filtering and ordering are different jobs, and only the second one decides how a
completer feels. Typing `ruboc` should not be able to push an exact match below a
coincidence, so the ordering is a **tier** plus a local score rather than one
arithmetic blend: a single blend is untestable, because nobody can say what the
number 47.3 means. A tier is worth a million points, so a local bonus can never
cross one.

| Tier | Value | How it is reached | Example |
| --- | --- | --- | --- |
| exact | 5 | The needle is the label, in the same case | `Inter` → `Inter` |
| exact-fold | 4 | The needle is the label, ignoring case | `inter` → `Inter` |
| prefix | 3 | The label starts with the needle | `inte` → `Inter` |
| boundary | 2 | Every needle character starts a word or continues a run the match already started | `IPM` → `IBM Plex Mono`, `fm` → `Fira Mono`, `jbmo` → `JetBrains Mono` |
| substring | 1 | The needle appears as one unbroken run inside the label | `lex` → `Plex Inter`, `bm` → `IBM Plex Mono` |
| subsequence | 0 | The needle's characters appear in order, with gaps | `ton` → `Noto Sans` |

Two details of that table are worth pulling out. `IPM` finds `IBM Plex Mono`
without being a substring of anything: the gap search tries *every* position the
first character could have started at, rather than only the first hit, because a
greedy match would take the `P` of `Plex` and then fail to find an `M` when the
`M` of `Mono` was available all along. And `jbmo` reaches the boundary tier rather
than the subsequence one — every one of its characters starts a word or continues
the run before it — so the subsequence tier is reached only when a matched
character sits inside a word without continuing the match, as the `t` of `Noto`
does.

Case follows the needle: a needle with any uppercase character is matched
case-sensitively, so `Inter` does not quietly match `inter`, while an all-lowercase
needle matches anything. That is the "smart case" a terminal has used for decades.

`sortText` is the primary key and the score is the tie-break inside a group. It is
how a grammar puts a whole group on top — the value already in effect, the shipped
rate — without pretending its label starts with a `0`:

| Rows | `sortText` | Result |
| --- | --- | --- |
| `IBM Plex Mono`, `Inter`, `Inter Tight`, `Iosevka` | `'0'`, `'1'`, `'1'`, — (falls back to the label) | `IBM Plex Mono` first, then the `'1'` group by score, then `Iosevka` |

That last cell is the trap, and the type warns about it in the same words: a row with
no `sortText` is keyed by its **label**, so a grammar that sets `sortText` on some
rows and not others is comparing its sort keys against other rows' labels — two
different kinds of string, in one sort. Set it on every row, or on none.

With no `sortText` anywhere, rows are sorted by score alone on a stable sort,
which keeps the order the grammar declared for everything the needle does not
separate. That is load-bearing: an empty needle must show a catalogue in catalogue
order — what `Ctrl+Space` is for — and an alphabetical tie-break would quietly
rearrange a list the grammar had already ranked. An empty needle keeps every row,
with no emphasis.

`filterText` is matched instead of `label`, so a row can be found by text it does
not display. The matched offsets are only meaningful against the label, so a row
that matched on different text is ranked without an emphasis rather than with the
wrong one. `highlightSegments(label, indices)` is exported for the caller that
builds the row: it returns alternating plain and matched pieces rather than
markup, because the caller is building DOM nodes, not HTML, and a font family
called `<b>` must be shown as `<b>`.

`rank(items, needle, options)` is the exported entry point (`options` is
`label`, `filterText?`, `sortText?`), and `fuzzyMatch(needle, label)` returns the
raw `{ score, indices, tier }` for one pair. `isWordStart` is exported too: it is
the word test the ranking uses, where a word starts at the beginning, after a
separator (`\s-_./:@()+[]`), or at a lower-to-upper transition — which is what
makes camelCase names searchable by their humps.

## Applying a row

`applyCompletion(text, range, item)` clamps the range into the text and returns:

| `AppliedCompletion` field | What it is |
| --- | --- |
| `text` | The document after the edit |
| `caret` | Where the caret belongs in it |
| `range` | What changed, in the **new** document, for a host that wants to scroll the result into view. The editor writes the edit from `from`/`to`/`insert` and never reads this field |
| `from` | The offset the edit starts at in the **original** document |
| `to` | The offset the edit ends at in the original document |
| `insert` | The text written between those two offsets |

`from`, `to`, and `insert` exist alongside `text` because an editor must write only
the range that changed. Assigning the whole recomputed `text` would be simpler and
would throw away the browser's undo history, which is the one thing this library
exists to protect. The editor therefore writes exactly `insert` over `[from, to)`
through the editing pipeline, then puts the caret at `caret` with
`setSelectionRange` — a selection write touches no text, so it cannot disturb the
history. Accepting a completion with `Enter` or `Tab` is therefore one undoable
edit, and the browser check asserts that undo restores the text as it was before
the accept and that redo puts it back. A commit character is written as a second
edit through the same pipeline, so whether the browser groups the two is the
browser's business rather than a promise this library makes.

`append` is skipped when the document already says it:

| Call | Result | Why |
| --- | --- | --- |
| `applyCompletion('one two', { from: 3, to: 3 }, { label: 'three', append: ' ' })` | `onethree two` | The append is whitespace and the text after the range already starts with whitespace |
| `applyCompletion('one  two', { from: 3, to: 3 }, { label: 'three', append: ' ' })` | `onethree  two` | Same rule: whitespace is compared as whitespace, so a tab would count too |
| `applyCompletion('a, b', { from: 1, to: 1 }, { label: 'a', append: ', ' })` | `aa, b` | The text after the range already starts with `, ` |
| `applyCompletion('Inter', { from: 0, to: 5 }, { label: 'Geist', mode: 'before', append: ', ' })` | `Geist, Inter`, caret 7 | Nothing was removed; the new family is written ahead of the old one and keeps the comma that invites the next fallback |

`append` is the grammar's business and not the engine's: inviting another entry
with a `, ` is a fact about font stacks, and an engine that appended one by
default would be guessing about every other language.

## Against VSCode

| VSCode | litearea |
| --- | --- |
| Typing triggers suggestions | A word character or one of `triggerCharacters` (empty by default) opens the list; `auto: false` turns it off |
| `Ctrl+Space` | `Ctrl+Space`/`Cmd+Space` opens on demand, and closes when the list is already open |
| Typing filters the list | The needle is the text between the source's current range start and the caret, matched fuzzily |
| `Enter` accepts | `Enter` accepts the active row |
| `Tab` accepts | `Tab` accepts |
| `Escape` dismisses | `Escape` closes the list; with no list open it hides the tooltip |
| Arrows move without wrapping | `ArrowDown`/`ArrowUp` clamp at the ends |
| `PageUp`/`PageDown` | Move the active row by eight |
| A click picks without stealing focus | The list listens for `mousedown`, calls `preventDefault`, and accepts — so the field never blurs and the caret is not lost |
| The documentation panel | The active row's `detail` and `documentation` render in a panel PINNED below the list, outside the element that scrolls; `showDocumentation: false` removes it. Pinning is what makes the list usable with the keyboard: a panel inside the scroll range is unreachable when the list is long and the explanation is long, because the arrows move the active row rather than the scrollbar. The panel bounds its own height and scrolls itself, so the rows stay put while the text changes in place |
| Kind icons | `kind` becomes a coloured dot with the class `litearea-kind-<kind>`; the stylesheet decides the colour |
| Commit characters | A row opts in with `commitCharacters`; typing one accepts the row, writes the character, and closes the list |
| `sortText` | The primary sort key, exactly as VSCode uses it |
| `filterText` | Matched against the needle instead of the label |
| `preselect` | Not supported: the first row is always the active one |

## Limits

- **Sources are synchronous.** `items` returns rows, not a promise; there is no
  `isIncomplete` and no re-query after the accept.
- **The list closes on accept.** A commit character writes the row and then the
  character and leaves no list open, so a grammar cannot chain two completions
  through a commit. There is no `'commit'` trigger for the same reason: a union
  member nothing can return is a promise the code does not keep.
- **No snippet stops.** `caretOffset` is one offset from the end of what was
  written, so a grammar can land the caret inside a pair of parentheses and
  nowhere else.
- **The source is sticky while it stays eligible.** Only the source that answered
  first is asked again, and `priority` decides only which source opens a closed
  list; a source that sets `merge: true` still contributes its rows either way.
- **The whole list is re-derived on every keystroke.** The winning source is asked
  for all of its rows again and the merged list is ranked again, then sliced to
  `limit`. A source that builds a thousand rows pays for them on each keystroke.
- **`limit` applies after ranking**, so it caps what is returned without saving the
  work of producing it.
- **Rows can come back empty.** `complete` returns `undefined` when no source is
  eligible or when the winning source produced no rows at all, and a `Completion`
  with an empty `rows` array when the needle filtered every row out. The editor
  treats both as "close the list", not as "show an empty panel".
- **`onAccept` is called after the edit**, with `{ text, caret, item, state }` where
  `state` is the analysis of the resulting text. It is the place to sync a host's
  own state without re-parsing.
