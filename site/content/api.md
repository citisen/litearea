# API

Every export of `@citisen/litearea`. Options and methods are on [Options and methods](/docs/options/).

Three entry points and no more:

| Import | Contents |
| --- | --- |
| `@citisen/litearea` | The engine (`src/core`, no DOM) plus the DOM layer (`src/dom`) |
| `@citisen/litearea/react` | `LiteAreaEditor` |
| `@citisen/litearea/styles.css` | The same string the editor injects, written out at build time |

## DOM layer

| Export | What it is |
| --- | --- |
| `createEditor(target, options)` | Constructs an editor in `target` and returns it |
| `LiteArea` | The class behind it |
| `DEFAULT_KEYS` | The default keymap, as data |
| `LiteAreaOptions`, `LiteAreaSizing`, `LiteAreaCompletion`, `LiteAreaHover`, `LiteAreaSticky`, `LiteAreaIndent` | The option groups |
| `LiteAreaCommand` | The closed set a key binding may name |
| `EditorDecoration`, `EditorRange`, `EditorSeverity` | Host-facing aliases of the engine's ranges and severities |
| `TextMirror`, `CaretBox` | The offscreen element that measures |
| `Overlay`, `OverlayClassNames` | The paint |
| `Popup`, `AnchorBox`, `PopupHandlers` | The completion list |
| `Tooltip`, `TooltipAnchor` | The hover tooltip |
| `StickyHeaders`, `StickyRenderInput` | The pinned rows |
| `Ghost`, `GhostAnchor` | The inline completion preview |
| `replaceThroughPipeline`, `writeDocument`, `writeSelection`, `readSelection`, `undoField`, `redoField`, `dispatchInput`, `fieldLineHeight` | The editing helpers, used by the layer itself |
| `EditOutcome`, `TextSelection` | `'pipeline' | 'direct' | 'unchanged'`, and a selection |
| `canEditThroughPipeline()`, `hasCaretHitTest()`, `hasDocument()` | What the environment can do |
| `offsetFromPoint()`, `withDefaults()` | The point-to-offset hit test, and the option defaults filled in |

## Engine

Pure: text and a grammar in, values out. No DOM.

| Group | Exports |
| --- | --- |
| Grammar | `defineGrammar`, `defineCompletion`, `resolveGrammar`, `isResolvedGrammar`, `scan`, `ResolvedGrammar`, `ScanResult` |
| Inspection | `inspect`, `normalizeDiagnostics`, `Inspection` |
| Vocabulary | `defineVocabulary`, `asResolvedVocabulary`, `resolveWordsSource`, `vocabularyWords`, `VocabularySpec` |
| Segments | `buildSegments`, `segmentClasses`, `PaintSegment`, `SegmentInput` |
| Ranking | `rank`, `fuzzyMatch`, `highlightSegments`, `isWordStart`, `Ranked`, `FuzzyMatch`, `RankOptions` |
| Completion | `complete`, `applyCompletion`, `CompletionRequest`, `AppliedCompletion` |
| Hover | `resolveHover`, `diagnosticHover` |
| Sticky | `buildStickyBlocks`, `planStickyHeaders`, `StickyBlock`, `StickyBox`, `StickyPlacement`, `StickyRangeInput` |
| Typing aids | `planPairTyping`, `planCommentToggle`, `planBracketEnter`, `PairTyping`, `PairAction`, `CommentToggle`, `BracketEnter`, `PendingEdit` |
| Indentation | `planIndent`, `resolveIndentUnit`, `IndentCommand`, `IndentDirection`, `IndentRequest` |
| Keys | `keyCombo`, `matchesKey`, `resolveCommand`, `KeyBinding`, `KeyPress` |
| Text | `lineAt`, `lineIndexAt`, `lineStarts`, `tokenAt`, `tokenBefore`, `tokenAfter`, `tokensOnLine`, `wordInfoAt`, `scopeAt`, `containsOffset`, `isEmptyRange`, `isOffset`, `isWordChar`, `clamp` |
| Formatting | `excerpt`, `fillTemplate`, `listPhrase` |
| Styles | `LITEAREA_STYLES`, `injectStyles`, `scopeClass`, `decorationClass`, `severityClass` |

Grammar-facing types, from the same entry point: `Grammar`, `Rule`, `MatchRule`, `WordsRule`,
`RegionRule`, `CheckRule`, `RuleContext`, `RuleMatch`, `Token`, `Scope`, `ScopeSpec`, `Severity`,
`Range`, `Diagnostic`, `Decoration`, `DiagnoseContext`, `HoverContext`, `HoverInfo`, `Completion`,
`CompletionContext`, `CompletionRow`, `CompletionSource`, `CompletionTrigger`, `SuggestionItem`,
`VocabularyContext`, `VocabularyEntry`, `ResolvedVocabulary`, `WordInfo`, `LineInfo`, `WordsSource`,
`CommentSyntax`, `AutoPair`.

`excerpt`, `fillTemplate`, and `listPhrase` are the substitution helpers a diagnostic message is
built from, and they are exported because a host writing its own message wants the same `{word}` and
`{allowed}` handling the vocabulary's `unknownMessage` gets.

## Generated class names

| Prefix | From |
| --- | --- |
| `litearea-scope-<scope>` | A token's scope, with dots folded to hyphens: `value.color` is `litearea-scope-value-color` |
| `litearea-dec-<kind>` | A decoration's `kind` |
| `litearea-diag-<severity>` | `error`, `warning`, `info`, `hint` |
| `litearea-kind-<kind>` | A completion row's `kind` |

## Version

0.2.2, MIT, no runtime dependencies. The only peer dependency is `react >= 18`, and it is optional.
