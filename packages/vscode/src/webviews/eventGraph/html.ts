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

/**
 * One tool in the left rail: an icon and a sentence. The rail is icons only, so
 * the tooltip is the whole label, and a tool that acts on a card says so in it
 * rather than in a line of prose under the buttons.
 */
const TOOLS: { id: string; icon: Parameters<typeof icon>[0]; tip: string; needsCard?: boolean }[] = [
  {
    id: "toolSimulate",
    icon: "flaskConical",
    tip: "Simulate the selected event (S)",
    needsCard: true,
  },
  {
    id: "toolCenter",
    icon: "locate",
    tip: "Chain: only what leads to the selected card and what it leads to (C)",
    needsCard: true,
  },
  {
    id: "toolAll",
    icon: "waypoints",
    tip: "All nodes of this mod (A)",
  },
  {
    id: "toolSource",
    icon: "fileText",
    tip: "Open the selected card's source (O)",
    needsCard: true,
  },
];

export function eventGraphHtml({ scriptSrc, nonce, csp }: EventGraphHtmlOptions): string {
  const kindToggles = KINDS.map(
    (k) =>
      `<button class="px-toggle" data-size="sm" data-kind="${k.kind}" aria-pressed="true" data-tip="${k.tip}" data-tip-side="top"><i class="swatch" style="background:var(--eg-${k.kind})"></i>${k.label}</button>`
  ).join("");
  const tools = TOOLS.map(
    (t) =>
      `<button id="${t.id}" class="tool px-btn" data-variant="ghost" data-size="icon-sm" data-tip="${t.tip}" data-tip-side="right" data-tip-wrap${t.needsCard ? ' aria-disabled="true"' : ""}>${icon(t.icon)}</button>`
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
  /* The pending count rides the Changes button: one place says how much is
     unsaved, and it is the button that lists it. */
  #changes .count {
    min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; flex: 0 0 auto;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 10px; line-height: 1; font-variant-numeric: tabular-nums;
    background: var(--px-primary); color: var(--px-primary-fg);
  }
  #changes[disabled] .count { display: none; }
  /* Compact kind chips: a swatch, a word, one row. They sit on the canvas
     next to the zoom group, so they get the same translucent backing. */
  #kinds {
    gap: 4px; padding: 2px; border-radius: var(--px-radius);
    background: color-mix(in oklch, var(--px-bg) 75%, transparent);
  }
  #kinds .px-toggle { height: var(--px-h-sm); padding: 0 8px; gap: 5px; font-size: var(--px-text-sm); }
  #kinds .swatch { width: 12px; height: 12px; border-radius: 3px; display: inline-block; flex: 0 0 auto; }
  #kinds .px-toggle[aria-pressed="false"] { color: var(--px-muted-fg); }
  #kinds .px-toggle[aria-pressed="false"] .swatch { opacity: 0.35; }
  /* Every pending edit, newest last, with a way back to before any of them. */
  #changeList { display: flex; flex-direction: column; gap: 2px; width: 340px; max-height: 320px; overflow: auto; }
  #changeList .px-item-kind { width: 62px; }
  #changeList .what { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #changeList .who { color: var(--px-muted-fg); font-size: var(--px-text-xs); flex: 0 0 auto; }

  /* ---- main split ---- */
  #main { display: flex; flex: 1 1 auto; min-height: 0; }
  /* The rail is a fixed strip of icons, so it has no resizer: there is nothing
     to make wider. It still collapses, and its handle lives on the canvas. */
  /* The rail's body must not clip: a tool's tooltip opens to the right of a
     40px strip, so overflow: hidden on the body swallowed it. The z-index
     puts the escaped tooltip over the canvas (a disabled tool's own opacity
     makes it a stacking context, which would otherwise paint it underneath). */
  #rail { --px-sidepanel-width: 40px; z-index: 7; }
  #rail > .px-sidepanel-body { padding: 6px 4px; gap: 2px; align-items: center; overflow: visible; }
  .tool[aria-pressed="true"] { background: var(--px-muted); }
  .tool[aria-disabled="true"] { opacity: 0.45; }

  #graphWrap { position: relative; flex: 1 1 auto; min-width: 0; overflow: hidden; }
  #graph { width: 100%; height: 100%; display: block; cursor: grab; }
  #graph.dragging { cursor: grabbing; }
  /* The rail's handle and what the tools would act on, on the rail's edge. */
  #railBar {
    position: absolute; left: 6px; top: 6px; z-index: 6;
    display: flex; align-items: center; gap: 8px; max-width: calc(100% - 12px);
  }
  #railBar .px-btn { background: color-mix(in oklch, var(--px-bg) 82%, transparent); }
  #actingOn { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #actingOn:empty { display: none; }
  /* The chain depth control: a compact head that unfolds the 1 2 3 4 ∞ row.
     The [hidden] guard is explicit because display rules beat the attribute. */
  /* Beside the rail's Chain tool: the control is that button's own setting.
     Collapsed it is just the arrow; open, the slider with ONE value: the
     current depth. */
  #chainDepth {
    position: absolute; left: 6px; top: 38px; z-index: 6;
    display: flex; align-items: center; gap: 6px;
  }
  #chainDepth[hidden], #chainDepthOptions[hidden] { display: none; }
  #chainDepth .px-btn { background: color-mix(in oklch, var(--px-bg) 82%, transparent); }
  #chainDepthHead .px-icon { transition: transform var(--px-ease); }
  #chainDepthHead[data-open] .px-icon { transform: rotate(90deg); }
  #chainDepthOptions {
    display: flex; align-items: center; gap: 8px; padding: 4px 10px;
    border: 1px solid var(--px-border); border-radius: var(--px-radius);
    background: color-mix(in oklch, var(--px-bg) 82%, transparent);
  }
  #chainDepthSlider { width: 110px; accent-color: var(--eg-event); cursor: pointer; }
  #chainDepthLabel { min-width: 14px; text-align: center; font-weight: 600; }
  /* Bottom-left view controls, the same group the GUI editor uses. */
  #stageTools { position: absolute; left: 8px; bottom: 8px; display: flex; align-items: center; gap: 8px; }
  #zoomGroup {
    display: flex; align-items: center; gap: 2px; padding: 2px;
    border-radius: var(--px-radius); background: color-mix(in oklch, var(--px-bg) 75%, transparent);
  }
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
  /* A card is a small document: a title you can read at a glance, what kind of
     thing it is, and what it asks for before it runs. The kind is said twice,
     as a bar on the left and as the border's hue, so it survives a banner
     behind the card and a colorblind reader alike. */
  .node { cursor: pointer; }
  .node-rect { fill: var(--px-popover); stroke-width: 1; }
  .node:hover .node-rect { stroke: var(--px-fg) !important; stroke-opacity: 0.55; }
  .node.selected .node-rect { stroke: var(--px-fg) !important; stroke-opacity: 1; stroke-width: 2; }
  /* A selected root would wear BOTH outlines; one is enough. */
  .node.root.selected .node-outline { display: none; }
  .node-outline { fill: none; stroke: var(--px-primary); stroke-width: 2; pointer-events: none; }
  .node-title { pointer-events: none; fill: var(--px-fg); font-size: 15px; font-weight: 600; font-family: var(--px-font); }
  .node-sub { pointer-events: none; fill: var(--px-muted-fg); font-size: 12px; font-family: var(--px-font); }
  /* The card's own "open the source" button: a ghost button in its top right
     corner, drawn in SVG, on the card's hover only. */
  .card-open { opacity: 0; cursor: pointer; transition: opacity var(--px-ease); }
  .node:hover .card-open, .card-open:focus-visible { opacity: 1; }
  .card-open-bg { fill: transparent; pointer-events: all; transition: fill var(--px-ease); }
  .card-open:hover .card-open-bg { fill: var(--px-muted); }
  .card-open-icon { color: var(--px-muted-fg); pointer-events: none; }
  .node.on-banner .card-open-bg { fill: color-mix(in oklch, #000 45%, transparent); }
  .node.on-banner .card-open-icon { color: #e4e4e4; }
  /* Over an illustration the theme's colors no longer apply: the scrim below
     is dark in every theme, so the text is light in every theme. */
  .node.on-banner .node-title { fill: #f4f4f4; }
  .node.on-banner .node-sub { fill: #c9c9c9; }
  .node-rect.search-hit { stroke: var(--eg-hit) !important; stroke-opacity: 1 !important; stroke-width: 2.6 !important; }
  .node-banner { opacity: 0.85; }
  /* Placeholder for a theme whose illustration does not resolve. Hatched and
     labeled, so it can never be mistaken for the real picture. */
  .banner-missing { fill: url(#hatch); stroke: var(--px-border); }
  .banner-missing-label { fill: var(--px-muted-fg); font-size: 9px; font-family: var(--px-font); pointer-events: none; }
  /* Focus + context: the selection's 1-hop neighborhood stays, the rest dims
     (never hides, so the mental map survives). In and out edges differ. */
  .node.dim, .edge-path.dim, .edge-label.dim, .edge-chip.dim { opacity: 0.25; }
  .edge-path { fill: none; stroke: var(--px-fg); stroke-opacity: 0.35; transition: opacity var(--px-ease); }
  .edge-path.out-of-sel { stroke: var(--eg-event); stroke-opacity: 0.95; }
  .edge-path.into-sel { stroke: var(--eg-other); stroke-opacity: 0.95; }
  /* Hoverable: the label's <title> spells out what the shorthand means. */
  .edge-label { pointer-events: all; fill: var(--px-muted-fg); font-size: 10px; font-family: var(--px-font); }
  .edge-label.hidden { display: none; }
  /* A cycle's return arc: unmistakably not a forward step. */
  .edge-path.edge-back { stroke-dasharray: 6 4; stroke-opacity: 0.3; }
  /* The connector's hover target: wide, invisible, carries the <title>. */
  .edge-hit { fill: none; stroke: transparent; stroke-width: 12; pointer-events: stroke; }
  /* The WHEN chip: an edge's delay ("30d") or random weight ("w 100").
     Hoverable: its <title> says what the number means. */
  .edge-chip { pointer-events: all; }
  .edge-chip rect { fill: var(--px-popover); stroke: color-mix(in oklch, var(--px-fg) 35%, transparent); stroke-width: 1; }
  .edge-chip text { fill: var(--px-fg); font-size: 10px; font-family: var(--px-mono, monospace); text-anchor: middle; }
  .edge-chip.edge-chip-random rect { stroke-dasharray: 3 2; }
  .edge-chip.edge-chip-random text { fill: var(--px-muted-fg); }
  /* Step rows: the card's own sequence, in execution order. */
  .step-sep { stroke: color-mix(in oklch, var(--px-fg) 18%, transparent); stroke-width: 1; }
  /* The row's own hover surface: the toolkit's usual grayish highlight. */
  .step-row-bg { fill: transparent; cursor: pointer; }
  .step-row-bg:hover { fill: color-mix(in oklch, var(--px-fg) 10%, transparent); }
  .node-step { pointer-events: none; fill: var(--px-fg); font-size: 11px; font-family: var(--px-font); }
  .node-step .step-num { fill: var(--px-muted-fg); }
  .node-step-auto { fill: var(--px-muted-fg); font-style: italic; }
  .step-port { fill: var(--eg-event); }
  .step-port-auto { fill: var(--px-muted-fg); }
  /* Chain stubs: the sequence continues past what the view keeps. */
  .chain-stub-line { stroke: var(--px-muted-fg); stroke-opacity: 0.6; stroke-width: 1.2; stroke-dasharray: 3 3; }
  .chain-stub-text { fill: var(--px-muted-fg); font-size: 10px; font-family: var(--px-font); }
  .arrow-plain { fill: var(--px-fg); opacity: 0.5; }
  .arrow-out { fill: var(--eg-event); }
  .arrow-in { fill: var(--eg-other); }

  /* ---- simulation window (floating, over the graph) ---- */
  /* Opens at the top right of the canvas. Without an offset an absolutely
     positioned box takes its static position, which here is under a
     full-height <svg>, so the window would open outside the clipped wrapper.
     A drag sets left, which wins over right from then on. */
  /* Fixed, not absolute: the window drags over the WHOLE page (topbar,
     inspector, rail), not just the canvas it was born in. */
  #sim {
    position: fixed; z-index: 40; right: 16px; top: 44px;
    width: 440px; max-width: calc(100vw - 24px);
    display: flex; flex-direction: column; max-height: calc(100vh - 60px);
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
  /* The caret here is a button, and its tooltip is that button's ::after, so
     rotating the button turned the words on their side. Rotate the icon. */
  .step > .px-panel-title .caret > svg { transition: transform var(--px-ease); }
  .step[data-collapsed] > .px-panel-title .caret > svg { transform: rotate(-90deg); }
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
    text-transform: uppercase; color: var(--px-muted-fg); width: fit-content;
  }
  #inspector .hint { color: var(--px-muted-fg); font-size: var(--px-text-xs); white-space: normal; line-height: 1.45; }
  .badges { display: flex; gap: 4px; flex-wrap: wrap; }
  .field { display: grid; grid-template-columns: 74px 1fr; align-items: center; gap: 6px; }
  /* The "New event" popover form shares the inspector's row anatomy. */
  .newEventForm { display: flex; flex-direction: column; gap: 8px; width: 300px; }
  .newEventForm .sub { font-weight: 600; font-size: var(--px-text-sm); }
  .newEventForm .hint { color: var(--px-muted-fg); font-size: var(--px-text-xs); white-space: normal; line-height: 1.45; }
  .field > .k { color: var(--px-muted-fg); font-size: var(--px-text-xs); overflow: hidden; text-overflow: ellipsis; }
  .field > .v { min-width: 0; display: flex; gap: 4px; align-items: center; }
  .field .px-dropdown, .field .px-input { flex: 1 1 auto; min-width: 0; }
  .locrow { display: flex; flex-direction: column; gap: 3px; }
  .locrow .k { word-break: break-all; }
  .locrow .edit { display: flex; gap: 4px; align-items: center; }
  .locrow .edit .px-input { flex: 1 1 auto; min-width: 0; }
  .pendingMark { color: var(--px-primary); flex: 0 0 auto; }
  .block { display: flex; flex-direction: column; gap: 4px; }
  .block > .head { display: flex; align-items: center; gap: 4px; min-height: 24px; cursor: pointer; user-select: none; }
  .block > .head .caret { transition: transform var(--px-ease); cursor: pointer; }
  .block > .head .btitle { flex: 0 0 auto; font-weight: 600; font-size: var(--px-text-sm); }
  .block > .head .bsub { flex: 1 1 auto; min-width: 0; }
  .block + .block { border-top: 1px solid var(--px-border); padding-top: 4px; }
  .bbody { display: flex; flex-direction: column; gap: 4px; }
  #inspector .caret.closed { transform: rotate(-90deg); }
  /* ---- the structured script editor ---- */
  #inspector .insHead { display: flex; align-items: center; gap: 4px; }
  #inspector .insHead h2 { flex: 1 1 auto; }
  .subhead2 {
    margin-top: 2px; font-size: var(--px-text-xs); font-weight: 600; letter-spacing: 0.04em;
    text-transform: uppercase; color: var(--px-muted-fg); width: fit-content;
  }
  .tree { display: flex; flex-direction: column; gap: 1px; }
  .tchildren { display: flex; flex-direction: column; gap: 1px; }
  .trow {
    display: flex; align-items: center; gap: 6px; min-height: 24px;
    padding-right: 2px; border-radius: var(--px-radius-sm);
  }
  .trow:hover { background: color-mix(in oklch, var(--px-fg) 5%, transparent); }
  .trow .tk { font-family: var(--px-font-mono); font-size: var(--px-text-sm); color: var(--px-tok-key, var(--px-fg)); }
  .trow .top { font-family: var(--px-font-mono); font-size: var(--px-text-sm); color: var(--px-muted-fg); }
  .trow .tv { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 4px; }
  .trow .tv .px-input, .trow .tv .px-dropdown { flex: 1 1 auto; min-width: 0; height: 24px; font-size: var(--px-text-sm); }
  .trow .ttools { display: flex; align-items: center; opacity: 0; transition: opacity var(--px-ease); }
  .trow:hover .ttools, .trow.thead .ttools { opacity: 1; }
  .trow.thead .ttools { opacity: 0; }
  .trow.thead:hover .ttools { opacity: 1; }
  .trow.thead .tk { font-weight: 600; color: var(--px-fg); flex: 1 1 auto; }
  .trow.thead .caret { cursor: pointer; flex: 0 0 auto; }
  .trow.tbare .tk { color: var(--px-muted-fg); }
  /* A value is text until it is clicked; the hover says "editable" quietly. */
  .trow .tval {
    font-family: var(--px-font-mono); font-size: var(--px-text-sm); cursor: pointer;
    padding: 1px 4px; margin-left: -4px; border-radius: var(--px-radius-sm);
    min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .trow .tval:hover { background: var(--px-muted); }
  .trow.tadd:hover { background: none; }
  .trow.tadd > .px-btn { color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  .trow.tadd > .px-btn:hover { color: var(--px-fg); }
  .trow-more { align-self: flex-start; padding: 0 4px; font-size: var(--px-text-xs); }
  .gateAdd { margin-top: 2px; }
  #inspector .revealed { box-shadow: 0 0 0 1.5px var(--eg-hit); border-radius: var(--px-radius-md); transition: box-shadow 0.2s; }
  #inspector .px-list { padding: 0; }
  #inspector .px-item > .px-item-kind { width: 64px; }
  #inspector .px-item > .px-item-label.px-xs { color: var(--px-muted-fg); flex: 0 0 auto; }
</style>
</head>
<body>
<div id="app">
  <div id="toolbar">
    <div id="queryWrap">
      <div class="px-input-group">${icon("search")}<input id="query" class="px-input" data-size="sm" autocomplete="off" spellcheck="false" placeholder="Event id or namespace" data-tip="An event id (namespace.123), an on_action or decision name, or a namespace. Enter loads it; / focuses this box" data-tip-wrap /></div>
      <div id="suggest" role="listbox"><div class="px-menu-list"></div></div>
    </div>
    <button id="go" class="px-btn" data-variant="outline" data-size="sm" data-tip="Load the graph for the id or namespace">Go</button>
    <button id="newEvent" class="px-btn" data-variant="outline" data-size="sm" data-tip="Create a new event (N)">${icon("plus")}New</button>
    <div class="px-separator" data-orientation="vertical"></div>
    <div class="px-toggle-group" data-tip="What the cards are captioned with" data-tip-wrap>
      <button id="titleRaw" class="px-toggle" data-size="sm" aria-pressed="true" data-tip="Caption every card with its raw id (cultivation_scheme.101)" data-tip-wrap>Raw</button>
      <button id="titleLoc" class="px-toggle" data-size="sm" aria-pressed="false" data-tip="Caption every card with its localized title, falling back to the id where there is none" data-tip-wrap>Loc</button>
    </div>
    <button id="toolBanner" class="tool px-btn" data-variant="ghost" data-size="icon-sm" aria-pressed="false" data-tip="Event background: draw each event's background illustration behind its card. A background that cannot be resolved gets a hatched placeholder that says so" data-tip-wrap>${icon("image")}</button>
    <div class="px-separator" data-orientation="vertical"></div>
    <button id="undo" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Nothing to undo" disabled>${icon("undo")}</button>
    <button id="redo" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Nothing to redo" disabled>${icon("redo")}</button>
    <span class="px-grow"></span>
    <button id="refresh" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Reload the current graph from the index">${icon("rotate")}</button>
    <button id="changes" class="px-btn" data-variant="ghost" data-size="sm" data-tip="No changes yet. Edits stay in this view until you save them" data-tip-wrap disabled>${icon("list")}<span class="count">0</span></button>
    <button id="save" class="px-btn" data-variant="default" data-size="sm" data-tip="No changes to save yet. Edits stay in this view until you save them" data-tip-wrap disabled>${icon("save")}Save</button>
    <div class="px-separator" data-orientation="vertical"></div>
    <button id="export" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Export the graph as SVG" data-tip-side="left">${icon("download")}</button>
    <button id="helpBtn" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="How this view works: reading, editing, saving, shortcuts" data-tip-side="left" data-tip-wrap>${icon("circleHelp")}</button>
    <button id="togglePanel" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Hide inspector" data-tip-side="left">${icon("panelRightClose")}</button>
  </div>
  <div id="main">
    <div id="rail" class="px-sidepanel" data-side="left">
      <div class="px-sidepanel-body">
        ${tools}
      </div>
    </div>
    <div id="graphWrap">
      <div id="railBar">
        <span id="actingOn" class="px-muted px-xs"></span>
      </div>
      <div id="chainDepth" hidden>
        <button id="chainDepthHead" class="px-btn" data-variant="outline" data-size="icon-sm" data-tip="Chain depth: how many steps around the selected card stay visible" data-tip-side="bottom" data-tip-wrap>${icon("chevronRight")}</button>
        <div id="chainDepthOptions" hidden>
          <input id="chainDepthSlider" type="range" min="1" max="5" step="1" value="5" />
          <span id="chainDepthLabel" class="px-xs">∞</span>
        </div>
      </div>
      <svg id="graph" xmlns="http://www.w3.org/2000/svg"></svg>
      <div id="stageTools">
        <div id="zoomGroup">
          <button id="zoomOut" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Zoom out (−)" data-tip-side="top">${icon("zoomOut")}</button>
          <button id="zoomIn" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Zoom in (+)" data-tip-side="top">${icon("zoomIn")}</button>
          <button id="zoomFit" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Fit the graph (0)" data-tip-side="top">${icon("maximize")}</button>
        </div>
        <div id="kinds" class="px-toggle-group" data-tip="Click a kind to dim it in the graph" data-tip-side="top" data-tip-wrap>${kindToggles}</div>
        <span id="focusLine" class="px-muted px-xs"></span>
      </div>
      <button id="info" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="" data-tip-side="top" data-tip-align="right" data-tip-wrap>${icon("info")}</button>
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
