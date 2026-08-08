# The GUI editor, and the contract a host implements

`app/` is the whole editor: canvas, tree, layers, inspector, hit-testing,
gestures, smart guides, subtree focus. It
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
| `app/` | The editor. Pure modules (`scene`, `hitTest`, `gesture`, `snap`, `selection`, `inspector`, `tree`, `layers`) under a thin DOM shell (`main.ts`, `render.ts`) | Nobody. It is the shared artifact. |
| `app/host.ts` | The transport shim, and the ONLY file under `app/` that knows which host it is in | A new host adds a branch here. Nothing else under `app/` changes. |
| `messages.ts` | The typed contract, both directions | Nobody. It is the contract. |
| `html.ts` | The page: markup, ids and styles, parameterised by the four things only a host knows (bundle URL, nonce, CSP, game font) | Reusable as is. A host that writes its own page must keep the element ids. |
| `panel.ts` | The VS Code host | Replaced by the new host. |
| `textureCache.ts` | Host-side DDS decoding, caching and eviction | Replaced or reused; it has no `vscode` import. |

The bundle is built by `compile:webview` (esbuild, IIFE, es2020) to
`dist/webview/guiEditor.js`. `guiEditorPackaging.test.ts` fails if that step
leaves the compile chain or the output stops shipping in the vsix.

## The two rules

**The host owns the text. The server owns the truth.** The app never edits
source and never computes layout. It asks; the host asks the server
(`paradox/guiLayout`, `paradox/guiWidgetInfo`, `paradox/guiSourceEdit`, all in
`PROTOCOL.md`), applies the returned edits to the real document, and pushes a
fresh layout back down. The widget tree is built from the layout result, so
there is no separate tree request to serve. That
is why undo is the host document's own undo and the editor holds no history:
one gesture is one op is one document change is one undo step. (The Studio's
separate canvas undo stack existed because `_code.SetText` reset Monaco's
history. A host that applies edits as a proper document edit does not have that
problem and must not reintroduce a second stack.)

**Textures are opaque.** The app receives URL strings it hands to an `Image`.
It knows nothing about DDS, decoding, caches or paths, and a host is free to
serve `data:` URIs, a virtual scheme or files.

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
  failed inspector read is not worth a banner over the canvas.
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
- **`reveal`** Show that line in the text editor without stealing focus and
  without hijacking the column the editor panel is in.

Every `checkEdit`, `applyEdit`, `checkReorder` and `reorder` must get exactly
one `editVerdict`. The app keeps a pending-callback map keyed by `id`; an
unanswered id leaves a gesture armed forever.

Three cases are easy to get wrong and are worth stating:

1. **An empty edit list with no refusal is not success.** It is the writer
   saying the bytes are already there. Answer it as a refusal ("that edit
   changes nothing"), or the app waits for a layout that never comes.
2. **A stale offset set must not be applied.** Capture the document version
   with the text the op was computed from, and refuse if it moved.
3. **`warning` is not `refused`.** A warning rides along with a write that went
   ahead and was only half honoured (a container owning one axis of a resize).
   The app shows it and keeps the result.

### The one thing a reorder index cannot say yet

`reorder`'s `from` and `to` count the container's SOURCE children, and the app
derives them by ranking the container's children that carry a `line` in this
document. That is exact whenever a container's body holds widgets and
properties, which is nearly always. It is off by one per intervening
declaration when the body ALSO holds `block` / `blockoverride` declarations
between its widget children, because those have no layout node and the app
cannot see them. The fix is server-side and small (a source-child index on
`GuiLayoutNode`); until it lands, the app never guesses beyond this and a wrong
permutation is one undo step, visible immediately in the re-laid-out tree.

## What the page must provide

If a host writes its own page instead of reusing `html.ts`, `app/` queries
these ids: `canvas`, `stage`, `tree`, `layers`, `focusBar`, `inspector`,
`status`, `toast`, `meta`, `zoomLabel`, `outlines`, `snap`, `grid`, `zoomIn`,
`zoomOut`, `zoomFit`, `refresh`. `snap` and `grid` are checkboxes, `snap`
checked by default. The stage needs pointer events and, ideally, pointer
capture (`app/` guards its absence, so a host without it loses only the ability
to finish a drag off-canvas). A layers row drag needs no capture at all: it
follows `pointermove` on the rows and ends on a window `pointerup`.
`body[data-font="game"]` tells the app the page embedded the game font.

## Testing a host

The headless harnesses in `packages/vscode/test/` are host-agnostic on purpose
and are the cheapest way to check a new adapter's behavior against the same
expectations:

- `guiEditorScene.test.ts` dumps the scene for every layout fixture and asserts
  scene rects EQUAL the engine's rects. The canvas decides how a widget looks,
  never where it is.
- `guiEditorHarness.ts` + `guiEditorSmoke.test.ts` boot the REAL bundle in jsdom
  against a stub host that replays the REAL server, and assert the exact op a
  gesture sends, the bytes it changes, and the refusal text a user reads.
- `guiEditorPerf.test.ts` holds the budgets: scene build, and the host half of a
  commit on the biggest window the game ships.
- `docs/gui-designer/g3-checklist.md` is the human-mouse pass, because feel is
  not something a headless harness can sign off.
