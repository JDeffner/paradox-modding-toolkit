/**
 * The editor page: markup and styles, with no host API in it.
 *
 * It lives apart from `panel.ts` for one reason: the interaction smoke boots
 * the REAL page. A harness that hand-wrote its own DOM would keep passing after
 * a rename split the markup from the ids `app/` queries, which is exactly the
 * failure a headless UI test exists to catch. The host supplies the four things
 * only it knows (where the bundle lives, its nonce, the policy to declare, the
 * game font it could read) and nothing else.
 *
 * No `vscode` import: this module is plain string building.
 */
export interface GuiEditorHtmlOptions {
  /** URL the page loads the app bundle from. */
  scriptSrc: string;
  /** Nonce the script tag carries, matching the host's own policy. */
  nonce: string;
  /** Content-Security-Policy for the page, as the host wants it enforced. */
  csp: string;
  /** The game's UI font as a data URI, or null when the host could not read it. */
  fontDataUri: string | null;
}

export function guiEditorHtml(options: GuiEditorHtmlOptions): string {
  const { scriptSrc, nonce, csp, fontDataUri } = options;
  const fontFace = fontDataUri
    ? `@font-face { font-family: "PxGuiGameFont"; src: url("${fontDataUri}") format("opentype"); }`
    : "";

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>GUI Editor</title>
<style>
  ${fontFace}
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0; height: 100%;
    font-family: var(--vscode-font-family, sans-serif);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-editor-foreground);
    background: var(--vscode-editor-background);
  }
  #app { display: flex; flex-direction: column; height: 100%; }
  #toolbar {
    display: flex; align-items: center; gap: 8px; flex: 0 0 auto; flex-wrap: wrap;
    padding: 6px 8px;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
  }
  button {
    padding: 3px 10px; border-radius: 2px; cursor: pointer;
    color: var(--vscode-button-secondaryForeground, var(--vscode-editor-foreground));
    background: var(--vscode-button-secondaryBackground, transparent);
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.4));
  }
  #toolbar label { display: flex; align-items: center; gap: 4px; cursor: pointer; user-select: none; }
  #zoomLabel { min-width: 46px; text-align: center; }
  .sep { width: 1px; align-self: stretch; background: var(--vscode-panel-border, rgba(128,128,128,0.35)); }
  #main { flex: 1 1 auto; display: flex; min-height: 0; }
  #stage { flex: 1 1 auto; overflow: hidden; background: #101010; position: relative; min-width: 0; }
  #canvas { display: block; }
  #side {
    flex: 0 0 auto; width: 240px; display: flex; flex-direction: column; min-height: 0;
    border-right: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
    background: var(--vscode-sideBar-background, transparent);
  }
  #tree, #layers, #inspector { overflow: auto; padding: 4px 0; }
  #tree { flex: 1 1 auto; min-height: 60px; }
  #layers {
    flex: 0 0 40%; min-height: 70px;
    border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
  }
  #inspector {
    flex: 0 0 auto; width: 280px;
    background: var(--vscode-sideBar-background, transparent);
    border-left: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
  }
  #focusBar {
    flex: 0 0 auto; display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
    padding: 4px 6px; white-space: nowrap;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
  }
  #focusBar button { padding: 1px 6px; font-size: 0.9em; }
  #focusBar .crumb { cursor: pointer; color: var(--vscode-textLink-foreground, #3794ff); }
  #focusBar .crumb:hover { text-decoration: underline; }
  #focusBar .sepArrow { color: var(--vscode-descriptionForeground); }
  .row {
    display: flex; align-items: center; gap: 4px; padding: 1px 6px 1px 0;
    white-space: nowrap; cursor: default; user-select: none;
  }
  .row:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.15)); }
  .row.selected { background: var(--vscode-list-activeSelectionBackground, rgba(70,130,200,0.4)); }
  .twisty {
    flex: 0 0 auto; width: 14px; text-align: center; cursor: pointer;
    color: var(--vscode-descriptionForeground);
  }
  .rowName { color: var(--vscode-descriptionForeground); }
  #layers .head { padding: 2px 6px 5px; white-space: normal; }
  #layers .head .title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #layers .head .hint { font-size: 0.85em; color: var(--vscode-descriptionForeground); }
  #layers .row { padding-left: 2px; }
  #layers .row.dragging { opacity: 0.5; }
  #layers .row.dropBefore { box-shadow: inset 0 2px 0 0 var(--vscode-focusBorder, #007fd4); }
  #layers .row.dropAfter { box-shadow: inset 0 -2px 0 0 var(--vscode-focusBorder, #007fd4); }
  #layers .row .grip {
    flex: 0 0 auto; width: 14px; text-align: center; cursor: grab;
    color: var(--vscode-descriptionForeground);
  }
  #layers .row .toggle {
    flex: 0 0 auto; width: 16px; text-align: center; cursor: pointer;
    color: var(--vscode-descriptionForeground);
  }
  #layers .row .toggle.on { color: var(--vscode-charts-yellow, #cca700); }
  #layers .row .label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  #layers .row.hiddenWidget .label { text-decoration: line-through; opacity: 0.6; }
  #layers .note { padding: 4px 8px; white-space: normal; color: var(--vscode-descriptionForeground); }
  .tag {
    flex: 0 0 auto; margin-left: 4px; padding: 0 4px; border-radius: 2px; font-size: 0.85em;
    color: var(--vscode-descriptionForeground);
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
  }
  #inspector .head { padding: 4px 8px 6px; border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35)); }
  #inspector .head .chain, #inspector .note { color: var(--vscode-descriptionForeground); }
  #inspector .note { padding: 8px; white-space: normal; }
  #inspector .prop { display: flex; flex-direction: column; padding: 3px 8px; }
  #inspector .prop .line { display: flex; gap: 6px; justify-content: space-between; }
  #inspector .prop .val { font-family: var(--vscode-editor-font-family, monospace); overflow: hidden; text-overflow: ellipsis; }
  #inspector .prop input.val {
    flex: 1 1 auto; min-width: 0; text-align: right; padding: 0 3px; border-radius: 2px;
    color: var(--vscode-input-foreground, inherit);
    background: var(--vscode-input-background, transparent);
    border: 1px solid transparent;
  }
  #inspector .prop input.val:hover { border-color: var(--vscode-panel-border, rgba(128,128,128,0.4)); }
  #inspector .prop input.val:focus { border-color: var(--vscode-focusBorder, #007fd4); outline: none; }
  #inspector .prop .from { font-size: 0.85em; color: var(--vscode-descriptionForeground); }
  #toast {
    position: absolute; left: 10px; right: 10px; bottom: 10px;
    padding: 7px 10px; border-radius: 3px; white-space: normal;
    color: var(--vscode-notifications-foreground, var(--vscode-editor-foreground));
    background: var(--vscode-notifications-background, #252526);
    border: 1px solid var(--vscode-notifications-border, rgba(128,128,128,0.4));
    border-left-width: 3px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.45);
    cursor: pointer;
  }
  #toast[hidden] { display: none; }
  #toast.refused { border-left-color: var(--vscode-editorError-foreground, #f14c4c); }
  #toast.warned { border-left-color: var(--vscode-editorWarning-foreground, #cca700); }
  #toast.info { border-left-color: var(--vscode-editorInfo-foreground, #3794ff); }
  #status {
    flex: 0 0 auto; padding: 4px 8px; font-size: 0.9em;
    border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
    color: var(--vscode-descriptionForeground);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
</style>
</head>
<body data-font="${fontDataUri ? "game" : "fallback"}">
<div id="app">
  <div id="toolbar">
    <button id="zoomOut" title="Zoom out">-</button>
    <span id="zoomLabel">100%</span>
    <button id="zoomIn" title="Zoom in">+</button>
    <button id="zoomFit" title="Fit the 1920x1080 reference viewport">Fit</button>
    <span class="sep"></span>
    <label><input id="outlines" type="checkbox" /> Outlines</label>
    <label title="Snap a drag to sibling edges, centres and equal gaps"><input id="snap" type="checkbox" checked /> Guides</label>
    <label title="Draw a 10 px grid and snap a drag to it"><input id="grid" type="checkbox" /> Grid</label>
    <button id="refresh">Refresh</button>
    <span id="meta" style="margin-left:auto;color:var(--vscode-descriptionForeground)"></span>
  </div>
  <div id="main">
    <div id="side">
      <div id="focusBar"></div>
      <div id="tree"></div>
      <div id="layers"></div>
    </div>
    <div id="stage"><canvas id="canvas"></canvas><div id="toast" hidden></div></div>
    <div id="inspector"></div>
  </div>
  <div id="status">Loading…</div>
</div>
<script nonce="${nonce}" src="${scriptSrc}"></script>
</body>
</html>`;
}
