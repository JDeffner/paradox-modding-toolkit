# Third-party notices

Paradox Toolkit is GPL-3.0-or-later (see `LICENSE`). It additionally contains
material derived from the MIT-licensed projects below. Their license texts are
reproduced verbatim as required.

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
