/**
 * The Wiki page: markup and page-specific styles on top of the shared px-ui
 * stylesheet. The app (app/main.ts) fills the sidebar and the reading pane at
 * runtime; nothing here talks to the host.
 *
 * The article styles are the doc panel's (webviews/docPanel.ts), so a page
 * reads the same whichever surface shows it.
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
    flex: 0 0 258px; display: flex; flex-direction: column; min-height: 0;
    border-right: 1px solid var(--px-border); background: var(--px-sidebar);
  }
  #searchBar { flex: 0 0 auto; padding: 8px; border-bottom: 1px solid var(--px-border); }
  #searchBar .px-input-group { width: 100%; }
  #nav { flex: 1 1 auto; overflow-y: auto; padding: 4px 4px 20px; }
  #nav .px-panel-title { padding: 10px 8px 4px; }
  #nav .px-item { gap: 6px; }
  #nav .px-item[aria-selected="true"] { background: var(--px-muted-strong); }
  #nav .px-item-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #nav .diag .px-item-label { font-family: var(--px-font-mono); font-size: var(--px-text-sm); }
  #navEmpty { padding: 12px 10px; color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  #doc { flex: 1 1 auto; overflow-y: auto; min-width: 0; }
  #page { max-width: 860px; padding: 18px 44px 48px 24px; }
  #page h1 { font-size: 1.7em; margin: 0 0 4px; }
  #page h2 { font-size: 1.25em; margin: 26px 0 8px; padding-bottom: 4px; border-bottom: 1px solid var(--px-border); }
  #page h3 { font-size: 1.05em; margin: 18px 0 6px; }
  #page p, #page ul { margin: 8px 0; }
  #page ul { padding-left: 20px; }
  #page li { margin: 3px 0; }
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
  #placeholder { padding: 40px 24px; color: var(--px-muted-fg); display: flex; flex-direction: column; gap: 8px; max-width: 560px; }
  /* An explicit display beats the hidden attribute, so say it again here. */
  #placeholder[hidden], #page[hidden] { display: none; }
</style>
</head>
<body>
<div id="app">
  <div id="sidebar">
    <div id="searchBar">
      <div class="px-input-group">${icon("search")}<input id="query" class="px-input" data-size="sm" autocomplete="off" spellcheck="false" placeholder="Search the wiki…" data-tip="Matches the title and the text of every article." data-tip-wrap /></div>
    </div>
    <div id="nav"></div>
  </div>
  <button id="helpBtn" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="How this view works" data-tip-side="left" aria-label="How this view works">${icon("circleHelp")}</button>
  <div id="doc">
    <div id="placeholder">
      <div>Pick a page on the left. The wiki collects the reference knowledge the toolkit carries: what the game expects from your art, and what each diagnostic means.</div>
      <div class="px-xs">Every page comes from the toolkit's own measured documentation, not from a hand written list.</div>
    </div>
    <div id="page" hidden></div>
  </div>
</div>
<script nonce="${nonce}" src="${scriptSrc}"></script>
</body>
</html>`;
}
