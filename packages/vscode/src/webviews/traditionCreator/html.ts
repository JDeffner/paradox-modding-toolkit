/**
 * The Tradition Creator page: markup and page styles on top of the shared px-ui
 * stylesheet. The app (app/main.ts) builds every field at runtime from the form
 * the server answered and the catalog the panel read; nothing here knows a key
 * name or a layer folder.
 *
 * The page is a form on the left and the game's own Add Tradition tile on the
 * right (`.px-game-tip`, ui.css), because the question a tradition designer
 * actually has is "what will the player see and read", and script is not an
 * answer to it. The tile is 220x120 in the game
 * (`window_add_tradition.gui`'s `widget_tradition_item`), so the preview keeps
 * that shape rather than squaring the picture: at real size in the Icon
 * section, where the layers are picked, and up to twice that in the panel.
 *
 * The section chrome (fold, lede, modrow) is the trait creator's, value for
 * value, so the two creators read as one family.
 */
import uiCss from "../shared/ui.css";
import { icon } from "../shared/icons";

export interface TraditionCreatorHtmlOptions {
  scriptSrc: string;
  nonce: string;
  csp: string;
}

export function traditionCreatorHtml({ scriptSrc, nonce, csp }: TraditionCreatorHtmlOptions): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>Tradition Creator</title>
<style>
${uiCss}
  body { overflow: hidden; }
  /* An author rule beats the browser's own [hidden] rule, and px-ui gives
     every control a display of its own (px-btn is inline-flex), so a button
     the app hides would still be drawn without this. */
  [hidden] { display: none !important; }
  #app { display: flex; flex-direction: column; height: 100%; }
  #toolbar {
    display: flex; align-items: center; gap: 6px; flex: 0 0 auto; flex-wrap: wrap;
    padding: 6px 8px; border-bottom: 1px solid var(--px-border);
  }
  #name { width: 240px; font-family: var(--px-font-mono); }
  /* A dropdown fills its field cell by default; in a toolbar it is a button. */
  #mode { width: auto; }
  /* The save target line (shared/saveTarget.ts) sits in the toolbar. */
  #target { display: flex; min-width: 0; }
  #body { flex: 1 1 auto; display: flex; min-height: 0; }
  #form { flex: 1 1 auto; overflow-y: auto; min-width: 0; }
  #sections {
    max-width: 760px; padding: 12px 16px 60px; display: flex; flex-direction: column; gap: 6px;
  }
  /* The form sits centred in its pane rather than hugging its left edge, its
     label column is wide enough for the game's own field names, and a
     single-line control stops at a readable width instead of stretching to
     the pane; a block control (a text, a picture strip) keeps the full width. */
  #form #sections { margin: 0 auto; width: 100%; }
  #form .px-field { grid-template-columns: 148px minmax(0, 1fr); }
  #form .px-field > .px-input, #form .px-field > .px-dropdown, #form .px-field > .px-select { max-width: 520px; }

  /* A folding section (px-ui rule 7: sections fold, with a caret in the head). */
  .fold { display: flex; flex-direction: column; border-bottom: 1px solid var(--px-border); }
  .fold:last-of-type { border-bottom: 0; }
  .fold-head {
    display: flex; align-items: center; gap: 6px; width: 100%;
    padding: 8px 2px; border: 0; background: none; cursor: pointer; text-align: left;
    color: var(--px-fg); font: inherit;
  }
  .fold-head:hover { background: var(--px-muted); }
  .fold-head > svg { flex: 0 0 auto; transition: transform var(--px-ease); }
  .fold[data-open] > .fold-head > svg { transform: rotate(90deg); }
  .fold-title {
    font-size: var(--px-text-xs); text-transform: uppercase; letter-spacing: 0.04em;
    font-weight: 600; color: var(--px-muted-fg);
  }
  .fold-body { display: flex; flex-direction: column; gap: 8px; padding: 2px 2px 14px; container-type: inline-size; }
  .fold:not([data-open]) > .fold-body { display: none; }
  /* A lone button in the body (the Examples Wiki link) keeps its own width
     instead of stretching to the column and reading as centered text. */
  .fold-body > .px-btn { align-self: flex-start; }
  .lede { color: var(--px-muted-fg); font-size: var(--px-text-xs); margin: -2px 0 2px; }
  /* A multi-row control (the layers, the cost) reads from its first row, so
     the key label sits level with that row rather than mid-block. */
  .px-field[data-rows] { align-items: start; }
  .px-field[data-rows] > .px-label { padding-top: 6px; }

  /* The picture: its layer rows on the left, the composed tile at the game's
     own 220x120 on the right, so a pick is seen where it is made. */
  .iconblock { display: grid; grid-template-columns: minmax(0, 1fr) 220px; gap: 8px 12px; align-items: start; }
  .iconblock > .px-stack { gap: 6px; }
  /* A narrow panel (the section, not the window: the preview beside it takes
     its share) puts the tile under the rows rather than squeezing the pickers. */
  @container (max-width: 560px) {
    .iconblock { grid-template-columns: minmax(0, 1fr); }
  }
  /* One layer: the folder's own name, the picked file at the file's 545x285
     shape (measured), the picker. The slot is always drawn, so an empty layer
     keeps the row's grid and reads as empty instead of losing its picker. */
  .layerrow {
    display: grid; grid-template-columns: 96px 54px minmax(0, 1fr); gap: 6px; align-items: center;
  }
  .layerthumb {
    display: block; width: 54px; height: 28px; object-fit: contain;
    border-radius: var(--px-radius-sm);
  }
  .layerthumb[data-empty] { border: 1px dashed var(--px-border); }
  /* The files a row's draw can land on, under the row and aligned with its
     slot: small, so a folder of eight fits on one line. */
  .layeroptions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding-left: 102px; margin-top: -2px; }
  .layeroptions > .px-xs:first-child { width: 100%; }
  .layeroptions .layerthumb { width: 92px; height: 48px; }
  .layeroption {
    padding: 0; border: 1px solid transparent; border-radius: var(--px-radius-sm); background: none; cursor: pointer;
  }
  .layeroption:hover, .layeroption:focus-visible { border-color: var(--px-ring); }
  /* The live composed tile, and the same box empty while nothing is picked. */
  .iconlive { position: relative; width: 220px; height: 120px; }
  .iconlive > .px-tradicon { position: absolute; inset: 0; width: 100%; height: 100%; }
  .iconlive > .noicon {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    border: 1px dashed var(--px-border); border-radius: var(--px-radius-sm);
    color: var(--px-muted-fg); font-size: var(--px-text-xs);
  }
  /* One currency of the cost: the game's own icon and word, then the value,
     in the layer rows' columns so the two blocks share one grid. */
  .costrow { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 6px; align-items: center; }
  .costrow > .px-label { display: inline-flex; align-items: center; gap: 6px; }
  .costrow > .px-input { max-width: 282px; }

  /* A modifier row: what gets written on top, what the player reads under it. */
  .modrow { display: grid; grid-template-columns: minmax(0, 1fr) 92px 24px; gap: 6px; align-items: center; }
  .modrow > .px-mod-line, .modrow > .modrow-empty { grid-column: 1 / -1; padding-left: 2px; }
  .modrow-empty { color: var(--px-muted-fg); font-size: var(--px-text-xs); }

  /* A key the file keeps the last word on: named, never silently dropped. */
  .kept {
    display: flex; align-items: baseline; gap: 6px;
    color: var(--px-muted-fg); font-size: var(--px-text-xs);
  }
  .kept > code { font-family: var(--px-font-mono); color: var(--px-fg); }
  .kept > svg { align-self: center; flex: 0 0 auto; }

  /* The preview panel: the Add Tradition tile and the tooltip on it. */
  #side > .px-sidepanel-body { gap: 10px; padding: 10px; }
  #sideHead {
    display: flex; align-items: center; gap: 6px;
    font-size: var(--px-text-xs); text-transform: uppercase; letter-spacing: 0.04em;
    font-weight: 600; color: var(--px-muted-fg);
  }
  .tip-group {
    font-size: var(--px-text-xs); text-transform: uppercase; letter-spacing: 0.04em;
    font-weight: 600; color: var(--px-muted-fg);
  }
  /* The game's own tile: the 220x120 picture (drawn up to twice that from
     full-size layers) with the name centred under it, then its cost line. */
  .tile { display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .tile-icon { position: relative; width: 100%; max-width: 440px; aspect-ratio: 11 / 6; }
  .tile-icon > .px-tradicon { position: absolute; inset: 0; width: 100%; height: 100%; }
  .tile-icon > .noicon {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    border: 1px dashed var(--px-border); border-radius: var(--px-radius-sm);
  }
  .tile > .px-game-tip-title { text-align: center; }
  .tile-cost { display: flex; gap: 12px; font-size: var(--px-text-sm); }
  .tile-cost-line { display: inline-flex; align-items: center; gap: 4px; }
  .tile-cost-value { font-variant-numeric: tabular-nums; font-weight: 600; }
  .tile-cost-word { color: var(--px-muted-fg); }
  .tip-mods { display: flex; flex-direction: column; gap: 1px; }
  .tip-note { color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  /* The parameter sentences, as lines of the effect description; the game's
     #P/#N/#V runs keep their tone (textformatting.gui, measured). */
  .tip-params { display: flex; flex-direction: column; gap: 1px; }
  .tip-param { font-size: var(--px-text-sm); line-height: 1.5; }
  .tip-good { color: var(--px-good); font-weight: 600; }
  .tip-bad { color: var(--px-bad); font-weight: 600; }
  .tip-value { font-weight: 600; }
  #problem {
    margin: 12px 16px; padding: 10px 12px; border: 1px solid var(--px-border);
    border-radius: var(--px-radius-md); background: var(--px-muted);
    font-size: var(--px-text-sm);
  }
</style>
</head>
<body>
<div id="app">
  <div id="toolbar">
    <input id="name" class="px-input" data-size="sm" spellcheck="false" autocomplete="off"
      placeholder="tradition key" data-tip="The key the game reads. Lowercase letters, digits and _." data-tip-wrap />
    <span id="source" class="px-badge" data-variant="outline">New</span>
    <button id="new" class="px-btn" data-variant="ghost" data-size="icon-sm"
      data-tip="Start a new tradition">${icon("filePlus")}</button>
    <button id="open" class="px-btn" data-variant="ghost" data-size="icon-sm"
      data-tip="Open an existing tradition in this form">${icon("folderOpen")}</button>
    <button id="reveal" class="px-btn" data-variant="ghost" data-size="icon-sm" hidden
      data-tip="Open the file this tradition comes from">${icon("fileText")}</button>
    <!-- The script section's copy button lands here (shared/scriptSection.ts). -->
    <span id="scriptCopy"></span>
    <span class="px-grow"></span>
    <span id="target"></span>
    <button id="mode" class="px-btn px-dropdown" data-variant="outline" data-size="sm" hidden
      data-tip="This tradition belongs to the game. Choose how your mod changes it." data-tip-wrap>
      <span class="px-truncate">Duplicate</span>${icon("chevronDown")}</button>
    <button id="save" class="px-btn" data-size="sm">${icon("save")}Save</button>
    <span class="px-separator" data-orientation="vertical"></span>
    <button id="togglePreview" class="px-btn" data-variant="ghost" data-size="icon-sm"
      data-tip="Show or hide the tile preview">${icon("panelRightClose")}</button>
    <button id="helpBtn" class="px-btn" data-variant="ghost" data-size="icon-sm"
      data-tip="How this view works" data-tip-side="left">${icon("circleHelp")}</button>
  </div>
  <div id="problem" hidden></div>
  <div id="body">
    <div id="form"><div id="sections"></div></div>
    <div id="side" class="px-sidepanel" data-side="right">
      <div class="px-sidepanel-resizer"></div>
      <div class="px-sidepanel-body">
        <div id="sideHead">Preview</div>
        <div id="tip"></div>
        <div id="scriptSlot"></div>
      </div>
    </div>
  </div>
</div>
<script nonce="${nonce}" src="${scriptSrc}"></script>
</body>
</html>`;
}
