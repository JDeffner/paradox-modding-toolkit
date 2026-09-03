/**
 * The Trait Creator page: markup and page styles on top of the shared px-ui
 * stylesheet. The app (app/main.ts) builds every field at runtime from the
 * form the server answered; nothing here knows a key name.
 */
import uiCss from "../shared/ui.css";
import { icon } from "../shared/icons";

export interface TraitCreatorHtmlOptions {
  scriptSrc: string;
  nonce: string;
  csp: string;
}

export function traitCreatorHtml({ scriptSrc, nonce, csp }: TraitCreatorHtmlOptions): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>Trait Creator</title>
<style>
${uiCss}
  body { overflow: hidden; }
  #app { display: flex; flex-direction: column; height: 100%; }
  #toolbar {
    display: flex; align-items: center; gap: 6px; flex: 0 0 auto; flex-wrap: wrap;
    padding: 6px 8px; border-bottom: 1px solid var(--px-border);
  }
  #name { width: 220px; font-family: var(--px-font-mono); }
  #target { color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  #body { flex: 1 1 auto; overflow-y: auto; }
  #sections {
    max-width: 720px; padding: 12px 16px 60px; display: flex; flex-direction: column; gap: 18px;
  }
  section { display: flex; flex-direction: column; gap: 6px; }
  section > .px-panel-title { padding: 0; }
  .lede { color: var(--px-muted-fg); font-size: var(--px-text-xs); margin: -2px 0 4px; }
  /* A key the file keeps the last word on: named, never silently dropped. */
  .kept {
    display: flex; align-items: center; gap: 6px;
    color: var(--px-muted-fg); font-size: var(--px-text-xs);
  }
  .kept > code { font-family: var(--px-font-mono); color: var(--px-fg); }
  #preview {
    margin: 0; padding: 8px 10px; overflow: auto; max-height: 320px;
    background: var(--px-muted); border-radius: var(--px-radius-md);
    font-family: var(--px-font-mono); font-size: var(--px-text-sm); white-space: pre;
  }
  #problem {
    margin: 12px 16px; padding: 10px 12px; border: 1px solid var(--px-border);
    border-radius: var(--px-radius-md); background: var(--px-muted);
    font-size: var(--px-text-sm);
  }
  #problem[hidden] { display: none; }
  details > summary { cursor: pointer; color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  details[open] > summary { margin-bottom: 6px; }
</style>
</head>
<body>
<div id="app">
  <div id="toolbar">
    <input id="name" class="px-input" data-size="sm" spellcheck="false" autocomplete="off"
      placeholder="trait key" data-tip="The key the game reads. Lowercase letters, digits and _." data-tip-wrap />
    <span id="source" class="px-badge" data-variant="outline">New</span>
    <button id="open" class="px-btn" data-variant="ghost" data-size="icon-sm"
      data-tip="Open an existing trait in this form">${icon("folderOpen")}</button>
    <button id="reveal" class="px-btn" data-variant="ghost" data-size="icon-sm" hidden
      data-tip="Open the file this trait comes from">${icon("fileText")}</button>
    <span class="px-grow"></span>
    <span id="target"></span>
    <button id="mode" class="px-btn px-dropdown" data-variant="outline" data-size="sm" hidden
      data-tip="This trait belongs to the game. Choose how your mod changes it." data-tip-wrap>
      <span class="px-truncate">Duplicate</span>${icon("chevronDown")}</button>
    <button id="save" class="px-btn" data-size="sm">${icon("save")}Save</button>
    <button id="helpBtn" class="px-btn" data-variant="ghost" data-size="icon-sm"
      data-tip="How this view works" data-tip-side="left">${icon("circleHelp")}</button>
  </div>
  <div id="problem" hidden></div>
  <div id="body"><div id="sections"></div></div>
</div>
<script nonce="${nonce}" src="${scriptSrc}"></script>
</body>
</html>`;
}
