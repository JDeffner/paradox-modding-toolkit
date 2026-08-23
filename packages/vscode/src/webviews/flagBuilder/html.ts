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
  #name { width: 180px; font-weight: 600; }
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
  .adders { display: flex; gap: 4px; flex-wrap: wrap; padding: 2px 10px 8px; }
  #inspector { padding: 4px 10px 12px; display: flex; flex-direction: column; gap: 8px; }
  .colors { display: flex; flex-direction: column; gap: 4px; }
  .color-row { display: grid; grid-template-columns: 44px 18px 92px minmax(0, 1fr) 24px; align-items: center; gap: 6px; }
  .inst { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .inst .px-input { width: 50px; padding: 0 6px; }
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
  .tile canvas { width: 108px; height: 72px; border-radius: var(--px-radius-sm); background: color-mix(in oklch, var(--px-bg), var(--px-fg) 8%); }
  .tile .name { font-size: var(--px-text-xs); color: var(--px-muted-fg); width: 100%; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .flagrow .px-item-kind { width: auto; }
</style>
</head>
<body>
<div id="app">
  <div id="toolbar">
    <input id="name" class="px-input" placeholder="flag_name" spellcheck="false" />
    <button id="new" class="px-btn" data-variant="outline">${icon("filePlus")} New</button>
    <button id="open" class="px-btn" data-variant="outline">${icon("folderOpen")} Open…</button>
    <div class="px-separator" data-orientation="vertical"></div>
    <button id="copy" class="px-btn" data-variant="ghost">${icon("copy")} Copy script</button>
    <button id="save" class="px-btn" data-variant="default">${icon("save")} Save to mod</button>
    <button id="png" class="px-btn" data-variant="ghost">${icon("imageDown")} Export PNG</button>
    <span class="px-grow"></span>
    <span id="status" class="px-muted px-sm px-truncate"></span>
    <button id="togglePanel" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Toggle inspector" data-tip-side="left">${icon("panelRightClose")}</button>
  </div>
  <div id="main">
    <div id="stage">
      <canvas id="canvas" width="768" height="512"></canvas>
      <div id="hint" class="px-muted px-xs"></div>
    </div>
    <div id="side" class="px-sidepanel" data-side="right">
      <div class="px-sidepanel-resizer"></div>
      <div class="px-sidepanel-body">
        <div class="px-panel-title">${icon("layers")} Layers</div>
        <div id="layers" class="px-list"></div>
        <div class="adders">
          <button class="px-btn" data-variant="outline" data-size="xs" data-add="colored_emblem">${icon("plus")} Colored emblem</button>
          <button class="px-btn" data-variant="outline" data-size="xs" data-add="textured_emblem">${icon("plus")} Textured emblem</button>
          <button class="px-btn" data-variant="outline" data-size="xs" data-add="sub">${icon("plus")} Sub flag</button>
        </div>
        <div class="px-separator"></div>
        <div id="inspectorTitle" class="px-panel-title">Flag</div>
        <div id="inspector"></div>
      </div>
    </div>
    <div id="browser">
      <div id="browserBar">
        <span id="browserTitle" class="px-label"></span>
        <div class="px-input-group">${icon("search")}<input id="browserSearch" class="px-input" placeholder="Search…" spellcheck="false" /></div>
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
