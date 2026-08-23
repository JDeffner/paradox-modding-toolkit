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
 * The chrome is px-ui (../shared): the toolbar grammar, the two resizable side
 * panels, the item lists and the inspector fields all come from ui.css, and
 * what is below is only the page's own layout plus the few shapes the shared
 * sheet has no class for.
 *
 * No `vscode` import: this module is plain string building.
 */
import uiCss from "../shared/ui.css";
import { icon, type IconName } from "../shared/icons";

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

  /** A checkbox dressed as a px-toggle: the app reads `.checked`, the page shows the pressed state. */
  const viewToggle = (id: string, name: IconName, tip: string, checked = false): string =>
    `<label class="px-toggle" data-size="sm" data-tip="${tip}" data-tip-wrap><input id="${id}" type="checkbox"${checked ? " checked" : ""} />${icon(name)}</label>`;

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>GUI Editor</title>
<style>
${uiCss}
  ${fontFace}
  body { overflow: hidden; }
  #app { display: flex; flex-direction: column; height: 100%; }

  /* ---- toolbar ---- */
  #toolbar {
    display: flex; align-items: center; gap: 6px; flex: 0 0 auto;
    padding: 6px 8px; border-bottom: 1px solid var(--px-border);
  }
  #toolbar .px-separator { height: 20px; align-self: center; }
  #fileName { font-weight: 600; max-width: 260px; }
  #fileName:empty::before { content: "GUI Editor"; color: var(--px-muted-fg); font-weight: 500; }
  /* A checkbox inside a toggle: hidden, its state shown on the label (the px-switch pattern). */
  .px-toggle > input[type="checkbox"] { position: absolute; opacity: 0; width: 0; height: 0; }
  .px-toggle:has(> input:checked) { background: var(--px-muted); }
  .px-toggle:has(> input:focus-visible) { border-color: var(--px-ring); box-shadow: 0 0 0 3px var(--px-ring-soft); }
  #heatmap { display: none; }
  #heatmapMenu { width: auto; min-width: 120px; }

  /* ---- stage ---- */
  #main { flex: 1 1 auto; display: flex; min-height: 0; }
  /* The canvas paints this same color under the world (render.ts CANVAS_BG), so a resize shows no flash. */
  #stage { flex: 1 1 auto; overflow: hidden; background: #101010; position: relative; min-width: 0; }
  #canvas { display: block; }
  #stageTools {
    position: absolute; left: 8px; bottom: 8px; display: flex; align-items: center; gap: 2px;
    padding: 2px; border-radius: var(--px-radius);
    background: color-mix(in oklch, var(--px-bg) 75%, transparent);
  }
  #zoomLabel { min-width: 44px; text-align: center; font-variant-numeric: tabular-nums; }
  #info[data-warning] { color: var(--px-destructive); }
  #info::after { white-space: pre-line; }
  [data-tip][data-tip-side="right"]::after { left: calc(100% + 6px); right: auto; top: 50%; transform: translateY(-50%); }

  /* ---- side panels ---- */
  #side { --px-sidepanel-width: 280px; }
  #right { --px-sidepanel-width: 320px; }
  #side > .px-sidepanel-body, #right > .px-sidepanel-body { overflow: hidden; }
  #tree, #layers, #inspector, #palette, #haloBody { overflow: auto; min-height: 0; }
  #tree { flex: 1 1 auto; min-height: 60px; }
  #layers { flex: 0 0 40%; min-height: 70px; border-top: 1px solid var(--px-border); }
  #palette { flex: 0 0 35%; min-height: 90px; border-top: 1px solid var(--px-border); }
  #palette[hidden] { display: none; }
  #palette .head, #layers .head { position: sticky; top: 0; z-index: 1; background: var(--px-sidebar); }
  #palette .head { padding: 6px 8px 4px; }
  #layers .head { padding: 0 0 2px; }
  #layers .head .where { text-transform: none; letter-spacing: 0; font-weight: 500; color: var(--px-fg); }
  #layers .head .hint { padding: 0 10px 4px; white-space: normal; }
  .note { padding: 6px 10px; white-space: normal; color: var(--px-muted-fg); font-size: var(--px-text-sm); }
  .section { padding: 10px 10px 2px; color: var(--px-muted-fg); font-size: var(--px-text-xs); font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
  #focusBar {
    flex: 0 0 auto; display: flex; align-items: center; gap: 2px; flex-wrap: wrap;
    padding: 4px 6px; white-space: nowrap; min-height: 36px;
    border-bottom: 1px solid var(--px-border);
  }
  #focusBar .crumb { cursor: pointer; color: var(--px-muted-fg); }
  #focusBar .crumb:hover { color: var(--px-fg); }
  #focusBar .sepArrow { color: var(--px-muted-fg); }
  #focusBar .px-grow { flex: 1 1 auto; }

  /* ---- rows (tree, layers, palette): px-item plus this page's columns ---- */
  .px-list { padding: 2px 4px; }
  .row { gap: 4px; min-height: 24px; padding-right: 4px; white-space: nowrap; }
  .row > span { flex: 0 0 auto; }
  .row > .label, .row > .rowKey { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .twisty {
    display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto;
    width: 16px; height: 16px; color: var(--px-muted-fg); cursor: pointer;
  }
  .twisty > svg.px-icon { width: 14px; height: 14px; transition: transform var(--px-ease); }
  .twisty[data-open] > svg.px-icon { transform: rotate(90deg); }
  .rowName { color: var(--px-muted-fg); }
  .tag { margin-left: 2px; height: 16px; padding: 0 6px; }
  #layers .row .grip { display: inline-flex; width: 14px; color: var(--px-muted-fg); cursor: grab; }
  #layers .row .grip > svg.px-icon { width: 12px; height: 12px; }
  #layers .row .layerTools { display: flex; flex: 0 0 auto; gap: 0; opacity: 0; transition: opacity var(--px-ease); }
  #layers .row > .px-grow { flex: 1 1 auto; }
  #layers .row:hover .layerTools, #layers .row[aria-selected="true"] .layerTools,
  #layers .row .layerTools:has([aria-pressed="true"]) { opacity: 1; }
  #layers .row .layerTools .toggle:not([aria-pressed="true"]) { color: var(--px-muted-fg); }
  #layers .row[data-dragging] { opacity: 0.35; }
  #layers .row.hiddenWidget .label { text-decoration: line-through; opacity: 0.6; }
  #palette .row { cursor: grab; }
  #palette .row[data-dragging] { opacity: 0.5; }
  /* The chip that follows a palette drag, and the container it would drop into. */
  .paletteGhost { padding: 0 10px; height: var(--px-h-sm); line-height: var(--px-h-sm); border-radius: var(--px-radius-md); font-size: var(--px-text-sm); white-space: nowrap; }
  #dropTarget { position: absolute; pointer-events: none; box-sizing: border-box; border: 2px solid var(--px-primary); border-radius: 2px; }
  #dropTarget[hidden] { display: none; }
  #dropTarget > .px-badge { position: absolute; left: -2px; top: -22px; background: var(--px-primary); color: var(--px-primary-fg); border-color: var(--px-primary); }

  /* ---- inspector ---- */
  #inspector { flex: 1 1 auto; min-height: 80px; padding-bottom: 8px; }
  #inspector .head { padding: 4px 10px 8px; border-bottom: 1px solid var(--px-border); display: flex; flex-direction: column; gap: 2px; }
  #inspector .head .title { font-weight: 600; }
  .chain { color: var(--px-muted-fg); font-size: var(--px-text-sm); white-space: normal; }
  #inspector .prop { display: flex; flex-direction: column; padding: 2px 10px; }
  #inspector .prop .line { display: grid; grid-template-columns: 16px minmax(0, 40%) minmax(0, 1fr); align-items: center; gap: 4px; }
  #inspector .prop .line > .key { grid-column: 2; }
  #inspector .prop .line > .twisty { grid-column: 1; }
  #inspector .prop .line > .val, #inspector .prop .line > .valRow { grid-column: 3; }
  #inspector .key { font-size: var(--px-text-sm); color: var(--px-muted-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #inspector .valRow { display: flex; align-items: center; gap: 4px; min-width: 0; }
  #inspector .valRow > .val { flex: 1 1 auto; }
  #inspector input.val { text-align: right; }
  #inspector .val { font-family: var(--px-font-mono); }
  #inspector .val.short {
    display: block; min-width: 0; height: var(--px-h-sm); line-height: calc(var(--px-h-sm) - 2px);
    padding: 0 8px; text-align: right; cursor: text; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    border: 1px solid transparent; border-radius: var(--px-radius-md); transition: background-color var(--px-ease);
  }
  #inspector .val.short:hover { background: var(--px-muted); }
  #inspector .prop .from { padding-left: 20px; font-size: var(--px-text-xs); color: var(--px-muted-fg); }
  #inspector .prop .block { display: flex; flex-direction: column; gap: 3px; padding: 3px 0 3px 20px; }
  #inspector .prop .block .line { display: flex; gap: 4px; align-items: center; }
  #inspector .prop .block .line > .val { flex: 1 1 auto; }
  #inspector .prop .block .line > .val.key { flex: 0 0 40%; text-align: left; }
  #inspector .addProp { padding: 2px 10px 6px; display: flex; flex-direction: column; gap: 3px; }
  #inspector .addProp .line { display: flex; gap: 4px; align-items: center; }
  #inspector .addProp .line > .val { flex: 1 1 auto; min-width: 0; }
  #inspector .addProp .line > .val.key { flex: 0 0 40%; text-align: left; }
  #inspector .addProp .line > .dropdownWrap > .px-dropdown { flex: 1 1 auto; min-width: 0; width: auto; }
  #inspector .addProp .suggest { display: flex; flex-direction: column; gap: 1px; }
  #inspector .addProp .suggest:empty { display: none; }
  #inspector .addProp .suggest .row { min-height: 24px; padding: 0 8px; font-family: var(--px-font-mono); font-size: var(--px-text-sm); }
  .tools { display: flex; flex-wrap: wrap; gap: 3px; padding: 4px 10px; align-items: center; }
  .tools > .px-input, .tools > .dropdownWrap > .px-dropdown { flex: 1 1 120px; min-width: 0; width: auto; }
  .tools > .px-label { flex: 0 0 auto; }
  /* dropdownSelect(): the select holds the value and is never shown; the button is the field. */
  .dropdownWrap { display: contents; }
  .dropdownWrap > select { display: none; }
  #inspector .anchors { display: flex; gap: 16px; padding: 4px 10px 8px; }
  #inspector .anchors .from { font-size: var(--px-text-xs); color: var(--px-muted-fg); margin-bottom: 4px; }
  #inspector .anchorGrid { display: grid; grid-template-columns: repeat(3, 16px); grid-auto-rows: 16px; gap: 3px; }
  #inspector .anchorGrid .cell {
    border: 1px solid var(--px-input); border-radius: 3px; cursor: pointer;
    transition: background-color var(--px-ease), border-color var(--px-ease);
  }
  #inspector .anchorGrid .cell:hover { background: var(--px-muted); }
  #inspector .anchorGrid .cell.on { background: var(--px-primary); border-color: var(--px-primary); }

  /* ---- devtools halo ---- */
  #halo { flex: 0 0 55%; min-height: 120px; display: flex; flex-direction: column; border-top: 1px solid var(--px-border); }
  #halo[hidden] { display: none; }
  #haloTabs { flex: 0 0 auto; display: flex; flex-wrap: wrap; padding: 0 4px; }
  #haloTabs .px-tab { height: var(--px-h-sm); padding: 0 7px; font-size: var(--px-text-sm); }
  #haloBody { flex: 1 1 auto; padding: 4px 0; }
  #haloBody .head { padding: 6px 10px; display: flex; flex-direction: column; gap: 2px; }
  #haloBody .head .title { font-weight: 600; }
  #haloBody .prose { padding: 3px 10px; white-space: normal; }
  #haloBody .terms { padding: 2px 10px; font-family: var(--px-font-mono); font-size: var(--px-text-sm); }
  #haloBody .terms .term { display: flex; gap: 6px; justify-content: space-between; white-space: nowrap; }
  #haloBody .terms .term.sum { margin-top: 2px; padding-top: 2px; border-top: 1px solid var(--px-border); }
  #haloBody .terms .term .n { flex: 0 0 auto; text-align: right; min-width: 96px; }
  #haloBody .terms .term .what { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  #haloBody .link { cursor: pointer; text-underline-offset: 3px; }
  #haloBody .link:hover { text-decoration: underline; }
  #haloBody .missing { color: var(--px-destructive); }
  #haloBody .filter { padding: 4px 10px; }
  #haloBody .row { padding-left: 8px; }
  #haloBody .thumb { display: block; margin: 4px 10px; background: #101010; border-radius: var(--px-radius-sm); }
  #haloBody .swatch {
    flex: 0 0 auto; width: 28px; height: 28px; background: #101010; object-fit: contain;
    border-radius: var(--px-radius-sm); box-shadow: inset 0 0 0 1px var(--px-border);
  }
  #haloBody .texRow { gap: 8px; min-height: 36px; }
  #haloBody .texRow .names { min-width: 0; }
  #haloBody .texRow .names div { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #haloBody label.check { padding: 3px 10px; gap: 8px; }
  #haloBody label.check .px-grow { white-space: normal; }

  /* ---- status strip ---- */
  #statusBar {
    flex: 0 0 auto; display: flex; align-items: center; gap: 10px;
    padding: 3px 10px; font-size: var(--px-text-xs); min-height: 24px;
    border-top: 1px solid var(--px-border); color: var(--px-muted-fg);
  }
  #status { flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* The store line and the stats are read from the info button's tooltip; only a warning shows here. */
  #meta { flex: 0 1 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #meta:not([data-warning]), #stats { display: none; }
  #meta[data-warning] { color: var(--px-destructive); }
  #visibilityBadge { cursor: pointer; }
  #visibilityBadge[hidden] { display: none; }
</style>
</head>
<body data-font="${fontDataUri ? "game" : "fallback"}">
<div id="app">
  <div id="toolbar">
    <span id="fileName" class="px-truncate"></span>
    <button id="refresh" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Lay the document out again">${icon("rotate")}</button>
    <div class="px-separator" data-orientation="vertical"></div>
    <button id="undo" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Undo the last change to the .gui file (the text editor's own undo)">${icon("undo")}</button>
    <button id="redo" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Redo the change you just undid">${icon("redo")}</button>
    <span class="px-grow"></span>
    <div class="px-toggle-group">
      ${viewToggle("outlines", "squareDashed", "Outline every widget")}
      ${viewToggle("snap", "magnet", "Snap a drag to sibling and parent edges, centres, equal gaps and equal sizes", true)}
      ${viewToggle("grid", "grid", "Draw an 8 px grid and snap a drag to it (Alt+arrow nudges by one step)")}
      ${viewToggle("constraints", "ruler", "Show the selected widget's parent box, its anchors and the offset between them")}
      ${viewToggle("pulses", "activity", "Flash the widgets each re-layout moved")}
    </div>
    <select id="heatmap"></select>
    <button id="heatmapMenu" class="px-btn px-dropdown" data-variant="outline" data-size="sm" data-tip="Tint the scene by one property of the widget tree" data-tip-wrap>${icon("flame")}<span class="px-truncate"></span>${icon("chevronDown")}</button>
    <div class="px-separator" data-orientation="vertical"></div>
    <div class="px-toggle-group">
      <button id="paletteToggle" class="px-toggle" data-size="sm" aria-pressed="false" data-tip="Show the widgets you can drag onto the canvas" data-tip-wrap>${icon("shapes")}Palette</button>
      <button id="haloToggle" class="px-toggle" data-size="sm" aria-pressed="false" data-tip="Explain, browse and reuse: why a widget is placed where it is, what it depends on, and the textures, types and saved pieces available to it" data-tip-wrap>${icon("wrench")}Devtools</button>
    </div>
    <div class="px-separator" data-orientation="vertical"></div>
    <button id="toggleSide" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Hide the tree">${icon("panelLeftClose")}</button>
    <button id="toggleRight" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Hide the inspector" data-tip-side="left">${icon("panelRightClose")}</button>
  </div>
  <div id="main">
    <div id="side" class="px-sidepanel" data-side="left">
      <div class="px-sidepanel-resizer"></div>
      <div class="px-sidepanel-body">
        <div id="focusBar"></div>
        <div id="tree" class="px-list"></div>
        <div id="layers" class="px-list"></div>
        <div id="palette" class="px-list" hidden></div>
      </div>
    </div>
    <div id="stage">
      <canvas id="canvas"></canvas>
      <div id="dropTarget" hidden><span class="px-badge">Drop here</span></div>
      <div id="stageTools">
        <button id="info" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="" data-tip-side="right" data-tip-wrap>${icon("info")}</button>
        <button id="zoomOut" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Zoom out" data-tip-side="right">${icon("zoomOut")}</button>
        <span id="zoomLabel" class="px-muted px-xs">100%</span>
        <button id="zoomIn" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Zoom in" data-tip-side="right">${icon("zoomIn")}</button>
        <button id="zoomFit" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Fit the 1920x1080 reference viewport" data-tip-side="right">${icon("maximize")}</button>
      </div>
    </div>
    <div id="right" class="px-sidepanel" data-side="right">
      <div class="px-sidepanel-resizer"></div>
      <div class="px-sidepanel-body">
        <div id="inspector"></div>
        <div id="halo" hidden><div id="haloTabs" class="px-tabs" data-variant="line"></div><div id="haloBody"></div></div>
      </div>
    </div>
  </div>
  <div id="statusBar">
    <span id="status">Loading…</span>
    <span id="visibilityBadge" class="px-badge" data-variant="destructive" hidden></span>
    <span id="meta"></span>
    <span id="stats"></span>
  </div>
</div>
<script nonce="${nonce}" src="${scriptSrc}"></script>
</body>
</html>`;
}
