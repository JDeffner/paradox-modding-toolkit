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

  /** A checkbox dressed as a px-toggle: the app reads `.checked`, the page shows the pressed state.
   *  They live in the stage's bottom-left strip, so their tooltips open upward. */
  const viewToggle = (id: string, name: IconName, tip: string, checked = false): string =>
    `<label class="px-toggle" data-size="sm" data-tip="${tip}" data-tip-side="top" data-tip-wrap><input id="${id}" type="checkbox"${checked ? " checked" : ""} />${icon(name)}</label>`;

  /** A collapsible panel section: the header toggles `data-collapsed` on the section (main.ts wires it). */
  const section = (id: string, title: string, inner: string, collapsed = false): string =>
    `<div class="px-section" id="sec-${id}"${collapsed ? " data-collapsed" : ""}><button class="px-section-head" type="button">${icon("chevronDown")}<span>${title}</span></button><div class="px-section-body">${inner}</div></div>`;

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
  /* Deferred features, hidden until they are fleshed out: the interact mode
     and the save-game preview source. See docs/deferred-features.md. The
     elements stay in the DOM because app/ queries their ids. */
  #modeGroup[hidden], #saveSource[hidden] { display: none; }
  /* The session-changes count rides the Changes button, like the event graph's. */
  #changes .count {
    min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; flex: 0 0 auto;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 10px; line-height: 1; font-variant-numeric: tabular-nums;
    background: var(--px-primary); color: var(--px-primary-fg);
  }
  #changes[disabled] .count { display: none; }
  #changeList { display: flex; flex-direction: column; gap: 2px; width: 340px; max-height: 320px; overflow: auto; }
  #changeList .px-item-kind { width: 62px; }
  #changeList .what { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #fileName { font-weight: 600; max-width: 260px; }
  #fileName:empty::before { content: "GUI Editor"; color: var(--px-muted-fg); font-weight: 500; }
  /* A checkbox inside a toggle: hidden, its state shown on the label (the px-switch pattern). */
  .px-toggle > input[type="checkbox"] { position: absolute; opacity: 0; width: 0; height: 0; }
  .px-toggle:has(> input:checked) { background: var(--px-muted); }
  .px-toggle:has(> input:focus-visible) { border-color: var(--px-ring); box-shadow: 0 0 0 3px var(--px-ring-soft); }
  #heatmap { display: none; }
  #heatmapMenu { width: auto; min-width: 120px; }
  /* What a hovered textbox's segments resolved to (main.ts builds the rows). */
  #textTip { position: fixed; z-index: 60; pointer-events: none; gap: 6px; min-width: 0; max-width: 420px; padding: 8px 10px; font-size: var(--px-text-xs); }
  #textTip[hidden] { display: none; }
  #textTip .tipTitle { font-weight: 600; color: var(--px-muted-fg); }
  #textTip .seg { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 8px; align-items: baseline; }
  #textTip .seg .px-badge { height: 16px; padding: 0 5px; }
  #textTip .seg .src { font-family: var(--px-font-mono); word-break: break-all; white-space: normal; }
  #textTip .seg .res { grid-column: 2; white-space: normal; }
  #textTip .seg .val { color: var(--px-fg); }
  #textTip .seg .arrow, #textTip .seg .note { color: var(--px-muted-fg); }

  /* ---- stage ---- */
  /* Relative: the library overlay is positioned against it, so it can cover
     the side panels as well as the stage. */
  #main { flex: 1 1 auto; display: flex; min-height: 0; position: relative; }
  /* The canvas paints this same color under the world (render.ts CANVAS_BG), so a resize shows no flash. */
  #stage { flex: 1 1 auto; overflow: hidden; background: #101010; position: relative; min-width: 0; }
  #canvas { display: block; }
  #stageTools, #stageInfo {
    position: absolute; bottom: 8px; display: flex; align-items: center; gap: 2px;
    padding: 2px; border-radius: var(--px-radius);
    background: color-mix(in oklch, var(--px-bg) 75%, transparent);
  }
  #stageTools { left: 8px; gap: 4px; }
  #stageTools .px-separator { height: 18px; }
  #stageInfo { right: 8px; }
  #zoomLabel { min-width: 44px; height: var(--px-h-sm); line-height: var(--px-h-sm); padding: 0 6px; text-align: center; font-variant-numeric: tabular-nums; cursor: default; }
  /* What a click did in interact mode (main.ts fills it). */
  #clickTip { position: absolute; z-index: 61; gap: 4px; min-width: 0; max-width: 360px; padding: 8px 10px; font-size: var(--px-text-xs); }
  #clickTip[hidden] { display: none; }
  #clickTip .title { font-weight: 600; font-size: var(--px-text-sm); }
  #clickTip .act { display: flex; align-items: baseline; gap: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #clickTip .act .px-badge { flex: 0 0 auto; height: 16px; padding: 0 5px; }
  #clickTip .act .src { font-family: var(--px-font-mono); overflow: hidden; text-overflow: ellipsis; }
  #clickTip .note { padding: 0; }
  /* ---- collapsible sections in the side panels ---- */
  .px-section { display: flex; flex-direction: column; min-height: 0; flex: 1 1 0; }
  .px-section[data-collapsed] { flex: 0 0 auto; }
  .px-section + .px-section { border-top: 1px solid var(--px-border); }
  .px-section-head {
    display: flex; align-items: center; gap: 4px; flex: 0 0 auto; width: 100%;
    padding: 5px 8px; border: 0; background: var(--px-sidebar); color: var(--px-muted-fg);
    font: inherit; font-size: var(--px-text-xs); font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
    cursor: pointer; text-align: left;
  }
  .px-section-head:hover { color: var(--px-fg); }
  .px-section-head > svg.px-icon { width: 14px; height: 14px; transition: transform var(--px-ease); }
  .px-section[data-collapsed] > .px-section-head > svg.px-icon { transform: rotate(-90deg); }
  .px-section-body { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
  .px-section[data-collapsed] > .px-section-body { display: none; }
  #sec-layers:not([data-collapsed]) { flex: 0 0 40%; }
  #sec-tree[data-collapsed] ~ #sec-layers:not([data-collapsed]) { flex: 1 1 0; }
  #sec-devtools:not([data-collapsed]) { flex: 0 0 55%; }
  #sec-inspector[data-collapsed] ~ #sec-devtools:not([data-collapsed]) { flex: 1 1 0; }
  /* ---- the library, over the whole editor ---- */
  /* It covers #main (stage AND side panels), so the showcase always has the
     full window's width; being outside #stage also keeps its wheel events off
     the canvas zoom handler, which used to eat the library's own scrolling. */
  #libraryOverlay { position: absolute; inset: 0; z-index: 40; display: flex; flex-direction: column; background: var(--px-bg); }
  #libraryOverlay[hidden] { display: none; }
  #libraryOverlay > #library { flex: 1 1 auto; min-height: 0; border-top: 0; }
  #info[data-warning] { color: var(--px-destructive); }

  /* ---- side panels ---- */
  #side { --px-sidepanel-width: 280px; }
  #right { --px-sidepanel-width: 320px; }
  #side > .px-sidepanel-body, #right > .px-sidepanel-body { overflow: hidden; }
  #tree, #layers, #inspector, #library, #haloBody { overflow: auto; min-height: 0; }
  #tree { flex: 1 1 auto; min-height: 60px; }
  #layers { flex: 1 1 auto; min-height: 70px; }
  #library[hidden] { display: none; }
  #library .head, #layers .head { position: sticky; top: 0; z-index: 1; background: var(--px-sidebar); }
  #library .head { display: flex; flex-direction: column; gap: 6px; padding: 8px 12px 4px; }
  #library .head .titleRow { display: flex; align-items: center; gap: 8px; }
  #library .head .titleRow .title { font-weight: 600; }
  #library .head .px-tabs { display: flex; flex-wrap: wrap; }
  #library .head .px-tab { height: var(--px-h-sm); padding: 0 7px; font-size: var(--px-text-sm); }
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

  /* ---- rows (tree, layers): px-item plus this page's columns ---- */
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
  /* ---- the library's showcase cards ---- */
  /* Modeled on the game's own GUI overview window: each element rendered at a
     readable size, named, and explained, so a new modder learns what it IS
     from the card rather than from trying it. */
  #library .tileGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px; padding: 10px 16px 18px; }
  #library .groupHead {
    grid-column: 1 / -1; padding: 14px 2px 0; color: var(--px-muted-fg);
    font-size: var(--px-text-xs); font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
  }
  #library .groupHead:first-child { padding-top: 2px; }
  #library .tile {
    display: flex; flex-direction: column; gap: 6px; padding: 10px; min-width: 0;
    border: 1px solid var(--px-border); background: var(--px-bg);
    border-radius: var(--px-radius-md); cursor: grab;
    transition: background-color var(--px-ease), border-color var(--px-ease);
  }
  #library .tile:hover { background: var(--px-muted); border-color: color-mix(in oklch, var(--px-fg) 25%, var(--px-border)); }
  #library .tile[data-dragging] { opacity: 0.5; }
  #library .tile canvas {
    width: 220px; height: 110px; max-width: 100%; align-self: center; border-radius: var(--px-radius-sm);
    background: color-mix(in oklch, var(--px-bg), var(--px-fg) 8%); box-shadow: inset 0 0 0 1px var(--px-border);
  }
  #library .tile[data-empty] canvas { background: transparent; box-shadow: none; border: 1px dashed var(--px-border); box-sizing: border-box; }
  #library .tile .name, #library .tile .src { width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #library .tile .name { font-size: var(--px-text-sm); font-weight: 600; }
  #library .tile .desc { font-size: var(--px-text-xs); color: var(--px-muted-fg); white-space: normal; line-height: 1.45; }
  #library .tile .src { font-size: var(--px-text-xs); color: var(--px-muted-fg); }
  #library .tileMore { height: 1px; }
  #library .note.count { text-align: center; font-size: var(--px-text-xs); }
  #library .head { padding: 10px 16px 4px; }
  /* The chip that follows a library drag, and the container it would drop into. */
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
  /* Under the inspector text row: what the canvas shows for it, and the buttons for what it could not resolve. */
  #inspector .prop .resolved { padding-left: 20px; font-size: var(--px-text-xs); color: var(--px-muted-fg); white-space: normal; word-break: break-word; }
  #inspector .prop .textTools { display: flex; flex-wrap: wrap; gap: 3px; padding: 2px 0 2px 20px; }
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
  #halo { flex: 1 1 auto; min-height: 120px; display: flex; flex-direction: column; }
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
  #haloBody label.check { display: flex; width: 100%; box-sizing: border-box; padding: 3px 10px; gap: 8px; min-width: 0; }
  #haloBody label.check > span:first-of-type { flex: 0 0 auto; }
  #haloBody label.check .px-grow { flex: 1 1 auto; min-width: 0; white-space: normal; }
  #haloBody label.check .px-grow.mono { font-family: var(--px-font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #haloBody .uses .row { display: flex; align-items: baseline; gap: 6px; padding: 2px 10px; min-height: 22px; }
  #haloBody .uses .row .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #haloBody .uses .row .meta { flex: 0 0 auto; color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  #haloBody .uses .sub { padding-left: 22px; }
  #haloBody .uses .via { color: var(--px-muted-fg); font-size: var(--px-text-xs); white-space: normal; }
  #haloBody .refRow { display: flex; align-items: center; gap: 6px; padding: 3px 10px; }
  #haloBody .refRow .px-slider { flex: 1 1 auto; }
  #haloBody .refRow .px-label { flex: 0 0 64px; }
  #haloBody .refRow input.px-input { width: 72px; text-align: right; font-family: var(--px-font-mono); }

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
    <button id="toggleSide" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Hide the tree" data-tip-side="right">${icon("panelLeftClose")}</button>
    <span id="fileName" class="px-truncate"></span>
    <button id="refresh" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Lay the document out again">${icon("rotate")}</button>
    <div class="px-separator" data-orientation="vertical"></div>
    <button id="undo" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Nothing from this panel to undo. The text editor's own history stays its own" data-tip-wrap disabled>${icon("undo")}</button>
    <button id="redo" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Nothing to redo" disabled>${icon("redo")}</button>
    <button id="changes" class="px-btn" data-variant="ghost" data-size="sm" data-tip="No changes yet this session" data-tip-wrap disabled>${icon("list")}<span class="count">0</span></button>
    <button id="save" class="px-btn" data-variant="default" data-size="sm" data-tip="Nothing to save: the file on disk already matches" data-tip-wrap disabled>${icon("save")}Save</button>
    <div class="px-separator" data-orientation="vertical"></div>
    <div class="px-toggle-group" id="modeGroup" hidden>
      <button id="modeEdit" class="px-toggle" data-size="sm" aria-pressed="true" data-tip="Edit: select, drag, resize and write to the file (V)" data-tip-wrap>${icon("mousePointer")}Edit</button>
      <button id="modeInteract" class="px-toggle" data-size="sm" aria-pressed="false" data-tip="Interact: click buttons and scroll lists as in game (I)" data-tip-wrap>${icon("hand")}Interact</button>
    </div>
    <span class="px-grow"></span>
    <div class="px-toggle-group">
      <button id="locResolved" class="px-toggle" data-size="sm" aria-pressed="true" data-tip="Show textboxes as the game would render them" data-tip-wrap>Resolved</button>
      <button id="locRaw" class="px-toggle" data-size="sm" aria-pressed="false" data-tip="Show textboxes as the file has them: the text = value verbatim" data-tip-wrap>Raw</button>
      <button id="saveSource" class="px-btn px-dropdown" data-variant="outline" data-size="sm" style="width:auto;max-width:260px" data-tip="Real values for [datafunctions] from a save game (plain text, not ironman)" data-tip-wrap hidden>${icon("fileText")}<span class="px-truncate">No save</span>${icon("chevronDown")}</button>
    </div>
    <select id="heatmap"></select>
    <button id="heatmapMenu" class="px-btn px-dropdown" data-variant="outline" data-size="sm" data-tip="Tint the scene by one property of the widget tree" data-tip-wrap>${icon("flame")}<span class="px-truncate"></span>${icon("chevronDown")}</button>
    <div class="px-separator" data-orientation="vertical"></div>
    <button id="libraryToggle" class="px-toggle" data-size="sm" aria-pressed="false" data-tip="Widgets, templates and saved pieces to add to the canvas (L)" data-tip-wrap>${icon("shapes")}Library</button>
    <div class="px-separator" data-orientation="vertical"></div>
    <button id="helpBtn" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="How this editor works: selecting, editing, saving, the library, shortcuts" data-tip-side="left" data-tip-wrap>${icon("circleHelp")}</button>
    <button id="toggleRight" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Hide the inspector" data-tip-side="left">${icon("panelRightClose")}</button>
  </div>
  <div id="main">
    <div id="side" class="px-sidepanel" data-side="left">
      <div class="px-sidepanel-resizer"></div>
      <div class="px-sidepanel-body">
        ${section("tree", "Tree", `<div id="focusBar"></div><div id="tree" class="px-list"></div>`)}
        ${section("layers", "Layers", `<div id="layers" class="px-list"></div>`)}
      </div>
    </div>
    <div id="stage">
      <canvas id="canvas"></canvas>
      <div id="dropTarget" hidden><span class="px-badge">Drop here</span></div>
      <div id="textTip" class="px-popover" hidden></div>
      <div id="clickTip" class="px-popover" hidden></div>
      <div id="stageTools">
        <button id="zoomOutBtn" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Zoom out (Ctrl+−)" data-tip-side="top">${icon("zoomOut")}</button>
        <button id="zoomInBtn" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Zoom in (Ctrl++)" data-tip-side="top">${icon("zoomIn")}</button>
        <button id="zoomFitBtn" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Fit the view (Ctrl+0)" data-tip-side="top">${icon("maximize")}</button>
        <span id="zoomLabel" class="px-muted px-xs" data-tip="Wheel zooms, middle mouse pans. Double-click to fit" data-tip-side="top" data-tip-wrap>100%</span>
        <div class="px-separator" data-orientation="vertical"></div>
        <div class="px-toggle-group">
          ${viewToggle("outlines", "squareDashed", "Outline every widget")}
          ${viewToggle("snap", "magnet", "Snap a drag to sibling and parent edges, centres, equal gaps and equal sizes", true)}
          ${viewToggle("grid", "grid", "Draw an 8 px grid and snap a drag to it (Alt+arrow nudges by one step)")}
          ${viewToggle("constraints", "ruler", "Show the selected widget's parent box, its anchors and the offset between them")}
          ${viewToggle("pulses", "activity", "Flash the widgets each re-layout moved")}
        </div>
      </div>
      <div id="stageInfo">
        <button id="info" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="" data-tip-side="top" data-tip-align="right" data-tip-wrap>${icon("info")}</button>
      </div>
    </div>
    <div id="right" class="px-sidepanel" data-side="right">
      <div class="px-sidepanel-resizer"></div>
      <div class="px-sidepanel-body">
        ${section("inspector", "Inspector", `<div id="inspector"></div>`)}
        ${section("devtools", "Devtools", `<div id="halo"><div id="haloTabs" class="px-tabs" data-variant="line"></div><div id="haloBody"></div></div>`, true)}
      </div>
    </div>
    <div id="libraryOverlay" hidden>
      <div id="library" hidden></div>
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
