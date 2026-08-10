# PdxGui fixture corpus

Executable truth for the GUI-editor consolidation (`docs/gui-editor-consolidation.md`).
`layout/` feeds the layout engine (G2), `writer/` feeds the source-preserving writer (G1).
Every row of `docs/gui-designer/parity-checklist.md` names the fixture that exercises it,
and every fixture here names its rows in its header comment; `guiFixtureCorpus.test.ts`
fails if the two lists drift apart.

## Authorship

**Every file in this folder is original work authored in this repository for this corpus.**
Nothing here is copied, translated or adapted from another project's fixtures, from the
Sage's Clausewitz Studio repository, or from Crusader Kings III's own `gui/` files. The
behaviors under test were read from the CK3 engine's measured behavior (the calibration
campaign in `docs/gui-designer/calibration/` and the in-game verifications recorded in
`docs/gui-designer/calibration/spec.md`); the files that exercise them were written here,
from scratch, shaped for the TypeScript harness rather than inherited from any other one.

Widget names are prefixed `px_` and texture paths point at `gfx/px_fixtures/`, neither of
which exists in any game or mod: a fixture can never be mistaken for game content, and a
grep for a vanilla path can never land in here.

## `layout-rects.baseline.txt`

Not a fixture: the recorded rect dump of every `layout/` fixture (S07 in the checklist,
the Studio's `--render-gui` equivalent). `guiLayoutMerge.test.ts` compares against it, so
any layout-engine change shows up as a numeric diff instead of silently drifting. When the
change is intended, re-record it and let review read the diff:

```bash
PX_WRITE_GUI_RECT_BASELINE=1 npx vitest run packages/server/test/guiLayoutMerge.test.ts
```

## Rules for adding a fixture

- Minimal. One file exercises one behavior or one tight family of related behaviors.
- Self-contained. No `using` of a template the file does not declare, no reference to a
  vanilla type, so a fixture's rects are reproducible with an empty `GuiDefs` store.
- The header comment states the behavior in engine terms and lists its checklist rows.
- Layout fixtures avoid textures and localization keys; they are about rectangles.
- Writer fixtures are about BYTES. Their comments, blank lines, indent unit and line
  endings are the thing under test, so do not tidy them. The whole
  `packages/server/test/fixtures/` tree is prettier-ignored, and `.gitattributes` marks
  `*.gui` here `-text` so git cannot normalize the CRLF fixture's line endings.
