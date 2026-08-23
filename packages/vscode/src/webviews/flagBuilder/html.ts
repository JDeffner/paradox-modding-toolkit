/**
 * The Flag Builder page: markup and page-specific styles on top of the shared
 * px-ui stylesheet, no host API. The app (app/) fills the layer list, the
 * inspector and the browser at runtime.
 */
import uiCss from "../shared/ui.css";
import { icon } from "../shared/icons";

export interface FlagBuilderHtmlOptions {
  scriptSrc: string;
  nonce: string;
  csp: string;
}

export function flagBuilderHtml({ scriptSrc, nonce, csp }: FlagBuilderHtmlOptions): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>Flag Builder</title>
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
  #canvas { max-width: 92%; max-height: 92%; border-radius: 2px; box-shadow: 0 0 0 1px rgba(0,0,0,.5), 0 12px 40px rgba(0,0,0,.35); }
  #hint { position: absolute; bottom: 8px; left: 10px; }
  #inspector { padding: 4px 10px 12px; display: flex; flex-direction: column; gap: 8px; }
  .colors { display: flex; flex-direction: column; gap: 4px; }
  .color-row { display: grid; grid-template-columns: 44px 18px 92px minmax(0, 1fr) 24px; align-items: center; gap: 6px; }
  .instance { display: flex; flex-direction: column; gap: 4px; padding: 2px 0; }
  .instance + .instance { border-top: 1px solid var(--px-border); }
  .instance > .subhead { cursor: pointer; user-select: none; }
  .instance > .subhead .px-icon.caret { transition: transform var(--px-ease); }
  .instance[data-collapsed] > .subhead .px-icon.caret { transform: rotate(-90deg); }
  .instance[data-collapsed] > .px-field { display: none; }
  .instance .px-input { width: 100%; min-width: 0; }
  .subhead { display: flex; align-items: center; justify-content: space-between; min-height: 24px; }
  #browser {
    position: absolute; inset: 0; display: none; flex-direction: column; z-index: 10;
    background: var(--px-bg);
  }
  #browser.open { display: flex; }
  #browserBar { display: flex; gap: 8px; align-items: center; padding: 8px; border-bottom: 1px solid var(--px-border); }
  #browserBar .px-input-group { flex: 1 1 auto; }
  #browserBody { flex: 1 1 auto; overflow: auto; padding: 8px; }
  #grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(124px, 1fr)); gap: 6px; }
  .tile {
    display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px; cursor: pointer;
    border-radius: var(--px-radius-md); transition: background-color var(--px-ease);
  }
  .tile:hover { background: var(--px-muted); }
  .tile[data-kind="flag"] canvas { width: 120px; height: 80px; }
  .tile .src { font-size: var(--px-text-xs); color: var(--px-muted-fg); }
  .tile canvas { width: 108px; height: 72px; border-radius: var(--px-radius-sm); background: color-mix(in oklch, var(--px-bg), var(--px-fg) 8%); }
  .tile .name { font-size: var(--px-text-xs); color: var(--px-muted-fg); width: 100%; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
</head>
<body>
<div id="app">
  <div id="toolbar">
    <input id="name" class="px-input" placeholder="flag_name" spellcheck="false" data-tip="Flag name (the key in the coa file)" />
    <div class="px-row" style="gap:2px">
      <button id="new" class="px-btn" data-variant="ghost" data-size="icon" data-tip="New flag">${icon("filePlus")}</button>
      <button id="open" class="px-btn" data-variant="ghost" data-size="icon" data-tip="Open a flag from the game or a mod">${icon("folderOpen")}</button>
      <button id="paste" class="px-btn" data-variant="ghost" data-size="icon" data-tip="Paste a flag definition from the clipboard">${icon("paste")}</button>
      <button id="copy" class="px-btn" data-variant="ghost" data-size="icon" data-tip="Copy the script to the clipboard">${icon("copy")}</button>
    </div>
    <div class="px-separator" data-orientation="vertical"></div>
    <div class="px-row" style="gap:2px">
      <button id="undo" class="px-btn" data-variant="ghost" data-size="icon" data-tip="Undo (Ctrl+Z)">${icon("undo")}</button>
      <button id="redo" class="px-btn" data-variant="ghost" data-size="icon" data-tip="Redo (Ctrl+Y)">${icon("redo")}</button>
    </div>
    <span class="px-grow"></span>
    <button id="mod" class="px-btn px-dropdown" data-variant="outline" style="width:auto;max-width:220px" data-tip="Mod the flag is saved into">${icon("package")}<span class="px-truncate"></span>${icon("chevronDown")}</button>
    <button id="save" class="px-btn" data-variant="default" data-tip="Write the flag into the mod's coat_of_arms folder">${icon("save")} Save</button>
    <div class="px-separator" data-orientation="vertical"></div>
    <div class="px-row" style="gap:2px">
      <button id="png" class="px-btn" data-variant="ghost" data-size="icon" data-tip="Export as PNG">${icon("imageDown")}</button>
      <button id="info" class="px-btn" data-variant="ghost" data-size="icon" data-tip="" data-tip-side="left" data-tip-wrap>${icon("info")}</button>
      <button id="togglePanel" class="px-btn" data-variant="ghost" data-size="icon" data-tip="Hide inspector" data-tip-side="left">${icon("panelRightClose")}</button>
    </div>
  </div>
  <div id="main">
    <div id="stage">
      <canvas id="canvas" width="768" height="512"></canvas>
      <div id="hint" class="px-muted px-xs"></div>
    </div>
    <div id="side" class="px-sidepanel" data-side="right">
      <div class="px-sidepanel-resizer"></div>
      <div class="px-sidepanel-body">
        <div class="px-panel-title">${icon("layers")} Layers <span class="px-grow"></span>
          <button id="addLayer" class="px-btn" data-variant="ghost" data-size="icon-xs" data-tip="Add a layer" data-tip-side="left">${icon("plus")}</button>
        </div>
        <div id="layers" class="px-list"></div>
        <div class="px-separator"></div>
        <div id="inspectorTitle" class="px-panel-title">Flag</div>
        <div id="inspector"></div>
      </div>
    </div>
    <div id="browser">
      <div id="browserBar">
        <span id="browserTitle" class="px-label"></span>
        <div class="px-input-group">${icon("search")}<input id="browserSearch" class="px-input" placeholder="Search…" spellcheck="false" /></div>
        <span id="browserCount" class="px-muted px-xs"></span>
        <button id="browserClose" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Close (Esc)" data-tip-side="left">${icon("x")}</button>
      </div>
      <div id="browserBody"></div>
    </div>
  </div>
</div>
<script nonce="${nonce}" src="${scriptSrc}"></script>
</body>
</html>`;
}
