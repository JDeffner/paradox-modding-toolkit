# @px-lsp/protocol

The wire contract of the [px-lsp language server](https://github.com/JDeffner/paradox-modding-toolkit):
custom LSP request/notification names, their payload types, the settings and
initialization-option shapes, plus a few pure helpers shared between the
server and its clients (tiger report parsing, `.mod` descriptor parsing,
diagnostic suppression, localization helpers).

The published package ships compiled JavaScript with type declarations, so it
works from plain Node and from any bundler:

```ts
// The root export is the wire contract (request/notification names + payload types):
import { modOverviewRequest, type ModOverview } from "@px-lsp/protocol";
// The helpers live in named modules:
import { parseTigerJson } from "@px-lsp/protocol/tigerParser";
import { parseDescriptor } from "@px-lsp/protocol/descriptorMod";
```

Clients in other languages should code against the documented contract instead:
see [`docs/PROTOCOL.md`](https://github.com/JDeffner/paradox-modding-toolkit/blob/main/docs/PROTOCOL.md)
in the repository. Changes to the wire contract are treated as API changes
and versioned with the packages.

The Node-only `@px-lsp/protocol/fsWalk` helpers enumerate files through directory symlinks and junctions without visiting a physical directory twice. `iterFiles(dir, ext)` yields matching logical paths and periodic `null` ticks so async callers can yield control. `iterFilesInRoots(dirs: readonly string[], ext: string)` shares that visit guard across roots in priority order. Use semantic folders before a containing fallback root when the logical path determines a file's kind. The configured root path is retained even when it is a link. Within each root, ordinary directories precede deferred aliases, and sibling aliases use sorted traversal order. This does not deduplicate hard links or file symlinks.

License: GPL-3.0-or-later.
