# AGENTS.md — orientation for AI agents working in this repo

## What this project is

A VS Code extension ("Paradox Toolkit", id `px-toolkit`) that gives Crusader
Kings III mod authors a full language workbench: an LSP server with a
hand-written tolerant parser for Paradox/Jomini script, grammar-aware
completion, hover docs, diagnostics for the silent-failure class of bugs,
ck3-tiger integration, an editable event-graph webview, DDS texture
preview/conversion, PdxGui support, and localization tooling.

**The one design idea that explains most decisions:** all language knowledge
is *derived from the game itself* — the user's `script_docs` logs, the vanilla
files, harvested `_*.info` schema docs, and real-corpus usage counts — never
hand-maintained rule files (that is what killed CWTools). If you are about to
hard-code a trigger/effect/property name from memory, stop: find it in the
game files or a harvest, or don't add it.

## Non-negotiable invariants

- **AD-5 "annotate, never hide":** scope inference ranks and labels completion
  items but emits zero diagnostics and never removes an item for scope
  reasons. (Server-side word-filtering/capping is fine — it mirrors what the
  client drops anyway.)
- **PX names the product, `ck3` names the game.** Everything we invent is
  `px`/Paradox Toolkit: extension id `px-toolkit`, `px.*` settings and
  commands, `@px-lsp/*` packages, `# px:ignore`, `px-descriptor`. Everything
  belonging to Crusader Kings III stays `ck3`: the `gameId`, `games/ck3/`,
  `data/ck3/`, `ck3-tiger`, `ck3-script`, `.ck3modding/` in the user's mod,
  and the `zzz_ck3_modding_edits_*.yml` file we write into it. The
  `paradox*` language ids and the `paradox/*` wire methods predate the brand
  and mean "the engine family" — do NOT rename them to `px`.
- **Deep validation belongs to ck3-tiger,** not us. Our own diagnostics stay
  structural and certain (braces, encodings, folder traps).
- **CK3 fails silently.** Every writer in this repo must produce files that
  are correct by construction: loc yml = UTF-8 **with BOM** + `l_<lang>:`
  header + `_l_<lang>.yml` filename; script `.txt` = UTF-8 with BOM (vanilla
  ships BOMs everywhere; tiger warns otherwise); event files START with their
  `namespace =` line.
- **`localization/replace/` is only for overriding vanilla keys.** New keys go
  to the mod loc file holding their siblings (`writeLocSmart` /
  `upsertNewModLoc` in `packages/vscode/src/locCommands.ts`).
- **Override rules:** script databases are last-in-wins (LIOS), `gui/` and
  `localization/replace` are first-in-wins (FIOS).
- **No `vscode` imports** in `packages/server` or `packages/protocol` modules
  that carry logic — they must be unit-testable in plain Node. UI-only code
  lives in `packages/vscode`.
- The parse cache (`packages/server/src/parseCache.ts`) is keyed by **uri + version**.
  In tests and scripts, use a fresh URI per document text or you will get a
  stale parse (this has bitten twice).

## Repo map

| Path | What lives there |
|---|---|
| `packages/vscode/src/` | Extension host: language-mode switching, tiger runner + download, views (`views.ts`), webview panels (`webviews/eventGraph`, `webviews/guiTree`), DDS editor/converter, loc commands, scaffolds (`scaffold/`), setup |
| `packages/server/src/` | The LSP server (`@px-lsp/server`). `parser/` (tolerant CST, encoding), `index/` (definition/reference indexing, extraction modes), `features/` (completion, hover, guiLanguage, diagnostics, semantic tokens, …), `scopes/` (inference), `overview/` (graph, event detail, coverage, overrides), `schema/` (loader + the CK3 tables: `ck3Schema.ts`, `structures.ts`, `ambientScopes.ts`) |
| `packages/protocol/src/` | `@px-lsp/protocol`: wire protocol (`protocol.ts`), shared types/constants, translation core, suppression, tiger report parser, descriptorMod, fsWalk. One subpath export per module (`@px-lsp/protocol/<module>`); no barrel |
| `packages/server/data/ck3/` | Bundled harvested data: `freqs.json` (usage counts), `structures.json` (all `_*.info` keys), `guiSchema.json` (widget vocabulary). JSON-imported, inlined into the server bundle |
| `packages/*/test/` | Vitest suites, package-local. The bulk (plus `fixtures/`, `parser/`, `dds/`) lives in `packages/server/test`: `vscodeFuzzy.ts` = faithful port of VS Code's suggest scoring; `rankEvalCore.ts` = ranking eval harness; `lspSmoke.test.ts` forks the real bundle over node IPC. Protocol-pure tests in `packages/protocol/test`; client-ish ones in `packages/vscode/test` |
| `scripts/` | Build-time harvests and evals (see "Regenerating data") |
| `packages/server/data/ck3/wikidocs/` | Bundled wiki token lists (CC BY-SA, see its ATTRIBUTION.md) — the fallback when the user has no `script_docs` logs |
| `packages/vscode/media/` | Icon, walkthrough pages, `image-guidelines.md`. `media/` SHIPS in the vsix; `docs/` does NOT |
| `docs/` | Tracked: `diagnostics/` (per-code explanations, linked from README + diagnostic codes), `gui-designer/` (the in-game layout-calibration campaign: spec + evidence), `guides/` (UI-modding guide + screenshots, referenced by the skill). Everything else (design history: `rework-plan.md`, `UPDATE_PLAN_v1.1.md`, `research.md`, …) is LOCAL-ONLY, gitignored |
| `packages/vscode/skills/ck3-modding/` | A Claude/agent skill for CK3 modding itself (not the extension): routing table, per-system recipes, validation workflow, distilled AGOT/PoD pattern notes. Machine-agnostic: paths appear as `<game>`/`<logs>`/`<mods>`/`<workshop>`/`<tiger>` placeholders resolved per SKILL.md Step 0. Excluded from the vsix |
| `packages/vscode/syntaxes/` | TextMate grammars (`paradox`, `paradox-loc`, `paradox-info` for the game's `_*.info` format docs, `paradox-mod` for .mod descriptors; `paradox-gui` reuses the script grammar) |

Feature routing (most-touched files): completion ranking →
`packages/server/src/features/completion.ts`; context detection →
`packages/server/src/context.ts` + `contextKeywords.ts`; gui language →
`features/guiLanguage.ts`; `[ ... ]` datafunctions →
`features/datafunction.ts` + `data/dataTypes.ts` (wiki/dump tables) +
`data/dataFnUsage.ts` (cached runtime harvest of vanilla gui+loc usage) +
`data/dataFnDocs.ts` (curated/deduced descriptions); gui layout engine (designer preview) →
`packages/server/src/gui/layoutEngine.ts` + `guiDefs.ts` (template/type store, FIOS)
(rules measured in `docs/gui-designer/calibration/spec.md`, fixtures in
`packages/server/test/guiLayout.test.ts`);
descriptor.mod (completion/hover/diagnostics, missing-descriptor check) →
`packages/vscode/src/descriptorMod.ts` + `packages/protocol/src/descriptorMod.ts` (field table, validator);
event graph/inspector →
`packages/server/src/overview/eventGraph.ts` + `eventDetail.ts` +
`packages/vscode/src/webviews/eventGraph/panel.ts`; DDS →
`packages/server/src/dds/` (decoder + encoder, no vscode imports) +
`packages/vscode/src/ddsEditor.ts` / `ddsConvert.ts`.

## Local machine paths (dev-paths.json)

Machine-specific paths (game folder, logs, your mod, an eval corpus mod, the
tiger binary) live in ONE central place: `dev-paths.json` at the repo root,
gitignored — copy `dev-paths.example.json` and fill it in. Slots are per game:

```json
{ "games": { "ck3": { "gamePath": "…", "logsPath": "…", "modPath": "…",
                      "modCorpus": "…", "tigerPath": "…" },
             "vic3": { "gamePath": "…" } } }
```

Environment variables override per game and key:
`PX_<GAMEID>_GAME_PATH`, `PX_<GAMEID>_LOGS_PATH`, `PX_<GAMEID>_MOD_PATH`,
`PX_<GAMEID>_MOD_CORPUS`, `PX_<GAMEID>_TIGER_PATH` (e.g. `PX_VIC3_GAME_PATH`).
The loader is `scripts/devPaths.ts`; every accessor defaults to game `ck3`.
Back-compat for ck3 only: the old flat `dev-paths.json` shape (`gamePath`,
`corpusPath`, …) and the old `CK3_*` env var names keep working.
Corpus-gated tests skip when a path is unset; scripts print usage and exit.
Never hardcode a personal path in a tracked file. (The shipped extension does
not read any of this: at runtime, paths come from VS Code settings with
auto-inference.)

The base game files are THE source of truth for script syntax. Never guess
names; grep the game folder or the `_*.info` docs. The `~/.claude/skills/
ck3-modding` skill has distilled references if present.

## Build, test, package

```bash
pnpm install
pnpm run compile        # server bundle + extension bundle, then copies
                        # server.js + data/ck3 into packages/vscode (self-contained)
npx tsc --noEmit        # typecheck (esbuild does not check types)
pnpm run lint           # eslint + prettier --check (both gate CI)
pnpm run lint:fix       # autofix what is autofixable
npx vitest run          # fast suite (corpus-gated tests skip without env)

# Full gated suite (needs games.ck3.gamePath + games.ck3.modCorpus in dev-paths.json, or the env vars):
npx vitest run          # (rank eval alone takes ~4 min; exclude packages/server/test/rankEval.test.ts when iterating)

# Package (vsce runs in the extension package):
cd packages/vscode && npx vsce package --pre-release --no-dependencies
```

## Releasing

Branch model: `dev` = full working history, LOCAL-ONLY (never push it; the
remote was deliberately purged of history). `main` = the public face: the
initial commit plus ONE commit per release. To cut a release from dev:

```bash
git checkout main
git read-tree -u --reset dev      # main's tree becomes exactly dev's tree
git commit -m "v<version>: <summary>"
git push origin main
git tag v<version> && git push origin v<version>
```

(NOT `git merge` and not `git merge --squash` — with the disjoint histories
both produce add/add conflicts or drag dev's history into main.)

The tag push triggers `.github/workflows/release.yml`: build, test, package,
GitHub Release with the vsix attached. Publishing to the VS Code Marketplace
is a manual workflow run with "publish" checked; it needs the `VSCE_PAT` repo
secret (Azure DevOps PAT, scope Marketplace→Manage) and the publisher
**JDeffner** created once at marketplace.visualstudio.com/manage. Keep the
minor version odd while pre-release (0.1.x, 0.3.x — Marketplace convention);
vsix builds use `--pre-release` until 1.0.

Gotchas:
- **The tag must match `packages/vscode/package.json` version.** `v0.1.3`
  was tagged on a commit still reading `0.1.2`, so the release carried a
  vsix whose version disagreed with its own tag. Bump first, then tag.
- `dist/*.cjs` (harvest/eval bundles) are excluded by `.vscodeignore` now,
  so a stray one can no longer ship; no manual delete needed.
- Git prints LF→CRLF warnings on commit; harmless, ignore.
- The vsix must stay self-contained: everything is esbuild-bundled, so new
  runtime npm deps are almost never the answer.

## Regenerating bundled data (per game patch)

All are esbuild-bundled scripts: `npx esbuild scripts/<name>.ts --bundle
--platform=node --outfile=dist/<name>.cjs && node dist/<name>.cjs` (then
delete the .cjs).

The per-game scripts take `--game <id>` and default to `ck3`, reading their
paths from that game's `dev-paths.json` slots:
`node dist/build-freqs.cjs --game vic3`.

| Script | Output | What it does |
|---|---|---|
| `build-structures-json.ts` | `packages/server/data/ck3/structures.json` | Harvests every `_*.info` schema doc, validates keys against vanilla usage counts. CK3-only by design (only CK3 ships `_*.info` docs) |
| `build-gui-schema.ts [--game <id>]` | `packages/server/data/<id>/guiSchema.json` | Widget types + per-type property counts from the vanilla `gui/` tree |
| `build-freqs.ts [--game <id>]` | `packages/server/data/<id>/freqs.json` | Per-context token/def usage counts (vanilla + corpus). The context set is CK3-shaped; for other games the CK3-only contexts stay empty |
| `import-cwt-types.ts <clone>` | `packages/server/src/games/eu5/schema.generated.ts` | Projects the `types = { ... }` blocks of a pinned kaiser-chris/cwtools-eu5-config clone onto the EU5 schema table. NOT a build step: run by hand when re-pinning upstream, then update the pinned commit in the file header AND `THIRD-PARTY-NOTICES.md`, and read the "Not covered" block for newly dropped types |
| `audit-schema-coverage.ts [--game <id>]` | stdout | Compares the profile's schema table + `data/<id>/structures.json` against every game `_*.info` and common/ folder; run per patch, gaps should be 0 or documented |
| `gen-brand.ts` | `packages/vscode/media/icon.{png,svg}`, `media/px-view.svg`, `packages/server/media/px-lsp.svg` | The PX lockup. Geometry lives in `brandGeometry.ts` so the raster and the vector cannot drift; it asserts the ink is centred, so an off-centre icon fails the build rather than shipping |
| `gen-icons.ts` | `packages/vscode/media/fileicons/*.svg` | The per-language file icons; the script glyph is the brand "PS" letterforms imported from `brandGeometry.ts` |
| `rank-eval.ts` / `fuzzy-diag.ts` | stdout | Completion-quality measurement: rank-eval replays real corpus positions; fuzzy-diag replays typed prefixes through VS Code's own scoring — run BEFORE and AFTER any ranking change |

## Testing philosophy

- Logic lives in `packages/server`/`packages/protocol` without vscode imports
  so vitest covers it directly; `packages/vscode` UI code is exercised by the
  IPC smoke test and live passes.
- `packages/server/test/lspSmoke.test.ts` forks `dist/server.js` with
  `--node-ipc` exactly like the real client — the headless stand-in for a live
  VS Code pass. Extend it when adding protocol surface.
- Completion changes MUST be justified with `fuzzy-diag`/`rank-eval` numbers,
  not vibes: the suggest widget's behavior is simulated exactly by
  `packages/server/test/vscodeFuzzy.ts` (keep it in lockstep with upstream if
  VS Code changes).
- Scaffold/writer changes should be validated against the real ck3-tiger on a
  scratch mod (descriptor.mod + the generated files).

## Conventions

- User-facing prose (README, CHANGELOG entries, UI copy) avoids
  em dashes; code comments follow the existing style.
- Comments state constraints and provenance ("measured", "per §C2"), not
  narration of the code below them.
- Commit messages explain the WHY with measured numbers where they exist;
  version bumps follow feature releases (see CHANGELOG.md for the shape).
- The task history and per-release evidence live in CHANGELOG.md and
  `docs/`; read `docs/UPDATE_PLAN_v1.1.md` before redesigning completion.

## Upstream sources

See "Upstream sources & acknowledgements" in [README.md](README.md) — every
external repository, data set and reference this project uses, with licenses.
When you add a new one, extend that table AND this line's neighbor files
(packages/server/data/ck3/wikidocs/ATTRIBUTION.md pattern) as appropriate.
