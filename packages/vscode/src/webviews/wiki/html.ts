/**
 * The Wiki page: markup and page-specific styles on top of the shared px-ui
 * stylesheet. The app (app/main.ts) fills the table of contents and the
 * reading pane at runtime; nothing here talks to the host.
 *
 * The article styles are the doc panel's (webviews/docPanel.ts), so a page
 * reads the same whichever surface shows it. The front-page cards are the
 * Credits page (a wiki article, rendered from credits/credits.ts).
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
  #reader { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
  #readingBar { display: flex; align-items: center; gap: 4px; padding: 6px 12px; border-bottom: 1px solid var(--px-border); }
  #improvePage { margin-left: auto; }
  #readingBar button[hidden] { display: none; }
  #helpBtn { margin-left: auto; }
  #improvePage:not([hidden]) + #helpBtn { margin-left: 0; }
  /* A fixed width, whatever a row holds: a flex item's min-width is its
     content by default, so a long diagnostic code pushed the sidebar wider
     each time the codes folded out. */
  #sidebar {
    flex: 0 0 232px; width: 232px; min-width: 0; overflow: hidden;
    display: flex; flex-direction: column; min-height: 0;
    border-right: 1px solid var(--px-border); background: var(--px-sidebar);
  }
  @media (max-width: 640px) { #sidebar { flex-basis: 168px; width: 168px; } }
  #gameBar, #searchBar { flex: 0 0 auto; padding: 8px; border-bottom: 1px solid var(--px-border); }
  #searchBar .px-input-group { width: 100%; }
  #gameBar > label { display: block; margin-bottom: 5px; color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  #sidebarFooter { padding: 8px; display: flex; flex-direction: column; gap: 5px; border-top: 1px solid var(--px-border); }
  #sidebarFooter > * { justify-content: flex-start; }
  #sidebarFooter a { color: var(--vscode-textLink-foreground, var(--px-primary)); text-decoration: none; }
  .workspace { display: block; color: var(--px-muted-fg); font-size: var(--px-text-xs); font-weight: normal; }
  #nav .workspace { white-space: normal; line-height: 1.4; }
  #nav .search-result { align-items: flex-start; }
  #nav .search-result .px-item-label { white-space: normal; }
  .search-detail { display: block; color: var(--px-muted-fg); font-size: var(--px-text-xs); line-height: 1.4; margin-top: 3px; overflow-wrap: anywhere; }
  #searchExamples { margin-top: 12px; border-top: 1px solid var(--px-border); padding-top: 10px; }
  #nav #searchExamples .px-item-label { white-space: normal; }
  .secondary-links { display: flex; flex-wrap: wrap; gap: 8px; }
  .secondary-links button { height: auto; flex-wrap: wrap; padding: 8px 10px; }
  .article-contents { margin: 14px 0; border: 1px solid var(--px-border); border-radius: var(--px-radius-md); padding: 8px 12px; }
  .article-contents summary { cursor: pointer; }
  .article-contents > div { max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; margin-top: 6px; }
  .contents-link { border: 0; background: none; color: var(--vscode-textLink-foreground, var(--px-primary)); font: inherit; text-align: left; padding: 4px 0; cursor: pointer; }
  .contents-link:hover { text-decoration: underline; }
  #content .search-target { background: var(--px-muted-strong); outline: 1px solid var(--px-ring); outline-offset: 3px; border-radius: var(--px-radius-sm); }
  [id^="wiki-heading-"], [id^="wiki-card-"] { scroll-margin-top: 16px; }
  #nav { flex: 1 1 auto; overflow-y: auto; overflow-x: hidden; padding: 4px 4px 20px; }
  #nav .px-panel-title { padding: 10px 8px 4px; }
  #nav .px-item { gap: 6px; }
  #nav .px-item[aria-selected="true"] { background: var(--px-muted-strong); }
  #nav .px-item-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 auto; }
  #nav .px-item { min-width: 0; }
  #nav .diag { padding-left: 12px; }
  /* The severity symbol: the theme's own Problems colours, the word on hover. */
  .sev { display: inline-flex; flex: 0 0 auto; cursor: help; }
  .sev svg { width: 14px; height: 14px; }
  .sev[data-level="error"] { color: var(--vscode-problemsErrorIcon-foreground, var(--px-bad)); }
  .sev[data-level="warning"] { color: var(--vscode-problemsWarningIcon-foreground, #cca700); }
  .sev[data-level="info"], .sev[data-level="hint"] { color: var(--vscode-problemsInfoIcon-foreground, #3794ff); }
  #page td.sevcell { white-space: nowrap; }
  #page td.sevcell .sev { vertical-align: -2px; margin-right: 6px; }
  #page blockquote { margin: 10px 0; padding: 6px 12px; border-left: 2px solid var(--px-border); color: var(--px-muted-fg); }
  #page blockquote p { margin: 0; }
  #page a { color: var(--vscode-textLink-foreground, var(--px-primary)); text-decoration: none; }
  #page a:hover { text-decoration: underline; }
  #nav .diag .px-item-label { font-family: var(--px-font-mono); font-size: var(--px-text-sm); }
  #nav .twist { flex: 0 0 auto; display: inline-flex; padding: 2px; border: 0; background: none; cursor: pointer; border-radius: var(--px-radius-sm); color: var(--px-muted-fg); }
  #nav .twist:hover { background: var(--px-muted); color: var(--px-fg); }
  #nav .twist svg { width: 14px; height: 14px; }
  #navEmpty { padding: 12px 10px; color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  #doc { flex: 1 1 auto; overflow-y: auto; min-width: 0; }
  #page { max-width: 900px; padding: 20px 24px 48px; }
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
  #page .article-revision { color: var(--px-muted-fg); font-size: var(--px-text-sm); margin: 4px 0 16px; }
  #page ul { padding-left: 20px; }
  #page li { margin: 3px 0; }
  #page .lede { color: var(--px-muted-fg); margin: 0 0 18px; }
  #page code { font-family: var(--px-font-mono); font-size: 0.92em; background: var(--px-muted); border-radius: var(--px-radius-sm); padding: 1px 5px; }
  #page :not(pre) > code { overflow-wrap: anywhere; }
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
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(230px, 100%), 1fr)); gap: 10px; margin-top: 6px; }
  .hub-cards { grid-template-columns: repeat(auto-fit, minmax(min(230px, 100%), 1fr)); }
  .card {
    display: flex; flex-direction: column; gap: 6px; min-height: 96px; min-width: 0; padding: 12px;
    border: 1px solid var(--px-border); border-radius: var(--px-radius-md);
    background: var(--px-sidebar); cursor: pointer; text-align: left; font: inherit; color: inherit;
  }
  .card:hover { background: var(--px-muted); }
  .card:focus-visible { outline: 1px solid var(--px-ring); outline-offset: 1px; }
  .card .head { display: flex; align-items: flex-start; gap: 8px; font-weight: 600; }
  .card .head svg { width: 16px; height: 16px; flex: 0 0 auto; margin-top: 2px; }
  .card .head > a, .card .head > span { min-width: 0; overflow-wrap: anywhere; }
  .card .tip { color: var(--px-muted-fg); font-size: var(--px-text-sm); }
  /* Reference cards (Credits, Modding Tools): text with links in it, not a button. */
  .card.info { cursor: default; }
  .card.info:hover { background: var(--px-sidebar); }
  .card .meta { margin-top: -4px; color: var(--px-muted-fg); font-size: var(--px-text-sm); }
  .card .links { display: flex; flex-wrap: wrap; gap: 10px; margin-top: auto; font-size: var(--px-text-sm); }
  /* The filter row above a card grid: one chip per kind, with its icon. */
  .filterbar { display: flex; flex-direction: column; gap: 6px; margin: 10px 0 4px; }
  .filters { display: flex; flex-wrap: wrap; gap: 4px; }
  .filters .px-badge { cursor: pointer; font: inherit; font-size: var(--px-text-xs); font-weight: 500; }
  .filters .px-badge svg { width: 12px; height: 12px; }
  .filters .px-badge[aria-pressed="true"] { background: var(--px-primary); color: var(--px-primary-fg); border-color: transparent; }
  .filters .px-badge:focus-visible { outline: 1px solid var(--px-ring); outline-offset: 1px; }
  #pending { display: flex; align-items: center; gap: 8px; color: var(--px-muted-fg); padding: 12px 0; }
</style>
</head>
<body>
<div id="app">
  <div id="sidebar">
    <div id="gameBar">
      <label for="game">Reference game</label>
      <button id="game" class="px-btn px-dropdown" data-variant="outline" data-size="sm" aria-label="Game" data-tip="The game the wiki shows pages for. The toolkit keeps working on the workspace's game." data-tip-wrap><span class="px-truncate"></span>${icon("chevronDown")}</button>
    </div>
    <div id="searchBar">
      <div class="px-input-group">${icon("search")}<input id="query" class="px-input" data-size="sm" autocomplete="off" spellcheck="false" placeholder="Search the wiki…" data-tip="Matches the title and the text of every page." data-tip-wrap /></div>
    </div>
    <div id="nav"></div>
    <div id="sidebarFooter">
      <button id="suggestContent" class="px-btn" data-variant="outline" data-size="sm">${icon("plus")}Suggest content</button>
      <a class="px-btn" data-variant="ghost" data-size="sm" href="https://paradoxtoolkit.jdeffner.com/docs/">${icon("externalLink")}Toolkit help</a>
    </div>
  </div>
  <div id="reader">
  <div id="readingBar" role="toolbar" aria-label="Reading controls">
    <button id="wikiBack" class="px-btn" data-variant="ghost" data-size="icon-sm" aria-label="Back" data-tip="Back (Alt+Left)" disabled>${icon("chevronLeft")}</button>
    <button id="wikiForward" class="px-btn" data-variant="ghost" data-size="icon-sm" aria-label="Forward" data-tip="Forward (Alt+Right)" disabled>${icon("chevronRight")}</button>
    <button id="improvePage" class="px-btn" data-variant="ghost" data-size="sm" hidden>${icon("pencil")}Improve this page</button>
  <button id="helpBtn" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="How this view works" data-tip-side="left" aria-label="How this view works">${icon("circleHelp")}</button>
  </div>
  <div id="doc">
    <div id="page">
      <nav id="crumbs" hidden></nav>
      <div id="content"></div>
    </div>
  </div>
  </div>
</div>
<script nonce="${nonce}" src="${scriptSrc}"></script>
</body>
</html>`;
}
