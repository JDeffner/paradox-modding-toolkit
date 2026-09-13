# Releasing the Paradox Modding Toolkit

Extension ID: `JDeffner.px-toolkit`. Stable Marketplace publishing is the default. Select **Mark as pre-release** in the manual Release workflow to publish on the opt-in Marketplace channel and keep the GitHub release marked as a prerelease. The workflow sets the flag when packaging the VSIX, because the manifest determines its channel.

## Branch model

- `main`: the public face, one squash commit per landed change. It changes
  ONLY through a squash-merged pull request, merged by Joel. Never commit or
  push to it directly (AGENTS.md carries the full rule and its history).
- Work happens on `feat/`, `fix/`, `docs/`, `chore/` branches (or an
  `integration/<version>` branch collecting several PRs for one release),
  pushed to origin and PR'd into `main`.
- Historical branches (`monorepo`, `dev-0.3.1`, the retired `dev`/`devold`
  archived in `F:\Projets\repo-archives\`) have disjoint or diverged
  history. Never merge one of them into `main`; the old
  `git read-tree -u --reset monorepo` release recipe is superseded and must
  not be run.

## Cutting a release

1. Bump versions. Since 0.3.3 they do **not** move in lockstep:
   - `packages/vscode/package.json` and the root `package.json` carry the
     **release version** (the vsix, the tag, the Marketplace listing). They
     bump every release.
   - `packages/server` and `packages/protocol` each bump **only when that
     package changed** since its last bump, with an entry in its own
     `CHANGELOG.md`. A release whose changes are client-only leaves both
     untouched, and the server tarball keeps its older version in the name;
     that is correct, not a mistake.

   Every release also needs, before the tag: the new section at the top of
   `packages/vscode/CHANGELOG.md` covering everything since the last tag
   (`git log v<prev>..HEAD` is the checklist), and
   `docs/release/<version>.md` (it becomes the GitHub Release body and
   the Discord post). Missing or empty notes fail preparation.
2. Regenerate bundled data if the game patched (see below), and check
   `THIRD-PARTY-NOTICES.md` still matches what actually ships: every imported
   or derived third-party source needs its entry, and the pinned commits in
   the notices must equal the ones in the generated files' headers
   (`packages/server/src/games/eu5/schema.generated.ts`).
3. Verify locally: `pnpm typecheck && pnpm lint && pnpm test && pnpm run compile`,
   plus `node scripts/check-game-boundary.mjs`.
4. Build the artifacts and smoke the tarball (below), then open the release
   PR and hand it to Joel; he squash-merges it into `main`.
5. Create and publish a GitHub release or prerelease for `v<version>` from the merged commit. A tag push alone does not start publishing. **Prepare release** checks the tagged extension and root package versions first. A mismatch fails without changing the release. When versions match, it loads `docs/release/<version>.md`, sets the release body, and marks the release as a prerelease with Latest disabled. Draft releases are prepared when published. After fixing a preparation failure, rerun its failed Actions run.
6. Wait for **Prepare release** to succeed. In **Actions > Release > Run workflow**, leave the workflow branch on `main`, enter the prepared tag, and choose whether to **Mark as pre-release**. This run always builds the tag, checks its versions and prepared notes again, runs checks, and attaches the VSIX and both standalone server archives. Archive filenames use the server's independent version.
7. The workflow uploads the VSIX to the Marketplace, then sets the final GitHub release channel. Discord is notified only after Marketplace publishing succeeds. npm packages publish afterward when their versions are absent from npm. A failed Marketplace upload leaves the GitHub release as a prerelease and sends no Discord notification.

If a tag points to a commit with the wrong package version, correct the tag before preparing the release again. Changing a release's target branch does not move an existing tag.

For testers who should try a build before it is released, send them the vsix
file directly; they install it via Extensions panel → `…` menu →
"Install from VSIX".

## Major game update checklist

Use a fresh copy of this checklist for each major CK3, Victoria 3 or EU5 update. Record the game, previous and new game versions, enabled DLC, toolkit commit and test workspace in the update PR. Keep local paths in `dev-paths.json` or environment variables. Leave tasks unchecked until verified; record a reason for anything that does not apply.

Reloading game documentation updates runtime language knowledge and generated snippets. It does not rebuild bundled harvests or update fixed snippets and file templates. Check all three sources below.

### Establish the baseline

- [ ] Create an update branch and save the previous game documentation and generated snippet export before replacing them. Use `Paradox: Export Generated Snippets (HTML / Print)` for the catalogue.
- [ ] Read the game's official patch notes for script, GUI, localization, asset, save-format and mod-loading changes. Record the changes that could affect the toolkit, with source links.
- [ ] Confirm the selected game install and logs belong to the new version. Update the ignored development paths, and use a scratch mod for writer and game tests.
- [ ] Capture completion ranking and index performance before changing toolkit code or bundled data. Keep the workspace and corpus consistent for the comparison; record any unavoidable game-file changes.

### Refresh game documentation

- [ ] Generate fresh `script_docs` from the updated game in debug mode. Check timestamps, nonempty output and parser coverage for effects, triggers, event targets and modifiers, plus on-actions where available.
- [ ] Generate fresh `DumpDataTypes` output where supported. Check that the loader finds the game's output location and format, including a sibling logs directory when script docs are in a docs directory.
- [ ] Run `Paradox: Reload Game Data`. Confirm added, changed and removed names match the fresh dumps, and that fallback wiki data does not restore removed names in a covered category.
- [ ] Check documentation format changes against the parsers. Add focused fixtures for changed syntax, parameter descriptions and optional-field markers.
- [ ] Review bundled documentation used without local dumps. Refresh the relevant source snapshots and attribution deliberately; check fallback behavior with local logs unavailable.

### Update profiles and bundled data

- [ ] Audit new, renamed and moved vanilla folders with `audit-schema-coverage.ts --game <id>`. Resolve or document every gap before harvesting definition skeletons.
- [ ] Check the affected GameProfile's definition kinds, root keys and scopes, references, value vocabularies and supported tools against the updated game sources. Keep game-specific rules inside the profile boundary.
- [ ] Regenerate completion frequencies, definition skeletons, GUI schema and asset vocabulary for the affected game. Confirm its game path exists first: the skeleton generator can write an empty table without it.
- [ ] For CK3, regenerate structure documentation from `_*.info`. If refreshing bundled datatype documentation, update its source snapshot before running `build-data-types-json.ts`.
- [ ] For EU5, decide whether the pinned CWT schema needs updating. If it does, inspect the importer's uncovered types and update the source pin and notices together.
- [ ] Review harvest counts and diffs for missing folders, empty output, removed entries and changed common fields. Repeat generation against unchanged inputs and confirm deterministic output apart from timestamps.

### Check snippets and file templates

- [ ] Export the refreshed generated snippet catalogue after indexing finishes. Compare it with the baseline for added, changed and removed commands and definitions.
- [ ] Spot-check minimal insertion for changed commands: braces and assignment signs, documented required fields, optional fields omitted, useful cursor positions and tab order. Do not treat a field's common occurrence in vanilla as proof that it is required.
- [ ] Check example and all-fields variants against fresh sources. Confirm nested blocks, alternatives, defaults and optional fields produce useful code rather than pasted explanatory prose.
- [ ] Check completion previews and datatype hints against the new docs. Keep unknown types explicit; do not invent a type or default when the source does not establish one.
- [ ] Audit fixed VS Code snippets in `packages/vscode/snippets/` and GameProfile scaffolds against the updated game. They need manual review even when generated snippets have refreshed.
- [ ] Check Minimal, Examples and Names completion modes, snippet icons in VS Code, and plain-text insertion for clients without snippet support. Check any aliases or migrated templates for missing or duplicate suggestions.
- [ ] Generate representative files in the scratch mod. Validate their syntax with the supported tiger tool and load them in the game where needed; check BOM, localization naming and event namespace requirements.

### Check editor and tool behavior

- [ ] Try completion, hover, navigation, references and structural diagnostics on representative updated vanilla definitions and mod overrides. Keep vanilla read-only and free of diagnostics; scope inference must annotate rather than hide candidates.
- [ ] Check localization lookup, new-key writing and vanilla-key replacement, including language headers, filenames, BOM and override order.
- [ ] Check changed GUI widget properties, datafunctions and layout behavior with real game examples. Verify GUI editing and previews against the updated game.
- [ ] Open representative DDS textures and check format decoding, alpha and export. Check flag and coat-of-arms assets and editors for games whose profiles support them.
- [ ] Check event graphs, file creators and other tools affected by changed definitions. Review save schemas, descriptors, launch options and log discovery when the patch changes them.
- [ ] Reindex an existing mod workspace and check cache refresh, game selection and multi-mod override order. Confirm changed vanilla content is visible without stale entries.
- [ ] Check tiger compatibility and diagnostics integration for each supported profile. Record any tool or feature that does not yet support the new game version.

### Verify and prepare the toolkit release

- [ ] Run focused tests for changed parsers and features, typecheck, lint and the full suite for the major update. Compile first when tests exercise a bundled server; run `node scripts/check-game-boundary.mjs` for server changes.
- [ ] Compare before/after `fuzzy-diag` and `rank-eval` results for completion or frequency changes. Review intended ranking shifts and investigate regressions.
- [ ] Record before/after index and completion performance for affected server work, following `docs/PERFORMANCE.md`. Add the release performance-history row and keep machine paths out of tracked results.
- [ ] Check VS Code and bare LSP behavior, including clients without snippets, file links or client commands. Check the Studio-facing contract where affected, and run representative checks for the other game profiles.
- [ ] Run `pnpm run package:test`, reload VS Code with `Developer: Reload Window`, and try the installed build. Smoke-test the standalone server artifacts and confirm each ships its required per-game data.
- [ ] Write changelog entries for changed packages. In the release PR, record tested game versions, DLC coverage and known limitations, refresh source notices, and update protocol/embedding docs plus their wiki mirrors if contracts changed.
- [ ] Hand the verified release PR to the maintainer for merge and release. Treat support for the new game version as verified only after the required checks pass; document any remaining unsupported features.

### Working commands

Run the relevant checks from the repository root. These commands verify an update; they do not fetch new game documentation or regenerate the harvests for you.

```bash
pnpm run typecheck
pnpm run lint
pnpm run compile
pnpm exec vitest run
node scripts/check-game-boundary.mjs
pnpm run package:test
```

Use the per-game regeneration commands below for bundled data, and the measurement recipes in `docs/PERFORMANCE.md` for performance comparisons.

## Regenerating bundled data (per game patch)

The per-game generators take `--game <id>` and default to `ck3`; each reads its
paths from that game's `dev-paths.json` slots. Build and run them the usual
way:

```bash
pnpm exec esbuild scripts/build-freqs.ts --bundle --platform=node --outfile=dist/build-freqs.cjs
node dist/build-freqs.cjs                # ck3
node dist/build-freqs.cjs --game vic3    # vic3
```

| What | Command | Output |
|---|---|---|
| CK3 structure docs | `build-structures-json.ts` | `packages/server/data/ck3/structures.json` (CK3 only: no other game ships `_*.info` docs) |
| GUI widget schema | `build-gui-schema.ts [--game <id>]` | `packages/server/data/<id>/guiSchema.json` |
| Completion frequencies | `build-freqs.ts [--game <id>]` | `packages/server/data/<id>/freqs.json` |
| Definition skeletons | `build-skeletons.ts [--game <id>]` | `packages/server/data/<id>/skeletons.json` |
| Asset vocabulary | `build-asset-vocabulary.ts [--game <id>]` | `packages/server/data/<id>/assetVocabulary.json` |
| CK3 bundled datatypes | `build-data-types-json.ts` | `packages/server/data/ck3/dataTypes.json`, from bundled `wikidocs/Data_types.md`, not live dumps |
| Schema coverage audit | `audit-schema-coverage.ts [--game <id>]` | stdout; gaps should be 0 or documented |
| EU5 schema table | `import-cwt-types.ts <path-to-cwtools-eu5-config-clone>` | `packages/server/src/games/eu5/schema.generated.ts` |

`import-cwt-types.ts` is a by-hand importer, not a build step: run it only when
re-pinning the upstream config, then update the pinned commit and game version
in **both** the generated file's header and `THIRD-PARTY-NOTICES.md`, and read
the "Not covered" block it prints for newly dropped types.

Regenerating CK3 freqs must stay byte-identical modulo the `meta.generated`
stamp unless the game actually patched; a diff there moves completion ranking
and needs `rank-eval` numbers.

## Building a vsix locally

```bash
pnpm run compile
# (stray harvest bundles land in the repo-root dist/, which no longer ships)
cd packages/vscode && npx vsce package --no-dependencies --githubBranch main \
  --baseImagesUrl https://github.com/JDeffner/paradox-modding-toolkit/raw/main/packages/vscode
```

Produces `px-toolkit-<version>.vsix`.

`--baseImagesUrl` is not optional here. vsce resolves relative image links
against the repository root, but the extension lives in `packages/vscode/`, so
without the prefix the banner and the screenshots resolve to
`/raw/main/media/...` and 404 on the listing. The same flag is baked into the
`package` script and into `.github/workflows/release.yml`. After packaging,
verify the shipped readme rather than trusting the flag:

```bash
node -e "const z=new (require('adm-zip'))('packages/vscode/px-toolkit-<version>.vsix'); \
  const rd=z.getEntry('extension/readme.md').getData().toString('utf8'); \
  console.log([...rd.matchAll(/(?:src=\"|\]\()(https:[^\")]*(?:png|jpg|svg))/g)].map(m=>m[1]).join('\n'))"
```

Every image URL it prints must contain `/main/packages/vscode/media/`.

## Building and smoking the server tarball

```bash
pnpm run compile
node scripts/build-server-tarball.mjs   # px-lsp-server-<version>.tar.gz at the repo root
```

Then prove the SHIPPED artifact, not just `dist/`: extract it and run the stdio
smoke against the extracted bundle. `PX_LSP_SERVER` (note the name: no
`PARADOX_` prefix any more) points the smoke test at another server path.

```bash
mkdir -p /tmp/px-tarball && tar -xzf px-lsp-server-*.tar.gz -C /tmp/px-tarball
PX_LSP_SERVER="$(echo /tmp/px-tarball/px-lsp-server-*/dist/server.js)" \
  npx vitest run packages/server/test/stdioSmoke.test.ts
```

This is the check that catches a flattened extraction or a missing
`data/<gameId>/` folder: the server keeps starting either way, it just loses
its bundled data silently. CI runs the same two steps on every push.

## Building and smoking the Windows zip

```bash
pnpm run compile
node scripts/build-server-zip.mjs   # px-lsp-win-x64-<version>.zip at the repo root
```

Same payload as the tarball plus an unmodified official `node.exe`, Node's
`NODE-LICENSE`, and `px-lsp.cmd` (one line, CRLF, everything `%~dp0`-relative).
The Node build is **pinned** in the script and verified against the release's
`SHASUMS256.txt`; the download is cached under `.cache/` so re-runs are offline.
Bumping the pin is a deliberate act: it changes the runtime an embedder ends up
on, so re-run the round trip below afterwards.

`--local-node` substitutes this machine's Node for a quick layout check. It
never produces a releasable artifact; CI uses it only to assert the file list.

The end-to-end check on Windows is to unpack the zip somewhere and drive the
launcher itself:

```powershell
Expand-Archive px-lsp-win-x64-<version>.zip -DestinationPath $env:TEMP\px-zip
$env:TEMP\px-zip\px-lsp-win-x64-<version>\px-lsp.cmd   # waits for LSP messages on stdin
```

An `initialize` followed by `shutdown`/`exit` must return `serverInfo` and exit
0 without any Node on `PATH`. The extracted `dist/server.js` also runs the
normal tarball smoke:

```bash
PX_LSP_SERVER="/path/to/px-lsp-win-x64-<version>/dist/server.js" \
  npx vitest run packages/server/test/stdioSmoke.test.ts
```

Before a release, also run the neovim parity harness by hand
(`scripts/nvim-parity/README.md`). It needs nvim, a game install and a real
mod, so it is deliberately not in CI.

## Publishing to the Marketplace (manual, when you decide)

One-time setup:

1. Sign in at <https://marketplace.visualstudio.com/manage> with a Microsoft
   account and create the publisher **JDeffner** (must match `publisher` in
   package.json).
2. Create an Azure DevOps Personal Access Token at
   <https://dev.azure.com> → User settings → Personal access tokens:
   Organization = "All accessible organizations", Scope = **Marketplace →
   Manage**. Copy the token.
3. Either add it as the `VSCE_PAT` repository secret on GitHub
   (Settings → Secrets and variables → Actions) for CI publishing, or keep it
   for local use.

For each release, use **Actions > Release > Run workflow**, enter the prepared tag, and leave **Mark as pre-release** unchecked for stable publishing. The run uses `VSCE_PAT`; there is no separate publish checkbox.

For a local recovery, publish the exact built artifact with `pnpm exec vsce publish --no-dependencies --packagePath packages/vscode/px-toolkit-<version>.vsix`. Local publishing does not update the GitHub release or send the workflow's Discord notification.

The first publish creates the Marketplace listing; it goes live after an
automatic validation pass (usually minutes). README.md becomes the listing
page and CHANGELOG.md the changelog tab.

## Pre-release channel

**Mark as pre-release** applies to both the Marketplace artifact and the final GitHub release. During preparation, the GitHub prerelease badge only indicates that manual publishing is pending. It does not publish anything to the Marketplace. Choose a version higher than the current Marketplace version when publishing a new build. See the [VS Code publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#prerelease-extensions) for channel versioning.

## Publishing the npm packages (M3b)

`@px-lsp/protocol` and `@px-lsp/server` are publishable. They version
independently of the extension, starting at 0.1.0 (`packages/*/package.json`
carry `files`, `publishConfig.access: public`, and the server's `px-lsp` bin;
each package has its own `CHANGELOG.md`).

**The manual Release workflow publishes npm packages after Marketplace publishing and notification.** Preparation does not publish them. The npm step checks whether each exact version exists and publishes only missing versions, protocol before server. The step needs the `NPM_TOKEN` repository secret with publish rights on the `px-lsp` scope. A missing secret warns and skips npm publishing.

The manual procedure below stays as the fallback (first-time scope setup, or
publishing outside a release). Publish a package only when its version bumped
since the last publish:

1. `npm login` (one-time), then re-check the scope is still ours/free:
   `npm org ls px-lsp`. On first publish, publishing a scoped package
   auto-creates the scope for your account. Fallbacks if taken: unscoped
   `px-lsp-server` / `px-lsp-protocol`.
2. Dry run: `pnpm publish --dry-run --no-git-checks` inside
   `packages/protocol` and `packages/server` (the server's `prepublishOnly`
   rebuilds `dist/server.js`; pnpm rewrites the `workspace:*` dependency to
   the real version on pack). Check the packed file list includes
   `data/<gameId>/` for every bundled game.
3. Publish for real: same commands without `--dry-run`, protocol first.
4. Wire-contract changes must be reflected in `docs/PROTOCOL.md` in the same
   release — external clients (neovim, the Studio) code against it. The
   `gameId` list lives there too, so adding a game is a protocol edit.
