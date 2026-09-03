/**
 * The Wiki page: markup and page-specific styles on top of the shared px-ui
 * stylesheet. The app (app/main.ts) fills the table of contents and the
 * reading pane at runtime; nothing here talks to the host.
 *
 * The article styles are the doc panel's (webviews/docPanel.ts), so a page
 * reads the same whichever surface shows it. The front-page cards are the
 * Credits page's (credits/html.ts).
 */
import uiCss from "../shared/ui.css";
import { icon } from "../shared/icons";

export interface WikiHtmlOptions {
  scriptSrc: string;
  nonce: string;
  csp: string;
}

export function wikiHtml({ scriptSrc, nonce, csp }: WikiHtmlOptions): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>Wiki</title>
<style>
${uiCss}
  body { overflow: hidden; }
  #app { display: flex; height: 100%; position: relative; }
  /* The ? floats at the top right of the reading pane: this page has no
     toolbar to end. #page reserves the room so an article never runs under it. */
  #helpBtn { position: absolute; top: 8px; right: 12px; z-index: 5; }
  #sidebar {
    flex: 0 0 232px; display: flex; flex-direction: column; min-height: 0;
    border-right: 1px solid var(--px-border); background: var(--px-sidebar);
  }
  @media (max-width: 640px) { #sidebar { flex-basis: 168px; } }
  #searchBar { flex: 0 0 auto; padding: 8px; border-bottom: 1px solid var(--px-border); }
  #searchBar .px-input-group { width: 100%; }
  #nav { flex: 1 1 auto; overflow-y: auto; padding: 4px 4px 20px; }
  #nav .px-panel-title { padding: 10px 8px 4px; }
  #nav .px-item { gap: 6px; }
  #nav .px-item[aria-selected="true"] { background: var(--px-muted-strong); }
  #nav .px-item-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 auto; }
  #nav .diag { padding-left: 26px; }
  #nav .diag .px-item-label { font-family: var(--px-font-mono); font-size: var(--px-text-sm); }
  #nav .twist { flex: 0 0 auto; display: inline-flex; padding: 2px; border-radius: var(--px-radius-sm); color: var(--px-muted-fg); }
  #nav .twist:hover { background: var(--px-muted); color: var(--px-fg); }
  #nav .twist svg { width: 14px; height: 14px; }
  #navEmpty { padding: 12px 10px; color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  #doc { flex: 1 1 auto; overflow-y: auto; min-width: 0; }
  #page { max-width: 900px; padding: 14px 44px 48px 24px; }
  #crumbs {
    display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin: 0 0 14px;
    color: var(--px-muted-fg); font-size: var(--px-text-sm);
  }
  #crumbs[hidden] { display: none; }
  #crumbs .crumb { display: inline-flex; align-items: center; gap: 4px; }
  #crumbs .crumb[role="button"] { cursor: pointer; color: var(--px-fg); }
  #crumbs .crumb[role="button"]:hover { text-decoration: underline; }
  #crumbs svg { width: 13px; height: 13px; }
  #page h1 { font-size: 1.7em; margin: 0 0 4px; }
  #page h2 { font-size: 1.25em; margin: 26px 0 8px; padding-bottom: 4px; border-bottom: 1px solid var(--px-border); }
  #page h3 { font-size: 1.05em; margin: 18px 0 6px; }
  #page p, #page ul { margin: 8px 0; }
  #page ul { padding-left: 20px; }
  #page li { margin: 3px 0; }
  #page .lede { color: var(--px-muted-fg); margin: 0 0 18px; }
  #page code { font-family: var(--px-font-mono); font-size: 0.92em; background: var(--px-muted); border-radius: var(--px-radius-sm); padding: 1px 5px; }
  #page pre {
    margin: 10px 0; padding: 8px 10px; overflow-x: auto; background: var(--px-muted);
    border-radius: var(--px-radius-md);
  }
  #page pre code { background: none; padding: 0; font-size: var(--px-text-sm); }
  #page table { border-collapse: collapse; margin: 10px 0; width: 100%; }
  #page th, #page td { text-align: left; padding: 5px 10px; border-bottom: 1px solid var(--px-border); }
  #page th { font-weight: 600; color: var(--px-muted-fg); font-size: var(--px-text-sm); }
  #page tbody tr:hover { background: var(--px-muted); }
  /* The Diagnostics index: each row is a link to its page. */
  #page tr.link { cursor: pointer; }
  #page tr.link td:first-child { font-family: var(--px-font-mono); font-size: var(--px-text-sm); white-space: nowrap; }
  /* Front-page cards: as many per row as the width allows, one column on narrow panes. */
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 10px; margin-top: 6px; }
  .card {
    display: flex; flex-direction: column; gap: 6px; min-height: 96px; padding: 12px;
    border: 1px solid var(--px-border); border-radius: var(--px-radius-md);
    background: var(--px-sidebar); cursor: pointer; text-align: left; font: inherit; color: inherit;
  }
  .card:hover { background: var(--px-muted); }
  .card:focus-visible { outline: 1px solid var(--px-ring); outline-offset: 1px; }
  .card .head { display: flex; align-items: center; gap: 8px; font-weight: 600; }
  .card .head svg { width: 16px; height: 16px; flex: 0 0 auto; }
  .card .head .ext { margin-left: auto; opacity: 0.6; }
  .card .head .ext svg { width: 12px; height: 12px; }
  .card .tip { color: var(--px-muted-fg); font-size: var(--px-text-sm); }
  #pending { display: flex; align-items: center; gap: 8px; color: var(--px-muted-fg); padding: 12px 0; }
</style>
</head>
<body>
<div id="app">
  <div id="sidebar">
    <div id="searchBar">
      <div class="px-input-group">${icon("search")}<input id="query" class="px-input" data-size="sm" autocomplete="off" spellcheck="false" placeholder="Search the wiki…" data-tip="Matches the title and the text of every page." data-tip-wrap /></div>
    </div>
    <div id="nav"></div>
  </div>
  <button id="helpBtn" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="How this view works" data-tip-side="left" aria-label="How this view works">${icon("circleHelp")}</button>
  <div id="doc">
    <div id="page">
      <nav id="crumbs" hidden></nav>
      <div id="content"></div>
    </div>
  </div>
</div>
<script nonce="${nonce}" src="${scriptSrc}"></script>
</body>
</html>`;
}
