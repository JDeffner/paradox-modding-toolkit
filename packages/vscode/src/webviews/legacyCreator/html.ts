/**
 * The Dynasty Legacy Creator page: markup and the few page-specific styles on
 * top of the shared px-ui stylesheet. The app fills the sections at runtime;
 * nothing here talks to the host.
 *
 * The shape is the game's legacy window (gui/window_dynasty_legacy.gui,
 * measured): the track's icon at the 80 x 80 the window draws it at, its name
 * and description beside it, and under them the illustration with the row of
 * perk tiles the dynasty buys left to right. A tile there is 296 x 128, which
 * is the 2.3:1 the tiles keep here.
 *
 * The section chrome (fold, lede) is the Tradition Creator's, value for value,
 * so the creators read as one family.
 */
import uiCss from "../shared/ui.css";
import { icon } from "../shared/icons";

export interface LegacyCreatorHtmlOptions {
  scriptSrc: string;
  nonce: string;
  csp: string;
}

export function legacyCreatorHtml({ scriptSrc, nonce, csp }: LegacyCreatorHtmlOptions): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>Dynasty Legacy Creator</title>
<style>
${uiCss}
  body { overflow: hidden; }
  #app { display: flex; flex-direction: column; height: 100%; }
  #toolbar {
    display: flex; align-items: center; gap: 6px; flex: 0 0 auto; flex-wrap: wrap;
    padding: 6px 8px; border-bottom: 1px solid var(--px-border);
  }
  #name { width: 220px; font-family: var(--px-font-mono); }
  #main { flex: 1 1 auto; display: flex; min-height: 0; }
  #body { flex: 1 1 auto; overflow-y: auto; padding: 10px 12px 40px; min-width: 0; }
  #sections { max-width: 860px; display: flex; flex-direction: column; gap: 4px; }
  /* A class rule beats the browser's own display:none for [hidden], so a
     px-badge or a px-toggle-group marked hidden would still draw. */
  [hidden] { display: none !important; }
  .note { color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  #problem { margin: 8px 0; }

  /* --------------------------------- a folding section (px-ui rule 7) */
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
  .fold-body { display: flex; flex-direction: column; gap: 8px; padding: 2px 2px 14px; }
  .fold:not([data-open]) > .fold-body { display: none; }
  .lede { color: var(--px-muted-fg); font-size: var(--px-text-xs); margin: -2px 0 2px; }

  /* --------------------------------------------------- the two pictures */
  /* The pickers on the left, the icon at the size the game draws it on the
     right, so a pick is seen where it is made. */
  .artblock { display: grid; grid-template-columns: minmax(0, 1fr) 96px; gap: 8px 12px; align-items: start; }
  .artnote { color: var(--px-muted-fg); font-size: var(--px-text-xs); padding-left: 2px; }
  .artnote > code { font-family: var(--px-font-mono); color: var(--px-fg); }
  /* The game draws both pictures through a frame and a mask, both with
     blend_mode = alphamultiply, so the final alpha is picture x frame x mask:
     two mask layers intersected. Without the game folder there is no texture
     to mask with and the picture stays a plain rectangle. */
  .masked {
    -webkit-mask-image: var(--frame), var(--mask);
    mask-image: var(--frame), var(--mask);
    -webkit-mask-size: 100% 100%, 100% 100%;
    mask-size: 100% 100%, 100% 100%;
    -webkit-mask-composite: source-in;
    mask-composite: intersect;
  }

  /* ------------------------------------------------------- the legacy row */
  #legacyRow { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  #trackBox { display: flex; align-items: flex-start; gap: 10px; min-width: 0; }
  /* icon_doctrine in window_dynasty_legacy.gui: size = { 80 80 }. */
  #trackArt {
    flex: 0 0 auto; width: 80px; height: 80px; border-radius: var(--px-radius-md);
    background: var(--px-muted); display: flex; align-items: center; justify-content: center;
    color: var(--px-muted-fg); overflow: hidden;
  }
  #trackArt > img { width: 100%; height: 100%; object-fit: cover; display: block; }
  #trackArt[data-masked] { background: none; border-radius: 0; }
  #trackWords { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  #rowName { font-size: var(--px-text); font-weight: 600; }
  #rowDesc {
    font-size: var(--px-text-sm); color: var(--px-muted-fg); line-height: 1.35;
    display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;
  }

  /* The illustration strip. The game's two background widgets FILL the box
     the perk items define (the calibrated layout engine reads a background as
     its parent's fill), so one illustration stretches under the whole row and
     is drawn twice, each pass multiplied by the frame and the mask. The strip
     here is that box: the tiles set its width and height, the picture covers
     it. */
  #stripRow { display: flex; align-items: stretch; gap: 8px; min-width: 0; overflow-x: auto; padding-bottom: 4px; }
  #strip { position: relative; flex: 1 1 auto; min-width: 0; }
  #stripArt { position: absolute; inset: 0; overflow: hidden; }
  #stripArt > img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: fill; display: block; }
  #stripArt[data-empty] {
    border: 1px dashed var(--px-border); border-radius: var(--px-radius-sm);
  }
  #perks { position: relative; display: flex; gap: 0; min-width: 0; }
  /* The game's own tile is 296 x 128. The min-height is the one departure: at
     the narrow end the ratio alone leaves no room for a two-line name, and a
     clipped name is worse than a strip a few pixels taller than the game's. */
  .perktile {
    position: relative; flex: 1 1 0; min-width: 96px; aspect-ratio: 296 / 128; min-height: 54px;
    box-sizing: border-box;
    display: flex; flex-direction: column; justify-content: flex-end;
    padding: 4px 6px; cursor: pointer; overflow: hidden;
    border: 1px solid transparent; text-align: left; user-select: none;
    transition: background-color var(--px-ease), border-color var(--px-ease);
  }
  /* With no picture behind them the tiles keep the panel's own chrome. */
  #perks > .perktile { background: var(--px-muted); }
  #perks > .perktile + .perktile { border-left-color: var(--px-border); }
  #perks > .perktile:hover { background: var(--px-muted-strong); }
  /* Over the illustration the game lays mask_frame_horizontal on every tile
     with tintcolor = { 0 0 0 0.7 }, which is what keeps a perk's name
     readable on the picture; the same scrim does it here. */
  #stripArt:not([data-empty]) ~ #perks > .perktile { background: rgba(0, 0, 0, 0.55); color: #f2ece2; }
  #stripArt:not([data-empty]) ~ #perks > .perktile + .perktile { border-left-color: rgba(0, 0, 0, 0.35); }
  #stripArt:not([data-empty]) ~ #perks > .perktile:hover { background: rgba(0, 0, 0, 0.35); }
  #stripArt:not([data-empty]) ~ #perks > .perktile > .step { color: inherit; opacity: 0.75; }
  .perktile[aria-selected="true"] { border-color: var(--px-ring); }
  .perktile[data-dragging] { opacity: 0.35; }
  /* The step number sits in the corner rather than above the name, so the
     name gets the tile's whole height. */
  .perktile > .step {
    position: absolute; top: 2px; left: 6px;
    font-size: var(--px-text-xs); color: var(--px-muted-fg);
  }
  .perktile > .face {
    font-size: var(--px-text-sm); line-height: 1.25; overflow: hidden; font-weight: 600;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  }
  .perktile > .px-item-tools { position: absolute; top: 2px; right: 2px; opacity: 0; }
  .perktile:hover > .px-item-tools,
  .perktile:focus-within > .px-item-tools { opacity: 1; }
  /* The one tile that is not on the strip: the game has no such tile, so it
     keeps the panel's own chrome. */
  #addPerk {
    flex: 0 0 132px; align-self: stretch; align-items: center; justify-content: center;
    border: 1px dashed var(--px-border); border-radius: var(--px-radius-md);
    background: none; color: var(--px-muted-fg); aspect-ratio: auto;
  }
  #addPerk:hover { background: var(--px-muted); }
  #perkTip { position: fixed; z-index: 80; max-width: 320px; pointer-events: none; }
  #perkTip > .px-game-tip { background: var(--px-popover); box-shadow: var(--px-shadow-md); }
  .rows-preview { padding: 0 8px 2px 8px; }

  /* --------------------------------------------------------- perk editor */
  #side .px-sidepanel-body { padding-bottom: 24px; }
  #sideHead { display: flex; align-items: center; gap: 4px; padding: 0 0 4px; }
  #sideTitle {
    font-size: var(--px-text-xs); text-transform: uppercase; letter-spacing: 0.04em;
    font-weight: 600; color: var(--px-muted-fg); overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap;
  }
  #perkEditor { display: flex; flex-direction: column; gap: 4px; }
  #perkEditor .px-field { grid-template-columns: 1fr; gap: 2px; }
  #perkEditor .px-label { padding-top: 0; }
  /* One doctrine modifier: its own card, because a perk can carry several. */
  .doctrineblock {
    position: relative; display: flex; flex-direction: column; gap: 6px;
    padding: 8px; border: 1px solid var(--px-border); border-radius: var(--px-radius-md);
  }
  .doctrineblock > .px-item-tools { position: absolute; top: 4px; right: 4px; }

  .px-script > pre { max-height: 420px; }
</style>
</head>
<body>
<div id="app">
  <div id="toolbar">
    <input id="name" class="px-input" data-size="sm" spellcheck="false" autocomplete="off"
      placeholder="track key" data-tip="The track's key: lowercase letters, digits and _, starting with a letter. Everything else follows it." data-tip-wrap />
    <span id="source" class="px-badge" data-variant="outline" hidden></span>
    <div class="px-toggle-group" id="mode" hidden>
      <button class="px-toggle" data-size="sm" data-mode="duplicate" aria-pressed="true" data-tip="Write a copy under a new key. Your track and the game's both exist." data-tip-wrap>Duplicate</button>
      <button class="px-toggle" data-size="sm" data-mode="override" data-tip="Write the game's own key into your mod. There are no partial overrides: your copy replaces the whole track and stops receiving patch changes." data-tip-wrap>Override</button>
    </div>
    <button id="new" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Start a fresh track. Nothing is written until you save." data-tip-wrap>${icon("filePlus")}</button>
    <button id="open" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Open a track: one of your own to edit, or one of the game's to duplicate or override" data-tip-wrap>${icon("folderOpen")}</button>
    <button id="lookup" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Read what a modifier does, and where the game itself uses it" data-tip-wrap>${icon("bookOpen")}</button>
    <!-- The script section's copy button lands here (shared/scriptSection.ts). -->
    <span id="scriptCopy"></span>
    <span class="px-grow"></span>
    <!-- One line for the whole save; its menu picks which of the two files to move. -->
    <span id="target"></span>
    <span id="locLang" class="px-muted px-xs"></span>
    <button id="save" class="px-btn" data-variant="default" data-size="sm">${icon("save")}Save</button>
    <span class="px-separator" data-orientation="vertical"></span>
    <button id="togglePerk" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Show or hide the perk editor">${icon("panelRightClose")}</button>
    <button id="helpBtn" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="How this view works" data-tip-side="left">${icon("circleHelp")}</button>
  </div>
  <div id="main">
    <div id="body">
      <div id="problem" class="px-badge" data-variant="destructive" hidden></div>
      <!-- Every section is built by the app (app/main.ts), because which keys
           exist is the server's answer and not this page's. -->
      <div id="sections"></div>
      <!-- The generated script (shared/scriptSection.ts) replaces this. -->
      <div id="scriptSlot"></div>
    </div>
    <aside id="side" class="px-sidepanel" data-side="right" data-collapsed>
      <div class="px-sidepanel-resizer"></div>
      <div class="px-sidepanel-body">
        <div id="sideHead">
          <span id="sideTitle">Perk</span>
          <span class="px-grow"></span>
          <button id="prevPerk" class="px-btn" data-variant="ghost" data-size="icon-xs" data-tip="The perk before this one">${icon("chevronLeft")}</button>
          <button id="nextPerk" class="px-btn" data-variant="ghost" data-size="icon-xs" data-tip="The perk after this one">${icon("chevronRight")}</button>
          <button id="closeSide" class="px-btn" data-variant="ghost" data-size="icon-xs" data-tip="Close the perk editor">${icon("x")}</button>
        </div>
        <div id="perkEditor"></div>
      </div>
    </aside>
  </div>
</div>
<div id="perkTip" hidden></div>
<script nonce="${nonce}" src="${scriptSrc}"></script>
</body>
</html>`;
}
