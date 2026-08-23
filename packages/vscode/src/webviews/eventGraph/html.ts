/**
 * The Event Graph page: markup and page-specific styles on top of the shared
 * px-ui stylesheet, no host API. The app (app/) draws the graph into #graph
 * and fills the inspector at runtime.
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

export function eventGraphHtml({ scriptSrc, nonce, csp }: EventGraphHtmlOptions): string {
  const kindToggles = KINDS.map(
    (k) =>
      `<button class="px-toggle" data-size="sm" data-kind="${k.kind}" aria-pressed="true" data-tip="${k.tip}"><i class="swatch" style="background:var(--eg-${k.kind})"></i>${k.label}</button>`
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
  #toolbar {
    display: flex; align-items: center; gap: 6px; flex: 0 0 auto;
    padding: 6px 8px; border-bottom: 1px solid var(--px-border);
  }
  #toolbar .px-separator { height: 20px; align-self: center; }
  #queryWrap { position: relative; width: 300px; max-width: 40vw; }
  #suggest {
    position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 20; display: none;
    padding: 4px; border-radius: var(--px-radius); background: var(--px-popover);
    box-shadow: var(--px-shadow-md), 0 0 0 1px color-mix(in oklch, var(--px-fg) 10%, transparent);
  }
  #suggest.show { display: block; }
  #kinds .swatch { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
  #kinds .px-toggle[aria-pressed="false"] { color: var(--px-muted-fg); }
  #kinds .px-toggle[aria-pressed="false"] .swatch { opacity: 0.35; }
  #main { display: flex; flex: 1 1 auto; min-height: 0; }
  #graphWrap { position: relative; flex: 1 1 auto; min-width: 0; overflow: hidden; }
  #graph { width: 100%; height: 100%; display: block; cursor: grab; }
  #graph.dragging { cursor: grabbing; }
  #stageTools { position: absolute; left: 8px; bottom: 8px; display: flex; align-items: center; gap: 2px; }
  #stageTools .px-separator { height: 16px; margin: 0 4px; }
  [data-tip][data-tip-side="right"]::after { left: calc(100% + 6px); right: auto; top: 50%; transform: translateY(-50%); }
  #status { margin-left: 4px; }
  #status[data-state="warn"] { color: var(--eg-hit); }
  #status[data-state="error"] { color: var(--px-destructive); }
  #empty {
    position: absolute; inset: 0; display: none; align-items: center; justify-content: center;
    text-align: center; padding: 24px; color: var(--px-muted-fg);
  }
  #empty.show { display: flex; }
  .help { max-width: 360px; font-size: var(--px-text-sm); }
  .help ul { margin: 0; padding-left: 18px; }
  .help li { margin: 4px 0; }
  /* Nodes are cards on the canvas: popover surface, border, and the kind as a
     thin accent bar (several kinds must not read as several alarm states). */
  .node { cursor: pointer; }
  .node-rect { fill: var(--px-popover); stroke: var(--px-ring); stroke-opacity: 0.6; stroke-width: 1.2; }
  .node:hover .node-rect { stroke: var(--px-fg); stroke-opacity: 0.8; }
  .node.selected .node-rect { stroke: var(--px-fg); stroke-opacity: 1; stroke-width: 2.2; }
  .node.root .node-rect { stroke: var(--px-fg); stroke-opacity: 1; stroke-width: 2.2; }
  .node-label { pointer-events: none; fill: var(--px-fg); font-size: 12px; font-family: var(--px-font); }
  .node-sub { font-size: 9.5px; fill: var(--px-muted-fg); }
  .node-rect.search-hit { stroke: var(--eg-hit) !important; stroke-opacity: 1 !important; stroke-width: 2.6 !important; }
  /* Focus + context: the selection's 1-hop neighborhood stays, the rest dims
     (never hides, so the mental map survives). In and out edges differ. */
  .node.dim, .edge-path.dim, .edge-label.dim { opacity: 0.25; }
  .edge-path { fill: none; stroke: var(--px-fg); stroke-opacity: 0.4; transition: opacity var(--px-ease); }
  .edge-path.out-of-sel { stroke: var(--eg-event); stroke-opacity: 0.95; }
  .edge-path.into-sel { stroke: var(--eg-other); stroke-opacity: 0.95; }
  .edge-label { pointer-events: none; fill: var(--px-muted-fg); font-size: 9px; font-family: var(--px-font); }
  .edge-label.hidden { display: none; }
  .arrow-plain { fill: var(--px-fg); opacity: 0.55; }
  .arrow-out { fill: var(--eg-event); }
  .arrow-in { fill: var(--eg-other); }
  /* Inspector */
  #inspector { padding: 0 10px 12px; display: flex; flex-direction: column; gap: 8px; }
  #inspector h2 { margin: 0; font-size: 14px; font-weight: 600; word-break: break-all; }
  #inspector .sub {
    margin-top: 6px; font-size: var(--px-text-xs); font-weight: 600; letter-spacing: 0.04em;
    text-transform: uppercase; color: var(--px-muted-fg);
  }
  .badges { display: flex; gap: 4px; flex-wrap: wrap; }
  .actions { display: flex; gap: 4px; flex-wrap: wrap; }
  .locrow { display: flex; flex-direction: column; gap: 3px; }
  .locrow .k { word-break: break-all; }
  .locrow .edit { display: flex; gap: 4px; align-items: center; }
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
    <button id="go" class="px-btn" data-variant="default" data-size="sm" data-tip="Load the graph for the id or namespace">Go</button>
    <div class="px-row" style="gap:2px">
      <button id="showAll" class="px-btn" data-variant="ghost" data-size="icon" data-tip="All nodes: every event, on_action and decision of the mod">${icon("waypoints")}</button>
      <button id="refresh" class="px-btn" data-variant="ghost" data-size="icon" data-tip="Reload the current graph">${icon("rotate")}</button>
    </div>
    <span class="px-grow"></span>
    <button id="export" class="px-btn" data-variant="ghost" data-size="icon" data-tip="Export the graph as SVG">${icon("download")}</button>
    <div class="px-separator" data-orientation="vertical"></div>
    <div id="kinds" class="px-toggle-group" data-tip="Click a kind to dim it in the graph" data-tip-wrap>${kindToggles}</div>
    <div class="px-separator" data-orientation="vertical"></div>
    <button id="helpBtn" class="px-btn" data-variant="ghost" data-size="icon" data-tip="How to read this view" data-tip-side="left">${icon("circleHelp")}</button>
    <button id="togglePanel" class="px-btn" data-variant="ghost" data-size="icon" data-tip="Hide inspector" data-tip-side="left">${icon("panelRightClose")}</button>
  </div>
  <div id="main">
    <div id="graphWrap">
      <svg id="graph" xmlns="http://www.w3.org/2000/svg"></svg>
      <div id="stageTools">
        <button id="info" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="" data-tip-side="right" data-tip-wrap>${icon("info")}</button>
        <div class="px-separator" data-orientation="vertical"></div>
        <button id="zoomOut" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Zoom out (−)" data-tip-side="right">${icon("zoomOut")}</button>
        <button id="zoomIn" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Zoom in (+)" data-tip-side="right">${icon("zoomIn")}</button>
        <button id="zoomFit" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Fit the graph (0)" data-tip-side="right">${icon("maximize")}</button>
        <span id="status" class="px-muted px-xs"></span>
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
