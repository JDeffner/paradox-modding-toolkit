# @px-lsp/server changelog

The server has its own version, separate from the extension: it starts at
0.1.0 for its first npm release and only gets a bump when the server itself
changes. Before the split it moved inside the extension's version (up to
0.3.2); that history is in the extension changelog
(`packages/vscode/CHANGELOG.md`).

## Unreleased

- `paradox/definitionForm` answers two more things a creator cannot work
  out for itself, both measured rather than stored. An option carries
  `group` when the schema entry declares a `groupKey`, read out of the
  definition's own block: CK3's `culture_pillar` sets it to `type`, which
  is what splits one folder of 163 pillars into the five families
  `_pillars.info` documents. A key with no `refKinds` carries `sampled`,
  the distinct values the indexed definitions of the kind write for it,
  most used first and dropped past 80 (a key whose value differs per
  definition is a free field, not a list): this is the only honest source
  for a culture's art sets and ethnicities, which no index can answer.
  CK3's schema also gains culture's full loc key set (`$`, `$_prefix`,
  `$_collective_noun`, all three defined by 244 of 244 vanilla cultures)
  and the per-kind reference rows for the five pillar keys and `name_list`.
- `paradox/definitionForm` and `paradox/definitionEdit`: the read and the
  write a visual content creator needs. The form is assembled from the
  schema table, the harvested `_*.info` structures, the definition index
  and the modifier tokens, so no field list is written for it; the edit is
  the GUI editor's span writer applied to plain script through a new
  dialect parameter on the source model. CK3's schema gains the trait icon
  folder, the trait and dynasty-legacy loc key patterns, and the per-kind
  reference rows for `opposites`, `traditions` and `parents`.

## 0.3.0

Ships with the toolkit's 0.3.5 pre-release, ahead of 0.4.0.

### Security

- Schema overlay entries (`<configDir>/schema.json`) with a `path` that could
  climb out of the mod root (absolute, `..` segments, backslashes) are ignored
  with a log line instead of steering the indexer's directory walk.

### Added

- Every hover renders through one shared card assembly
  (`renderHoverMarkdown`): gui, datafunction, localization-format, texture
  and script hovers share the card anatomy and one footer line, and cards
  whose subject has an Examples Wiki article emit a capability-gated link to
  it. Keywords and scope words became wiki kinds, single-sourced from the
  table the hover cards read. The "Scope here: unknown" line is dropped when
  inference has nothing to say.
- The Examples Wiki serves articles for the workspace's own variables and
  lists (kind, inferred value type, set/read sites with inline context,
  containers), rebuilt when the index changes; engine-token example sites
  carry surrounding lines for inline display. Variable hovers link to the
  article via `clientCommands.showExamplesWiki` when the client declares it.
- Document symbols (outline, breadcrumbs, sticky scroll) and workspace
  symbols resolve their `SymbolKind` through the shared kind map
  (`features/symbolKind.ts`), so a definition draws the same glyph in the
  breadcrumb bar as in its hover badge; the hand-kept workspace-symbol kind
  table is gone.
- `producersOf(data, typeName)` in `data/dataTypes.ts`: the reverse of
  `membersOf`, listing every global and member whose return type is `typeName`.
  Built lazily per `DataTypesData` and cached against it, so a reloaded
  `data_types.log` gets a fresh index with no explicit invalidation.
- `features/definitionBody.ts`: the source block of an indexed definition, for
  the hover. Brace-scans from the definition's own line (O(block), not O(file))
  and caches the file already split into lines plus every block it extracted,
  keyed on path and mtime. Benched against vanilla `common/scripted_triggers`
  (3,119 definitions, 127 files): 390 µs cold, **25 µs warm**, a 16x speedup.
  Caching the raw text instead measured 66 µs, because every hover re-split a
  multi-thousand-line file and re-ran the scan.
- `hoverIcons` client capability: the client renders `$(codicon)` in hover
  markdown. Default false, and the default matters, since a client without it
  prints the literal text `$(symbol-method)`.
- `ParadoxSettings.hoverDetail` (`compact` | `standard` | `full`).

- **New `@px-lsp/server/browser` entry: the language service without node.**
  Completion, hover, diagnostics and scope inference against a single in-memory
  document, with no child process, no JSON-RPC, no workspace scan and no
  filesystem. Intended for web hosts that cannot spawn the server at all.
  `docs/EMBEDDING.md` has the API, the payload sizes and the list of what a
  browser build cannot know.
- `scripts/bake-browser-data.ts` (`pnpm run bake:browser`) runs the existing
  script_docs and wikidocs parsers at build time and emits
  `dist/browser-data/<gameId>/{tokens,docs,freqs}.json`. The prose is split from
  the token tables so a host answers completions after 225 KB brotli and can
  fetch the 72 KB of hover text later, or never.
- `loadFreqs` now delegates its validation to a new exported `coerceFreqs`, so
  the browser build validates a parsed freqs.json exactly as the node path does
  instead of duplicating the shape checks.
- `paradox/exampleWiki` + `paradox/exampleWikiEntry`: the catalog behind the
  extension's Examples Wiki panel. The index ships every known trigger,
  effect, event target, modifier, datafunction and data type with a short doc
  and its vanilla usage count, most-used first; the detail request returns the
  full doc, scopes, the engine `usage:` block, observed literal arguments,
  producers and members, and vanilla example sites as absolute paths the
  client can open. Logic in `overview/exampleWiki.ts`; example-site search is
  bounded and memoized per name (45 ms for `add_gold`, 426 ms worst case over
  772 files on a real install).
- Custom-calendar date display when `settings.calendar` is set: inlay hints
  after date tokens in script files and a hover card with the in-game form.
  The setting is sanitized on intake, so clients may pass raw JSON.
- `GameMeta` gains an optional `calendarLoc` field: the game's verified
  date-format and month-name loc keys, consumed by the extension's
  Generate Calendar Localization command (set for CK3).
- `GameMeta` gains an optional `launchPresets` field: game-specific launch
  option presets (flags verified in the game's binary), consumed by the
  extension's `paradox-game` run configurations (set for CK3 and Vic3).

### Changed

- **One kind map, in `@px-lsp/protocol/kinds`.** Glyph, completion-item kind and
  colour family per concept, read by the hover badge, the completion list and
  the client's tree views. It replaced two hand-maintained tables that disagreed
  with each other and with the trees.
- `features/hoverRender.ts` rewritten around four slots (head, doc, example,
  facts) plus one shared footer line per hover instead of a footer per card.
  Badges render in three tiers by capability: codicon, `■` square, or plain
  text. `CardInput.traits` becomes `facts`; `CardInput.footer: string[]` becomes
  `provenance: string`, used only by multi-card hovers.
- Long fenced blocks cap inline and end with a "N more lines" tail. An earlier
  draft disclosed the rest with `<details>`, which does render in a hover, but
  reading a long body inside a widget that closes when the pointer leaves it
  never worked in practice; the whole-body reading surface is the Examples
  Wiki panel instead.
- `[ ... ]` datafunction hovers build the same card model as every other hover
  surface: kind badge (promote = blue stored value, function = purple, data
  type = orange), the `→ ReturnType` tail on the head line, description and
  harvested usage in the doc slot, provenance on the facts line.

### Removed

- `isShortExample()`, dead since it was written: exported and unit-tested but
  never called. The example cap it was meant for now lives in `fencedBlock`.

## 0.2.0

Capability-honest output for bare LSP clients. VSCode behavior is unchanged
(it declares everything); every other client now gets output it can actually
use instead of affordances it cannot.

### Added

- **Engine block templates in completion.** Completing an engine token whose
  `script_docs` `usage:` example qualifies inserts the block that example
  shows (`if = { limit = { … } … }`), as a `${n:…}` snippet or a plain
  skeleton depending on the client. The extractor
  (`features/blockSnippets.ts`) is guard-everything: the example must name
  the token itself, balance its braces, carry only plain identifier keys and
  no `#` comment, or it yields nothing. Measured over the shipped dumps: 679
  CK3 and 265 Vic3 effect/trigger tokens get a template.
- **Block skeletons for schema structure keys.** A structure key the schema
  marks `values: "block"` completes as `key = { }` with the cursor inside
  (~700 keys in the CK3 schema alone).
- **`client.fileLinks` capability** (`@px-lsp/protocol` 0.1.1): declare it if
  your hover renderer navigates `file:` links. Off (the default), provenance
  and set-site lines render as plain `file.txt:12` labels instead of links.

### Changed

- **Completion snippets are gated on the standard LSP
  `snippetSupport` capability.** A client that does not declare
  `textDocument.completion.completionItem.snippetSupport` now gets plain-text
  skeletons (parameter blocks included); `${` never reaches it. Previously
  scripted-effect parameter snippets were sent unconditionally.
- **The hover reference count is dropped for clients without
  `px.showReferences`.** It used to render as plain text; a count nobody can
  click answers no question.
- The deprecated `clientCommands: true` alias now also implies
  `fileLinks: true` plus snippet support, keeping old rich clients
  byte-identical.

### Performance

Large-workspace performance. Measured on a game install plus 5 Steam Workshop
mods, all fully indexed (87,250 files, 1,304,861 definitions, 7,553,947
references).

- A workspace mod root is walked once instead of twice. The definition scan
  covered the schema folders and the reference scan then re-read the whole
  root, and both extractors parsed the file themselves, so nearly every mod
  file was read twice and parsed twice. One walk now reads and parses each
  file once and feeds both extractors. `extractDefinitionsParsed` and
  `extractReferencesParsed` are new exports taking an already-parsed CST; the
  existing `extractDefinitions` and `extractReferences` are unchanged.
- Both indexes compact their buckets when a scan finishes. V8 grows an empty
  array's backing store to 16 slots on the first push and most index names
  hold one entry.
- References share their `kinds` arrays, and the schema root-scope `Set` is
  built per schema entry rather than per file.
- Fixed: `variableTypes()` keyed its cache on the definition index revision,
  but a rebuild installs a fresh index whose revision restarts at 0, so a
  stale variable-type map could be served once the new index counted back up.

Time to indexed on that workspace went 142.9 s to 61.5 s with a cold page
cache and 52.9 s to 44.5 s warm, and post-GC heap after the build went
1735 MB to 1504 MB. The cold half needs the client to fork the server with
`UV_THREADPOOL_SIZE=16`: libuv's default pool of 4 caps how many reads the
scan can really have in flight. Embedders forking the server themselves
should set it too.

## 0.1.0

First npm release. The full language server (parser, index, scope engine,
features, per-game profiles, bundled data) with the `px-lsp` bin, usable over
`--stdio` from any LSP client or over node-ipc.
