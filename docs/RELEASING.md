# Releasing the Paradox Modding Toolkit

Extension ID: `JDeffner.px-toolkit`. The 0.x series is a **beta**, and it ships
on the **normal** Marketplace channel. The Marketplace pre-release channel is
deliberately not used: it makes every user tick "pre-release version" inside VS
Code, which is friction for no gain here. "Beta" is said in the README badge and
blockquote and in the changelog instead.

**Never pass `--pre-release`.** The flag is written into the vsix manifest at
PACKAGE time (`Microsoft.VisualStudio.Code.PreRelease`), so a vsix built with it
lands on the pre-release channel however it is published. Check a built vsix
with:

```bash
node -e "const z=new (require('adm-zip'))('packages/vscode/px-toolkit-<version>.vsix'); \
  console.log(/PreRelease/.test(z.getEntry('extension.vsixmanifest').getData().toString()))"
```

That must print `false`.

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

   The odd/even minor convention only applies to extensions that use the
   pre-release channel, so it does not apply here; plain increments are fine.

   Every release also needs, before the tag: the new section at the top of
   `packages/vscode/CHANGELOG.md` covering everything since the last tag
   (`git log v<prev>..HEAD` is the checklist), and
   `docs/release/<version>.md` (it becomes the GitHub Release body and
   the Discord post; 0.3.2 shipped without one and fell back to a generated
   commit list).
2. Regenerate bundled data if the game patched (see below), and check
   `THIRD-PARTY-NOTICES.md` still matches what actually ships: every imported
   or derived third-party source needs its entry, and the pinned commits in
   the notices must equal the ones in the generated files' headers
   (`packages/server/src/games/eu5/schema.generated.ts`).
3. Verify locally: `pnpm typecheck && pnpm lint && pnpm test && pnpm run compile`,
   plus `node scripts/check-game-boundary.mjs`.
4. Build the artifacts and smoke the tarball (below), then open the release
   PR and hand it to Joel; he squash-merges it into `main`.
5. Tag the squash commit on `main` and push:
   `git tag v<version> && git push origin v<version>`.
   The tag triggers `.github/workflows/release.yml`: build, test, package,
   and a GitHub Release with three artifacts attached: the vsix,
   `px-lsp-server-<version>.tar.gz` (standalone server, bring your own Node)
   (TODO: the server assets carry the server's own version while the tag
   carries the release version; consider renaming so the two cannot be
   confused) and `px-lsp-win-x64-<version>.zip` (the same payload plus a bundled
   node.exe and a `px-lsp.cmd` launcher, for embedders and Windows users).

For testers who should try a build before it is released, send them the vsix
file directly; they install it via Extensions panel → `…` menu →
"Install from VSIX".

## Regenerating bundled data (per game patch)

The per-game generators take `--game <id>` and default to `ck3`; each reads its
paths from that game's `dev-paths.json` slots. Build and run them the usual
way:

```bash
npx esbuild scripts/build-freqs.ts --bundle --platform=node --outfile=dist/build-freqs.cjs
node dist/build-freqs.cjs                # ck3
node dist/build-freqs.cjs --game vic3    # vic3
```

| What | Command | Output |
|---|---|---|
| CK3 structure docs | `build-structures-json.ts` | `packages/server/data/ck3/structures.json` (CK3 only: no other game ships `_*.info` docs) |
| GUI widget schema | `build-gui-schema.ts [--game <id>]` | `packages/server/data/<id>/guiSchema.json` |
| Completion frequencies | `build-freqs.ts [--game <id>]` | `packages/server/data/<id>/freqs.json` |
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

Then, per release, one of:

- **CI**: Actions → Release → "Run workflow" → check "publish". Uses the
  `VSCE_PAT` secret.
- **Local**: `npx vsce publish --no-dependencies --packagePath packages/vscode/px-toolkit-<version>.vsix`
  (it prompts for the PAT, or set the `VSCE_PAT` env var). Name the file
  explicitly: a `*.vsix` glob can match a stale build.

The first publish creates the Marketplace listing; it goes live after an
automatic validation pass (usually minutes). README.md becomes the listing
page and CHANGELOG.md the changelog tab.

## If you ever DO want the pre-release channel

Leave the `prerelease` input unchecked unless you mean it. Turning it on has two
consequences worth knowing before you do:

- The channel version must be higher than the stable one, and the Marketplace
  convention pairs an odd minor (pre-release) with an even minor (stable). Since
  the beta shipped stable on `0.3.x`, starting a pre-release channel later means
  moving stable to an even minor and giving the channel the next odd one.
- A version published as pre-release can never be re-published as stable, so the
  two channels never share a version number.

Marking the GitHub Release as a pre-release (`prerelease: true` in
`release.yml`'s GitHub Release step) is a separate, harmless thing: it only adds
a badge on the Releases page and has no effect on how anyone installs the
extension.

## Publishing the npm packages (M3b)

`@px-lsp/protocol` and `@px-lsp/server` are publishable. They version
independently of the extension, starting at 0.1.0 (`packages/*/package.json`
carry `files`, `publishConfig.access: public`, and the server's `px-lsp` bin;
each package has its own `CHANGELOG.md`).

**CI publishes them automatically.** Every tag build (and every manual
release.yml run with "publish" checked) ends with a version-guarded npm step:
for each package it checks whether that exact version already exists on npm
and publishes it only when it does not, protocol before server. Bumping a
package version in a release is therefore all it takes; a release that did
not touch a package publishes nothing for it. The step needs the `NPM_TOKEN`
repo secret (granular npm automation token with publish rights on the
`px-lsp` scope, Settings → Secrets and variables → Actions); when the secret
is missing the step warns and skips so the rest of the release still ships.

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
