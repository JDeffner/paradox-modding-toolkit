# AGENTS.md — the one guide for AI agents working in this repo

This is the single source of agent-facing truth. `CLAUDE.md` is just
`@AGENTS.md`, so every agent tool loads the same file. Long procedures live
in the documents this file links; everything else agent-relevant is here.

## What this project is

The **Paradox Modding Toolkit** (`JDeffner.px-toolkit`): a VS Code extension
plus a standalone LSP server (`@px-lsp/server`) that give Paradox/Jomini
script modders a full language workbench across Crusader Kings III,
Victoria 3 and Europa Universalis V. Hand-written tolerant parser,
scope-aware completion, hover docs, diagnostics for the silent-failure class
of bugs, ck3-tiger integration, event graph, GUI editor with a
pixel-calibrated layout engine, DDS tooling, localization workflow. The
server also serves bare LSP clients (neovim) and an external WPF IDE
(Sage's Clausewitz Studio).

**The one design idea that explains most decisions:** all language knowledge
is *derived from the game itself* — the user's `script_docs` logs, the
vanilla files, harvested `_*.info` schema docs, real-corpus usage counts —
never hand-maintained rule files (that is what killed CWTools' CK3 support).

## How these rules bind

Most of this file is good defaults, and Joel's stated preference in the
session overrides them. Two sections are hard rules with no override:
"The ways to hurt yourself" and the invariants list. If a rule here fights
the task in front of you, say so loudly and get Joel's sign-off instead of
quietly breaking it.

## Glossary

- **mod**: a user's content package for a Paradox game; what our users edit.
- **vanilla**: the shipped game files; indexed read-only, never diagnosed.
- **game / `gameId`**: `ck3`, `vic3` or `eu5`; one active game per workspace.
- **GameProfile**: the boundary behind which ALL game-specific knowledge
  lives (`packages/server/src/games/<id>/`).
- **definition / reference**: an indexed name's declaration site / use site.
- **schema**: the per-game folder-to-definition-kind table driving indexing.
- **harvest**: a build-time script output bundled as `data/<id>/*.json`.
- **tiger**: ck3-tiger/vic3-tiger, the external deep validator we integrate.
- **loc**: Paradox localization (`*_l_<lang>.yml`, UTF-8 with BOM).
- **the Studio**: Sage's Clausewitz Studio, an external C# consumer of the
  server over stdio; owned by lennart99v, not by Joel.

## The ways to hurt yourself (hard rules, each learned the expensive way)

1. **Committing or pushing to `main`.** `main` is the public face: one
   squash commit per landed change, created ONLY by Joel squash-merging a
   PR. The whole 0.3.1 cycle was once committed straight onto `main` (11
   commits, 103 files) and recovering it needed a public-history rewrite.
   Check your branch before the first edit; never work in a worktree with
   `main` checked out; never push to `main` in any form. Old release
   recipes that push `main` directly (the `read-tree` cut in older docs)
   are superseded — do not run them.
2. **Hand-coding game knowledge from memory.** A trigger name, folder
   layout or loc rule written from recall is how rule files rot. Find it
   in the game install, the `_*.info` docs, a `script_docs` dump or a
   harvest — or don't add it.
3. **Letting Studio-origin content into a commit.** `docs/reference/studio/`
   (gitignored) holds C# from the Studio repo for HUMAN consultation only.
   Nothing from it may be translated, ported or committed into this GPL
   repo; the accepted route is a spec-driven rebuild from checklists and
   fixtures (see `docs/gui-designer/parity-checklist.md`), with a
   design-credit header, which is what `gui/sourceEdit*` already carries.
4. **Machine paths in tracked files.** Personal paths live in
   `dev-paths.json` (gitignored) or env vars, nowhere else.

## Non-negotiable invariants

- **AD-5 "annotate, never hide":** scope inference ranks and labels
  completion items but emits zero diagnostics and never removes an item for
  scope reasons. (Server-side word-filtering/capping is fine — it mirrors
  what the client drops anyway.)
- **PX names the product, `ck3` names the game.** Everything we invent is
  `px`: extension id `px-toolkit`, `px.*` settings and commands, `@px-lsp/*`
  packages, `# px:ignore`. Everything belonging to the game stays `ck3`:
  `gameId`, `games/ck3/`, `data/ck3/`, `ck3-tiger`, `ck3-script`,
  `.ck3modding/`, `zzz_ck3_modding_edits_*.yml`. The `paradox*` language ids
  and `paradox/*` wire methods mean "the engine family" — do NOT rename
  them to `px`.
- **Deep validation belongs to ck3-tiger,** not us. Our own diagnostics stay
  structural and certain (braces, encodings, folder traps).
- **The games fail silently.** Every writer must produce files correct by
  construction: loc yml = UTF-8 **with BOM** + `l_<lang>:` header +
  `_l_<lang>.yml` filename; script `.txt` = UTF-8 with BOM; event files
  START with their `namespace =` line.
- **`localization/replace/` is only for overriding vanilla keys.** New keys
  go to the mod loc file holding their siblings (`writeLocSmart` /
  `upsertNewModLoc` in `packages/vscode/src/locCommands.ts`).
- **Override rules:** script databases are last-in-wins (LIOS), `gui/` and
  `localization/replace` are first-in-wins (FIOS).
- **No `vscode` imports** in `packages/server` or `packages/protocol`
  modules that carry logic — they must be unit-testable in plain Node.
- The parse cache (`packages/server/src/parseCache.ts`) is keyed by
  **uri + version**. In tests and scripts, use a fresh URI per document text
  or you get a stale parse (this has bitten twice).

## The hit-every-surface checklist

The most common defect class here is a change that works on the path you
tested and is missing everywhere else. Before calling work done, walk these
axes and say which applied:

| Axis | Question |
|---|---|
| Games | One decision per GameProfile (`ck3`, `vic3`, `eu5`), even if the decision is "not supported here" (gate on profile data, not on `if (gameId === ...)` — the boundary check enforces it). |
| Clients | VS Code is the rich client; bare LSP clients (neovim) and the Studio get degraded-but-honest behavior via capability gates (`clientCommands`, `snippetSupport`, `fileLinks`), never broken markup or dead links. |
| Entry points | A feature reachable from one place usually also needs: command palette entry, Project-panel row, keybinding (`when`-scoped), walkthrough mention. |
| Contracts | Anything crossing the wire is typed in `packages/protocol` and documented in `docs/PROTOCOL.md`; embedder-visible behavior also in `docs/EMBEDDING.md`. Changing either doc means porting it to its wiki mirror in the same session. |
| Data | Per-game bundled data lives in `data/<id>/`; a new harvest needs its regen script row below and a `--game` flag. |
| Change notes | The changelog bullet ships in the same PR (see "Landing work"). |

## Repo map

| Path | What lives there |
|---|---|
| `packages/vscode/src/` | Extension host: language-mode switching, tiger runner + download, views, webview panels (`webviews/`), DDS editor/converter, loc commands, scaffolds, setup |
| `packages/server/src/` | The LSP server (`@px-lsp/server`). `parser/` (tolerant CST, encoding), `index/`, `features/`, `scopes/`, `overview/`, `gui/` (layout engine + source writer), `schema/`, `games/<id>/` (the GameProfile boundary) |
| `packages/protocol/src/` | `@px-lsp/protocol`: wire protocol, shared types/constants, translation core, suppression, tiger report parser, descriptorMod, fsWalk. One subpath export per module; no barrel |
| `packages/server/data/<id>/` | Bundled harvested data per game (`freqs.json`, `structures.json`, `guiSchema.json`, `wikidocs/` with its ATTRIBUTION.md). JSON-imported, inlined into the server bundle |
| `packages/*/test/` | Vitest suites, package-local. The bulk in `packages/server/test`: `vscodeFuzzy.ts` = faithful port of VS Code's suggest scoring; `rankEvalCore.ts` = ranking eval; `lspSmoke.test.ts` forks the real bundle over node IPC |
| `scripts/` | Build-time harvests, evals, packaging (`package-test.mjs`), brand generation |
| `packages/vscode/media/` | Icon, walkthrough pages, banner, `image-guidelines.md`. `media/` SHIPS in the vsix; `docs/` does NOT |
| `packages/vscode/skills/ck3-modding/` | An agent skill for CK3 modding itself (not the extension). Machine-agnostic placeholders; excluded from the vsix |
| `packages/vscode/syntaxes/` | TextMate grammars (`paradox`, per-game wrappers, `paradox-loc`, `paradox-info`, `paradox-mod`, `paradox-gui`) |
| `docs/` | Tracked: `diagnostics/` (per-code explanations), `gui-designer/` (calibration evidence + editor ledgers, see its README), `release/` (per-release notes, read by release.yml), `PROTOCOL.md`, `EMBEDDING.md`, `PERFORMANCE.md`, `deferred-features.md`, `RELEASING.md` (the release runbook), `file-icons.md`, `webviews.md` (the webview-panel pattern; CONTRIBUTING.md points contributors at it). Everything else under `docs/` is gitignored — and should not exist: working notes do not belong in the repo (see "Work artifacts") |

Feature routing (most-touched files): completion ranking →
`packages/server/src/features/completion.ts`; context detection →
`packages/server/src/context.ts` + `contextKeywords.ts`; gui language →
`features/guiLanguage.ts`; `[ ... ]` datafunctions → `features/datafunction.ts`
+ `data/dataTypes.ts` + `data/dataFnUsage.ts` + `data/dataFnDocs.ts`;
gui layout engine → `packages/server/src/gui/layoutEngine.ts` + `guiDefs.ts`
(rules measured in `docs/gui-designer/spec.md`, fixtures in
`packages/server/test/guiLayout.test.ts`); gui source writer →
`gui/sourceEdit*.ts` (contract: `docs/gui-designer/parity-checklist.md`);
descriptor.mod → `packages/vscode/src/descriptorMod.ts` +
`packages/protocol/src/descriptorMod.ts`; event graph →
`packages/server/src/overview/eventGraph.ts` + `eventDetail.ts` +
`packages/vscode/src/webviews/eventGraph/panel.ts`; DDS →
`packages/server/src/dds/` + `packages/vscode/src/ddsEditor.ts`.

## Local machine paths (dev-paths.json)

Machine-specific paths (game folder, logs, your mod, eval corpus, tiger
binary) live in ONE place: `dev-paths.json` at the repo root, gitignored —
copy `dev-paths.example.json`. Slots are per game:

```json
{ "games": { "ck3": { "gamePath": "…", "logsPath": "…", "modPath": "…",
                      "modCorpus": "…", "tigerPath": "…" },
             "vic3": { "gamePath": "…" } } }
```

Env vars override per game and key: `PX_<GAMEID>_GAME_PATH`,
`PX_<GAMEID>_LOGS_PATH`, `PX_<GAMEID>_MOD_PATH`, `PX_<GAMEID>_MOD_CORPUS`,
`PX_<GAMEID>_TIGER_PATH`. Loader: `scripts/devPaths.ts`; accessors default
to `ck3`; the old flat shape and `CK3_*` names keep working for ck3.
Corpus-gated tests skip when a path is unset. (The shipped extension reads
none of this; runtime paths come from VS Code settings with auto-inference.)

The base game files are THE source of truth for script syntax. Never guess
names; grep the game folder or the `_*.info` docs.

## Build, test, verify

```bash
pnpm install
pnpm run compile        # server bundle + extension bundle + data copy
npx tsc --noEmit        # typecheck (esbuild does not check types)
pnpm run lint           # eslint + prettier --check (both gate CI)
npx vitest run          # suite (corpus-gated tests skip without dev-paths)
```

- Scope verification to what you changed: the tests you touched plus
  typecheck and lint. The full corpus-gated suite (needs `gamePath` +
  `modCorpus`) is for cross-cutting changes; rank-eval alone takes ~4 min.
- Two corpus **timing** tests can fail under full-suite load and pass in
  isolation; re-run them alone before believing a red full run.
- Completion changes MUST be justified with `fuzzy-diag`/`rank-eval`
  numbers, not vibes; run them BEFORE and AFTER.
- Cross-cutting refactors are gated on CK3 rank-eval staying
  byte-identical and CK3 `freqs.json` regenerating byte-identical.
- Protocol additions extend `lspSmoke.test.ts` (the headless stand-in for a
  live VS Code pass). Scaffold/writer changes get validated against real
  ck3-tiger on a scratch mod.
- `node scripts/check-game-boundary.mjs` guards the GameProfile boundary;
  run it whenever you touch `packages/server/src`.

**Test builds are part of finishing extension work.** When a change alters
what the editor does, end with:

```bash
pnpm run package:test   # compile, vsce package, code --install-extension --force
```

then tell Joel it is installed and VS Code needs a reload
(`Developer: Reload Window`). Skip only for changes with nothing to try in
the editor (docs, CI, tests alone), and say so. Never commit a vsix.

## Landing work: branches, PRs, and change notes

1. **Branch first** (`feat/`, `fix/`, `docs/`, `chore/`), never from a
   `main` checkout. Granular commits belong on the branch; commit messages
   explain the WHY, with measured numbers where they exist.
2. **A feature or fix PR writes changelog bullets, and nothing else.** One
   bullet under "Unreleased" at the top of `packages/vscode/CHANGELOG.md`;
   server or protocol changes also get a bullet in that package's own
   `CHANGELOG.md` (they version independently — see below). Do NOT touch
   release notes, README feature lists or the wiki from a feature PR.
3. Push the branch and open the PR:
   ```bash
   git push -u origin <branch>
   gh pr create --base main --title "<title>" --body "<why, with numbers>"
   ```
   Multi-PR effort for one release may target an `integration/<version>`
   branch instead; that branch then PRs into `main`.
4. **Stop there and hand Joel the PR link.** The squash merge into `main`
   is Joel's call, and his alone.
5. Sourcery reviews every PR next to CI (`gh pr checks <n>` shows both). A
   finding is a pointer to a site, not a verdict: verify against source,
   fix what is real, dismiss false positives with a written reason. With
   stacked PRs, fix a finding on the branch the file belongs to, then merge
   upward.

**The release PR writes everything else.** Cutting version `<v>`:

- Roll the "Unreleased" sections into `<v>` headings; check
  `git log v<prev>..HEAD` against the changelog for anything missed.
- Write `docs/release/<v>.md` — mostly a curated paste of the Unreleased
  bullets. release.yml uses it as the GitHub Release body and the Discord
  announcement; a missing file falls back to a generated commit list
  (0.3.2 shipped that way; do not repeat it).
- Sweep the user-facing story ONLY if user-visible features changed:
  `packages/vscode/README.md` (the Marketplace listing) Highlights and the
  root README's short list.
- Versioning is NOT lockstep: `packages/vscode` + root `package.json` carry
  the release version and bump every release; `packages/server` and
  `packages/protocol` bump only when they changed. The tag must match
  `packages/vscode/package.json` (v0.1.3 was once tagged on a 0.1.2
  manifest). Never pass `--pre-release` to vsce.
- The full runbook (artifacts, tarball/zip smokes, Marketplace, npm) is
  `docs/RELEASING.md`.

**Wiki mirrors:** `docs/EMBEDDING.md` → wiki "Embedding" and
`docs/PROTOCOL.md` → wiki "Protocol Reference" (repo copies canonical).
Whenever you change either repo doc, port the change to the wiki page in
the same session (clone `paradox-modding-toolkit.wiki.git`, edit, push).

## Work artifacts

Plans, research notes and scratch files stay OUT of the repo: a code search
must return the product as it exists, not abandoned intentions. Plans live
in PR descriptions; durable decisions live in the tracked docs, written in
present tense; the merged PR is the implementation record. `docs/` is
gitignored by default precisely so a stray note cannot land in git, but the
goal is to not create the note there at all.

## Regenerating bundled data (per game patch)

All are esbuild-bundled scripts: `npx esbuild scripts/<name>.ts --bundle
--platform=node --outfile=dist/<name>.cjs && node dist/<name>.cjs` (then
delete the .cjs). Per-game scripts take `--game <id>`, default `ck3`.

| Script | Output | What it does |
|---|---|---|
| `build-structures-json.ts` | `data/ck3/structures.json` | Harvests every `_*.info` schema doc (CK3-only: no other game ships them) |
| `build-gui-schema.ts [--game]` | `data/<id>/guiSchema.json` | Widget types + property counts from the vanilla `gui/` tree |
| `build-freqs.ts [--game]` | `data/<id>/freqs.json` | Per-context usage counts. CK3 regen must stay byte-identical modulo the `meta.generated` stamp unless the game patched |
| `import-cwt-types.ts <clone>` | `games/eu5/schema.generated.ts` | By-hand importer from a pinned cwtools-eu5-config clone; update the pinned commit in the file header AND `THIRD-PARTY-NOTICES.md` |
| `audit-schema-coverage.ts [--game]` | stdout | Schema vs game folders; gaps should be 0 or documented |
| `gen-brand.ts` / `gen-icons.ts` | `media/` brand + file icons | Geometry in `brandGeometry.ts`; regeneration guide in `docs/file-icons.md` |
| `rank-eval.ts` / `fuzzy-diag.ts` | stdout | Completion-quality measurement; run before and after any ranking change |

## Conventions

- User-facing prose (README, CHANGELOG entries, UI copy, release notes)
  avoids em dashes; code comments follow the existing style.
- Comments state constraints and provenance ("measured", "per batch 03"),
  not narration of the code below them.
- The vsix stays self-contained: everything is esbuild-bundled, so new
  runtime npm deps are almost never the answer.
- Upstream sources: see "Upstream sources & acknowledgements" in
  [README.md](README.md). Adding one extends that table AND the relevant
  notices file (`THIRD-PARTY-NOTICES.md`, `data/ck3/wikidocs/ATTRIBUTION.md`
  pattern).
