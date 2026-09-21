// ─── litearea: the grammar contract ─────────────────────────────────────────
//
// Everything litearea knows about a language lives in ONE object, and the engine
// knows nothing else. There is no built-in syntax, no bundled tokenizer, and no
// language identifier to switch on: a grammar is data the caller writes, and the
// editor is a function of it.
//
// The reason the whole language is one object rather than several registrations
// is the failure this library exists to correct. The editors it replaces derived
// the painted tokens, the diagnostics, and the completion list three separate
// times from the same text, by three separate passes that could — and did —
// disagree: a word painted as a family while the completer thought it was
// unknown, a caret offset counted in one coordinate system and applied in
// another. Here `analyze` runs ONCE per text, its result is handed to every
// feature that needs it, and the features cannot drift because they are looking
// at the same value.
//
//     rules     → what is painted            (lexical, declarative)
//     analyze   → what the document MEANS    (structural, one pass, optional)
//     diagnose  → what is wrong with it      (declarative checks + a hook)
//     compose   → what can come next         (completion sources)
//     describe  → what a thing is            (hover tooltips)
//     decorate  → what is semantically true  (ranges that are not tokens)
//
// Every hook is optional. A grammar with nothing but `rules` is a plain
// highlighter; add `compose` and it completes; add `diagnose` and it complains.

/** A half-open range of character offsets into the document. `to` is exclusive. */
export interface Range {
  /** The first character, inclusive. */
  from: number
  /** The character after the last one, exclusive. */
  to: number
}

/**
 * The name a token is painted under.
 *
 * A scope is a plain string and the engine never interprets it: it becomes a CSS
 * class (`litearea-scope-<scope>`), and a stylesheet decides what that looks
 * like. Dots are kept as written so a grammar can group its own vocabulary
 * (`value.color`, `value.shape`) and theme the group at once.
 */
export type Scope = string

/** How loudly a diagnostic speaks. Mirrors the four levels an editor shows. */
export type Severity = 'error' | 'warning' | 'info' | 'hint'

/** One painted span. `text` always equals `text.slice(from, to)`. */
export interface Token extends Range {
  scope: Scope
  text: string
  /** Zero-based line number. */
  line: number
  /** Zero-based column, counted in characters rather than in display width. */
  column: number
  /**
   * The scope of the innermost region this token sits inside, when it is inside
   * one. A grammar's validator reads it to tell a word in a comment from the same
   * word in the code around it.
   */
  region?: Scope
}

/**
 * A span the grammar marks for a reason of its own — VSCode calls these semantic
 * tokens and they are deliberately not tokens here.
 *
 * The distinction earns its keep. A token is what the *characters* are; a
 * decoration is what they *mean*, and the two change on different schedules. A
 * grammar can paint `Geist Mono` as a family from the characters alone, but which
 * family is *in effect* depends on a catalogue the HOST supplied — the same
 * characters mean something else on another machine. Painting that as a token
 * would mean re-lexing the document whenever the catalogue changed; painting it
 * as a decoration means recomputing one range list, which is what it is.
 */
export interface Decoration extends Range {
  /** The class suffix: the span is rendered as `litearea-dec-<kind>`. */
  kind: string
  /**
   * A short label for the mark, shown as the tooltip's heading.
   *
   * It is combined with whatever the grammar's `describe` says about the token rather than
   * replacing it, because the two answer different questions: the mark says what the
   * grammar concluded ("in effect: Geist Mono") and the description says what the token is
   * (its faces, its weight). A hover that showed only one of them would always be missing
   * the half the reader wanted.
   */
  title?: string
}

/** A problem the grammar found, with the range that should be underlined. */
export interface Diagnostic extends Range {
  severity: Severity
  message: string
  /**
   * A stable machine-readable tag, so a host can react to a specific problem
   * without matching on prose, and so tests can assert on meaning rather than on
   * wording.
   */
  code?: string
  /** A second paragraph, shown under the message in a tooltip. */
  detail?: string
  /** Who raised it. Defaults to the grammar id. */
  source?: string
}

// ── the vocabulary ──────────────────────────────────────────────────────────

/** What one word of a vocabulary explains about itself when the pointer rests on it. */
export interface VocabularyEntry {
  /** A short signature line, shown first and emphasised. */
  title?: string
  /** A dimmed line under the title. */
  detail?: string
  /** The body text. Plain text: litearea does not render markdown. */
  body?: string
}

/**
 * The words a rule may accept, resolved at scan time.
 *
 * A function is how a vocabulary that lives outside the document — the fonts
 * actually installed, the states the host actually has — reaches the grammar
 * without the grammar holding state of its own. It is called once per scan with
 * the grammar's analysis, so a dynamic vocabulary costs one call, not one per
 * token.
 */
export type WordsSource<State = unknown> =
  | readonly string[]
  | ResolvedVocabulary<State>
  | ((context: VocabularyContext<State>) => readonly string[])

/** What a vocabulary resolution is allowed to look at. */
export interface VocabularyContext<State = unknown> {
  text: string
  /** Whatever `Grammar.analyze` returned. */
  state: State
}

/**
 * A vocabulary after {@link defineVocabulary} has filled in its defaults.
 *
 * It carries four facts that must agree — the word set, the scope a member is
 * painted with, the message a non-member earns, and the documentation a member
 * shows — which is exactly why they are declared together. Split across four
 * places they drift; declared once they cannot.
 */
export interface ResolvedVocabulary<State = unknown> {
  readonly id: string
  /** Whether membership is case-sensitive. */
  readonly caseSensitive: boolean
  /** Every member, in declaration order. */
  resolve(context: VocabularyContext<State>): readonly string[]
  /** Whether a word is a member. */
  has(word: string, context: VocabularyContext<State>): boolean
  /** The scope a member is painted with. */
  scopeFor(word: string): Scope
  /** The scope a non-member is painted with, when the vocabulary rejects one. */
  readonly unknownScope: Scope | undefined
  /** The diagnostic a non-member earns, or `undefined` for silence. */
  reject(
    word: string,
    context: VocabularyContext<State>,
  ): { message: string; severity: Severity; code: string } | undefined
  /** What a member explains about itself, for hover. */
  entryFor(word: string): VocabularyEntry | undefined
  /** How a word is written into the document when it is accepted. */
  format(word: string): string
}

// ── rules: what gets painted ────────────────────────────────────────────────

/**
 * Where a rule is allowed to match. Every predicate that is present must hold.
 *
 * The predicates are about *position*, not about the parse. That boundary is
 * deliberate: a rule that could ask "am I inside a rule named running?" would
 * make the highlighter a parser, and the whole point of `analyze` is that the
 * parse happens once, in a function the grammar author can read and test.
 */
export interface RuleContext {
  /** Only when nothing but whitespace precedes it on its line. */
  firstOnLine?: boolean
  /** Only when the nearest preceding token has one of these scopes. */
  after?: readonly Scope[]
  /** Only when the nearest preceding token does NOT have one of these scopes. */
  notAfter?: readonly Scope[]
  /** Only when the whole line matches. Anchored at the start. */
  line?: RegExp
  /** Only when the caret-facing column is at least this many characters in. */
  minColumn?: number
  /** Only when the column is at most this many characters in. */
  maxColumn?: number
  /**
   * Only when the character immediately before the match is not one of these.
   * `prevNot: '\\w'` is the common case: it is how a keyword rule is stopped
   * from matching the tail of a longer word.
   */
  prevNot?: string
}

/** A scope is either fixed, or decided per match by a function. */
export type ScopeSpec<State = unknown> =
  | Scope
  | ((match: RuleMatch<State>) => Scope)

/** What a scope function is told about the match it is naming. */
export interface RuleMatch<State = unknown> {
  /** The matched text. */
  text: string
  /** The document. */
  source: string
  /** Where the match starts. */
  from: number
  /** The capture groups, when the pattern had any. Index 0 is the whole match. */
  groups: readonly (string | undefined)[]
  /** Whatever `Grammar.analyze` returned. */
  state: State
}

/** A regular-expression token: the workhorse. */
export interface MatchRule<State = unknown> {
  kind: 'match'
  scope: ScopeSpec<State>
  /**
   * Tried at the current position. The engine adds the sticky flag, so the
   * pattern never has to be anchored by hand and can never skip ahead.
   */
  pattern: RegExp
  when?: RuleContext
}

/**
 * A vocabulary token: a set of words, matched as a unit.
 *
 * It is its own rule kind rather than sugar over `match` because a word has
 * three properties a regex cannot express. It can be resolved at scan time from
 * data outside the document; it can span several words when a name contains a
 * space; and a word that is NOT in the set is a fact worth reporting, which is
 * where most diagnostics come from.
 */
export interface WordsRule<State = unknown> {
  kind: 'words'
  words: WordsSource<State>
  /** Overrides the vocabulary's own scope for this rule only. */
  scope?: ScopeSpec<State>
  /**
   * Allows one entry to span several words (`IBM Plex Mono`).
   *
   * The engine tries the longest span first and keeps the longest member it finds, so a
   * catalogue holding both `IBM Plex` and `IBM Plex Mono` resolves the longer name. Words
   * are separated by any run of whitespace that does not contain a newline; the separators
   * are part of the matched span and are painted with the member's own scope.
   *
   * Setting `phrase` also stops a multi-word member being matched by the literal fallback,
   * so `max` really is a cap rather than a suggestion.
   */
  phrase?: {
    /**
     * The most words one entry may span. Default 4, which covers every real font family in
     * the shipped catalogue (`Source Han Serif SC` is four).
     */
    max?: number
  }
  when?: RuleContext
  /**
   * What to do with a word-shaped token that is not a member.
   *
   * Absent, the rule simply does not match and a later rule gets its turn —
   * which is what a grammar wants when two vocabularies overlap. Present, the
   * token is painted with `scope` and earns `message`, which is how a typo
   * becomes a red underline instead of quietly falling through to plain text.
   */
  unknown?: {
    scope?: Scope
    message?: string | ((word: string, context: RuleMatch<State>) => string)
    severity?: Severity
    code?: string
  }
}

/**
 * A delimited region: a block comment, a multi-line string, a heredoc.
 *
 * The engine scans for `end` from the end of `begin` and never re-enters the rule list in
 * between (unless `transparent`), so the contents of a string cannot be mistaken for the
 * language around it. `nested` widens that by one delimiter — the region may open inside
 * itself — and no further. An `end` that never arrives runs the region to the end of the
 * document and raises `unclosed`, because an unterminated block comment is a mistake and not
 * an invitation to tint the rest of the file.
 */
export interface RegionRule<State = unknown> {
  kind: 'region'
  /** The scope of the whole region when the other three are not given. */
  scope?: ScopeSpec<State>
  /** The opening delimiter. */
  begin: RegExp
  /** The closing delimiter, searched for rather than anchored. */
  end: RegExp
  /** The scope of the opening delimiter. Defaults to `scope`. */
  openScope?: ScopeSpec<State>
  /** The scope of the closing delimiter. Defaults to `scope`. */
  closeScope?: ScopeSpec<State>
  /** The scope of what lies between. Defaults to `scope`. */
  contentScope?: ScopeSpec<State>
  /**
   * Whether the same rule may open again inside itself. Default `false`.
   *
   * Nesting and transparency are different things, and conflating them is how a block
   * comment stops being a comment: a language whose comments nest wants the delimiters
   * matched and everything else inside treated as prose. So this flag adds ONLY the
   * delimiter — the contents stay opaque unless `transparent` says otherwise.
   */
  nested?: boolean
  /**
   * Whether the grammar's other rules also apply inside this region. Default `false`.
   *
   * The flag for a region that is not prose: a template in another language, or a string
   * with escapes to colour. It implies nesting, because the rule list this exposes includes
   * the rule that opened the region.
   */
  transparent?: boolean
  when?: RuleContext
  /** What an unterminated region reports. */
  unclosed?: {
    scope?: Scope
    message?: string | ((match: RuleMatch<State>) => string)
    severity?: Severity
    code?: string
  }
}

/** One production of a grammar's lexical rules. Tried in order; first match wins. */
export type Rule<State = unknown> = MatchRule<State> | WordsRule<State> | RegionRule<State>

// ── diagnostics ─────────────────────────────────────────────────────────────

/** A declarative check: a shape a token must have, or a vocabulary it must join. */
export interface CheckRule<State = unknown> {
  /** A stable code, copied onto every diagnostic the check raises. */
  code: string
  severity?: Severity
  /**
   * The tokens this check applies to, by scope. `*` matches every scope.
   * The check runs on the token's own text.
   */
  scopes: readonly Scope[]
  /**
   * The words that are acceptable. A token in `scopes` whose text is not a
   * member is reported.
   */
  allow?: WordsSource<State>
  /** The message. `{word}` and `{allowed}` are substituted. */
  message: string
  detail?: string
  /** Skips tokens whose text matches, so a check can carve out its exceptions. */
  except?: RegExp
  /** Runs at most once per line, on the first token that matches `scopes`. */
  perLine?: boolean
}

/** What a grammar's own validator is handed. */
export interface DiagnoseContext<State = unknown> {
  text: string
  tokens: readonly Token[]
  /** The result of `Grammar.analyze`, or the grammar's initial state. */
  state: State
  /** Raises a diagnostic. The grammar supplies the range. */
  report(problem: {
    from: number
    to: number
    message: string
    severity?: Severity
    code?: string
    detail?: string
  }): void
}

// ── completion ──────────────────────────────────────────────────────────────

/** One row of the completion list. */
export interface SuggestionItem {
  /** The text the row shows and, unless `insert` says otherwise, writes. */
  label: string
  /** The text written into the document. Defaults to `label`. */
  insert?: string
  /** A short dimmed annotation at the right edge, as VSCode's `detail` is. */
  detail?: string
  /** The paragraph shown in the documentation panel beside or below the list. */
  documentation?: string
  /** A kind name, for the icon and the colour: `litearea-kind-<kind>`. */
  kind?: string
  /**
   * The ranking bucket.
   *
   * Rows are ordered by this key first and by match score only within an equal key, which
   * is how a grammar puts a whole group on top — the value already in effect, say —
   * without pretending its label starts with a `0`.
   *
   * Set it on every row or on none. When some rows set it and others do not, the ones that
   * do not are keyed by their LABEL, so their labels are compared against the other rows'
   * sort keys rather than against their labels. That is a comparison between two different
   * things, and it is not what anyone means.
   */
  sortText?: string
  /** Matched against the needle instead of `label`. */
  filterText?: string
  /**
   * `replace` (the default) writes over the replaced range; `before` writes
   * ahead of it and keeps it. `before` is how a value is inserted in front of an
   * existing one without destroying it — promoting a fallback font, or adding a
   * state above a line that already exists.
   */
  mode?: 'replace' | 'before'
  /** Text appended after the insert, such as `', '` to invite another entry. */
  append?: string
  /** Characters that accept this row when typed, as VSCode's commit characters are. */
  commitCharacters?: string
  /**
   * Where the caret lands, counted back from the end of everything written.
   * Negative moves it left, which is how a grammar leaves the caret inside a
   * pair of delimiters it just wrote.
   */
  caretOffset?: number
  /** Opaque payload handed back to `Grammar.onAccept`. */
  data?: unknown
}

/** The word the caret sits in, and the range a completion would replace. */
export interface WordInfo extends Range {
  /** The word's text. */
  text: string
  /** What precedes the caret inside the word. Empty at the word's start. */
  prefix: string
  /** What follows the caret inside the word. Empty at the word's end. */
  suffix: string
}

/** One line of the document, and where the caret is on it. */
export interface LineInfo extends Range {
  text: string
  /** Zero-based line number. */
  number: number
  /** The caret's zero-based offset within the line. */
  column: number
  /** The line's text before the caret. */
  before: string
  /** The line's text after the caret. */
  after: string
}

/**
 * How the popup came to be open — which decides what may keep it open.
 *
 * There is no `'commit'` member, and that is deliberate: the DOM layer never produced
 * one, and a union member nothing can return is a promise the code does not keep. A
 * commit character accepts the row and closes the list; whatever the user types next is
 * an ordinary `'auto'` trigger.
 */
export type CompletionTrigger =
  /** Opened by typing a character. */
  | 'auto'
  /** Opened by the user asking (Ctrl+Space), with no needle. */
  | 'explicit'

/** Everything a completion source may look at. */
export interface CompletionContext<State = unknown> {
  text: string
  caret: number
  /** The word around the caret. */
  word: WordInfo
  /** The line around the caret. */
  line: LineInfo
  /** The tokens for the whole document. */
  tokens: readonly Token[]
  /** The diagnostics for the whole document. */
  diagnostics: readonly Diagnostic[]
  /** Whatever `Grammar.analyze` returned. */
  state: State
  /** The scope of the token under the caret, when the caret is in one. */
  scope: Scope | undefined
  /** The scope of the nearest token before the caret. */
  scopeBefore: Scope | undefined
  /** Whether nothing but whitespace precedes the caret on its line. */
  firstOnLine: boolean
  /**
   * Whether the caret is inside the FIRST word of its line, or before it.
   *
   * The difference from `firstOnLine` is the whole reason both exist. A
   * line-oriented language puts something special at the head of every line, and a
   * completion for it has to stay eligible while that head is being spelled out:
   * `runn|` is no longer "at the start of the line" in the strict sense, but it is
   * unmistakably completing the first word. A source that asked `firstOnLine` would
   * switch itself off after the very first keystroke — which is exactly the bug this
   * field was added to fix, and exactly the kind of thing a grammar written against
   * a real document is for finding.
   */
  firstWord: boolean
  /** The first non-whitespace token on the caret's line, when there is one. */
  firstToken: Token | undefined
  trigger: CompletionTrigger
}

/**
 * One way the grammar offers completions.
 *
 * Several sources may be declared. The first eligible one that returns rows wins
 * unless it asks to merge, which keeps the common case — "here is the list" —
 * free of any merging logic while still allowing a document-wide source (every
 * property already used elsewhere) to sit alongside a vocabulary.
 */
export interface CompletionSource<State = unknown> {
  /** A stable id, for tests and for the host's telemetry. */
  id: string
  /** Eligible only when every predicate holds. Default: always eligible. */
  when?: (context: CompletionContext<State>) => boolean
  /**
   * The range the chosen row replaces.
   *
   * A function of the context, so it is recomputed from the caret EVERY time the list is
   * filtered. It has to grow with the word being typed: type `ru`, accept `running`, and the
   * replacement must cover both letters, or the result is the completion followed by a
   * leftover character. What stays stable while the user types is the SOURCE — see
   * `CompletionRequest.previousSourceId` — not the range.
   */
  range: Range | ((context: CompletionContext<State>) => Range)
  /** The rows, in whatever order the grammar wants them scored. */
  items: (context: CompletionContext<State>) => readonly SuggestionItem[]
  /** Higher wins when several sources are eligible and none merges. Default 0. */
  priority?: number
  /** Adds this source's rows to the others' instead of competing with them. */
  merge?: boolean
}

/** One row of a resolved completion list, with the evidence for its position. */
export interface CompletionRow {
  item: SuggestionItem
  /** The ranking score. Higher is better. */
  score: number
  /** The offsets in the row's label the needle matched, for emphasis. */
  indices: number[]
}

/** A resolved completion: the range recomputed for this filter, and the rows worth showing. */
export interface Completion {
  /**
   * The range a chosen row replaces.
   *
   * Recomputed from the caret every time the list is filtered, never held over from an
   * earlier keystroke. That is the whole difference between a completer that works and
   * one that leaves debris: type `ru`, accept `running`, and the range has to cover both
   * letters. Holding the range resolved when the list opened replaces only the `r` and
   * produces `running u`.
   */
  range: Range
  rows: readonly CompletionRow[]
  /** The needle the rows were filtered against. */
  needle: string
  /** The source that produced them, for tests and for the host. */
  sourceId: string
}

// ── hover ───────────────────────────────────────────────────────────────────

/** What a hover shows. Every field is plain text; nothing is rendered as markdown. */
export interface HoverInfo {
  /** A short signature line, shown first and emphasised. */
  title?: string
  /** A dimmed line under the title. */
  detail?: string
  /** The paragraph below. */
  body?: string
  /** The range the hover describes. Defaults to the token under the pointer. */
  range?: Range
  /** Which part of the editor raised it, for styling. */
  kind?: 'token' | 'diagnostic' | 'decoration' | 'grammar'
}

/** Everything a grammar's hover may look at. */
export interface HoverContext<State = unknown> {
  text: string
  /** The offset the pointer resolved to, or the caret for a keyboard hover. */
  offset: number
  /** The token under the offset, when there is one. */
  token: Token | undefined
  /** The word under the offset. */
  word: WordInfo
  /** The line under the offset. */
  line: LineInfo
  tokens: readonly Token[]
  /**
   * Every problem the document has.
   *
   * The one UNDER the offset is not offered separately, and that is a fact about the order
   * of business rather than an omission: a diagnostic outranks a description, so `describe`
   * is only ever called when nothing is wrong at that offset. A grammar that wants to know
   * what else is flagged can read this list.
   */
  diagnostics: readonly Diagnostic[]
  state: State
}

// ── the grammar ─────────────────────────────────────────────────────────────

/**
 * A language, complete.
 *
 * `State` is whatever `analyze` returns and is threaded to every other hook, so
 * a grammar author writes the parse once and reads it everywhere with full
 * types. Leaving it out makes the state `unknown`, which is what a grammar with
 * no `analyze` wants.
 */
export interface Grammar<State = unknown> {
  /** A stable id, used as the default diagnostic `source` and for debugging. */
  id: string
  /** A human name, for a status line or a demo. */
  name?: string

  /**
   * The lexical rules, tried in order at each position. First match wins, so a
   * rule that must not shadow another belongs above it.
   */
  rules: readonly Rule<State>[]

  /** The scope for a character no rule claimed. Default `'text'`. */
  fallbackScope?: Scope

  /**
   * Which characters form a word.
   *
   * It matters more than it looks: this predicate decides what a completion
   * replaces, what a diagnostic underlines, and where a double-click puts the
   * selection. A language whose names contain dots or hyphens must say so, or
   * every completion will replace one segment of a name instead of the name.
   */
  wordChars?: RegExp

  /** The initial state, used before `analyze` exists and when it is skipped. */
  initialState?: State

  /**
   * The single structural pass over the document.
   *
   * Called once per text, before the scan, and its result is handed to every rule and to
   * `checks`, `validate`, `compose`, `describe`, and `decorate` alike — which is what keeps
   * them from disagreeing about what the document says.
   *
   * It receives the text and NOT the tokens, deliberately. Handing it tokens
   * would make the scan depend on the analysis that depends on the scan, and the
   * only ways out of that cycle are a second pass or a fixpoint, both of which
   * mean the analysis can disagree with the paint. A structural pass over a line
   * oriented language does not need the lexical result anyway: splitting lines
   * and words is cheaper than asking the scanner to do it again.
   */
  analyze?: (text: string) => State

  /** Declarative checks, run over the tokens. */
  checks?: readonly CheckRule<State>[]

  /**
   * The grammar's own validator, for what a check cannot express: a duplicated
   * value, a weight the chosen family does not have, a slot filled twice.
   */
  validate?: (context: DiagnoseContext<State>) => void

  /** The ways this grammar offers completions. */
  compose?: readonly CompletionSource<State>[]

  /** What a thing is, when the pointer rests on it. */
  describe?: (context: HoverContext<State>) => HoverInfo | null | undefined

  /** Semantic ranges that are not tokens. */
  decorate?: (text: string, state: State) => readonly Decoration[]

  /**
   * Called after a row is accepted, with the text that resulted. The place to
   * sync a host's own state — a stored value, a preview — without re-parsing.
   */
  onAccept?: (result: { text: string; caret: number; item: SuggestionItem; state: State }) => void
}
