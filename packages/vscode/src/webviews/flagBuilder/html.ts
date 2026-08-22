/**
 * The Flag Builder page: markup and styles, no host API. The app (app/) fills
 * the layer list, the inspector and the browser at runtime.
 */
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
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0; height: 100%; overflow: hidden;
    font-family: var(--vscode-font-family, sans-serif);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-editor-foreground, #ccc);
    background: var(--vscode-editor-background, #1e1e1e);
  }
  #app { display: flex; flex-direction: column; height: 100%; }
  #toolbar {
    display: flex; align-items: center; gap: 6px; flex: 0 0 auto; flex-wrap: wrap;
    padding: 6px 8px;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
  }
  #toolbar .grow { flex: 1 1 auto; }
  #toolbar .muted { opacity: .7; }
  button {
    padding: 3px 10px; border-radius: 2px; cursor: pointer; font: inherit;
    color: var(--vscode-button-secondaryForeground, var(--vscode-editor-foreground));
    background: var(--vscode-button-secondaryBackground, transparent);
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.4));
  }
  button.primary {
    color: var(--vscode-button-foreground); background: var(--vscode-button-background);
    border-color: transparent;
  }
  button.danger { color: var(--vscode-errorForeground, #f14c4c); }
  button.icon { padding: 2px 6px; }
  button:disabled { opacity: .5; cursor: default; }
  input, select {
    font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; padding: 2px 4px;
  }
  input[type=number] { width: 58px; }
  input[type=color] { width: 28px; height: 22px; padding: 0; border: none; background: none; }
  #name { width: 180px; font-weight: 600; }
  .sep { width: 1px; align-self: stretch; background: var(--vscode-panel-border, rgba(128,128,128,0.35)); }
  #main { flex: 1 1 auto; display: flex; min-height: 0; }
  #stage {
    flex: 1 1 auto; min-width: 0; display: flex; align-items: center; justify-content: center;
    background: #3c3c3c; position: relative; overflow: hidden;
    background-image: linear-gradient(45deg, #444 25%, transparent 25%, transparent 75%, #444 75%),
      linear-gradient(45deg, #444 25%, transparent 25%, transparent 75%, #444 75%);
    background-size: 24px 24px; background-position: 0 0, 12px 12px;
  }
  #canvas { max-width: 92%; max-height: 92%; box-shadow: 0 0 0 1px rgba(0,0,0,.6), 0 8px 30px rgba(0,0,0,.45); }
  #hint { position: absolute; bottom: 8px; left: 10px; font-size: 11px; opacity: .75; color: #ddd; }
  #side {
    flex: 0 0 360px; display: flex; flex-direction: column; min-height: 0; overflow: auto;
    border-left: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
    background: var(--vscode-sideBar-background, #252526);
  }
  h3 {
    margin: 0; padding: 6px 10px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; opacity: .8;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.25));
  }
  #layers { padding: 4px 0; }
  .row {
    display: flex; align-items: center; gap: 6px; padding: 3px 10px; cursor: pointer; user-select: none;
  }
  .row:hover { background: var(--vscode-list-hoverBackground); }
  .row.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .row .label { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row .kind { font-size: 11px; opacity: .7; }
  .row .tools { display: none; gap: 2px; }
  .row:hover .tools, .row.selected .tools { display: flex; }
  .adders { display: flex; gap: 4px; flex-wrap: wrap; padding: 6px 10px; }
  #inspector { padding: 6px 10px 12px; display: flex; flex-direction: column; gap: 8px; }
  .field { display: flex; align-items: center; gap: 6px; }
  .field > label { flex: 0 0 64px; opacity: .8; }
  .field > .value { flex: 1 1 auto; display: flex; align-items: center; gap: 4px; min-width: 0; }
  .field button.pick { flex: 1 1 auto; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  table { border-collapse: collapse; width: 100%; }
  td { padding: 2px 3px; vertical-align: middle; }
  td:first-child { width: 52px; opacity: .8; }
  .swatch { width: 16px; height: 16px; border-radius: 2px; border: 1px solid rgba(0,0,0,.5); display: inline-block; }
  .swatch.missing { background: repeating-linear-gradient(45deg, #f33 0 3px, transparent 3px 6px); }
  .subhead { display: flex; align-items: center; justify-content: space-between; margin-top: 4px; font-size: 11px; opacity: .85; }
  .inst { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; padding: 2px 0; }
  .inst span { opacity: .7; font-size: 11px; }
  #browser {
    position: absolute; inset: 0; display: none; flex-direction: column; z-index: 10;
    background: var(--vscode-editor-background, #1e1e1e);
  }
  #browser.open { display: flex; }
  #browserBar { display: flex; gap: 8px; align-items: center; padding: 8px; border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35)); }
  #browserBar input { flex: 1 1 auto; }
  #browserBody { flex: 1 1 auto; overflow: auto; padding: 8px; }
  #grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
  .tile {
    display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px; cursor: pointer;
    border: 1px solid transparent; border-radius: 3px;
  }
  .tile:hover { border-color: var(--vscode-focusBorder, #007fd4); }
  .tile canvas, .tile .ph { width: 108px; height: 72px; object-fit: contain; background: #2a2a2a; }
  .tile .ph { display: flex; align-items: center; justify-content: center; opacity: .5; font-size: 11px; }
  .tile .name { font-size: 11px; width: 100%; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .flagrow { display: flex; gap: 10px; padding: 3px 6px; cursor: pointer; align-items: center; }
  .flagrow:hover { background: var(--vscode-list-hoverBackground); }
  .flagrow .src { opacity: .6; font-size: 11px; }
  #toast {
    position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); padding: 6px 12px; border-radius: 3px;
    background: var(--vscode-notifications-background, #333); color: var(--vscode-notifications-foreground, #eee);
    box-shadow: 0 2px 10px rgba(0,0,0,.4); opacity: 0; transition: opacity .2s; pointer-events: none; z-index: 20;
  }
  #toast.show { opacity: 1; }
</style>
</head>
<body>
<div id="app">
  <div id="toolbar">
    <input id="name" placeholder="flag_name" spellcheck="false" />
    <button id="new">New</button>
    <button id="open">Open…</button>
    <span class="sep"></span>
    <button id="copy">Copy script</button>
    <button id="save" class="primary">Save to mod</button>
    <button id="png">Export PNG</button>
    <span class="grow"></span>
    <span id="status" class="muted"></span>
  </div>
  <div id="main">
    <div id="stage">
      <canvas id="canvas" width="768" height="512"></canvas>
      <div id="hint"></div>
    </div>
    <div id="side">
      <h3>Layers</h3>
      <div id="layers"></div>
      <div class="adders">
        <button data-add="colored_emblem">+ Colored emblem</button>
        <button data-add="textured_emblem">+ Textured emblem</button>
        <button data-add="sub">+ Sub flag</button>
      </div>
      <h3 id="inspectorTitle">Flag</h3>
      <div id="inspector"></div>
    </div>
  </div>
  <div id="browser">
    <div id="browserBar">
      <span id="browserTitle"></span>
      <input id="browserSearch" placeholder="Search…" spellcheck="false" />
      <button id="browserClose">Close</button>
    </div>
    <div id="browserBody"></div>
  </div>
  <div id="toast"></div>
</div>
<script nonce="${nonce}" src="${scriptSrc}"></script>
</body>
</html>`;
}
