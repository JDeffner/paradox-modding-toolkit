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
