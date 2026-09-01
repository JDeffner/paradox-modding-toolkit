# @px-lsp/protocol changelog

The protocol has its own version, separate from the extension: it starts at
0.1.0 for its first npm release and only gets a bump when the wire contract or
the shared helpers change. Before the split it moved inside the extension's
version (up to 0.3.2); that history is in the extension changelog
(`packages/vscode/CHANGELOG.md`).

## 0.2.0

Ships with toolkit 0.4.0.

### Added

- `paradox/exampleWiki` and `paradox/exampleWikiEntry` requests: the search
  index and the per-entry detail behind the extension's Examples Wiki panel
  (name, kind, short doc and vanilla usage count per row; full doc, scopes,
  usage block, literals, producers, members and example sites per entry).

- `upsertDescriptorBlock` in `descriptorMod`: replace or append a top-level
  `key={...}` block (tags editing in the Workshop panel), preserving the
  file's EOL style and everything around the block.

- `workshopMeta.ts`: reader/writer for the mod's local Workshop record
  (`<configDir>/workshop.json`: published id, description, per-language
  translations; merge-preserving round trips), plus the Steam API language
  table (`STEAM_LANGUAGES`) and the Paradox-loc-to-Steam language mapping
  (`steamLanguageForLoc`). The store behind the extension's Workshop panel
  and translation uploads.

- `descriptorMod.ts`: `readDescriptorBlock(text, key)` (the quoted strings of
  any top-level `key={ … }` block; `readDescriptorDependencies` now uses it)
  and `upsertDescriptorValue(text, key, value)` (replace or append a scalar
  entry, preserving BOM and line endings). Both for the extension's Steam
  Workshop publishing, which writes `remote_file_id` back after first publish.

- `kinds.ts`: one map from a concept (`trigger`, `saved_scope`, `data_type`, a
  GUI widget type) to its codicon and its `CompletionItemKind` name. Shared by
  the server's hover and completion and by the VS Code client's tree views, so
  the three surfaces cannot drift apart. The badge colour is derived, not
  chosen: it is the `symbolIcon.*Foreground` token of the completion kind, the
  token VS Code paints the completion row with, so the two surfaces agree by
  construction. Carries the two
  facts that make the table easy to re-break: codicon aliases collapse to one
  picture, and only `CompletionItemKind` reaches the suggest widget.
- `ParadoxClientCapabilities.hoverIcons`: the client renders `$(codicon)` in
  hover markdown. Default false.
- `ParadoxSettings.hoverDetail`: `compact` | `standard` | `full`.

## 0.1.1

- `ParadoxClientCapabilities.fileLinks` (optional, default false): the
  client's hover renderer navigates `file:` links, so provenance lines may be
  markdown links instead of plain labels. Backward compatible: absent means
  off, which is the pre-0.1.1 behavior for object-declaring clients.
- The deprecated `clientCommands: true` alias is documented to also imply
  `fileLinks: true` (and snippet support, which is standard LSP, not part of
  this object).

## 0.1.0

First npm release. The wire contract (custom `paradox/*` requests and
notifications, settings types) and the shared helpers, compiled to CommonJS
with type declarations.
