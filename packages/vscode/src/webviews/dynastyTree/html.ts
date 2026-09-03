/**
 * The Dynasty Tree page: markup and page-specific styles on top of the shared
 * px-ui stylesheet. The app (app/main.ts) fills the picker, draws the tree and
 * builds the inspector at runtime; nothing here talks to the host.
 */
import uiCss from "../shared/ui.css";
import { icon } from "../shared/icons";

export interface DynastyTreeHtmlOptions {
  scriptSrc: string;
  nonce: string;
  csp: string;
}

export function dynastyTreeHtml({ scriptSrc, nonce, csp }: DynastyTreeHtmlOptions): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>Dynasty Tree</title>
<style>
${uiCss}
  body { overflow: hidden; }
  #app { display: flex; flex-direction: column; height: 100%; }
  #toolbar {
    display: flex; align-items: center; gap: 6px; flex: 0 0 auto; flex-wrap: wrap;
    padding: 6px 8px; border-bottom: 1px solid var(--px-border);
  }
  #query { width: 240px; }
  #title { font-weight: 600; }
  #main { flex: 1 1 auto; display: flex; min-height: 0; }

  /* The picker: one scrolling list, mod dynasties first. */
  #pickerPane { flex: 1 1 auto; overflow-y: auto; min-width: 0; }
  #picker { padding: 6px; }
  #picker .px-item { align-items: center; gap: 8px; }
  #picker .dname { flex: 0 0 auto; font-weight: 500; }
  #picker .dkey { flex: 1 1 auto; min-width: 0; color: var(--px-muted-fg); font-family: var(--px-font-mono);
    font-size: var(--px-text-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #picker .dcount { flex: 0 0 auto; color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  #pickerNote { padding: 8px 12px; color: var(--px-muted-fg); font-size: var(--px-text-xs); }

  /* The canvas. Nodes are SVG, so pan and zoom are one transform. */
  #canvasWrap { flex: 1 1 auto; position: relative; min-width: 0; overflow: hidden; }
  #canvas { width: 100%; height: 100%; display: block; cursor: grab; }
  #canvas[data-panning] { cursor: grabbing; }
  #canvas text { user-select: none; }
  /* Child links are thin, marriage bars are heavier: the couple reads first. */
  .edge { fill: none; stroke: var(--px-border); stroke-width: 1.4; stroke-linejoin: round; }
  .edge[data-kind="spouse"] { stroke: var(--px-muted-fg); stroke-width: 2.6; }
  .edge[data-hot] { stroke: var(--px-primary); }
  .card { cursor: pointer; }
  .card .cbg { fill: var(--px-muted); stroke: var(--px-border); stroke-width: 1; }
  .card[data-source="mod"] .cbg { fill: var(--px-muted-strong); }
  .card[data-external] .cbg { fill: transparent; stroke-dasharray: 4 3; }
  .card:hover .cbg { stroke: var(--px-muted-fg); }
  .card .cring { fill: none; stroke: var(--px-ring); stroke-width: 2; opacity: 0; }
  .card[data-selected] .cring { opacity: 1; }
  .card .cname { font-size: 12px; font-weight: 600; fill: var(--px-fg); }
  .card[data-external] .cname { fill: var(--px-muted-fg); }
  .card .csex { font-size: 11px; fill: var(--px-muted-fg); }
  .card .cdates, .card .cid { font-size: 10px; fill: var(--px-muted-fg); }
  .card .cid { font-family: var(--px-font-mono); }
  .card .ctag { fill: var(--px-bg); stroke: var(--px-border); stroke-width: 1; }
  .card .ctagtext { font-size: 9.5px; fill: var(--px-muted-fg); }
  /* Contextual actions: only on the card the pointer is on. */
  .cacts { opacity: 0; }
  .card:hover .cacts, .card[data-selected] .cacts { opacity: 1; }
  .cact rect { fill: var(--px-bg); stroke: var(--px-border); stroke-width: 1; }
  .cact .px-icon { color: var(--px-muted-fg); }
  .cact:hover rect { fill: var(--px-primary); stroke: var(--px-primary); }
  .cact:hover .px-icon { color: var(--px-primary-fg); }
  #empty {
    position: absolute; inset: 0; display: flex; flex-direction: column; gap: 8px;
    align-items: center; justify-content: center; color: var(--px-muted-fg); padding: 24px;
    text-align: center;
  }
  #empty[hidden] { display: none; }
  #empty .note { font-size: var(--px-text-xs); }

  /* The inspector. The padding is the trait creator's, so a control never sits
     on the panel's own edge, and .px-field keeps its label column. */
  #side > .px-sidepanel-body { gap: 10px; padding: 10px; }
  #side h2 { margin: 0; font-size: 14px; }
  #side .sec { display: flex; flex-direction: column; gap: 6px; }
  #side .chips { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
  #side .note { color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  #side .actions { display: flex; flex-wrap: wrap; gap: 6px; }
  .pick { justify-content: space-between; width: 100%; }
  .pick > .val { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* One date, four parts: era (only when the calendar has one), year, month,
     day. Year, month and day together are 186px, which fits the 199px control
     column the default 340px panel has (measured 2026-09-03), so a date without
     an era reads on one line. A fourth part WRAPS rather than being clipped:
     a squeezed day dropdown is worse than a second line. */
  .dparts { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; min-width: 0; }
  .dparts > .px-btn { flex: 0 1 auto; min-width: 0; justify-content: space-between; gap: 2px; }
  .dparts > .year { width: 58px; flex: 0 0 auto; }
  .dparts > .month { min-width: 78px; }
  .dparts > .day { min-width: 42px; }
  .dparts .val { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dnote { color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  .dnote[data-bad] { color: var(--vscode-errorForeground, #f85149); }
  /* The six skills as one row across the whole panel: the label sits over its
     number and still drags it. A skill name is one word, so it ellipsizes
     rather than breaking mid-word; the label's tooltip spells it out. */
  .skillsec { display: flex; flex-direction: column; gap: 3px; }
  .skills { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 4px; }
  .skills .px-field { grid-template-columns: minmax(0, 1fr); gap: 1px; }
  .skills .px-field > .px-label {
    font-size: var(--px-text-xs); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .skills .px-row { max-width: none !important; }
  .skills .px-input { padding-left: 5px; padding-right: 2px; }
  /* A trait chip carries the same 16px picture the menu rows do. */
  .px-badge > img { width: 16px; height: 16px; object-fit: contain; }
  /* The trait picker and the tooltip a hovered trait opens. */
  .tpicker { width: 320px; }
  .tpicker .px-menu-item { cursor: pointer; }
  .tpicker .tid { color: var(--px-muted-fg); font-family: var(--px-font-mono); font-size: var(--px-text-xs); }
  .ttip { position: fixed; z-index: 60; max-width: 320px; pointer-events: none; }
  .tip-head { display: flex; align-items: center; gap: 8px; }
  .tip-icon { position: relative; width: 64px; height: 64px; flex: 0 0 auto; }
  .tip-icon > img { position: absolute; inset: 8px; width: 48px; height: 48px; object-fit: contain; }
  .tip-icon > img.frame { inset: 0; width: 64px; height: 64px; }
  .tip-icon > .noicon {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    padding: 2px; border: 1px dashed var(--px-border); border-radius: var(--px-radius-sm);
    font-family: var(--px-font-mono); font-size: var(--px-text-xs); color: var(--px-muted-fg);
    text-align: center; overflow-wrap: anywhere; line-height: 1.1;
  }
  .tip-mods { display: flex; flex-direction: column; gap: 1px; }
  .tip-rel { display: flex; flex-wrap: wrap; gap: 4px; }
  .tip-note { color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  #banner {
    padding: 6px 10px; background: var(--px-muted); border-bottom: 1px solid var(--px-border);
    color: var(--px-muted-fg); font-size: var(--px-text-xs);
  }
  #banner[hidden] { display: none; }
</style>
</head>
<body>
<div id="app">
  <div id="toolbar">
    <button id="back" class="px-btn" data-variant="ghost" data-size="sm" hidden>${icon("chevronLeft")}Dynasties</button>
    <div class="px-input-group" id="queryGroup">${icon("search")}<input id="query" class="px-input" data-size="sm" autocomplete="off" spellcheck="false" placeholder="Search dynasties…" /></div>
    <span id="title" class="px-sm"></span>
    <span class="px-grow"></span>
    <span id="targetSlot"></span>
    <button id="newDynasty" class="px-btn" data-variant="outline" data-size="sm">${icon("plus")}Dynasty</button>
    <button id="newHouse" class="px-btn" data-variant="outline" data-size="sm" hidden>${icon("plus")}House</button>
    <button id="newCharacter" class="px-btn" data-variant="outline" data-size="sm" hidden>${icon("plus")}Character</button>
    <button id="fit" class="px-btn" data-variant="ghost" data-size="icon-sm" hidden data-tip="Fit the whole tree">${icon("maximize")}</button>
    <button id="zoomOut" class="px-btn" data-variant="ghost" data-size="icon-sm" hidden data-tip="Zoom out">${icon("zoomOut")}</button>
    <button id="zoomIn" class="px-btn" data-variant="ghost" data-size="icon-sm" hidden data-tip="Zoom in">${icon("zoomIn")}</button>
    <button id="refresh" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Read the game and mod files again">${icon("rotate")}</button>
  </div>
  <div id="banner" hidden></div>
  <div id="main">
    <div id="pickerPane">
      <div id="picker" class="px-list"></div>
      <div id="pickerNote"></div>
    </div>
    <div id="canvasWrap" hidden>
      <svg id="canvas" xmlns="http://www.w3.org/2000/svg"><g id="scene"></g></svg>
      <div id="empty" hidden></div>
    </div>
    <div id="side" class="px-sidepanel" data-side="right" hidden>
      <div class="px-sidepanel-resizer"></div>
      <div class="px-sidepanel-body" id="sideBody"></div>
    </div>
  </div>
</div>
<script nonce="${nonce}" src="${scriptSrc}"></script>
</body>
</html>`;
}
