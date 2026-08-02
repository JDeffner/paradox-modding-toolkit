# G3: the webview GUI editor, v1 (VSCode-first, Studio-ready)

The plan of record is docs/gui-editor-consolidation.md; this details its G3 phase.
Everything G3 stands on is DONE and probe-settled: the layout engine (G2 + the
2026-08-02 probe, zero disputed rows), the source writer and its op API
(`paradox/guiSourceEdit`, G1), the fixture corpus and invariant sweeps (G0/G1), and
the refusal guards (measured-correct after the probe). G3 builds the first UI on top:
render, select, inspect, drag/resize with honest refusals. Creation gestures, layers,
smart guides and the devtools halo stay in G4/G5 by design.

## Architecture (the decisions, made)

- **One webview app, host-agnostic by construction.** New folder
  `packages/vscode/src/webviews/guiEditor/` containing: `app/` (the webview-side
  TypeScript, bundled by a new esbuild entry to `dist/webview/guiEditor.js`, loaded
  with the house nonce-CSP pattern), `panel.ts` (the VSCode host side), and
  `messages.ts` (the typed webview<->host contract). The inline-serialized-function
  pattern of the smaller panels does not scale to an editor; the bundle step is the
  one piece of new build machinery, mirrored on the existing esbuild scripts.
- **The host boundary is the Studio's boundary.** `messages.ts` is written as if the
  host were unknown: requests up (layout, tree, texture, edit-op, reveal), pushes
  down (document text changed, layout result, selection restore). The VSCode panel
  implements it over `postMessage`; G6's Studio adapter implements the same contract
  over WebView2 without touching `app/`. A README in the folder says exactly this.
- **Host owns the text; the server owns the truth.** The webview NEVER computes
  layout or edits text. Flow: webview asks host -> host asks the server
  (`paradox/guiLayout`, `paradox/guiTree`, `paradox/guiSourceEdit`) -> host applies
  returned edits to the real `TextDocument` via `WorkspaceEdit` -> the document
  change re-requests layout (300 ms debounce, matching the analysis debounce
  culture) -> push to webview. Undo/redo is VSCode's native document undo; the
  editor holds NO undo stack of its own (the Studio's separate canvas stack existed
  only because `_code.SetText` reset Monaco history; the WorkspaceEdit path does not
  have that problem).
- **Textures.** The server already decodes DDS (`@px-lsp/server/dds`). The host
  decodes on demand to PNG bytes cached under global storage keyed by
  path+mtime+maxSize, and hands the webview `asWebviewUri` links. Decode caps: 256px
  for tree/inspector thumbnails, full size for canvas fills. The webview treats
  texture URLs as opaque.
- **Rendering: canvas2d, no framework.** A retained scene built 1:1 from the
  server's `LayoutNode[]`: rect + fill (color, texture, nine-slice borders, tile
  mode, frame cell) + clip flags, drawn back-to-front with pan/zoom as a single
  canvas transform. The engine already computed everything per rect; the renderer
  adds NO layout opinions (the drift-proofing lesson behind the Studio's
  harness-linked engine).
- **The L11b decision lands here** (deferred from G2 to the canvas by the
  checklist): an unmeasurable container renders at a dashed GHOST default
  (reuse the GHOST_COUNT/GHOST_OPACITY presentation precedent), clearly marked
  as estimated in the inspector, and the engine keeps inventing no pixels.

## Interaction model, v1

- **Selection.** Click = smallest rect under the cursor wins, tree-depth breaks
  equal-area ties (the Studio's measured fix for anchored-box fills); Alt+click
  cycles the stack; Esc clears. Selection crosses re-parses as a positional path.
  Ctrl+Shift+click reveals the declaration in the text editor (`revealRange` on the
  span the source model already records).
- **Tree.** Source children in source order, template-expanded nodes marked
  synthetic (the server's tree already knows), click-to-select both ways. Filters
  and subtree focus are G4/G5.
- **Inspector, read-then-write.** Rows from the widget's entries with template-chain
  origin labels; editing a row commits ONE `setProperties` op. Values the guard
  refuses come back as a toast with the server's reason string; the row snaps back.
- **Drag and resize, the honest way.** Pointer events with `setPointerCapture`
  (the WPF capture-loss bug class cannot exist), rAF transform-only preview during
  the gesture, live geometry readout, ONE `setProperties` commit on release writing
  `effective position + drag delta` (never the canvas coordinate). Guards are
  consulted at GESTURE START: a box child's position drag is refused before it
  moves (reason shown, nothing snaps back because nothing moved), a both-axes
  expanding child refuses resize, one-axis warns which axis the box owns and writes
  the other. Sub-pixel no-op writes are reported as such, not silently dropped.
- **Deliberately absent in v1** (G4/G5 own them): palette/add/delete/duplicate,
  multi-select, copy/paste, layers, smart guides, align/distribute/wrap, components,
  presets, browsers, the devtools overlays.

## Testing (the Studio's lessons, applied headlessly)

- **Pure-module discipline.** Hit-testing, tie-breaks, handle math, delta math,
  scene building live in pure modules under `app/` with plain vitest coverage; DOM
  and canvas code stays a thin shell around them.
- **Scene-dump goldens (the --render-gui equivalent).** A headless harness builds
  the scene for every layout fixture and dumps `name x y w h fillKind` lines,
  diffed against a recorded baseline exactly like S07. Because scene rects must
  EQUAL the engine's rects, this pins the renderer transform without a browser.
- **Interaction smoke (the --gui-edit-smoke equivalent).** A jsdom harness runs the
  real `app/` bundle with a stubbed host: select -> drag-commit -> assert the exact
  op sent -> feed back the server's real edit -> assert byte-identity after undo
  feedback; plus the refusal path (box-child drag refused, toast text = the
  server's reason). The stub host replays real `paradox/guiSourceEdit` responses
  captured from the server so the contract stays honest.
- **Wire smoke.** One lspSmoke-family case: open a fixture, guiLayout + a
  guiSourceEdit round trip, proving the host path end to end.
- **Human-mouse checklist.** A short doc per Studio tradition: drag feel, capture
  release off-canvas, cycle clicks, refusal toasts. Headless proves logic; feel
  needs Joel's mouse once per phase.
- **Perf budgets as tests.** Scene build for the biggest fixture under a recorded
  budget; the edit-commit path re-layouts incrementally (only the changed document
  re-requested; target the Studio's ~150 ms nudge lesson, measured in the smoke).

## Phases

- **G3.1 Render (est. 4-6 d).** Bundle machinery, panel host, layout wire, fills,
  nine-slice, frames, text, ghosts, pan/zoom. Accept: every layout fixture renders;
  scene-dump baseline recorded and matching engine rects exactly; `window_character`
  renders; command `px.openGuiEditor` on a .gui file.
- **G3.2 Select + inspect (est. 3-4 d).** Hit-test stack + cycling, tree, inspector
  read side, reveal-in-source, selection-survives-reparse. Accept: pure-module tests
  for every click case; smoke proves selection path round trips.
- **G3.3 Edit (est. 4-6 d).** Drag/resize/inspector writes via ONE op each, guards
  at gesture start, toasts, document round trip, native undo. Accept: the
  interaction smoke's byte-identity and refusal cases; wire smoke green; a real
  drag in VSCode commits base+delta (checked by hand once).
- **G3.4 Harden (est. 2-3 d).** Perf budget tests, texture cache, the human-mouse
  checklist doc, README for the host contract, CHANGELOG. Accept: all five repo
  gates plus the new baselines green; guiPreview stays untouched (it retires in G5
  when the editor reaches parity, not before).

Total: the plan of record's 2-3 weeks. Implementation runs like G1/G2: one stage per
run, adversarially reviewed, committed locally, chain stops on red.
