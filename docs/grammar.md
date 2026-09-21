# Grammar reference

The complete contract for a litearea grammar: every field of every rule kind, the
precedence model, the vocabulary helper, diagnostics, hover, and a worked
walkthrough. The short version, with a runnable example, is in the
[README](../README.md#writing-a-grammar).

## One object, one pass

A language is a single object. The engine knows nothing else: there is no
built-in syntax, no bundled tokenizer, and no language identifier to switch on.

```
rules     → what is painted            (lexical, declarative)
analyze   → what the document MEANS    (structural, one pass, optional)
checks    → what is wrong with it      (declarative checks over the tokens)
validate  → what is wrong with it      (the grammar's own hook)
compose   → what can come next         (completion sources)
describe  → what a thing is            (hover tooltips)
decorate  → what is semantically true  (ranges that are not tokens)
onAccept  → what just changed          (after a row is accepted)
```

Those eight fields are six *stages*: the engine's own header groups `checks` and
`validate` under the single word `diagnose`, and `onAccept` is a field that reacts
to a change rather than producing one. The reason the whole
language is one object rather than several registrations is the failure this
library exists to correct: three separate passes over one string — paint, parse,
suggest — are three chances to disagree, and the editors this replaces disagreed
routinely. Here `analyze` runs once per text and its result is handed to every
hook that wants it.

| Field | Required | What it does |
| --- | --- | --- |
| `id` | yes | A stable id. It is the default diagnostic `source`, and the one thing a test can rely on |
| `name` | no | A human name, for a status line or a demo |
| `rules` | yes | The lexical pass. Tried in order at every position; first match wins |
| `fallbackScope` | no | The scope for a character no rule claimed. Default `'text'` |
| `wordChars` | no | The single-character test that decides where words begin and end. See [wordChars](#wordchars) |
| `initialState` | no | The state used before `analyze` exists, and when it is skipped |
| `analyze` | no | The single structural pass. Called once per text, before the scan |
| `checks` | no | Declarative "this token must be one of these words" checks |
| `validate` | no | The grammar's own validator, for what a check cannot express |
| `compose` | no | The ways this grammar offers completions |
| `describe` | no | What a thing is, when the pointer rests on it |
| `decorate` | no | Semantic ranges that are not tokens |
| `onAccept` | no | Called by the editor after a row is accepted |

Every hook is optional except `rules`. A grammar with nothing but `rules` is a
plain highlighter; add `compose` and it completes; add `checks` and it complains.
Use `defineGrammar` to declare one — it is an identity function whose only job is
to infer `State` from `analyze` and enforce it everywhere else, and
`defineCompletion` does the same for one source.

## Rules

```ts
type Rule<State> = MatchRule<State> | WordsRule<State> | RegionRule<State>
```

All three kinds may carry a `when` predicate; the two that paint a name may carry
a `scope`. `scope` is a `Scope` (a plain string) or a function of the match:

```ts
type ScopeSpec<State> = Scope | ((match: RuleMatch<State>) => Scope)
```

A function is handed everything a lexical decision could need:

| `RuleMatch` field | What it is |
| --- | --- |
| `text` | The matched text |
| `source` | The whole document |
| `from` | Where the match starts |
| `groups` | The capture groups; index 0 is the whole match |
| `state` | Whatever `analyze` returned |

The `state` field is the one that earns the function form: it is how a scope can
depend on something the characters do not say. `dshFontQueryGrammar` uses it to
paint a weight word as `weight` or `weight.missing`, which depends on the
machine's installed faces, not on the word.

### `match`: a regular expression

| Field | Type | Notes |
| --- | --- | --- |
| `kind` | `'match'` | |
| `pattern` | `RegExp` | Tried at the current position. The engine adds the sticky flag (`y`), so a pattern never has to be anchored and can never skip ahead |
| `scope` | `ScopeSpec` | The scope to paint |
| `when` | `RuleContext` | Extra positional predicates |

Compiled patterns are cached per source pattern, so a scan does not recompile one
per position.

### `words`: a vocabulary

A word is its own rule kind rather than sugar over `match`, because it has three
properties a regex cannot express: it can be resolved at scan time from data
outside the document, it can span several words when a name contains a space, and
a word that is *not* in the set is a fact worth reporting.

| Field | Type | Notes |
| --- | --- | --- |
| `kind` | `'words'` | |
| `words` | `WordsSource` | A `readonly string[]`, a `ResolvedVocabulary`, or `(context) => readonly string[]` |
| `scope` | `ScopeSpec` | Overrides the vocabulary's own scope for this rule only |
| `phrase` | object | Lets one entry span several words |
| `when` | `RuleContext` | Extra positional predicates |
| `unknown` | object | What to do with a word-shaped token that is not a member |

`WordsSource` as a function is called **once per scan** with
`{ text, state }`, so a dynamic vocabulary — the fonts actually installed, the
states the host actually has — costs one call, not one per token.

`phrase`:

| Field | Default | Notes |
| --- | --- | --- |
| `max` | 4 | The most words one entry may span. A span longer than `max` is never attempted, and four covers every family in the shipped catalogue (`Source Han Serif SC` is four) |

The engine tries the longest span first and keeps the longest member it finds, so
a catalogue holding both `IBM Plex` and `IBM Plex Mono` resolves the longer name.
Words are separated by any run of whitespace that does not contain a newline; the
separators are part of the matched span and are painted with the member's own
scope. A phrase never crosses a line: a name split over two lines is two names.

Setting `phrase` also makes `max` a real cap. A member containing whitespace would
otherwise be reachable through the literal fallback — the path that matches a
member's exact text when `wordChars` cannot read it in — and a cap that applies on
only one of the two routes to the same member is not a cap. The literal path still
serves members whose characters are not word characters for another reason, such as
`-apple-system`.

`unknown`:

| Field | Notes |
| --- | --- |
| `scope` | The scope a rejected word is painted with. Falls back to the vocabulary's `unknownScope`, then `'invalid'` |
| `message` | A string with `{word}` and `{allowed}` substituted, or `(word, match) => string`. Absent, the vocabulary's own rejection message is used |
| `severity` | Default: the vocabulary's `unknownSeverity`, then `'error'` |
| `code` | Default: the vocabulary's `unknownCode`, then `'unknown-word'` |

With `unknown` absent, a non-member simply does not match and a later rule gets
its turn — which is what a grammar with two overlapping vocabularies wants. With
`unknown` present, the rule *claims* the word-shaped run: painting it, reporting
it, and stopping anything below from seeing it. Write `unknown: {}` to take the
vocabulary's own rejection and nothing else.

Only the first word-shaped token is consumed. The scanner cannot know how far a
name it has never seen was meant to reach, and guessing would swallow the words
that follow it; a multi-word name that is merely misspelled is the grammar's
validator's business, where the structure is known.

### `region`: a delimited block

| Field | Type | Notes |
| --- | --- | --- |
| `kind` | `'region'` | |
| `begin` | `RegExp` | The opening delimiter, matched at the position |
| `end` | `RegExp` | The closing delimiter. A plain region **searches** for it from the end of `begin`; a nested or transparent one tries it at each position, with the same first match |
| `scope` | `ScopeSpec` | The scope of the whole region when the three below are not given |
| `openScope` | `ScopeSpec` | The opening delimiter. Defaults to `scope` |
| `closeScope` | `ScopeSpec` | The closing delimiter. Defaults to `scope` |
| `contentScope` | `ScopeSpec` | What lies between. Defaults to `scope` |
| `nested` | `boolean` | Default `false`. The same rule may open again inside itself; the contents stay opaque |
| `transparent` | `boolean` | Default `false`. The grammar's other rules also apply inside. Implies nesting |
| `when` | `RuleContext` | Extra positional predicates |
| `unclosed` | object | What an unterminated region reports |

A region has three shapes, and the two flags are the choice between them.

**Neither flag — the fast path.** The end is found with one search over the rest of
the document, so the content can be painted as a single span: one token, even across
several lines. It is also opaque, because the rule list never runs inside it. That is
what makes a string a string — the word `running` inside a quoted string is text and
not a state. The price of the fast path is that an inner delimiter is not matched:
`/* a /* b */ c */` without flags closes at the **first** `*/`, so ` c */` is read as
document text.

**`nested: true` — the delimiters are matched, the content is still opaque.** A
region that nests is still a region all the way down, which is why this flag adds
only the delimiter: the region's own `end` is tried first at every position, then its
own `begin`, and everything else is content. `/* a /* b */ c */` is painted as
comment from end to end — the inner `/* … */` pairs off, and a `[section]` header
written inside stays comment text rather than becoming a section header. A language
whose comments behaved any other way would be one nobody could write a comment in.

**`transparent: true` — the interior is code.** The rule list runs inside, so the
grammar's rules apply to the content. It implies nesting, because the rule list this
exposes includes the rule that opened the region. This is the flag for a region that
is not prose: a template written in another language, or a string with escapes worth
colouring. The cost is that nothing inside is opaque any more, which is exactly why
it is a separate flag from `nested`.

```ts
// A nestable block comment: the delimiters pair off, the interior is prose.
{ kind: 'region', scope: 'comment', begin: /\/\*/, end: /\*\//, nested: true }

// A template region whose interior is the language again: `{{ user.name }}` is
// painted by the grammar's own rules, and braces may nest.
{ kind: 'region', scope: 'tmpl', begin: /\{\{/, end: /\}\}/, transparent: true }
```

With `[a [b] c]` and one `word` rule, `nested: true` produces no `word` tokens at all
and no diagnostics, while `transparent: true` produces the words `a`, `b`, and `c`.
That single difference is the whole flag.

In every shape, a character inside a region that no rule claims is painted with the
region's content scope rather than with the document fallback, and adjacent
same-scope spans merge, so a body and its closing delimiter that share a scope and
sit on one line come out as one token. Merging never crosses a newline, so an
incrementally painted region is one token per line while a plain region's body is a
single token however many lines it covers.

An `end` that is never found runs the region to the end of the document, and an
unterminated block comment is a mistake rather than an invitation to tint the rest
of the file, so every shape reports it: a plain region when its search fails, and a
nested or transparent one when the document ends with a frame still open. An `end`
that can match the empty string counts as never found.

`unclosed`:

| Field | Default |
| --- | --- |
| `message` | `Unterminated <scope>.`, or `(match) => string` |
| `severity` | `'error'` |
| `code` | `'unclosed-region'` |
| `scope` | The scope the unterminated body is painted with instead of `contentScope`. Honoured on the **fast path only** — a plain region |

The diagnostic's range is the opening delimiter, not the rest of the document.

`unclosed.scope` is how a grammar says "this is not a string, it is a broken
string", which is the difference between a reader trusting the colours and being
misled by them. It reaches the plain region alone, because that is the shape whose
body exists as one span to repaint. A nested or transparent region is painted as it
is scanned, one run at a time, so only `message`, `severity`, and `code` apply to it.

A nested or transparent region is reported **innermost first** when the document ends
inside it — the one the reader has to fix first — and each open frame produces its
own diagnostic, over its own opening delimiter. `inspect` then sorts the list by
range, as it does for every diagnostic, so the order a host sees is positional.

### `when` and `RuleContext`

Every predicate that is present must hold. They are predicates about *position*,
not about the parse — a rule that could ask "am I inside a rule named running?"
would make the highlighter a parser, and the point of `analyze` is that the parse
happens once, in a function you can read and test.

| Field | Type | Holds when |
| --- | --- | --- |
| `firstOnLine` | `boolean` | Nothing but whitespace precedes the match on its line — so a match inside a line's indentation counts as first |
| `after` | `readonly Scope[]` | The nearest preceding non-whitespace token has one of these scopes. Fails when there is no preceding token |
| `notAfter` | `readonly Scope[]` | The nearest preceding token does not have one of these scopes. Passes when there is no preceding token |
| `line` | `RegExp` | The whole line's text matches. Anchor it yourself (`/^form/`); the engine runs it as written |
| `minColumn` | `number` | The match starts at or after this character column |
| `maxColumn` | `number` | The match starts at or before this character column |
| `prevNot` | `string` | The character immediately before the match is not one of these. It is used as a character class, so `'\\w'` means "not a word character" — the usual way to stop a keyword matching the tail of a longer word. At offset 0 the predicate holds, because there is nothing in front of the match |

Columns are counted in characters, from the start of the line.

## Precedence

Four rules decide how a document is painted, and all four are visible from
outside:

1. **First match wins, in declaration order.** At each position the rules are
   tried top to bottom and the first one that matches consumes the position. To
   make a rule win, put it higher. A rule that must not shadow another belongs
   below it.
2. **A rule that can match the empty string is treated as not matching.** A
   pattern such as `/\w*/` is skipped, so the scan cannot stall on one position
   forever. The same guard applies to a region's `begin` and to the sticky test
   for its `end`.
3. **Adjacent tokens with the same scope merge.** Whitespace is most of a
   document, and one span per space would mean thousands of DOM nodes for a file
   nobody is looking at. Merging stops at a newline, because a token's `line` and
   `column` describe where it starts and a span across two lines would make that
   a lie. Tokens also merge only when their `region` agrees.
4. **A region's contents are opaque unless it is `transparent`.** A plain or
   `nested` region never offers its interior to the rule list, so the word
   `running` inside a quoted string cannot be read as a state. `transparent: true`
   is the one flag that lifts it.

A run of characters no rule claimed is taken in one piece, up to the next rule
match or the end of the line, and painted with `fallbackScope`.

## defineVocabulary

A closed set of words appears four times in a language-aware editor: as the syntax
that accepts it, as the colour it is painted in, as the message a typo earns, and
as the documentation a hover shows. Written out four times they drift — a word
added to one and forgotten by the others is the ordinary way a grammar rots, and
the drift is invisible until someone types the new word and watches the editor get
it wrong. So they are declared once:

```ts
const SHAPES = defineVocabulary({
  id: 'shape',
  words: ['circle', 'rounded', 'square', 'none'],
  unknownMessage: '"{word}" is not a shape — expected {allowed}.',
  docs: { circle: 'A full disc, the background for a busy state.' },
})

// …
{ kind: 'words', words: SHAPES, unknown: {} }
```

| `VocabularySpec` field | Default | What it does |
| --- | --- | --- |
| `id` | — | Used in the default scope and the default diagnostic code |
| `words` | — | The members, or `(context) => readonly string[]` for a set that lives outside the document. Called once per scan |
| `scope` | `vocabulary:<id>` | The scope a member is painted with, or `(word) => Scope` |
| `unknownScope` | `'invalid'` | The scope a rejected word is painted with |
| `unknownMessage` | — | The message a rejected word earns. `{word}` and `{allowed}` are substituted, the latter as a readable list. **Absent, nothing rejects** — membership is simply not enforced |
| `unknownSeverity` | `'error'` | How loudly a rejection complains |
| `unknownCode` | `vocabulary:<id>` | A stable code for the rejection |
| `docs` | — | What each member explains about itself. A bare string is taken as the body |
| `detail` | — | A dimmed line beside a member in the completion list |
| `caseSensitive` | `false` | Whether membership is case-sensitive |
| `format` | identity | How a member is written into the document when accepted — how a family called `IBM Plex Mono` is inserted as `"IBM Plex Mono"` |

The returned `ResolvedVocabulary` is what the engine consumes: `resolve`, `has`,
`scopeFor`, `unknownScope`, `reject`, `entryFor`, and `format`. Because the test
for a vocabulary is structural rather than `instanceof`, a host may hand over its
own object as long as it carries those methods — which is what lets a host wrap a
vocabulary in logging, caching, or translation without the engine knowing.
`asResolvedVocabulary`, `resolveWordsSource`, and `vocabularyWords` are exported
for the same kind of work.

The one thing to remember: a vocabulary's rejection only fires where a rule asks
for it. `unknownMessage` on its own changes nothing — put `unknown: {}` on the
`words` rule, or `severity`/`message`/`code` overrides on it, and the words rule
reports.

## wordChars

`wordChars` is a single-character `RegExp` (`/[\p{L}\p{N}_$]/u` by default) and it
decides three things at once:

1. **What a completion replaces.** The word around the caret is expanded in both
   directions with this predicate, and that range is the default a source returns
   from `range`.
2. **What a diagnostic underlines**, when a check runs against a word-shaped
   token.
3. **Where a double click puts the selection**, because that is the platform's
   own word test and the browser uses the same notion of a word the field does.

A language whose names contain a dot or a hyphen must say so. `dshFontQueryGrammar`
uses `/[\p{L}\p{N}_-]/u` so `-apple-system` is one word; `dshSentryStyleGrammar`
deliberately does *not* include `.`, so a stray `circle.` is not read as one
unknown word and reported as a name the user never typed.

The flags are normalised: `g` and `y` are stripped from the predicate, because
`RegExp.prototype.test` advances `lastIndex` on a global pattern and a predicate
carrying one would answer correctly for the first character and then for every
other one.

## analyze

`analyze(text)` is called once per text, before the scan, and its return value is
threaded to every rule's `match.state` and to `validate`, `compose`, `describe`,
and `decorate` as `context.state`. It receives the text and **not** the tokens,
deliberately.

Handing it the tokens would make the scan depend on the analysis that depends on
the scan. The only ways out of that cycle are a second pass or a fixpoint, and
both of them mean the analysis can disagree with the paint — which is precisely
the failure this library was written to remove. A structural pass over a
line-oriented language does not need the lexical result anyway: splitting lines
and words is cheaper than asking the scanner to do it again, and `lineStarts` is
exported so the two agree on what a line is.

Nothing else about `analyze` is constrained. It may record problems (most grammars
do, so that one walk decides the structure and what is wrong with it together
rather than implementing one rule twice), and it may be expensive, because it runs
once per text and its result is reused by everything.

## Diagnostics

Four sources feed one list, in this order:

1. the lexical pass — a vocabulary rejection, an unclosed region;
2. `checks`, run over the tokens;
3. `validate`, the grammar's own hook;
4. nothing else: `inspect()` then deduplicates and sorts.

Two rules can legitimately notice the same mistake — a vocabulary's own rejection
and a validator both know that `nope` is not a colour — and drawing the underline
twice makes it darker rather than more informative. Duplicates are compared on
position, code, and message, so two genuinely different complaints about one word
both survive. The list is sorted by range.

### `checks`

| `CheckRule` field | Notes |
| --- | --- |
| `code` | Required. Copied onto every diagnostic the check raises |
| `severity` | Default `'error'` |
| `scopes` | The token scopes this check applies to. `'*'` matches every scope |
| `allow` | The words that are acceptable. A token in `scopes` whose text is not a member is reported. Any `WordsSource` will do |
| `message` | Required. `{word}` and `{allowed}` are substituted |
| `detail` | A second paragraph, shown under the message in a tooltip |
| `except` | A `RegExp` that skips tokens, so a check can carve out its exceptions |
| `perLine` | Runs at most once per line, on the first matching token |

Without `allow`, a check reports **every** token in `scopes` that `except` does not
skip — which is how you write a shape rule rather than a vocabulary rule:

```ts
checks: [
  {
    code: 'name-style',
    scopes: ['name', 'form.name'],
    except: /^[a-z][a-z0-9-]*$/,
    severity: 'warning',
    message: '"{word}" is not a lower-case name — write `email-address`, not `{word}`.',
  },
]
```

A `WordsSource` used as `allow` is resolved once per check with the grammar's
analysis, so a check may consult a vocabulary the machine supplied (`{ text, state }`,
exactly as a `words` rule's source is). What it still cannot do is report a range
other than the token's own, so keep checks to facts about a token's text and leave
anything structural to `validate`.

### `validate` and `report`

```ts
validate: (context) => {
  context.text       // the document
  context.tokens     // the painted tokens
  context.state      // whatever analyze returned
  context.report({ from, to, message, severity?, code?, detail? })
}
```

The grammar supplies the range, because only the grammar knows what the range
means. `severity` defaults to `'error'`, `code` to `'validate'`, and the
diagnostic's `source` is always the grammar's `id`.

`report` is also the place a structural walk that ran in `analyze` publishes what
it found — record the ranges while the structure is known, and report them here.
Both reference grammars do exactly that.

### Codes and severities

| Code | Where it comes from |
| --- | --- |
| `vocabulary:<id>` | A vocabulary's rejection; `unknownCode` changes it |
| `unknown-word` | A `words` rule's `unknown` with a message but no vocabulary to supply a code |
| `unclosed-region` | A region whose `end` was never found; `unclosed.code` changes it |
| *`<check.code>`* | A declarative check |
| `validate` | A `report` call with no code |

`Severity` is `'error' | 'warning' | 'info' | 'hint'` — four levels, painted as
`litearea-diag-error`, `-warning`, `-info`, and `-hint`, and one segment shows one
squiggle: the loudest diagnostic covering it wins, because two underlines on the
same characters only make a messier line. The wrapper also gains
`litearea-invalid` and the field `aria-invalid="true"` while any error is present.

## decorate

A token is what the *characters* are; a decoration is what they *mean*, and the two
change on different schedules.

```ts
decorate: (text, state) => readonly Decoration[]
```

A `Decoration` is `{ from, to, kind, title? }`: it is painted as
`litearea-dec-<kind>`, and `title` becomes the tooltip's title when the pointer
rests on it — with the grammar's `describe`, if there is one, still filling in the
detail and the body. Decorations are clamped into the document, dropped when they
come out empty, and sorted — a grammar computing them from a stale parse cannot
paint a span nobody can see.

The font grammar's "in effect" pill is the worked case. `Geist Mono` is painted as
a family from the characters alone — that is a token. Which family is *in effect*
depends on the machine's installed catalogue, so the same characters mean
something else on another computer. Painting that as a token would mean re-lexing
the document whenever the catalogue changed; as a decoration it is one recomputed
range list, which is what it actually is.

Reach for `decorate` when the mark depends on something outside the document. If
nothing in your language does, do not add one — a decoration that could have been
a scope is a second place for the same fact to live.

## describe and hover precedence

```ts
describe: (context) => HoverInfo | null | undefined
```

`HoverInfo` is `{ title?, detail?, body?, range?, kind? }`, all plain text. There
is no markdown rendering and no HTML: a font family called `<b>` is shown as
`<b>`.

`resolveHover(inspection, grammar, offset)` resolves one offset, and the
precedence is fixed:

| Order | Source | Why it is here |
| --- | --- | --- |
| 1 | A diagnostic covering the offset | The user resting the pointer on a squiggle is asking what is *wrong*, and answering "circle: a full disc" is technically true and useless. The **narrowest** covering diagnostic wins, so a squiggle inside a wider warning still explains itself |
| 2 | A decoration's `title` | The grammar went out of its way to name this range |
| 3 | The grammar's `describe` | The general account of a token |

The last two are not exclusive. When a decoration with a `title` covers the
offset, that title becomes the tooltip's title **and** the grammar's `describe`
still supplies the detail line (falling back to its own title) and the body. A
decoration title is short by design — `in effect: Geist Mono` — while a
description is rich but says nothing about the mark, so showing only one of them
would always be missing the half the reader wanted.

`diagnosticHover(diagnostic)` is exported so a host that shows its own marker list
can use the same wording: the severity as the title, the `source` as the detail,
and the message plus `detail` as the body.

The `HoverContext` a grammar's `describe` receives carries `text`, `offset`,
`token`, `word`, `line`, `tokens`, `diagnostics`, and `state`. The diagnostic under
the offset is not offered separately, and that is a fact about the order of business
rather than an omission: a diagnostic outranks a description, so `describe` is only
ever called when nothing is wrong at that offset. A grammar that wants to know what
else is flagged reads `diagnostics`.

## A worked walkthrough

The language is the small form schema from the README, with the structural half
added. It is line-oriented and indentation-tolerant:

```
# the signup form
form signup
  text    email        required
  text    password     secret   "at least 12 characters"
  number  age          optional
  text    email        optional
  number  Weight       required
  bogus   color        required
```

### The vocabulary, declared once

```ts
import { defineGrammar, defineVocabulary, lineStarts } from '@citisen/litearea'
import type { Severity } from '@citisen/litearea'

const FIELD_TYPES = ['text', 'number', 'bool'] as const
const OPTION_WORDS = ['required', 'optional', 'secret'] as const

const TYPES = defineVocabulary({
  id: 'field-type',
  words: FIELD_TYPES,
  scope: 'field.type',
  unknownMessage: '"{word}" is not a field type — expected {allowed}.',
  docs: {
    text: { detail: 'one line of text', body: 'The only type that can be `secret`.' },
    number: { detail: 'a number', body: 'Kept as written, so `007` stays `007`.' },
    bool: { detail: 'yes or no' },
  },
})

const OPTIONS = defineVocabulary({
  id: 'option',
  words: OPTION_WORDS,
  scope: 'option',
  docs: {
    required: { detail: 'cannot be left empty' },
    optional: { detail: 'may be left empty' },
    secret: { detail: 'never shown again', body: 'Only a `text` field can be secret.' },
  },
})
```

### The structural pass

This walk decides what each row *is* and records what is wrong with it in the same
pass. They are the same decision: the only reason to know which row a word belongs
to is to say what a word that belongs to nothing should have been, and splitting
them would mean two implementations of one rule.

```ts
interface Field {
  name: string
  type: string
  options: string[]
  line: number
  from: number
  to: number
}

interface Problem {
  from: number
  to: number
  message: string
  code: string
  severity: Severity
}

interface FormState {
  fields: Field[]
  problems: Problem[]
}

const analyze = (text: string): FormState => {
  const fields: Field[] = []
  const problems: Problem[] = []
  const starts = lineStarts(text)

  for (let index = 0; index < starts.length; index += 1) {
    const from = starts[index] ?? 0
    const raw = text.slice(from, starts[index + 1] ?? text.length)
    // The reader drops a comment from the first `#` anywhere on the line.
    const hash = raw.indexOf('#')
    const body = hash === -1 ? raw : raw.slice(0, hash)

    const words: Array<{ text: string; from: number; to: number }> = []
    const pattern = /[^\s]+/g
    let match: RegExpExecArray | null
    while ((match = pattern.exec(body)) !== null) {
      const at = from + match.index
      words.push({ text: match[0], from: at, to: at + match[0].length })
    }

    const type = words[0]
    const name = words[1]
    if (type === undefined || name === undefined) continue
    if (!FIELD_TYPES.includes(type.text as (typeof FIELD_TYPES)[number])) continue

    // A note is a quoted word, and the quotes belong to the syntax rather than to
    // the option list, so it is left out here.
    const options = words.slice(2).filter((word) => !word.text.startsWith('"'))
    fields.push({
      name: name.text,
      type: type.text,
      options: options.map((option) => option.text),
      line: index,
      from: name.from,
      to: name.to,
    })

    if (options.some((option) => option.text === 'secret') && type.text !== 'text') {
      problems.push({
        from: name.from,
        to: name.to,
        code: 'secret-not-text',
        severity: 'error',
        message: `\`${name.text}\` is \`${type.text}\`, so it cannot be \`secret\`.`,
      })
    }
  }

  const seen = new Set<string>()
  for (const field of fields) {
    if (seen.has(field.name)) {
      problems.push({
        from: field.from,
        to: field.to,
        code: 'duplicate-field',
        severity: 'error',
        message: `\`${field.name}\` is declared twice.`,
      })
    }
    seen.add(field.name)
  }

  return { fields, problems }
}
```

### The grammar

```ts
export const formSchema = defineGrammar({
  id: 'form-schema',
  name: 'form schema',
  wordChars: /[\p{L}\p{N}_-]/u,
  rules: [
    { kind: 'match', scope: 'comment', pattern: /#[^\n]*/ },
    { kind: 'match', scope: 'keyword', pattern: /form/, when: { prevNot: '\\w' } },
    {
      kind: 'match',
      scope: 'form.name',
      pattern: /[A-Za-z][\w-]*/,
      when: { after: ['keyword'] },
    },
    { kind: 'words', words: TYPES, when: { firstOnLine: true }, unknown: {} },
    { kind: 'words', words: OPTIONS },
    { kind: 'match', scope: 'name', pattern: /[A-Za-z][\w-]*/, when: { after: ['field.type'] } },
    { kind: 'region', scope: 'note', begin: /"/, end: /"/, unclosed: { severity: 'warning' } },
    { kind: 'match', scope: 'invalid', pattern: /\S+/ },
  ],

  analyze,

  checks: [
    {
      code: 'name-style',
      scopes: ['name', 'form.name'],
      except: /^[a-z][a-z0-9-]*$/,
      severity: 'warning',
      message: '"{word}" is not a lower-case name — write `email-address`, not `{word}`.',
    },
  ],

  validate: (context) => {
    for (const problem of context.state.problems) context.report(problem)
  },

  compose: [
    {
      id: 'field-type',
      when: (context) => context.firstWord,
      range: (context) => context.word,
      items: () =>
        FIELD_TYPES.map((type) => ({
          label: type,
          append: '  ',
          kind: 'type',
          detail: TYPES.entryFor(type)?.detail,
          documentation: TYPES.entryFor(type)?.body,
        })),
    },
    {
      id: 'option',
      when: (context) =>
        context.tokens.some(
          (token) =>
            token.line === context.line.number &&
            token.scope === 'name' &&
            token.to <= context.caret,
        ),
      range: (context) => context.word,
      items: () =>
        OPTION_WORDS.map((word) => ({
          label: word,
          kind: 'option',
          detail: OPTIONS.entryFor(word)?.detail,
        })),
    },
  ],

  describe: (context) => {
    const token = context.token
    if (token === undefined) return undefined
    if (token.scope === 'comment') return { title: 'comment', body: 'Ignored by the reader.' }
    if (token.scope === 'note') return { title: 'note', body: 'Shown under the field.' }
    if (token.scope === 'invalid') {
      return { title: token.text, detail: 'not part of this language' }
    }
    const entry =
      token.scope === 'field.type' ? TYPES.entryFor(token.text) : OPTIONS.entryFor(token.text)
    return entry === undefined
      ? { title: token.text, detail: token.scope }
      : { title: token.text, detail: entry.detail, body: entry.body }
  },
})
```

### Reading each rule

| Rule | Why it is where it is |
| --- | --- |
| `comment` first | `#` is unambiguous, so it never needs to consult anything |
| `form` with `prevNot: '\\w'` | The keyword must not match the tail of a longer word, and the character class is what says so |
| `form.name` with `after: ['keyword']` | The name after `form` is free text, and `after` is the cheapest way to say "the token before me was the keyword" |
| `TYPES` with `firstOnLine: true` and `unknown: {}` | The first word of a row is a type or it is a mistake — the one place in this language where the lexical layer can be that sure. `unknown: {}` asks for the vocabulary's own message |
| `OPTIONS` with no `when` and no `unknown` | An option word may appear anywhere after a name and never rejects, so the rules below it still get their turn |
| `name` with `after: ['field.type']` | A field's name follows its type; putting the options above this rule means a field cannot be called `required`, which is a trade the language makes on purpose |
| the `note` region | Quotes make the body opaque, so a note containing the word `secret` is text and not an option. `unclosed` is a warning: the document still reads, it just reads further than intended |
| `invalid` last | Anything left is painted as a word this language does not know, so a typo is visible before the structural pass says anything about it |

### What the sample produces

| Where | Diagnostic |
| --- | --- |
| the second `email` | `duplicate-field`, error — from `validate`, reported with the range the walk recorded |
| `Weight` | `name-style`, warning — from `checks`, which sees only the token's own text |
| `bogus` | `vocabulary:field-type`, error — from the words rule's `unknown: {}` |

And three hovers: `note` over the quoted note, the field type's documentation over
`number`, and `Error` plus the rejection message over `bogus`. The third is the
hover precedence doing its job: the diagnostic outranks the token's description.

## What each hook may and may not do

| Hook | May | May not |
| --- | --- | --- |
| `rules` | Paint a scope, read the match's groups and `state`, look at position | Ask what rule is running, see any token's final scope, or match the empty string |
| `analyze` | Read the whole text, be expensive, return anything typed | See the tokens (by design), or paint |
| `checks` | Test a token's text against a word set, skip exceptions, fire once per line | See the analysis through `allow`, or report a range other than the token's |
| `validate` | See the text, the tokens, and the state; report any range, code, and severity | Suppress a lexical diagnostic, or change the paint |
| `compose` | See the text, the caret, the tokens, the diagnostics, and the state; return any range and any rows | Choose who wins — that is `priority` and `merge` — or apply an edit |
| `describe` | Read a token, a word, a line, and the state; return any text | Change the paint, or outrank a diagnostic |
| `decorate` | Return ranges, a kind, and a title | Change a token's scope, or clear a diagnostic |

Exceptions are not caught. A hook that throws propagates out of `inspect` (or
`complete`) into the caller, because a grammar that fails is a bug the host needs
to see rather than a document that quietly paints itself plain.

## Error behaviour

| Situation | What the engine does |
| --- | --- |
| A rule's pattern can match the empty string | Treated as not matching, so the scan advances |
| A pattern was written without `y` or `g` | The sticky flag is added and the compiled pattern cached, so it cannot skip ahead |
| `wordChars` carries `g` or `y` | The flag is stripped, because `test` would otherwise alternate answers |
| `when.prevNot` at offset 0 | The predicate holds: a rule guarded this way is not disabled at the start of the document |
| A plain region's body | One opaque span, found in a single search; the rule list never runs inside it and an inner `begin` is not matched |
| A `nested` region's body | Opaque as well, but its own `begin` and `end` are matched at every position, so the delimiters pair off |
| A `transparent` region's body | The rule list runs inside it, and unclaimed characters are painted with the region's content scope |
| A region's `end` is never found, or can match empty | The region runs to the end of the document and reports `unclosed` over its opening delimiter: a plain region when its search fails, a nested or transparent one when the document ends with a frame open, innermost frame first |
| An `unclosed.scope` on a nested or transparent region | Ignored: the content was already painted as it was scanned, so only `message`, `severity`, and `code` apply |
| A `words` rule does not match and has no `unknown` | The rule is skipped and the next rule is tried; no diagnostic |
| A `words` rule has `unknown` but no message anywhere | The token is painted with the unknown scope and **nothing** is reported |
| A member contains a character `wordChars` rejects | Matched literally, longest member first, after the word-run attempt — unless the rule sets `phrase`, which drops whitespace-containing members from that fallback so `max` stays a cap |
| A `words` rule rejects a word | Only the first word-shaped token is consumed |
| Several sources are eligible | The highest `priority` opens the list; equal priorities go to the one declared first |
| A list is already open | The source that answered keeps answering while its `when` holds, whatever the priorities say |
| Several diagnostics cover one range with the same code and message | One survives |
| A decoration falls outside the document | Clamped into it; when it comes out empty it is dropped |
| A hook throws | The exception propagates: `inspect` and `complete` do not catch |
