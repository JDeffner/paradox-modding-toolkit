# AGENTS.md

Agent-facing guide for this repo. `CLAUDE.md` is `@AGENTS.md`.

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
  `.ck3modding/`, `zzz_ck3_modding_edits_*.yml`. The `paradox*` language ids
  and `paradox/*` wire methods mean "the engine family"; do NOT rename them.
- **Deep validation belongs to ck3-tiger.** Our diagnostics stay structural
  and certain (braces, encodings, folder traps).
- **The games fail silently**, so every writer produces files correct by
  construction: loc yml = UTF-8 **with BOM** + `l_<lang>:` header +
  `_l_<lang>.yml` filename; script `.txt` = UTF-8 with BOM; event files
  START with their `namespace =` line.
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

## Hit-every-surface checklist

The most common defect: a change that works on the path you tested and is
missing everywhere else. Before calling work done, walk these and say which
applied:

| Axis | Question |
|---|---|
| Games | One decision per GameProfile (`ck3`, `vic3`, `eu5`), even "not supported". Gate on profile data, not `if (gameId === ...)`; the boundary check enforces it. |
| Clients | VS Code is the rich client; bare LSP clients and the Studio get degraded-but-honest behavior via capability gates (`clientCommands`, `snippetSupport`, `fileLinks`), never broken markup or dead links. |
| Entry points | A feature usually also needs: command palette entry, Project-panel row, `when`-scoped keybinding, walkthrough mention. |
| Contracts | Anything on the wire is typed in `packages/protocol` and documented in `docs/PROTOCOL.md`; embedder-visible behavior also in `docs/EMBEDDING.md`. Changing either doc means porting it to its wiki mirror in the same session. |
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
| `packages/vscode/skills/ck3-modding/` | Agent skill for CK3 modding itself. Machine-agnostic; excluded from the vsix |
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

The base game files are THE source of truth for script syntax. Grep the game
folder or the `_*.info` docs; never guess names.

## Build, test, verify

```bash
pnpm install
pnpm run compile        # server bundle + extension bundle + data copy
npx tsc --noEmit        # typecheck (esbuild does not check types)
pnpm run lint           # eslint + prettier --check (both gate CI)
npx vitest run          # suite (corpus-gated tests skip without dev-paths)
node scripts/check-game-boundary.mjs   # run whenever you touch packages/server/src
```

- Verify what you changed: touched tests + typecheck + lint. The full
  corpus-gated suite is for cross-cutting changes (rank-eval alone ~4 min).
- Two corpus timing tests can fail under full-suite load; re-run them alone
  before believing a red run.
- Completion changes MUST be justified with `fuzzy-diag`/`rank-eval`
  numbers, run BEFORE and AFTER.
- Cross-cutting refactors are gated on CK3 rank-eval staying byte-identical
  and CK3 `freqs.json` regenerating byte-identical.
- Protocol additions extend `lspSmoke.test.ts`. Scaffold/writer changes get
  validated against real ck3-tiger on a scratch mod.

**Test builds finish extension work.** When a change alters what the editor
does, end with:

```bash
pnpm run package:test   # compile, vsce package, code --install-extension --force
```

then say it is installed and VS Code needs `Developer: Reload Window`.
Skip only for changes with nothing to try in the editor, and say so. Never
commit a vsix.

## Landing work

1. **Branch first** (`feat/`, `fix/`, `docs/`, `chore/`), never from a
   `main` checkout. Commit messages explain the WHY, with measured numbers.
2. **A feature or fix PR writes changelog bullets, nothing else.** One bullet
   under "Unreleased" in `packages/vscode/CHANGELOG.md`; server or protocol
   changes also get one in that package's own `CHANGELOG.md`. Do NOT touch
   release notes, README feature lists or the wiki from a feature PR.
3. Push and open the PR:
   ```bash
   git push -u origin <branch>
   gh pr create --base main --title "<title>" --body "<why, with numbers>"
   ```
   Multi-PR efforts may target an `integration/<version>` branch.
4. **Stop and hand over the PR link.** The squash merge is the maintainer's call.
5. Sourcery reviews every PR (`gh pr checks <n>`). A finding is a pointer,
   not a verdict: verify, fix what is real, dismiss false positives with a
   written reason. With stacked PRs, fix on the branch the file belongs to.

**The release PR writes everything else.** Cutting `<v>`:

- Roll "Unreleased" into `<v>` headings; check `git log v<prev>..HEAD`
  against the changelog.
- Write `docs/release/<v>.md` (curated Unreleased bullets). release.yml uses
  it as the GitHub Release body and Discord announcement; a missing file
  falls back to a generated commit list.
- Sweep `packages/vscode/README.md` Highlights and the root README only if
  user-visible features changed.
- Versioning is NOT lockstep: `packages/vscode` + root `package.json` bump
  every release; `packages/server` and `packages/protocol` bump only when
  changed. The tag must match `packages/vscode/package.json`. Never pass
  `--pre-release` to vsce.
- Full runbook: `docs/RELEASING.md`.

**Wiki mirrors:** `docs/EMBEDDING.md` → wiki "Embedding", `docs/PROTOCOL.md`
→ wiki "Protocol Reference" (repo copies canonical). Port changes to the
wiki in the same session (clone `paradox-modding-toolkit.wiki.git`).

**Work artifacts stay out of the repo.** Plans live in PR descriptions;
durable decisions in the tracked docs, present tense; the merged PR is the
record. Do not create notes under `docs/`.

## Regenerating bundled data (per game patch)

`npx esbuild scripts/<name>.ts --bundle --platform=node --outfile=dist/<name>.cjs && node dist/<name>.cjs`
(then delete the .cjs). Per-game scripts take `--game <id>`, default `ck3`.

| Script | Output | What it does |
|---|---|---|
| `build-structures-json.ts` | `data/ck3/structures.json` | Harvests every `_*.info` doc (CK3-only) |
| `build-gui-schema.ts [--game]` | `data/<id>/guiSchema.json` | Widget types + property counts from vanilla `gui/` |
| `build-freqs.ts [--game]` | `data/<id>/freqs.json` | Per-context usage counts. CK3 regen stays byte-identical modulo `meta.generated` unless the game patched |
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
