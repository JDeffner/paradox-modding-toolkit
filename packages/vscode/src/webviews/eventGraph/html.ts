/**
 * The Event Graph page: markup and page-specific styles on top of the shared
 * px-ui stylesheet, no host API. The app (app/) draws the graph into #graph,
 * fills the inspector, and drives the floating simulation window at runtime.
 */
import uiCss from "../shared/ui.css";
import { icon } from "../shared/icons";

export interface EventGraphHtmlOptions {
  scriptSrc: string;
  nonce: string;
  csp: string;
}

const KINDS: { kind: string; label: string; tip: string }[] = [
  { kind: "event", label: "event", tip: "Show or dim events" },
  { kind: "on_action", label: "on_action", tip: "Show or dim on_actions" },
  { kind: "decision", label: "decision", tip: "Show or dim decisions" },
  { kind: "other", label: "other", tip: "Show or dim other definitions" },
];

/** One tool in the left rail: an icon, a label, and a sentence. */
const TOOLS: { id: string; icon: Parameters<typeof icon>[0]; label: string; tip: string }[] = [
  {
    id: "toolSimulate",
    icon: "play",
    label: "Simulate",
    tip: "Walk through the selected event block by block, in the order the game runs them",
  },
  { id: "toolCenter", icon: "locate", label: "Center", tip: "Rebuild the graph around the selected event" },
  {
    id: "toolAll",
    icon: "waypoints",
    label: "All nodes",
    tip: "Every event, on_action and decision of this mod, connected or not",
  },
  {
    id: "toolSource",
    icon: "fileText",
    label: "Source",
    tip: "Open the selected event's file beside the graph",
  },
];

export function eventGraphHtml({ scriptSrc, nonce, csp }: EventGraphHtmlOptions): string {
  const kindToggles = KINDS.map(
    (k) =>
      `<button class="px-toggle" data-size="sm" data-kind="${k.kind}" aria-pressed="true" data-tip="${k.tip}"><i class="swatch" style="background:var(--eg-${k.kind})"></i>${k.label}</button>`
  ).join("");
  const tools = TOOLS.map(
    (t) =>
      `<button id="${t.id}" class="tool px-btn" data-variant="ghost" data-size="sm" data-tip="${t.tip}" data-tip-side="right" data-tip-wrap>${icon(t.icon)}<span>${t.label}</span></button>`
  ).join("");
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>Event Graph</title>
<style>
${uiCss}
  /* The four node kinds. px-ui has no categorical palette, so these are the
     page's own: one hue each, lightness tuned per theme so a bar stays
     legible on both the dark and the light card. */
  :root {
    --eg-event: oklch(0.72 0.14 250);
    --eg-on_action: oklch(0.74 0.14 310);
    --eg-decision: oklch(0.74 0.15 150);
    --eg-other: oklch(0.74 0.15 60);
    --eg-hit: oklch(0.8 0.16 90);
  }
  body.vscode-light {
    --eg-event: oklch(0.55 0.16 250);
    --eg-on_action: oklch(0.55 0.16 310);
    --eg-decision: oklch(0.55 0.15 150);
    --eg-other: oklch(0.6 0.16 60);
    --eg-hit: oklch(0.7 0.17 90);
  }
  body { overflow: hidden; }
  #app { display: flex; flex-direction: column; height: 100%; }

  /* ---- toolbar ---- */
  /* Wraps rather than clipping: in a narrow editor group the kind filters
     drop to a second row instead of pushing the Save button off the edge. */
  #toolbar {
    display: flex; align-items: center; gap: 6px; flex: 0 0 auto; flex-wrap: wrap;
    padding: 6px 8px; border-bottom: 1px solid var(--px-border);
  }
  #toolbar .px-separator { height: 20px; align-self: center; }
  #queryWrap { position: relative; width: 300px; max-width: 34vw; }
  #suggest {
    position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 20; display: none;
    padding: 4px; border-radius: var(--px-radius); background: var(--px-popover);
    box-shadow: var(--px-shadow-md), 0 0 0 1px color-mix(in oklch, var(--px-fg) 10%, transparent);
  }
  #suggest.show { display: block; }
  #save .count {
    min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; margin-left: 2px;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 10px; font-variant-numeric: tabular-nums;
    background: color-mix(in oklch, var(--px-primary-fg) 24%, transparent);
  }
  #save[disabled] .count { display: none; }
  #kinds .swatch { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
  #kinds .px-toggle[aria-pressed="false"] { color: var(--px-muted-fg); }
  #kinds .px-toggle[aria-pressed="false"] .swatch { opacity: 0.35; }

  /* ---- main split ---- */
  #main { display: flex; flex: 1 1 auto; min-height: 0; }
  #rail { --px-sidepanel-width: 172px; }
  #rail > .px-sidepanel-body { padding: 6px; gap: 2px; }
  #rail .railHead { display: flex; align-items: center; gap: 4px; padding: 0 2px 4px; }
  #rail .railHead .px-panel-title { padding: 0; flex: 1 1 auto; }
  .tool { width: 100%; justify-content: flex-start; }
  .tool[aria-pressed="true"] { background: var(--px-muted); }
  #railShow { position: absolute; left: 8px; top: 8px; z-index: 6; }
  #railShow[hidden] { display: none; }
  #railHint { padding: 8px 2px 0; white-space: normal; line-height: 1.45; }

  #graphWrap { position: relative; flex: 1 1 auto; min-width: 0; overflow: hidden; }
  #graph { width: 100%; height: 100%; display: block; cursor: grab; }
  #graph.dragging { cursor: grabbing; }
  /* Bottom-left view controls, the same group the GUI editor uses. */
  #stageTools { position: absolute; left: 8px; bottom: 8px; display: flex; align-items: center; gap: 8px; }
  #zoomGroup {
    display: flex; align-items: center; gap: 2px; padding: 2px;
    border-radius: var(--px-radius); background: color-mix(in oklch, var(--px-bg) 75%, transparent);
  }
  #zoomLabel { min-width: 44px; text-align: center; font-variant-numeric: tabular-nums; }
  #focusLine { white-space: nowrap; }
  #focusLine[data-state="warn"] { color: var(--eg-hit); }
  #focusLine[data-state="error"] { color: var(--px-destructive); }
  #info { position: absolute; right: 8px; bottom: 8px; }
  [data-tip][data-tip-side="right"]::after { left: calc(100% + 6px); right: auto; top: 50%; transform: translateY(-50%); }
  #empty {
    position: absolute; inset: 0; display: none; align-items: center; justify-content: center;
    text-align: center; padding: 24px; color: var(--px-muted-fg);
  }
  #empty.show { display: flex; }
  .help { max-width: 380px; font-size: var(--px-text-sm); }
  .help ul { margin: 0; padding-left: 18px; }
  .help li { margin: 4px 0; }

  /* ---- nodes and edges ---- */
  .node { cursor: pointer; }
  .node-rect { fill: var(--px-popover); stroke: var(--px-ring); stroke-opacity: 0.6; stroke-width: 1.2; }
  .node:hover .node-rect { stroke: var(--px-fg); stroke-opacity: 0.8; }
  .node.selected .node-rect, .node.root .node-rect { stroke: var(--px-fg); stroke-opacity: 1; stroke-width: 2.2; }
  .node-label { pointer-events: none; fill: var(--px-fg); font-size: 12px; font-family: var(--px-font); }
  .node-sub { font-size: 9.5px; fill: var(--px-muted-fg); }
  .node-rect.search-hit { stroke: var(--eg-hit) !important; stroke-opacity: 1 !important; stroke-width: 2.6 !important; }
  .node-banner { opacity: 0.5; }
  /* Placeholder for a theme whose illustration does not resolve. Hatched and
     labeled, so it can never be mistaken for the real picture. */
  .banner-missing { fill: url(#hatch); stroke: var(--px-border); }
  .banner-missing-label { fill: var(--px-muted-fg); font-size: 8px; font-family: var(--px-font); pointer-events: none; }
  /* Focus + context: the selection's 1-hop neighborhood stays, the rest dims
     (never hides, so the mental map survives). In and out edges differ. */
  .node.dim, .edge-path.dim, .edge-label.dim { opacity: 0.25; }
  .edge-path { fill: none; stroke: var(--px-fg); stroke-opacity: 0.35; transition: opacity var(--px-ease); }
  .edge-path.out-of-sel { stroke: var(--eg-event); stroke-opacity: 0.95; }
  .edge-path.into-sel { stroke: var(--eg-other); stroke-opacity: 0.95; }
  .edge-label { pointer-events: none; fill: var(--px-muted-fg); font-size: 9px; font-family: var(--px-font); }
  .edge-label.hidden { display: none; }
  .arrow-plain { fill: var(--px-fg); opacity: 0.5; }
  .arrow-out { fill: var(--eg-event); }
  .arrow-in { fill: var(--eg-other); }

  /* ---- simulation window (floating, over the graph) ---- */
  /* Opens at the top right of the canvas. Without an offset an absolutely
     positioned box takes its static position, which here is under a
     full-height <svg>, so the window would open outside the clipped wrapper.
     A drag sets left, which wins over right from then on. */
  #sim {
    position: absolute; z-index: 40; right: 16px; top: 16px;
    width: 440px; max-width: calc(100% - 24px);
    display: flex; flex-direction: column; max-height: calc(100% - 24px);
    border-radius: var(--px-radius); background: var(--px-popover);
    box-shadow: var(--px-shadow-md), 0 0 0 1px var(--px-border);
  }
  #sim[hidden] { display: none; }
  #simBar {
    flex: 0 0 auto; display: flex; align-items: center; gap: 4px; cursor: grab;
    padding: 4px 4px 4px 10px; border-bottom: 1px solid var(--px-border);
  }
  #simBar.dragging { cursor: grabbing; }
  #simTitle { flex: 1 1 auto; min-width: 0; font-weight: 600; }
  #simBody { flex: 1 1 auto; overflow: auto; padding: 8px 10px 12px; }
  #simBody h3 { margin: 0 0 2px; font-size: 13px; font-weight: 600; word-break: break-all; }
  .step { margin: 2px 0; }
  .step > .px-panel-title { padding-left: 2px; border-radius: var(--px-radius-sm); }
  .step > .px-panel-title .caret { transition: transform var(--px-ease); }
  .step[data-collapsed] > .px-panel-title .caret { transform: rotate(-90deg); }
  .step[data-collapsed] > .step-body { display: none; }
  .step > .px-panel-title .t { color: var(--px-fg); }
  .step > .px-panel-title .s {
    flex: 1 1 auto; min-width: 0; font-weight: 400; text-transform: none; letter-spacing: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .step-body { padding: 0 0 4px 8px; }
  .script { padding: 2px 0; font-family: var(--px-font-mono); font-size: var(--px-text-sm); }
  .script .ln {
    padding: 1px 6px; white-space: pre; cursor: pointer; border-radius: var(--px-radius-sm);
    transition: background-color var(--px-ease);
  }
  .script .ln:hover { background: var(--px-muted); }
  .tok-key { color: var(--px-tok-key); }
  .tok-op { color: var(--px-tok-op); }
  .tok-string { color: var(--px-tok-string); }
  .tok-number { color: var(--px-tok-number); }
  .tok-bool { color: var(--px-tok-bool); }
  .tok-comment { color: var(--px-tok-comment); font-style: italic; }
  .tok-brace { color: var(--px-tok-brace); }
  .note, .more { padding: 3px 6px; color: var(--px-muted-fg); }
  .leads { padding: 4px 0 2px; }
  .target { display: flex; align-items: center; gap: 6px; min-height: 22px; padding: 0 6px; }
  .target .via { color: var(--px-muted-fg); font-size: var(--px-text-xs); flex: 0 0 auto; }
  .target.fires { margin-left: 16px; }
  .dim { color: var(--px-muted-fg); }

  /* ---- inspector ---- */
  #inspector { padding: 0 10px 12px; display: flex; flex-direction: column; gap: 6px; }
  #inspector h2 { margin: 0; font-size: 14px; font-weight: 600; word-break: break-all; }
  #inspector .sub {
    margin-top: 8px; font-size: var(--px-text-xs); font-weight: 600; letter-spacing: 0.04em;
    text-transform: uppercase; color: var(--px-muted-fg);
  }
  #inspector .hint { color: var(--px-muted-fg); font-size: var(--px-text-xs); white-space: normal; line-height: 1.45; }
  .badges { display: flex; gap: 4px; flex-wrap: wrap; }
  .actions { display: flex; gap: 4px; flex-wrap: wrap; }
  .field { display: grid; grid-template-columns: 74px 1fr; align-items: center; gap: 6px; }
  .field > .k { color: var(--px-muted-fg); font-size: var(--px-text-xs); overflow: hidden; text-overflow: ellipsis; }
  .field > .v { min-width: 0; display: flex; gap: 4px; align-items: center; }
  .field .px-dropdown, .field .px-input { flex: 1 1 auto; min-width: 0; }
  .locrow { display: flex; flex-direction: column; gap: 3px; }
  .locrow .k { word-break: break-all; }
  .locrow .edit { display: flex; gap: 4px; align-items: center; }
  .locrow .edit .px-input { flex: 1 1 auto; min-width: 0; }
  .pendingMark { color: var(--px-primary); }
  .block { display: flex; flex-direction: column; gap: 4px; }
  .block > .head { display: flex; align-items: center; gap: 4px; min-height: 24px; }
  .block > .head .caret { transition: transform var(--px-ease); cursor: pointer; }
  .block[data-collapsed] > .head .caret { transform: rotate(-90deg); }
  .block[data-collapsed] > :not(.head) { display: none; }
  .block + .block { border-top: 1px solid var(--px-border); padding-top: 4px; }
  #inspector .px-list { padding: 0; }
  #inspector .px-item > .px-item-kind { width: 64px; }
  #inspector .px-item > .px-item-label.px-xs { color: var(--px-muted-fg); flex: 0 0 auto; }
</style>
</head>
<body>
<div id="app">
  <div id="toolbar">
    <div id="queryWrap">
      <div class="px-input-group">${icon("search")}<input id="query" class="px-input" autocomplete="off" spellcheck="false" placeholder="Event id or namespace" data-tip="An event id (namespace.123), an on_action or decision name, or a namespace. Enter loads it; / focuses this box" data-tip-wrap /></div>
      <div id="suggest" role="listbox"><div class="px-menu-list"></div></div>
    </div>
    <button id="go" class="px-btn" data-variant="outline" data-size="sm" data-tip="Load the graph for the id or namespace">Go</button>
    <div class="px-separator" data-orientation="vertical"></div>
    <div class="px-toggle-group" data-tip="What the cards are captioned with" data-tip-wrap>
      <button id="titleRaw" class="px-toggle" data-size="sm" aria-pressed="true" data-tip="Caption every card with its raw id (cultivation_scheme.101)" data-tip-wrap>Raw</button>
      <button id="titleLoc" class="px-toggle" data-size="sm" aria-pressed="false" data-tip="Caption every card with its localized title, falling back to the id where there is none" data-tip-wrap>Loc</button>
    </div>
    <div class="px-separator" data-orientation="vertical"></div>
    <button id="undo" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Nothing to undo" disabled>${icon("undo")}</button>
    <button id="redo" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Nothing to redo" disabled>${icon("redo")}</button>
    <span class="px-grow"></span>
    <button id="save" class="px-btn" data-variant="default" data-size="sm" data-tip="No changes to save yet. Edits stay in this view until you save them" data-tip-wrap disabled>${icon("save")}Save changes<span class="count">0</span></button>
    <button id="refresh" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Reload the current graph from the index">${icon("rotate")}</button>
    <button id="export" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Export the graph as SVG">${icon("download")}</button>
    <div class="px-separator" data-orientation="vertical"></div>
    <div id="kinds" class="px-toggle-group" data-tip="Click a kind to dim it in the graph" data-tip-wrap>${kindToggles}</div>
    <div class="px-separator" data-orientation="vertical"></div>
    <button id="helpBtn" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="How to read this view" data-tip-side="left">${icon("circleHelp")}</button>
    <button id="togglePanel" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Hide inspector" data-tip-side="left">${icon("panelRightClose")}</button>
  </div>
  <div id="main">
    <div id="rail" class="px-sidepanel" data-side="left">
      <div class="px-sidepanel-resizer"></div>
      <div class="px-sidepanel-body">
        <div class="railHead">
          <span class="px-panel-title">Tools</span>
          <button id="railHide" class="px-btn" data-variant="ghost" data-size="icon-xs" data-tip="Hide the tools">${icon("panelLeftClose")}</button>
        </div>
        ${tools}
        <button id="toolBanner" class="tool px-btn" data-variant="ghost" data-size="sm" aria-pressed="false" data-tip="Draw each event's theme illustration behind its card. A theme whose picture cannot be resolved gets a hatched placeholder that says so" data-tip-side="right" data-tip-wrap>${icon("image")}<span>Event banner</span></button>
        <div id="railHint" class="px-muted px-xs">Select a card first: Simulate, Center and Source act on it.</div>
      </div>
    </div>
    <div id="graphWrap">
      <button id="railShow" class="px-btn" data-variant="outline" data-size="icon-sm" data-tip="Show the tools" data-tip-side="right" hidden>${icon("panelLeftOpen")}</button>
      <svg id="graph" xmlns="http://www.w3.org/2000/svg"></svg>
      <div id="stageTools">
        <div id="zoomGroup">
          <button id="zoomOut" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Zoom out (−)" data-tip-side="right">${icon("zoomOut")}</button>
          <span id="zoomLabel" class="px-muted px-xs">100%</span>
          <button id="zoomIn" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Zoom in (+)" data-tip-side="right">${icon("zoomIn")}</button>
          <button id="zoomFit" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Fit the graph (0)" data-tip-side="right">${icon("maximize")}</button>
        </div>
        <span id="focusLine" class="px-muted px-xs"></span>
      </div>
      <button id="info" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="" data-tip-side="left" data-tip-wrap>${icon("info")}</button>
      <div id="sim" hidden>
        <div id="simBar">
          <span id="simTitle" class="px-truncate">Simulation</span>
          <button id="simBack" class="px-btn" data-variant="ghost" data-size="icon-xs" data-tip="Back" disabled>${icon("chevronLeft")}</button>
          <button id="simClose" class="px-btn" data-variant="ghost" data-size="icon-xs" data-tip="Close the simulation">${icon("x")}</button>
        </div>
        <div id="simBody"></div>
      </div>
      <div id="empty"></div>
    </div>
    <div id="side" class="px-sidepanel" data-side="right">
      <div class="px-sidepanel-resizer"></div>
      <div class="px-sidepanel-body">
        <div class="px-panel-title">Inspector</div>
        <div id="inspector"></div>
      </div>
    </div>
  </div>
</div>
<script nonce="${nonce}" src="${scriptSrc}"></script>
</body>
</html>`;
}
