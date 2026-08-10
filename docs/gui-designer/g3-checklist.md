# G3 human-mouse checklist

Everything G3 claims is proven headlessly: the scene dump pins every rect to the
engine's own numbers, the jsdom smoke drives the real bundle through the real
server and asserts the exact op, the bytes and the refusal words, and the perf
suite holds the budgets. None of that can tell you whether a drag FEELS like
dragging. This is the pass a person runs with a mouse, once per phase, in the
Studio tradition that produced these rules in the first place.

Run it in the Extension Development Host: `pnpm run compile`, F5, open a `.gui`
file, run **Paradox: Open GUI Editor** (`px.openGuiEditor`, also a button in the
editor title bar of a `.gui` file). CK3 only, deliberately: the layout engine is
calibrated against CK3 screenshots.

Two documents cover the range. `packages/server/test/fixtures/gui/layout/templates-types.gui`
is small and every widget is yours to move; the game's own
`gui/window_character.gui` is the biggest thing the editor will ever be asked to
hold (5,650 lines, 13,702 widgets after template expansion). Copy the vanilla
file into a scratch mod rather than editing the install.

Record the date and the build at the bottom when the pass is done.

## 1. First paint

- [ ] The window opens beside the text editor and the file name is in both the
      tab title and the status line.
- [ ] The scene is centred and fitted; the status line reads a widget count and
      the toolbar's right side names the template store size.
- [ ] Sprites are drawn, not grey boxes: nine-sliced frames have square corners
      at every zoom, frame-sheet icons show ONE cell, tiled fills repeat.
- [ ] Text sits where the engine put it, and at a size that matches the game
      when the game font was found.
- [ ] Dashed orange boxes appear only where the inspector agrees the content was
      unmeasurable (L11b). Nothing else is dashed.

## 2. Camera

- [ ] Wheel zooms toward the cursor, not toward the centre.
- [ ] Middle-drag pans, including off the canvas and back.
- [ ] `Fit` re-centres the 1920x1080 reference viewport.
- [ ] The selection marquee, the resize grips and the ghost dashes stay ONE
      screen pixel wide at 25% and at 400%.
- [ ] Resizing the panel redraws without stretching or blurring the scene.

## 3. Selection

- [ ] A click selects the smallest thing under the cursor, not the anchored box
      filling the window behind it.
- [ ] Alt+click steps outward through the stack, and wraps back to the innermost.
- [ ] Clicking empty canvas clears; Esc clears.
- [ ] Ctrl+Shift+click reveals the declaration in the text editor WITHOUT
      stealing focus and without moving the editor into the panel's column.
- [ ] Clicking a tree row selects on the canvas and scrolls the row into view;
      clicking on the canvas opens the tree down to that widget.
- [ ] A synthetic (template-expanded) row says it has no declaration here rather
      than showing an empty inspector, and shows no resize grips.

## 4. Drag

- [ ] Press and move: the widget follows the cursor 1:1, with its whole subtree.
- [ ] The status line reads the live geometry and the exact property the release
      will write.
- [ ] Below a few pixels of travel, a press is a click: selecting never nudges.
- [ ] Drag off the canvas, keep the button down, come back: the gesture is still
      alive and still tracking (pointer capture).
- [ ] Release off the canvas entirely: it commits where it was released, and the
      canvas does not end up with a gesture stuck on.
- [ ] Esc mid-drag abandons it and the widget snaps back to where the file has it.
- [ ] Release: the write lands, the canvas re-lays out ONCE, and the widget is
      still selected.
- [ ] The written value is the widget's own position plus the delta, NOT the
      cursor's world coordinate. Check it in the text editor: an anchored or
      margin-offset widget is the case that catches this.
- [ ] Ctrl+Z in the text editor puts the file back exactly as it was, and the
      canvas follows.

## 5. Resize

- [ ] The eight grips sit on the selection and are grabbable at every zoom, and
      a corner wins over an edge on a small widget.
- [ ] The cursor changes over each grip.
- [ ] A west or north grip moves the origin and changes the size in ONE commit:
      the far edge does not walk.
- [ ] Dragging an edge through the opposite one stops at zero instead of writing
      a negative size.
- [ ] A resize previews its own marquee only. Children do not pretend to reflow.

## 6. Refusals and warnings

The refusal fixtures are `packages/server/test/fixtures/gui/writer/refusal-shapes.gui`.

- [ ] Dragging a child of an hbox/vbox: the toast appears at the START of the
      gesture, in the server's own words ("places its children itself"), and the
      widget does NOT move even a pixel before the refusal.
- [ ] Resizing a child that expands on both axes: refused the same way, and the
      status line never shows a size the file will not get.
- [ ] Resizing a child that expands on one axis: a WARNING naming the axis the
      container owns, the write goes ahead, and the result matches what the
      warning said.
- [ ] A drag that rounds to less than a pixel says so instead of writing nothing
      silently.
- [ ] Toasts are readable, dismissable by clicking, and do not stack up.

## 7. Inspector

- [ ] Rows show the widget's properties with template-chain origins ("from type
      X"), and locally authored rows carry no origin line.
- [ ] Editing a row commits one op; the override lands at the use site and the
      type definition keeps its bytes.
- [ ] A refused row snaps back to what the file still says, with the reason.
- [ ] Typing in the text editor updates the inspector within the debounce
      without losing the selection.

## 8. Feel, at size

On `window_character.gui`, with the game folder configured:

- [ ] The first layout takes a moment (the template store is being built) and
      the status line says something is happening rather than looking frozen.
- [ ] The tree opens collapsed at its top level instead of listing 13,702 rows.
- [ ] A nudge feels direct: press, drag, release, done. The measured host cost
      is ~65 ms; if it feels like submitting a form, something regressed and
      `guiEditorPerf.test.ts` should be re-run.
- [ ] Zoom and pan stay smooth with every sprite on screen.
- [ ] Nothing in the editor's panel ever edits a document you did not open.

## 9. Boundaries

- [ ] The read-only preview is gone: **Paradox: Preview GUI Layout** is not in
      the palette, and Ctrl+Alt+P on a `.gui` file opens the editor instead.
- [ ] Opening the editor on a second `.gui` file reuses the panel, retitles it,
      and resolves textures against THAT file's mod.
- [ ] On a Victoria 3 or EU5 workspace, the command explains it is CK3 only
      instead of drawing a wrong layout.

---

Pass log:

| Date | Build | Result |
|---|---|---|
| | | |
