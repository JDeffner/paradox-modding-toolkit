# AGENTS.md

Agent-facing guide for this repo. `CLAUDE.md` is `@AGENTS.md`.

Keep these public instructions, skills, and supporting references independent of any person's identity. Use "the user" or "the maintainer" instead of the user's personal name. Do not copy personal details from local agent configuration into tracked files. Preserve required repository URLs and package identifiers.

## What this project is

The **Paradox Modding Toolkit** (`JDeffner.px-toolkit`): a VS Code extension
plus a standalone LSP server (`@px-lsp/server`) for Paradox/Jomini script
modding across Crusader Kings III, Victoria 3 and Europa Universalis V.
Tolerant parser, scope-aware completion, hover docs, structural diagnostics,
ck3-tiger integration, event graph, GUI editor with a pixel-calibrated layout
engine, DDS tooling, localization workflow. The server also serves bare LSP
clients (neovim) and an external WPF IDE (Sage's Clausewitz Studio, owned by
lennart99v).

**Core design idea:** all language knowledge is *derived from the game
itself* (the user's `script_docs` logs, vanilla files, harvested `_*.info`
docs, real-corpus usage counts), never hand-maintained rule files.

Terms: **mod** = user content package; **vanilla** = shipped game files,
indexed read-only, never diagnosed; **`gameId`** = `ck3`/`vic3`/`eu5`, one
per workspace; **GameProfile** = the boundary behind which ALL game-specific
knowledge lives (`packages/server/src/games/<id>/`); **schema** = per-game
folder-to-definition-kind table; **harvest** = build-time script output in
`data/<id>/*.json`; **tiger** = ck3-tiger/vic3-tiger; **loc** = Paradox
localization (`*_l_<lang>.yml`, UTF-8 with BOM).

## Hard rules (no override; if a task fights one, stop and ask the maintainer)

1. **Never commit or push to `main`.** `main` = one squash commit per PR,
   created only by the maintainer. Check your branch before the first edit; never use
   a worktree with `main` checked out. Old release recipes that push `main`
   directly are superseded.
2. **Never hand-code game knowledge from memory.** Find it in the game
   install, the `_*.info` docs, a `script_docs` dump or a harvest, or don't
   add it.
3. **No Studio-origin content in a commit.** `docs/reference/studio/`
   (gitignored) is C# for human consultation only. Nothing from it may be
   translated, ported or committed into this GPL repo; GUI parity is a
   spec-driven rebuild from `docs/gui-designer/parity-checklist.md` with a
   design-credit header (see `gui/sourceEdit*`).
4. **No machine paths in tracked files.** They live in `dev-paths.json`
   (gitignored) or env vars.

## Invariants

- **AD-5 "annotate, never hide":** scope inference ranks and labels
  completion items but emits zero diagnostics and never removes an item for
  scope reasons. (Server-side word-filtering/capping is fine.)
- **`px` names the product, `ck3` names the game.** Ours: `px-toolkit`,
  `px.*` settings/commands, `@px-lsp/*`, `# px:ignore`. The game's:
  `gameId`, `games/ck3/`, `data/ck3/`, `ck3-tiger`, `ck3-script`,
  `zzz_ck3_modding_edits_*.yml` (`.ck3modding/` is the pre-0.4.0 name of
  the `.px-toolkit/` config dir, read as a fallback). The `paradox*` language ids
  and `paradox/*` wire methods mean "the engine family"; do NOT rename them.
- **Deep validation belongs to ck3-tiger.** Our diagnostics stay structural
  and certain (braces, encodings, folder traps).
- **The games fail silently**, so every writer produces files correct by
  construction: loc yml = UTF-8 **with BOM** + `l_<lang>:` header +
  `_l_<lang>.yml` filename; script `.txt` = UTF-8 with BOM; event files
  START with their `namespace =` line.
- **Writers preserve user work.** Use the current editor document when it has unsaved edits; do not overwrite it from a stale disk snapshot. Before applying a preview or merge, check that its source documents and files still match. Reject stale results and require a fresh preview. Preserve unrelated content and keep vanilla and reference inputs read-only. Report write failures as failures.
- **`localization/replace/` only overrides vanilla keys.** New keys go to
  the mod loc file holding their siblings (`writeLocSmart` /
  `upsertNewModLoc` in `packages/vscode/src/locCommands.ts`).
- **Override rules:** script databases are last-in-wins, `gui/` and
  `localization/replace` are first-in-wins.
- **No `vscode` imports** in `packages/server` or `packages/protocol`
  modules that carry logic; they must be unit-testable in plain Node.
- The parse cache (`packages/server/src/parseCache.ts`) is keyed by
  **uri + version**. In tests and scripts, use a fresh URI per document
  text or you get a stale parse.

## Surface missing requirements

The user is not expected to know every modding requirement. Agents must identify and explain relevant shortcomings so the user can make informed product decisions.

- **Report limitations directly when found.** When code, documentation, game data or tests reveal a missing capability or prerequisite relevant to the requested feature or its advertised workflow, tell the user in a progress update. Include any unresolved limitation in the final handoff. A documentation note, TODO or deferred-feature entry alone is not enough.
- **Explain the practical effect.** State the affected use case, the evidence, what users will experience, and the recommended fix or workaround. Distinguish a quality reduction from output the game cannot use, and confirmed requirements from assumptions that still need verification.
- **Documentation does not establish acceptance.** Do not treat an existing limitation as an approved scope decision merely because it is documented or inherited from older code. When extending or reusing a feature, compare its known limitations with the intended workflow and the game's requirements.
- **Resolve gaps within the authorized scope.** Implement requirements needed to complete that workflow. If resolving a gap needs a material scope change or product decision, explain the tradeoff and recommendation to the user while continuing independent work. Do not silently narrow the feature's scope or promise to fit the implementation.
- **Verify the intended use.** A successful write or preview does not establish that the game can use the output. Check the relevant consumer requirements and report any verification gap. For example, if a texture workflow requires matching mip levels and the converter cannot produce them, surface that incompatibility directly instead of only documenting missing mipmap support.

## Hit-every-surface checklist

Before calling work done, check which existing surfaces the change affects and verify those paths. Add entry points or capabilities only when the requested behavior needs them. Report the affected surfaces and any verification gaps.

| Axis | Question |
|---|---|
| Games | One decision per GameProfile (`ck3`, `vic3`, `eu5`), even "not supported". Gate on profile data, not `if (gameId === ...)`; the boundary check enforces it. |
| Clients | VS Code is the rich client; bare LSP clients and the Studio get degraded-but-honest behavior via capability gates (`clientCommands`, `snippetSupport`, `fileLinks`), never broken markup or dead links. |
| Browser service | Shared server/protocol changes must preserve the browser language service. Keep Node-only dependencies out of its reachable code and run the browser build when that code or its bundled data changes. |
| Entry points | Check affected command palette entries, Project-panel actions, keybindings, and walkthrough instructions. Do not add all four by default. |
| Contracts | Anything on the wire is typed in `packages/protocol` and documented in `docs/PROTOCOL.md`; embedder-visible behavior also in `docs/EMBEDDING.md`. Update canonical docs with the implementation; publish their wiki mirrors as part of a requested release or wiki update. |
| Data | Per-game bundled data lives in `data/<id>/`; a new harvest needs a regen script row below and a `--game` flag. |
| Change notes | The changelog bullet ships in the same PR. |

## Repo map

| Path | What lives there |
|---|---|
| `packages/vscode/src/` | Extension host: language-mode switching, tiger runner + download, views, webview panels (`webviews/`), DDS editor/converter, loc commands, scaffolds, setup |
| `packages/server/src/` | The LSP server. `parser/` (tolerant CST, encoding), `index/`, `features/`, `scopes/`, `overview/`, `gui/` (layout engine + source writer), `schema/`, `games/<id>/` |
| `packages/protocol/src/` | Wire protocol, shared types/constants, translation core, suppression, tiger report parser, descriptorMod, fsWalk. One subpath export per module; no barrel |
| `packages/server/data/<id>/` | Bundled harvested data per game (`freqs.json`, `structures.json`, `guiSchema.json`, `wikidocs/` + ATTRIBUTION.md). Inlined into the server bundle |
| `packages/*/test/` | Vitest suites. `vscodeFuzzy.ts` = port of VS Code's suggest scoring; `rankEvalCore.ts` = ranking eval; `lspSmoke.test.ts` forks the real bundle over node IPC |
| `scripts/` | Build-time harvests, evals, packaging (`package-test.mjs`), brand generation |
| `packages/vscode/media/` | Icon, walkthrough pages, banner, `image-guidelines.md`. `media/` ships in the vsix; `docs/` does not |
| `packages/vscode/syntaxes/` | TextMate grammars |
| `docs/` | Tracked: `diagnostics/`, `gui-designer/`, `release/` (read by release.yml), `PROTOCOL.md`, `EMBEDDING.md`, `PERFORMANCE.md`, `deferred-features.md`, `RELEASING.md`, `file-icons.md`, `webviews.md`. Everything else under `docs/` is gitignored and should not exist |

Feature routing: completion ranking → `packages/server/src/features/completion.ts`;
context detection → `context.ts` + `contextKeywords.ts`; gui language →
`features/guiLanguage.ts`; `[ ... ]` datafunctions → `features/datafunction.ts`
+ `data/dataTypes.ts` + `data/dataFnUsage.ts` + `data/dataFnDocs.ts`;
gui layout engine → `gui/layoutEngine.ts` + `guiDefs.ts` (rules in
`docs/gui-designer/spec.md`, fixtures in `test/guiLayout.test.ts`); gui
source writer → `gui/sourceEdit*.ts` (contract:
`docs/gui-designer/parity-checklist.md`); descriptor.mod →
`packages/vscode/src/descriptorMod.ts` + `packages/protocol/src/descriptorMod.ts`;
event graph → `overview/eventGraph.ts` + `eventDetail.ts` +
`packages/vscode/src/webviews/eventGraph/panel.ts`; DDS →
`packages/server/src/dds/` + `packages/vscode/src/ddsEditor.ts`.

## Local machine paths (dev-paths.json)

`dev-paths.json` at the repo root (gitignored; copy `dev-paths.example.json`):

```json
{ "games": { "ck3": { "gamePath": "…", "logsPath": "…", "modPath": "…",
                      "modCorpus": "…", "tigerPath": "…" },
             "vic3": { "gamePath": "…" } } }
```

Env overrides: `PX_<GAMEID>_GAME_PATH`, `_LOGS_PATH`, `_MOD_PATH`,
`_MOD_CORPUS`, `_TIGER_PATH`. Loader: `scripts/devPaths.ts`. Corpus-gated
tests skip when a path is unset. The shipped extension reads none of this.

Compatch tooling is deferred and has no current test runner or supported `devPath` keys. Do not configure `compatchBasePath` or `compatchTargetPath` as working setup options. Add configuration and a documented real-data exercise together when a consumer exists.

The base game files are THE source of truth for script syntax. Grep the game
folder or the `_*.info` docs; never guess names.

## Build, test, verify

```bash
pnpm install
pnpm run compile        # server bundle + extension bundle + data copy
pnpm run typecheck     # root + separate webview projects; esbuild does not check types
pnpm run lint           # eslint + prettier --check (both gate CI)
pnpm test               # suite (corpus-gated tests skip without dev-paths)
node scripts/check-game-boundary.mjs   # server or protocol source changes
```

- Verify what you changed: touched tests + typecheck + lint. The full
  corpus-gated suite is for cross-cutting changes (rank-eval alone ~4 min).
- For focused tests, use `pnpm exec vitest run <test-path>`. Compile first when tests exercise a bundled server. Report relevant skipped tests and missing corpus settings; a skipped check is not verification.
- When browser-reachable server/protocol code or its bundled data changes, run `pnpm run bake:browser` followed by `pnpm --filter @px-lsp/server run compile:browser`, matching CI.
- Two corpus timing tests can fail under full-suite load; re-run them alone
  before believing a red run.
- Completion changes MUST be justified with `fuzzy-diag`/`rank-eval`
  numbers, run BEFORE and AFTER.
- Cross-cutting refactors are gated on CK3 rank-eval staying byte-identical
  and CK3 `freqs.json` regenerating byte-identical.
- Protocol additions extend `lspSmoke.test.ts`. Scaffold/writer changes get
  validated against real ck3-tiger on a scratch mod.
- Writer changes also verify preservation of unrelated content and, where applicable, unsaved edits, stale-preview rejection, and failure reporting. Validator success alone does not prove that an edit preserved user work.
- Every release adds a row to the performance history: `pnpm run perf:history`
  over a real `.code-workspace` (recipe in `docs/PERFORMANCE.md`, rows in
  `packages/server/test/perf/history.json`). Server changes that touch the
  index or completion add a row before and after.

**Verify editor behavior in the packaged build.** When a change alters what the editor does, prepare the test profile described below, then run:

```bash
pnpm run package:test   # compile, package, install into PXTK Development
```

Launch or reload the `PXTK Development` test window so it loads the new build. Exercise the affected user action through its actual entry point, check the visible or saved result, and test a relevant failure case. For UI changes, inspect the rendered UI; calling an internal handler alone does not verify that the user can reach it. Automated editor checks may use the isolated extension-host setup below with the same build.

Report packaging/installation and observed behavior separately. If the host could not be reloaded or a behavior could not be exercised, state the remaining check and the blocker. Installation alone does not establish that the feature works. Skip editor verification only for changes with no editor behavior to exercise, and say so. Never commit a vsix.

### VS Code test profile

Use the separate **PXTK Development** profile for agent-driven editor checks and manual toolkit development. Always specify `--profile "PXTK Development"` when launching VS Code or installing a test extension. The F5 launches and `package:test` script select this profile. Do not automate the developer's normal window.

```bash
code --new-window --profile "PXTK Development" <test-workspace>
```

Launch the command above once before the first test installation: VS Code creates a missing profile on launch, but `--install-extension --profile` requires the profile to exist already. Profiles separate settings and enabled extensions, but are not complete test isolation. Automated extension-host suites should use disposable `--user-data-dir` and `--extensions-dir` folders under `.local/testing/`. Existing runners that already use isolated directories can retain their own test profiles. Use the same isolation arguments for installation and launch, and keep generated mods and test output in the ignored local folders. Unit tests and bare LSP tests do not need VS Code.

### Live Webview development

For live webview work, install [Live Webview from the Marketplace](https://marketplace.visualstudio.com/items?itemName=JDeffner.live-webview) into **PXTK Development**:

```bash
code --profile "PXTK Development" --install-extension JDeffner.live-webview
```

The companion must be enabled in the Extension Development Host that runs the toolkit. The current build also needs the built helper from a Live Webview checkout: set `liveWebviewPath` in the ignored `dev-paths.json`, or `PX_LIVE_WEBVIEW_PATH`, to that checkout. Marketplace installation supplies the companion, not this helper. Use **Run Extension + Live Webview** for frontend iteration; host-code changes require a rebuild and host restart. See `docs/webviews.md` for the build loop. Finish with a normal packaged-build check, since production builds remove the helper.

## Landing work

1. **Branch first** (`feat/`, `fix/`, `docs/`, `chore/`), never from a
   `main` checkout. Commit messages explain the WHY, with measured numbers.
2. **Feature and fix PRs update changelogs and affected technical documentation.** Add a bullet under "Unreleased" in `packages/vscode/CHANGELOG.md`; server or protocol changes also get one in that package's own `CHANGELOG.md`. Keep canonical protocol, embedding, and other affected technical docs correct in the same change. Update source attribution when adding an upstream source. Release notes, README feature lists, and wiki publication belong to release work.
3. **Commit, push, or open a PR only when requested.** For a requested push and PR:
   ```bash
   git push -u origin <branch>
   gh pr create --base main --title "<title>" --body "<why, with numbers>"
   ```
   Multi-PR efforts may target an `integration/<version>` branch.
4. If a PR was requested, hand over its link after verification and required review follow-up. Otherwise report the local changes and checks. The squash merge is the maintainer's call.
5. Sourcery reviews every PR (`gh pr checks <n>`). A finding is a pointer,
   not a verdict: verify, fix what is real, dismiss false positives with a
   written reason. With stacked PRs, fix on the branch the file belongs to.

**A requested release updates release material.** Cutting `<v>`:

- Roll "Unreleased" into `<v>` headings; check `git log v<prev>..HEAD`
  against the changelog.
- Write `docs/release/<v>.md` (curated Unreleased bullets). release.yml uses
  it as the GitHub Release body and Discord announcement; a missing file
  falls back to a generated commit list.
- Sweep `packages/vscode/README.md` Highlights and the root README only if
  user-visible features changed.
- Versioning is NOT lockstep: `packages/vscode` + root `package.json` bump
  every release; `packages/server` and `packages/protocol` bump only when
  changed. The tag must match `packages/vscode/package.json`. Pass
  `--pre-release` to vsce only when the manual Release workflow option is selected.
- Full runbook: `docs/RELEASING.md`.

**Wiki mirrors:** `docs/EMBEDDING.md` → wiki "Embedding", `docs/PROTOCOL.md` → wiki "Protocol Reference". The repo copies are canonical and change with the implementation. Sync the wiki from the corresponding release revision during a requested release, or from the revision specified for a requested wiki update. A feature or fix request alone does not authorize wiki publication.

**Work artifacts stay out of the repo.** Plans live in PR descriptions;
durable decisions in the tracked docs, present tense; the merged PR is the
record. Do not create notes under `docs/`.

Keep local test projects and compatch fixtures in the ignored `.local/testing/` folder. Put temporary worktrees in `.local/worktrees/` and test artifacts in `.local/artifacts/`. Do not create sibling project folders for this work. The current test VSIX lives in `packages/vscode/`; older local builds can be kept in `.local/builds/archive/`.

## Regenerating bundled data (per game patch)

`pnpm exec esbuild scripts/<name>.ts --bundle --platform=node --outfile=dist/<name>.cjs && node dist/<name>.cjs`
(then delete the .cjs). Per-game scripts take `--game <id>`, default `ck3`.

| Script | Output | What it does |
|---|---|---|
| `build-asset-vocabulary.ts [--game]` | `data/<id>/assetVocabulary.json` | Context-specific graphics properties and usage counts from vanilla `.asset` files; no binaries |
| `build-structures-json.ts` | `data/ck3/structures.json` | Harvests every `_*.info` doc (CK3-only) |
| `build-gui-schema.ts [--game]` | `data/<id>/guiSchema.json` | Widget types + property counts from vanilla `gui/` |
| `build-freqs.ts [--game]` | `data/<id>/freqs.json` | Per-context usage counts. CK3 regen stays byte-identical modulo `meta.generated` unless the game patched |
| `build-skeletons.ts [--game]` | `data/<id>/skeletons.json` | Definition skeletons: the keys at least half a kind's vanilla definitions carry, in median order, with the measured value vocabulary. Byte-identical modulo `meta.generated` unless the game patched; a game with no `gamePath` writes an empty table |
| `import-cwt-types.ts <clone>` | `games/eu5/schema.generated.ts` | Importer from a pinned cwtools-eu5-config clone; update the pinned commit in the file header AND `THIRD-PARTY-NOTICES.md` |
| `audit-schema-coverage.ts [--game]` | stdout | Schema vs game folders; gaps 0 or documented |
| `gen-brand.ts` / `gen-icons.ts` | `media/` | Geometry in `brandGeometry.ts`; guide in `docs/file-icons.md` |
| `gen-codicon-glyphs.ts` | `webviews/exampleWiki/codiconGlyphs.ts` | Inlines the codicons named in `protocol/kinds.ts` |
| `rank-eval.ts` / `fuzzy-diag.ts` | stdout | Completion-quality measurement |

## Conventions

- User-facing prose avoids em dashes; code comments follow existing style.
- Comments state constraints and provenance ("measured", "per batch 03"),
  not narration.
- The vsix stays self-contained (esbuild-bundled); new runtime npm deps are
  almost never the answer.
- Adding an upstream source extends the README table AND the relevant
  notices file (`THIRD-PARTY-NOTICES.md`, `data/ck3/wikidocs/ATTRIBUTION.md`).
