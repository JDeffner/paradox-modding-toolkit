# The GUI editor, and the contract a host implements

`app/` is the whole editor: canvas, tree, layers, palette, inspector,
hit-testing, gestures, smart guides, subtree focus, multi-selection, the
clipboard gestures, and the devtools halo (placement, overlays, heatmaps,
visibility, dependencies) with its browsers and its saved library. It
imports no `vscode` API, touches no file system, and computes no layout. Every
line it needs from the outside world is a message in
[`messages.ts`](./messages.ts). `panel.ts` is one implementation of that
contract, over VS Code's `postMessage`; the Clausewitz Studio's WebView2
adapter (G6) is meant to be a second one, written without touching a line under
`app/`.

This file is that adapter's guide: what the contract promises, what a host owes
it, and which of the promises are load-bearing rather than conveniences.

## The pieces

| File | What it is | Who ports it |
|---|---|---|
| `app/` | The editor. Pure modules (`scene`, `hitTest`, `gesture`, `snap`, `selection`, `inspector`, `tree`, `layers`, `align`, `palette`, `placement`, `devtools`, `textures`, `browse`) under a thin DOM shell (`main.ts`, `render.ts`) | Nobody. It is the shared artifact. |
| `app/host.ts` | The transport shim, and the ONLY file under `app/` that knows which host it is in | A new host adds a branch here. Nothing else under `app/` changes. |
| `messages.ts` | The typed contract, both directions | Nobody. It is the contract. |
| `html.ts` | The page: markup, ids and styles, parameterised by the four things only a host knows (bundle URL, nonce, CSP, game font) | Reusable as is. A host that writes its own page must keep the element ids. |
| `panel.ts` | The VS Code host | Replaced by the new host. |
| `textureCache.ts` | Host-side DDS decoding, caching and eviction | Replaced or reused; it has no `vscode` import. |
| `userData.ts` | The storage keys and shapes for the per-user state, the block count a component row shows, and the validator for the stored view preferences | Reused. No `vscode` import, and a component saved in one host should be readable in the other. |

The bundle is built by `compile:webview` (esbuild, IIFE, es2020) to
`dist/webview/guiEditor.js`. `guiEditorPackaging.test.ts` fails if that step
leaves the compile chain or the output stops shipping in the vsix.

## The three rules

**The host owns the text. The server owns the truth.** The app never edits
source and never computes layout. It asks; the host asks the server
(`paradox/guiLayout`, `paradox/guiWidgetInfo`, `paradox/guiSourceEdit`,
`paradox/guiVocabulary`, all in `PROTOCOL.md`), applies the returned edits to
the real document, and pushes a fresh layout back down. The widget tree is
built from the layout result, so there is no separate tree request to serve.
That is why undo is the host document's own undo and the editor holds no
history: one gesture is one request is one document change is one undo step —
for a multi-selection too, which is what the `ops` BATCH exists for. (The
Studio's
separate canvas undo stack existed because `_code.SetText` reset Monaco's
history. A host that applies edits as a proper document edit does not have that
problem and must not reintroduce a second stack.)

**Textures are opaque.** The app receives URL strings it hands to an `Image`.
It knows nothing about DDS, decoding, caches or paths, and a host is free to
serve `data:` URIs, a virtual scheme or files. The texture BROWSER does not
change that: the host walks the `gfx/` trees and answers with engine-relative
path strings, so the app still never sees a file system path.

**The host owns the per-user state.** The conditional-visibility mode, the
saved components, the property presets and the inspector's value display mode
are none of them in the document and none of them the server's, so the app
keeps no authoritative copy: it asks, it draws what it is told, and the state
survives the panel being closed because the host is where it lives. See "What
the host remembers".

## What a host must implement

Every message is documented in `messages.ts`; this is what the host side of
each has to actually do.

- **`ready` / `requestLayout`** Lay out the current document text and push
  `layout`. `ready` arrives once, when the app boots.
- **`layout`** Push it after ANY change to the document: the app's own commits,
  typing in the text editor, a formatter, undo, a revert. `panel.ts` debounces
  document changes by `LAYOUT_DEBOUNCE_MS` (300 ms, the analysis debounce
  culture) and skips the debounce after its own write, so a released drag does
  not hang on its preview. `textures` maps every path in `result.textures` to a
  URL or to null.
- **`requestWidgetInfo` / `widgetInfo`** Read the widget declared on that
  0-based line and answer, ECHOING the line. The app drops an answer whose line
  the selection has already left, so an unechoed line silently breaks the
  inspector. A read that fails answers `info: null` rather than an error: a
  failed inspector read is not worth a banner over the canvas. **Pass
  `placement` through unchanged.** It costs a full server-side layout, the app
  only sets it while the panel that reads it is open, and a host that hard-coded
  it either way would either make every selection expensive or make the "why is
  it here" panel permanently empty.
- **`checkEdit`** Ask the guards what `applyEdit` would answer and WRITE
  NOTHING. This is the gesture-start check, which is why it is a message of its
  own rather than a flag: a host that misread a flag would edit the document on
  a mouse-down. Answer `editVerdict` for the same `id`.
- **`applyEdit`** One `setProperties` op, one document change, one undo step.
  Answer `editVerdict` for the `id` either way, then push a fresh `layout` when
  the document changed. A refusal reason is the SERVER'S OWN string and is shown
  verbatim: it names what the engine would have done with the write, which is
  knowledge the app does not have and must not paraphrase.
- **`checkReorder` / `reorder`** The same pair for one `reorder` op:
  `{ line, from, to }` goes to the server unchanged, `line` being the
  CONTAINER's declaration and `from`/`to` being source-child indices. The check
  writes nothing; the commit is one op, one document change, one undo step, then
  a fresh `layout`. A host that already has these two for `setProperties` has
  nothing new to do beyond building the other op kind.
- **`checkOps` / `applyOps`** The same pair for a BATCH of `GuiSourceOp`s,
  which is how everything a multi-selection does reaches the document: send
  them as the server's `ops` (not one request per op), apply the ONE edit set
  that comes back as ONE change, and put the per-op verdicts in
  `editVerdict.ops`, in request order. A per-op refusal means that member alone
  was skipped, so it must NOT become the top-level `refused`; the app shows
  those reasons per member and keeps the rest of the gesture.
- **`copyBlocks`** Read those widgets' verbatim blocks (a `blockText` op each,
  as one batch so they all come off the same text), join them in the order
  given, and put them on the system clipboard. The app never sees the text: a
  clipboard is the host's, and a paste has to survive being made in another
  editor. Answer `editVerdict`.
- **`pasteInto`** Read the clipboard and commit it as one `insertRaw` op at the
  named container and index. An empty clipboard is a refusal, not silence.
- **`requestVocabulary` / `vocabulary`** Answer `paradox/guiVocabulary` for the
  current text, WHOLE: the widget names a palette may offer, and the
  `properties` / `commonProperties` an inspector's add-property row completes
  from. A host that forwarded only the entries would leave that row offering
  nothing, which looks exactly like a document whose types the harvest does not
  know. A host with no such request answers `{ entries: [], total: 0 }`, and
  both panels say they have nothing rather than breaking.
- **`reveal`** Show that line in the text editor without stealing focus and
  without hijacking the column the editor panel is in.
- **`revealAt`** The same, for an ARBITRARY file: a dependency row points at a
  scripted_gui, an event or a loc key, none of which live in the .gui being
  edited. A path that no longer resolves is said plainly; revealing the wrong
  line in the wrong file is the failure this message exists to avoid.
- **`setVisibility`** Store the mode and the per-check assignments FOR THIS
  DOCUMENT, then lay the document out with them and push the result. There is no
  verdict: nothing was written and there is nothing for the guards to refuse,
  and the layout is the whole answer. Every later `layout` for that document
  must carry the same options in its `visibility` field, including the first one
  after reopening the file: that field is what the app builds its mode
  indicator from, and a hidden widget with no indicator is a bug hunt.
- **`requestDependencies` / `dependencies`** Answer `paradox/guiDependencies`
  for the line (or for the whole document when it is absent), ECHOING the line
  like `widgetInfo` does. A failure answers `result: null`, not an error.
- **`requestTextureList` / `textureList`** Walk the mod's and the game's `gfx/`
  trees for `.dds` files whose engine-relative path contains the query, and
  answer with at most a couple of hundred plus the real `total`. Bound the walk
  in depth and in count, do it lazily (nobody who never opens the browser should
  pay for it), and cache it: the filter box sends a request per keystroke and
  none of them may re-walk a game folder. `roots: false` says there is no folder
  configured, which the panel words differently from "nothing matched".
- **`requestThumbnails` / `thumbnails`** Decode those paths through the same
  cache and eviction the canvas fills use, CAPPED to a thumbnail size. The app
  asks only for the page it is drawing; a host that decoded a whole listing
  would decode a game's entire sprite set to draw a scrollbar.
- **`requestUserData` / `userData`** Answer with the saved components and
  presets. **Ship none.** A component or a preset this editor invented would be
  a guess at what a mod's widgets look like; two empty lists is the correct
  answer for a new user and the panels say so.
- **`saveComponent`** Read those widgets' verbatim blocks (a `blockText` op
  each, one batch, exactly like `copyBlocks`), store the TEXT under the name,
  answer `editVerdict`, then push `userData`. Storing a rendering rather than
  the bytes loses the comments, the tabs and the single-line bodies a paste is
  supposed to survive.
- **`insertComponent`** Send the stored text as one `insertRaw` op: the same
  verdict-then-layout contract as `pasteInto`. A name the host no longer has is
  a refusal, not silence.
- **`savePreset` / `forgetSaved`** Update the store and push `userData`. Neither
  touches the document, so neither answers a verdict.
- **`setUiState`** Store the inspector's value display mode and answer NOTHING.
  The app applied it the moment the user picked it, and what the host keeps is
  what the next panel boots with, which it reads off `layout.ui`. A host that
  echoed it back mid-session would fight a user who changed it twice while a
  layout was in flight, which is also why the app adopts `layout.ui` only from
  the FIRST layout it receives.

Every `checkEdit`, `applyEdit`, `checkReorder`, `reorder`, `checkOps`,
`applyOps`, `copyBlocks`, `pasteInto`, `saveComponent` and `insertComponent`
must get exactly one `editVerdict`. The app keeps a pending-callback map keyed
by `id`; an unanswered id leaves a gesture armed forever.

Three cases are easy to get wrong and are worth stating:

1. **An empty edit list with no refusal is not success.** It is the writer
   saying the bytes are already there. Answer it as a refusal ("that edit
   changes nothing"), or the app waits for a layout that never comes.
2. **A stale offset set must not be applied.** Capture the document version
   with the text the op was computed from, and refuse if it moved.
3. **`warning` is not `refused`.** A warning rides along with a write that went
   ahead and was only half honoured (a container owning one axis of a resize).
   The app shows it and keeps the result.

### Where a reorder index comes from

`reorder`'s `from` and `to` count the container's SOURCE children, which are its
DECLARATIONS: widget children and the `block` / `blockoverride` / `template`
entries alongside them, properties excluded. Those declarations have no layout
node, so an app that ranked the children it can see would be off by one per
intervening one. It does not: the server puts the real index on the node
(`GuiLayoutNode.srcIndex`), the app carries it through the scene and the layers
panel translates a dropped RANK into an op index (`app/layers.ts` `reorderTo`).

`srcIndex` is ABSENT wherever no index names the widget: a template- or
type-spliced child, a datamodel ghost, the contents of a named slot, and a
scrollarea's pass-through children (their ranks count the `scrollwidget`'s body,
not the scrollarea's). A host must treat absent as "cannot be reordered" and
never count one up for it; the app greys the grip and drops nothing there.

## What the host remembers

Four things outlive the panel, and [`userData.ts`](./userData.ts) owns their
keys and shapes so both hosts store the same bytes. `panel.ts` puts all four in
VS Code's `workspaceState`; another host may use anything with the same shape.

| Key | Shape | Scope |
|---|---|---|
| `px.guiEditor.components` | `{ [name]: string }` — the widgets' VERBATIM block text | A library: global, not per document |
| `px.guiEditor.presets` | `{ [name]: { key, value }[] }` — property writes in saved order | A library: global, not per document |
| `px.guiEditor.visibility` | `{ [documentUri]: { mode, checks? } }` | Per document |
| `px.guiEditor.ui` | `{ valueMode: "full" \| "abbreviated" \| "hidden" }` | A preference: global |

Three rules about them. The visibility default is NEVER stored: writing
`showAll` for every file ever opened would grow the map by one entry per file,
for the mode those files already have. A component is stored as bytes rather
than a parse, because that is the only form an `insertRaw` can put back
unchanged. And the ui state is READ BACK THROUGH `readUiState`, never cast: the
store outlives the build that wrote it, and a mode this build does not know
must not reach the inspector.

## What the page must provide

If a host writes its own page instead of reusing `html.ts`, `app/` queries
these ids: `canvas`, `stage`, `tree`, `layers`, `palette`, `focusBar`,
`inspector`, `status`, `statusBar`, `stats`, `visibilityBadge`, `toast`, `meta`,
`zoomLabel`, `outlines`, `snap`, `grid`, `constraints`, `pulses`, `heatmap`,
`zoomIn`, `zoomOut`, `zoomFit`, `paletteToggle`, `haloToggle`, `halo`,
`haloTabs`, `haloBody`, `refresh`. `snap`, `grid`, `constraints` and `pulses`
are checkboxes, `snap` checked by default; `heatmap` is a `<select>` the app
fills its own options into. `palette` and `halo` start `hidden` and their
toggles are what show them. The stage needs pointer events and, ideally, pointer
capture (`app/` guards its absence, so a host without it loses only the ability
to finish a drag off-canvas). A layers row drag needs no capture at all: it
follows `pointermove` on the rows and ends on a window `pointerup`.
`body[data-font="game"]` tells the app the page embedded the game font.

## What a closed panel costs

Nothing, and that is a contract clause rather than a nicety, because three of
the halo's surfaces are expensive: the placement trace is a full server-side
layout, the dependency answer reads script files, and the texture browser walks
a game's gfx tree. So:

- the placement flag rides on `requestWidgetInfo` and is set only while one of
  the two surfaces that draw it is on: the "why" panel, which reads it as prose,
  and the constraint overlay, which reads it as geometry. They share the one
  request, because they are the same answer read two ways;
- `requestDependencies`, `requestTextureList` and `requestUserData` are sent
  when their tab is first shown, never on boot;
- halo requests are debounced on selection change, so clicking down a tree or
  dragging a marquee sends one, not one per row;
- the canvas overlays (constraints, heatmaps, pulses) each cost one field test
  per repaint while off, and nothing new runs inside a drag frame unless its
  toggle is on. The stats line measures only the repaint that follows a layout
  push, so a gesture frame does not even pay for two clock reads.

## Testing a host

The headless harnesses in `packages/vscode/test/` are host-agnostic on purpose
and are the cheapest way to check a new adapter's behavior against the same
expectations:

- `guiEditorScene.test.ts` dumps the scene for every layout fixture and asserts
  scene rects EQUAL the engine's rects. The canvas decides how a widget looks,
  never where it is.
- `guiEditorDevtools.test.ts` pins the halo's pure halves without a DOM: the
  placement rows add up to the engine's own rect, the heatmap bins, the layout
  diff, the frame-sheet grid and the vocabulary browser's grouping.
- `guiEditorHarness.ts` + `guiEditorSmoke.test.ts` boot the REAL bundle in jsdom
  against a stub host that replays the REAL server, and assert the exact op a
  gesture sends, the bytes it changes, and the refusal text a user reads.
- `guiEditorPerf.test.ts` holds the budgets: scene build, and the host half of a
  commit on the biggest window the game ships.
- `docs/gui-designer/g3-checklist.md` is the human-mouse pass, because feel is
  not something a headless harness can sign off.
