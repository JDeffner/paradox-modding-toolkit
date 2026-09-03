/**
 * The Dynasty Legacy Creator page: markup and the few page-specific styles on
 * top of the shared px-ui stylesheet. The app fills the sections at runtime;
 * nothing here talks to the host.
 *
 * The shape is the game's legacy window (gui/window_dynasty_legacy.gui,
 * measured): the track's picture, its name and description, and the row of
 * perk tiles the dynasty buys left to right. A tile there is 296 x 128, which
 * is the 2.3:1 the tiles keep here.
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
  #body > section { margin-bottom: 18px; }
  #trackSection { max-width: 720px; }
  #body > section > .px-panel-title { padding: 0 0 6px; }
  /* A class rule beats the browser's own display:none for [hidden], so a
     px-badge or a px-toggle-group marked hidden would still draw. */
  [hidden] { display: none !important; }
  .note { color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  .px-panel-title > .note { text-transform: none; letter-spacing: normal; }
  #problem { margin: 8px 0; }

  /* ------------------------------------------------------- the legacy row */
  #legacyRow { display: flex; align-items: stretch; gap: 12px; }
  #trackBox {
    flex: 0 0 auto; display: flex; align-items: center; gap: 10px; width: 260px; min-width: 0;
  }
  /* The game draws the track picture through a frame and a mask, both with
     blend_mode = alphamultiply, so the final alpha is picture x frame x mask:
     two mask layers intersected. Without the game folder there is no texture
     to mask with and the picture stays a plain square. */
  #trackArt {
    flex: 0 0 auto; width: 96px; height: 96px; border-radius: var(--px-radius-md);
    background: var(--px-muted); display: flex; align-items: center; justify-content: center;
    color: var(--px-muted-fg); overflow: hidden;
  }
  #trackArt > img { width: 100%; height: 100%; object-fit: cover; display: block; }
  #trackArt[data-masked] { background: none; border-radius: 0; }
  #trackArt[data-masked] > img {
    -webkit-mask-image: var(--frame), var(--mask);
    mask-image: var(--frame), var(--mask);
    -webkit-mask-size: 100% 100%, 100% 100%;
    mask-size: 100% 100%, 100% 100%;
    -webkit-mask-composite: source-in;
    mask-composite: intersect;
  }
  #trackWords { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  #rowName { font-size: var(--px-text); font-weight: 600; }
  #rowDesc {
    font-size: var(--px-text-sm); color: var(--px-muted-fg); line-height: 1.35;
    display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;
  }
  #perks { flex: 1 1 auto; display: flex; gap: 6px; overflow-x: auto; padding: 1px 1px 8px; }
  .perktile {
    position: relative; flex: 0 0 148px; height: 64px; box-sizing: border-box;
    display: flex; flex-direction: column; gap: 2px; padding: 6px 8px; cursor: pointer;
    border: 1px solid var(--px-border); border-radius: var(--px-radius-md);
    background: var(--px-muted); text-align: left; user-select: none;
    transition: background-color var(--px-ease), border-color var(--px-ease);
  }
  .perktile:hover { background: var(--px-muted-strong); }
  .perktile[aria-selected="true"] { border-color: var(--px-ring); }
  .perktile[data-dragging] { opacity: 0.35; }
  .perktile > .step { font-size: var(--px-text-xs); color: var(--px-muted-fg); }
  .perktile > .face {
    font-size: var(--px-text-sm); line-height: 1.25; overflow: hidden;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  }
  .perktile > .px-item-tools { position: absolute; top: 2px; right: 2px; opacity: 0; }
  .perktile:hover > .px-item-tools,
  .perktile:focus-within > .px-item-tools { opacity: 1; }
  .perktile[data-add] {
    align-items: center; justify-content: center; border-style: dashed; background: none;
    color: var(--px-muted-fg);
  }
  #perkTip { position: fixed; z-index: 80; max-width: 320px; pointer-events: none; }
  #perkTip > .px-game-tip { background: var(--px-popover); box-shadow: var(--px-shadow-md); }
  .rows-preview { padding: 0 8px 2px 8px; }

  /* --------------------------------------------------------- perk editor */
  #side .px-sidepanel-body { padding-bottom: 24px; }
  #sideHead { display: flex; align-items: center; gap: 6px; }
  #perkEditor { padding: 4px 8px; }
  #perkEditor .px-field { grid-template-columns: 1fr; gap: 2px; }
  #perkEditor .px-label { padding-top: 0; }
  #sideEmpty { padding: 12px; }

  #script {
    margin: 0; padding: 8px 10px; overflow: auto; max-height: 420px; background: var(--px-muted);
    border-radius: var(--px-radius-md); font-family: var(--px-font-mono); font-size: var(--px-text-sm);
    white-space: pre;
  }
  details > summary { cursor: pointer; }
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
    <button id="new" class="px-btn" data-variant="ghost" data-size="sm" data-tip="Start a fresh track. Nothing is written until you save.">${icon("filePlus")}New</button>
    <button id="open" class="px-btn" data-variant="ghost" data-size="sm" data-tip="Open a track this mod already has">${icon("folderOpen")}Open</button>
    <button id="lookup" class="px-btn" data-variant="ghost" data-size="sm" data-tip="Read what a modifier does, and where the game itself uses it" data-tip-wrap>${icon("bookOpen")}Modifiers</button>
    <span class="px-grow"></span>
    <span id="target" class="px-muted px-xs"></span>
    <button id="save" class="px-btn" data-variant="default" data-size="sm">${icon("save")}Save</button>
    <button id="helpBtn" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="How this view works" data-tip-side="left">${icon("circleHelp")}</button>
  </div>
  <div id="main">
    <div id="body">
      <div id="problem" class="px-badge" data-variant="destructive" hidden></div>
      <section id="trackSection">
        <div class="px-panel-title">Track</div>
        <div id="trackFields"></div>
        <details id="trackOther" hidden>
          <summary class="note">Other keys the game documents for a legacy</summary>
          <div id="trackOtherFields"></div>
        </details>
      </section>
      <section>
        <div class="px-panel-title">The track as the game draws it <span id="perkNote" class="note"></span></div>
        <div id="legacyRow">
          <div id="trackBox">
            <div id="trackArt" data-tip="The game builds this picture's path from the track's key." data-tip-wrap>${icon("image")}</div>
            <div id="trackWords">
              <div id="rowName"></div>
              <div id="rowDesc"></div>
            </div>
          </div>
          <div id="perks"></div>
        </div>
      </section>
      <section>
        <details id="scriptFold">
          <summary class="px-panel-title">Script</summary>
          <pre id="script"></pre>
        </details>
      </section>
    </div>
    <aside id="side" class="px-sidepanel" data-side="right" data-collapsed>
      <div class="px-sidepanel-resizer"></div>
      <div class="px-sidepanel-body">
        <div class="px-panel-title" id="sideHead">
          <span id="sideTitle">Perk</span>
          <span class="px-grow"></span>
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
