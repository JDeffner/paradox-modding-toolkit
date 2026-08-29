# @px-lsp/server changelog

The server has its own version, separate from the extension: it starts at
0.1.0 for its first npm release and only gets a bump when the server itself
changes. Before the split it moved inside the extension's version (up to
0.3.2); that history is in the extension changelog
(`packages/vscode/CHANGELOG.md`).

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
