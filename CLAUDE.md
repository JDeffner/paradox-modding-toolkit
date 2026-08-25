# CLAUDE.md

## Branch rules (hard, no exceptions)

`main` is the public face of this repo. Treat it as read-only.

- **Never commit on `main`.** Check what branch you are on before the first edit.
- **Never push to `main`.** Not `git push origin main`, not `--force`, not
  `--force-with-lease`, not a push that fast-forwards it. If you believe a push
  to `main` is the only way, stop and ask Joel instead.
- **Never work in a worktree that has `main` checked out.**
- `main` changes ONLY through a squash-merged pull request.

This rule exists because the whole 0.3.1 cycle was committed straight onto
`main` and then pushed: 11 working commits, 103 files, on the public branch
that is supposed to carry one commit per release. Recovering it needed a
history rewrite of a public branch.

## How to land work

1. Branch first. Never start from a `main` checkout.
   ```bash
   git checkout -b <type>/<short-name>   # feat/, fix/, docs/, chore/
   ```
2. Commit on that branch, as many commits as the work needs. Granular history
   belongs here, not on `main`.
3. Push the branch, then open the pull request:
   ```bash
   git push -u origin <branch>
   gh pr create --base main --title "<title>" --body "<why, with numbers>"
   ```
4. **Stop there and hand Joel the PR link.** Opening the PR is the deliverable.
   The squash merge is Joel's call, not yours. Merge only if he says so, and
   then only with:
   ```bash
   gh pr merge --squash
   ```

The squash produces exactly one commit on `main` per landed change, which is
the same result the release model has always wanted.

## Relationship to AGENTS.md

`AGENTS.md` "Releasing" documents the older recipe: `git read-tree -u --reset
monorepo` on a `main` checkout, then `git push origin main`. **That recipe is
superseded.** Do not run it. Cut releases through a squash PR like any other
change. The rest of AGENTS.md (invariants, repo map, build/test, data
regeneration) still stands and is required reading.

## Current branches

| Branch | What it is |
|---|---|
| `main` | Public face. One squash commit per landed change. Read-only to you. |
| `dev-0.3.1` | The 0.3.1 working history, moved off `main` on 2026-08-20. Active work branch. |
| `monorepo` | Older full working history, pushed to `origin/monorepo`. |

## Changelogs and versions (keep them current, Joel will not)

The 0.3.2 release shipped with a half-written changelog and no release notes
file. Do not let that happen again:

- **When a feature or fix PR is opened, its changelog entry goes in the same
  PR**: a bullet under an "Unreleased" (or next-version) section at the top of
  `packages/vscode/CHANGELOG.md`. Server or protocol changes also get a bullet
  in that package's own `CHANGELOG.md`.
- **Versioning is not lockstep** (since 0.3.3): `packages/vscode` + root
  package.json carry the release version and bump every release;
  `packages/server` and `packages/protocol` bump only when they changed, in
  their own changelogs. Details in `docs/RELEASING.md`.
- **Before a release PR**: check `git log v<prev>..HEAD` against the
  changelog, and write `docs/release-notes-<version>.md` (it becomes the
  GitHub Release body and the Discord announcement).
- The user-facing feature story lives in `packages/vscode/README.md` (the
  Marketplace listing). When a release adds a user-visible feature, check that
  README's Highlights and the root README's short list still tell the truth.

## Test builds (automatic)

Whenever Joel asks you to create, change or fix something in the extension,
finish the work by building a test vsix and installing it, so he can try it
without packaging himself. The name carries the version from
`packages/vscode/package.json`:

```bash
pnpm run package:test     # scripts/package-test.mjs: compile, vsce package, code --install-extension
```

It writes `packages/vscode/px-toolkit-test-<version>.vsix` and installs it
with `--force`.

- Then tell him the install happened and that VS Code needs a reload
  (`Developer: Reload Window`) to pick it up.
- `px-toolkit-test-*.vsix` is gitignored; never commit a vsix.
- Skip this only for changes with nothing to try in the editor (docs, CI,
  tests alone), and say so.
