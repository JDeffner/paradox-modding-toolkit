/**
 * The Coat of Arms Designer page: markup and page-specific styles on top of
 * the shared px-ui stylesheet, no host API. The app (app/) fills the tabs, the
 * instance list and the preview at runtime.
 *
 * Two panels around one stage. What a design IS (its pattern, its layout, its
 * emblems: the game's own three tabs, gui/shared/coa_designer.gui) is on the
 * right; what the editor DOES to it (the library, the preview frame, the grid,
 * the numbers of the selection) is on the left, so the arms stay between the
 * catalog and the tools instead of scrolling past the placement fields. The
 * canvas keeps only the view controls.
 */
import uiCss from "../shared/ui.css";
import { icon } from "../shared/icons";

export interface CoaDesignerHtmlOptions {
  scriptSrc: string;
  nonce: string;
  csp: string;
}

export function coaDesignerHtml({ scriptSrc, nonce, csp }: CoaDesignerHtmlOptions): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>Coat of Arms Designer</title>
<style>
${uiCss}
  body { overflow: hidden; }
  #app { display: flex; flex-direction: column; height: 100%; }
  #toolbar {
    display: flex; align-items: center; gap: 6px; flex: 0 0 auto;
    padding: 6px 8px; border-bottom: 1px solid var(--px-border);
  }
  #toolbar .px-grow { flex: 1 1 auto; }
  #name { width: 170px; font-weight: 600; }
  #target { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px; }
  #target:empty { display: none; }
  /* The save path stands next to the mod picker, which already names the mod,
     so the line drops its own mod half and truncates instead of wrapping. */
  #targetLine .px-target { max-width: 260px; }
  #targetLine .px-target-mod, #targetLine .px-target-sep { display: none; }
  #toolbar .px-separator { height: 20px; align-self: center; }
  #main { flex: 1 1 auto; display: flex; min-height: 0; position: relative; }
  #stage {
    flex: 1 1 auto; min-width: 0; display: flex; align-items: center; justify-content: center;
    position: relative; overflow: hidden;
    background:
      linear-gradient(45deg, var(--px-muted) 25%, transparent 25%, transparent 75%, var(--px-muted) 75%) 0 0 / 24px 24px,
      linear-gradient(45deg, var(--px-muted) 25%, transparent 25%, transparent 75%, var(--px-muted) 75%) 12px 12px / 24px 24px,
      color-mix(in oklch, var(--px-bg), var(--px-fg) 3%);
  }
  #viewport { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; transform-origin: 0 0; }
  #canvas { max-width: 92%; max-height: 92%; border-radius: 2px; box-shadow: 0 0 0 1px rgba(0,0,0,.5), 0 12px 40px rgba(0,0,0,.35); }
  #stage[data-panning], #stage[data-panning] #canvas { cursor: grabbing; }
  #stageTools, #stageInfo {
    position: absolute; bottom: 8px; display: flex; align-items: center; gap: 2px;
    padding: 2px; border-radius: var(--px-radius);
    background: color-mix(in oklch, var(--px-bg) 75%, transparent);
  }
  #stageTools { left: 8px; }
  #stageInfo { right: 8px; }
  #zoom, #hint { padding: 0 6px; }
  #hint:empty { display: none; }
  #frame, #tier, #gridDiv { width: auto; min-width: 0; }
  /* The frame name is long and the tier is two words: the frame gives up its
     width first, so "Tier 1" stays readable however narrow the panel is. */
  #frame { flex: 1 1 auto; }
  #tier { flex: 0 0 auto; }
  #gridToggle[aria-pressed="true"] { background: var(--px-muted); color: var(--px-fg); }

  /* The left panel's own body: same rhythm as a tab body on the right. */
  #leftBody { display: flex; flex-direction: column; gap: 10px; padding: 4px 10px 14px; }
  #leftBody .px-panel-title { padding: 0; }
  .toolRow { display: flex; align-items: center; gap: 4px; }
  .toolRow > .px-btn { flex: 1 1 auto; min-width: 0; }
  .toolRow > .px-btn[data-size="icon-sm"] { flex: 0 0 auto; }
  #placement { display: flex; flex-direction: column; gap: 8px; }
  /* Two number fields per row in a column that can be dragged narrow: the
     shared field's 112px label track leaves nothing for the box, so the label
     goes above its input here. */
  #placement .px-field { grid-template-columns: minmax(0, 1fr); gap: 2px; }

  /* Tabs sit at the top of the panel body, above the tab's own scroller. */
  #tabsRow { display: flex; padding: 6px 10px 4px; }
  #tabsRow .px-tabs { width: 100%; }
  #tabsRow .px-tab { flex: 1 1 0; }
  .tabBody { display: none; flex-direction: column; gap: 10px; padding: 4px 10px 14px; }
  /* The active tab fills the panel, so its catalog grid can take the rest. */
  .tabBody[data-active] { display: flex; flex: 1 1 auto; min-height: 0; }

  /* The catalog grids: the game wraps them at 5 across. */
  .grid { display: grid; grid-template-columns: repeat(var(--cols, 5), minmax(0, 1fr)); gap: 4px; }
  .tile {
    position: relative; padding: 2px; border: 1px solid transparent; border-radius: var(--px-radius-sm);
    background: color-mix(in oklch, var(--px-bg), var(--px-fg) 6%); cursor: pointer; line-height: 0;
    transition: background-color var(--px-ease);
  }
  .tile:hover { background: var(--px-muted); }
  .tile[aria-selected="true"] { border-color: var(--px-primary); }
  .tile canvas, .tile img { width: 100%; aspect-ratio: 3 / 2; border-radius: var(--px-radius-sm); }
  .tile[data-square] canvas, .tile[data-square] img { aspect-ratio: 1 / 1; object-fit: contain; }
  /* The catalog runs to the bottom of the panel and scrolls inside itself,
     without a scrollbar of its own: the wheel and the tiles say where you are. */
  .gridScroll { flex: 1 1 auto; min-height: 120px; overflow: auto; scrollbar-width: none; align-content: start; }
  .gridScroll::-webkit-scrollbar { display: none; }

  /* Color rows: a labelled swatch button per slot the pattern or emblem shows. */
  .colorRow { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; }
  .colorRow .px-label { white-space: nowrap; }
  .swatchBtn { width: 46px; padding: 0 6px; }
  .swatchBtn .px-swatch { width: 100%; height: 14px; border-radius: 3px; }
  .palette { display: grid; grid-template-columns: repeat(5, 26px); gap: 4px; padding: 8px; }
  .palette .px-swatch { width: 26px; height: 26px; cursor: pointer; border-radius: var(--px-radius-sm); }
  .palette .px-swatch[aria-selected="true"] { outline: 2px solid var(--px-primary); outline-offset: 1px; }
  .paletteFoot { padding: 0 8px 8px; display: flex; }

  /* Instances of the selected emblem: four per row, as the game lists them. */
  .instances { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; }
  .instTile {
    display: flex; align-items: center; justify-content: center; height: 34px; cursor: pointer;
    border: 1px solid var(--px-border); border-radius: var(--px-radius-sm);
    font-size: var(--px-text-xs); color: var(--px-muted-fg);
    transition: background-color var(--px-ease);
  }
  .instTile:hover { background: var(--px-muted); }
  .instTile[aria-selected="true"] { border-color: var(--px-primary); color: var(--px-fg); }
  .detail { display: flex; flex-direction: column; gap: 6px; }
  .detail .px-field { min-width: 0; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  /* Scale X, the lock, Scale Y: the lock sits level with the two inputs. */
  .pair.scale { grid-template-columns: 1fr auto 1fr; align-items: end; }
  #scaleLock { margin-bottom: 2px; }
  #scaleLock[aria-pressed="true"] { background: var(--px-muted); color: var(--px-fg); }
  .detail .px-input { width: 100%; min-width: 0; }
  /* The layers stay in view: the emblem body takes the rest of the tab and
     the texture grid scrolls inside it, so the wheel never moves the panel. */
  #layerList { flex: 0 0 auto; max-height: 40%; overflow: hidden auto; }
  #emblemBody { display: flex; flex-direction: column; gap: 10px; flex: 1 1 auto; min-height: 0; }
  #emblemBody .gridScroll { margin-top: 2px; }
  #layerList .px-item .px-item-tools { gap: 2px; }
  #layerList .px-item[data-locked] .px-item-label { color: var(--px-muted-fg); }

  /* The library overlay: the stored designs, name under each. */
  #libGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 8px; max-height: 56vh; overflow: auto; padding: 2px; }
  .libItem { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .libItem .px-label { text-align: center; overflow-wrap: anywhere; line-height: 1.25; }
  .libBroken {
    display: flex; align-items: center; justify-content: center; aspect-ratio: 1 / 1; padding: 4px;
    border: 1px dashed var(--px-border); border-radius: var(--px-radius-sm);
    color: var(--px-muted-fg); font-size: var(--px-text-xs); text-align: center;
  }
  .libEmpty { display: flex; flex-direction: column; gap: 6px; }
  .libPath { overflow-wrap: anywhere; font-family: var(--px-mono, monospace); }
  /* The tools that act on the selection: align, distribute, mirror, duplicate. */
  /* Captioned groups of tools: the caption names what the row does. */
  .selTools { display: flex; flex-wrap: wrap; gap: 8px 12px; padding-top: 4px; }
  .toolGroup { display: flex; flex-direction: column; gap: 2px; }
  .toolGroup > .cap { font-size: var(--px-text-xs); color: var(--px-muted-fg); white-space: nowrap; }
  .toolGroup > .toolRow { display: flex; gap: 2px; }
  .note { color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  .adjustedNote { grid-column: 1 / -1; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
</style>
</head>
<body>
<div id="app">
  <div id="toolbar">
    <button id="toggleLeft" class="px-btn" data-variant="ghost" data-size="icon" data-tip="Hide the tools" data-tip-side="right">${icon("panelLeftClose")}</button>
    <input id="name" class="px-input" placeholder="my_house_coa" spellcheck="false" data-tip="The key: the arms are written as <key> = { … }, and a dynasty, house or title names it in its coa = line." data-tip-wrap />
    <span id="target" class="px-muted px-xs" data-tip="What these arms are for"></span>
    <div class="px-row" style="gap:2px">
      <button id="new" class="px-btn" data-variant="ghost" data-size="icon" data-tip="Start From Scratch">${icon("filePlus")}</button>
      <button id="open" class="px-btn" data-variant="ghost" data-size="icon" data-tip="Adjust Existing Design">${icon("folderOpen")}</button>
      <button id="paste" class="px-btn" data-variant="ghost" data-size="icon" data-tip="Paste from Clipboard">${icon("paste")}</button>
      <button id="copy" class="px-btn" data-variant="ghost" data-size="icon" data-tip="Copy to Clipboard">${icon("copy")}</button>
    </div>
    <div class="px-separator" data-orientation="vertical"></div>
    <div class="px-row" style="gap:2px">
      <button id="undo" class="px-btn" data-variant="ghost" data-size="icon" data-tip="Undo (Ctrl+Z)">${icon("undo")}</button>
      <button id="redo" class="px-btn" data-variant="ghost" data-size="icon" data-tip="Redo (Ctrl+Y)">${icon("redo")}</button>
    </div>
    <span class="px-grow"></span>
    <button id="mod" class="px-btn px-dropdown" data-variant="outline" style="width:auto;max-width:320px;min-width:180px" data-tip="Mod the arms are saved into">${icon("package")}<span class="px-truncate"></span>${icon("chevronDown")}</button>
    <span id="targetLine"></span>
    <button id="save" class="px-btn" data-variant="default" data-tip="Write the definition into the mod's coat_of_arms folder">${icon("save")} Save</button>
    <button id="png" class="px-btn" data-variant="ghost" data-size="icon" data-tip="Export as PNG">${icon("imageDown")}</button>
    <div class="px-separator" data-orientation="vertical"></div>
    <button id="help" class="px-btn" data-variant="ghost" data-size="icon" data-tip="How the designer works" data-tip-side="left">${icon("circleHelp")}</button>
    <button id="toggleRight" class="px-btn" data-variant="ghost" data-size="icon" data-tip="Hide the catalog" data-tip-side="left">${icon("panelRightClose")}</button>
  </div>
  <div id="main">
    <div id="left" class="px-sidepanel" data-side="left">
      <div class="px-sidepanel-resizer"></div>
      <div class="px-sidepanel-body">
        <div id="leftBody">
          <div class="px-panel-title">Library</div>
          <div class="toolRow">
            <button id="libImport" class="px-btn" data-variant="outline" data-size="sm" data-tip="Open a design from your library" data-tip-wrap>${icon("library")} Library</button>
            <button id="libExport" class="px-btn" data-variant="outline" data-size="sm" data-tip="Save this design to your library, outside any mod" data-tip-wrap>${icon("save")} Save</button>
            <button id="libDir" class="px-btn" data-variant="outline" data-size="icon-sm" data-tip="Choose the library folder (px.coaLibraryDir)" data-tip-wrap>${icon("folderOpen")}</button>
          </div>
          <div class="px-panel-title">Frame</div>
          <div class="toolRow">
            <button id="frame" class="px-btn px-dropdown" data-variant="outline" data-size="sm" data-tip="Preview frame (never written into the script)" data-tip-wrap>${icon("squareDashed")}<span class="px-truncate"></span>${icon("chevronDown")}</button>
            <button id="tier" class="px-btn px-dropdown" data-variant="outline" data-size="sm" data-tip-wrap hidden><span class="px-truncate"></span>${icon("chevronDown")}</button>
          </div>
          <div class="px-panel-title">Grid</div>
          <div class="toolRow">
            <button id="gridToggle" class="px-btn" data-variant="outline" data-size="icon-sm" data-tip="Show the grid and snap to it" data-tip-wrap>${icon("grid")}</button>
            <button id="gridDiv" class="px-btn px-dropdown" data-variant="outline" data-size="sm" data-tip="Grid subdivisions" hidden><span class="px-truncate"></span>${icon("chevronDown")}</button>
          </div>
          <div class="px-panel-title">Placement</div>
          <div id="placement"></div>
        </div>
      </div>
    </div>
    <div id="stage">
      <div id="viewport"><canvas id="canvas" width="768" height="512"></canvas></div>
      <div id="stageTools">
        <span id="zoom" class="px-muted px-xs"></span>
        <button id="recenter" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Recenter the canvas (default position and zoom)" data-tip-side="top" data-tip-wrap>${icon("maximize")}</button>
        <span id="hint" class="px-muted px-xs"></span>
      </div>
      <div id="stageInfo">
        <button id="info" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="" data-tip-side="top" data-tip-align="right" data-tip-wrap>${icon("info")}</button>
      </div>
    </div>
    <div id="side" class="px-sidepanel" data-side="right">
      <div class="px-sidepanel-resizer"></div>
      <div class="px-sidepanel-body">
        <div id="tabsRow">
          <div class="px-tabs" role="tablist">
            <button class="px-tab" role="tab" data-tab="background" aria-selected="true">Background</button>
            <button class="px-tab" role="tab" data-tab="layout" aria-selected="false">Layout</button>
            <button class="px-tab" role="tab" data-tab="emblems" aria-selected="false">Emblems</button>
          </div>
        </div>
        <div id="tabBackground" class="tabBody" data-active>
          <div class="px-panel-title">Colors</div>
          <div id="bgColors" class="colors"></div>
          <div class="px-panel-title">Pattern</div>
          <div id="patternGrid" class="grid gridScroll"></div>
        </div>
        <div id="tabLayout" class="tabBody">
          <div class="px-panel-title">Emblem Layout</div>
          <div class="note">Picking a layout keeps the pattern and the colors, and places the emblems it defines.</div>
          <div id="layoutGrid" class="grid gridScroll"></div>
        </div>
        <div id="tabEmblems" class="tabBody">
          <div class="px-panel-title">Emblems <span class="px-grow"></span>
            <button id="addEmblem" class="px-btn" data-variant="ghost" data-size="icon-xs" data-tip="Add an emblem" data-tip-side="left">${icon("plus")}</button>
          </div>
          <div id="layerList" class="px-list"></div>
          <div id="emblemBody"></div>
        </div>
      </div>
    </div>
  </div>
</div>
<script nonce="${nonce}" src="${scriptSrc}"></script>
</body>
</html>`;
}
