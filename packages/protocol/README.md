# @px-lsp/protocol

The wire contract of the [px-lsp language server](https://github.com/JDeffner/ck3-modding-toolkit):
custom LSP request/notification names, their payload types, the settings and
initialization-option shapes, plus a few pure helpers shared between the
server and its clients (tiger report parsing, `.mod` descriptor parsing,
diagnostic suppression, localization helpers).

The package ships plain TypeScript sources (`exports` maps `./*` to
`./src/*.ts`), so consume it from a bundler/TS toolchain, e.g.:

```ts
import { modOverviewRequest, type ModOverview } from "@px-lsp/protocol/protocol";
```

Non-TypeScript clients should code against the documented contract instead:
see [`docs/PROTOCOL.md`](https://github.com/JDeffner/ck3-modding-toolkit/blob/main/docs/PROTOCOL.md)
in the repository. Changes to the wire contract are treated as API changes
and versioned with the packages.

License: GPL-3.0-or-later.
