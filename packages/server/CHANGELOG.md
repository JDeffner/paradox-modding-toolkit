# @px-lsp/server changelog

The server has its own version, separate from the extension: it starts at
0.1.0 for its first npm release and only gets a bump when the server itself
changes. Before the split it moved inside the extension's version (up to
0.3.2); that history is in the extension changelog
(`packages/vscode/CHANGELOG.md`).

## Unreleased

### Added

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
- Long fenced blocks cap inline and disclose the rest with `<details>`, which is
  on VS Code's markdown sanitizer allowlist and does expand in place in a real
  hover. This is the workaround for `editorHoverVerbosityLevel` still being a
  proposed API that cannot ship to the Marketplace. The disclosure is capped
  too, because a hover cannot grow past the editor viewport.

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
