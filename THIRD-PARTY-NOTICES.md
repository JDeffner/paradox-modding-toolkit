# Third-party notices

Paradox Modding Toolkit is GPL-3.0-or-later (see `LICENSE`). It additionally contains
material derived from the MIT-licensed projects below, and one release artifact
bundles an unmodified third-party binary. License texts are reproduced verbatim
here, or shipped beside the binary where that is noted.

---

## cwtools-eu5-config

- Upstream: https://github.com/kaiser-chris/cwtools-eu5-config
- Pinned commit: `7f2764a9536951dc9915c0b05509d0499408381a` (targets EU5 1.3.4-beta)
- Imported: 2026-08-01

**What it is used for.** The Europa Universalis V schema table
(`packages/server/src/games/eu5/schema.generated.ts`) is machine-generated from
this project's `types = { ... }` declarations by `scripts/import-cwt-types.ts`.
The generated file is a derived work: the folder paths, definition kinds, file
extensions and the commented-out `requiredLoc` patterns all come from upstream.
No CWT source file is redistributed, and none of the rule language (aliases,
enums, cardinalities, scopes) is used, only the type-to-folder table.

```
MIT License

Copyright (c) 2025 Chris Kaiser

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## cwtools-vic3-config

- Upstream: https://github.com/kaiser-chris/cwtools-vic3-config
- Consulted at commit: `d87e303234cc049051ac7ae3c5984f8047973f88`

**What it is used for.** Nothing is generated from this project. The Victoria 3
schema table (`packages/server/src/games/vic3/schema.ts`) was written by hand
against a real Vic3 install and then **cross-checked** against these rules to
confirm folder names and definition kinds (for example that Vic3 reads the
plural `common/on_actions`). Any overlap is limited to those factual folder and
kind names; the notice is kept because the cross-check informed the table.

```
MIT License

Copyright (c) 2020 cwtools

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## pdx-flag-builder

- Upstream: https://github.com/kaiser-chris/pdx-flag-builder
- Reference commit: `75d442b794f20c75010a68ea3bc18d8316296793`
- Consulted: 2026-08-22

**What it is used for.** The Flag Builder
(`packages/vscode/src/webviews/flagBuilder/`) is a reimplementation in
TypeScript of this Odin application's approach: its coat-of-arms model
(pattern + colored/textured emblems + subs, with instances), the placeholder
colors the game paints patterns and colored emblems with, and the recolor
rule of its `recolor.fs` shader (tolerance, blue-channel shading, pattern
masks) are ported into `packages/server/src/coa/coa.ts` and
`app/render.ts`. No source file is copied; no asset is redistributed.

```
MIT License

Copyright (c) 2026 Chris Kaiser

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## shadcn/ui (design only)

- Upstream: https://github.com/shadcn-ui/ui
- Consulted: 2026-08-23, preset `b0` (Nova style, neutral theme)

**What it is used for.** The webviews' shared stylesheet
(`packages/vscode/src/webviews/shared/ui.css`) reproduces the look of the
Nova style in plain CSS: the neutral palette ratios, radii, control heights,
focus ring and hover treatment were read off the generated components and
written by hand. No source file of the project is copied or redistributed;
the components themselves (React, Tailwind, Radix/Base UI) are not used.

```
MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Lucide

- Upstream: https://github.com/lucide-icons/lucide
- Consulted: 2026-08-23 (`lucide-static` 1.33.0)

**What it is used for.** The icons the webviews draw
(`packages/vscode/src/webviews/shared/icons.ts`) are Lucide's SVG paths,
inlined so the pages stay asset-free.

```
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```

---

## Node.js

- Upstream: https://nodejs.org
- Bundled build: `node-v24.18.1-win-x64`, unmodified
- Ships in: `px-lsp-win-x64-<version>.zip` only (not in the .vsix, not in the
  server tarball, not in the npm packages)

**What it is used for.** The self-contained Windows artifact carries the
official `node.exe` so the server runs on a machine with no Node install.
`scripts/build-server-zip.mjs` downloads the published dist archive from
nodejs.org, verifies it against that release's `SHASUMS256.txt` and copies the
binary in byte for byte; nothing is patched or recompiled, and the toolkit's
own code stays a separate work in the same archive.

Node's license text also covers the components Node itself bundles (V8,
OpenSSL, ICU and many more) and runs to thousands of lines, so instead of
excerpting it the full file ships next to the binary as `NODE-LICENSE`. That
copy is the one that governs the bundled `node.exe`.
