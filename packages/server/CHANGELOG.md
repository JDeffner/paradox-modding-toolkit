# @px-lsp/server changelog

The server has its own version, separate from the extension: it starts at
0.1.0 for its first npm release and only gets a bump when the server itself
changes. Before the split it moved inside the extension's version (up to
0.3.2); that history is in the extension changelog
(`packages/vscode/CHANGELOG.md`).

## 0.2.0

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
