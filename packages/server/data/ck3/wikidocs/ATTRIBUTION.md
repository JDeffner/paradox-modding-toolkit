# Attribution

The Markdown files in this folder (`Effects_list.md`, `Triggers_list.md`, `Scopes_list.md`
from snapshot 5bf4300, 2026-06-09; `Data_types.md` from the `ck3-modding-wiki` npm package
1.20251107.0) are copied from the [ck3-modding-wiki](https://github.com/jesec/ck3-modding-wiki)
repository, which mirrors the official
[CK3 Paradox Wiki](https://ck3.paradoxwikis.com/Category:Modding).
`packages/server/data/ck3/dataTypes.json` is generated from `Data_types.md` by
`scripts/build-data-types-json.ts` and remains under the same license.

The wiki content is licensed under
[Creative Commons Attribution-Share Alike 3.0](https://creativecommons.org/licenses/by-sa/3.0/).
These files (and any derivative of their content) remain under that license; the extension's
own source code is separately licensed under GPL-3.0-or-later (see `LICENSE`).

To refresh them, copy the same files from a current checkout of the
ck3-modding-wiki repository into this folder, update the snapshot reference above,
and re-run `scripts/build-data-types-json.ts`.
