import uiCss from "../shared/ui.css";
import { icon } from "../shared/icons";

export function settingsHtml({
  scriptSrc,
  nonce,
  csp,
}: {
  scriptSrc: string;
  nonce: string;
  csp: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}"><title>Toolkit Settings</title>
<style>${uiCss}
body { overflow: hidden; }
#app { height: 100vh; display: grid; grid-template-rows: auto 1fr auto; }
header { min-width: 0; padding: 18px 24px 12px; border-bottom: 1px solid var(--px-border); }
.heading { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.heading > .px-icon { width: 23px; height: 23px; color: var(--px-muted-fg); }
h1 { margin: 0; font-size: 21px; font-weight: 600; letter-spacing: -.3px; }
#game { margin: 3px 0 0; color: var(--px-muted-fg); }
.toolbar { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; }
#query { flex: 1 1 240px; min-width: 0; }
.toolbar-label { display: flex; align-items: center; gap: 8px; color: var(--px-muted-fg); white-space: nowrap; min-width: 0; }
.toolbar-label .px-select { min-width: 0; max-width: 240px; }
nav { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 4px; }
nav .px-btn { min-height: 34px; gap: 8px; }
nav .px-btn[aria-current="page"] { background: var(--px-muted); font-weight: 600; }
nav .count { color: var(--px-muted-fg); font-size: 11px; }
#content { min-width: 0; min-height: 0; overflow: auto; padding: 24px 24px 40px; scroll-behavior: smooth; }
.content-inner { max-width: 1380px; margin: 0 auto; }
.settings-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr)); gap: 16px; align-items: start; }
h2 { font-size: 18px; font-weight: 600; margin: 0 0 6px; }
.intro { color: var(--px-muted-fg); line-height: 1.6; margin: 0 0 20px; max-width: 70ch; }
.health { background: var(--px-muted); border: 1px solid var(--px-border); border-radius: var(--px-radius); padding: 14px 16px; margin-bottom: 20px; line-height: 1.6; }
.health summary { font-weight: 500; color: var(--px-fg); }
.health p { margin: 4px 0; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.action-note { color: var(--px-muted-fg); margin: 0 0 22px; font-size: var(--px-text-xs); }
.setting { min-width: 0; padding: 18px; border: 1px solid var(--px-border); border-radius: var(--px-radius); background: var(--px-popover); }
.setting-head { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.setting-head label { font-size: 14px; font-weight: 600; }
.setting-head .px-badge { margin-left: auto; }
.setting-head .px-badge { background: var(--px-muted); color: var(--px-muted-fg); border-color: var(--px-border); }
.description { margin: 8px 0 12px; color: var(--px-muted-fg); line-height: 1.6; max-width: 74ch; white-space: pre-line; }
.control-line { display: flex; gap: 8px; align-items: flex-start; flex-wrap: wrap; }
.control-line > input:not([type="checkbox"]), .control-line > select, .control-line > textarea { width: 100%; min-width: 0; }
textarea.px-input { min-height: 90px; resize: vertical; padding: 9px 10px; line-height: 1.5; }
.control-line > textarea.calendar { min-height: 150px; font-family: var(--px-font-mono); }
.toggle { display: inline-flex; align-items: center; gap: 10px; min-height: 32px; }
.toggle .px-switch { padding: 4px 0; }
.setting-key { color: var(--px-muted-fg); font: 11px var(--px-font-mono); margin: 12px 0 0; overflow-wrap: anywhere; }
.field-note, .resolved, .warning, .field-error { line-height: 1.55; margin: 9px 0 0; white-space: pre-line; overflow-wrap: anywhere; }
.field-note, .resolved { color: var(--px-muted-fg); }
.warning { color: var(--vscode-editorWarning-foreground, #c99439); }
.field-error { color: var(--vscode-errorForeground, #f48771); }
details { margin-top: 10px; color: var(--px-muted-fg); line-height: 1.6; }
summary { cursor: pointer; width: fit-content; }
details p { white-space: pre-line; }
footer { border-top: 1px solid var(--px-border); padding: 8px 20px; display: flex; flex-wrap: wrap; align-items: center; gap: 12px; min-height: 38px; }
#notice { color: var(--px-muted-fg); flex: 1; }
#notice.error { color: var(--vscode-errorForeground, #f48771); }
:focus-visible { outline: 2px solid var(--px-ring); outline-offset: 3px; }
@media (max-width: 680px) {
 header { padding: 14px 16px 10px; } #content { padding: 18px 16px 30px; }
 #query { flex-basis: 100%; } .toolbar { gap: 8px 12px; }
 .toolbar-label { flex: 1 1 130px; } .toolbar-label .px-select { flex: 1; }
 nav { flex-wrap: nowrap; overflow-x: auto; padding: 3px 0; }
 nav .px-btn { flex-shrink: 0; } .heading { margin-bottom: 12px; }
 .setting { padding: 16px; } footer { padding: 8px 16px; gap: 6px 10px; }
 #notice { flex-basis: 100%; }
}
</style></head><body><div id="app">
<header><div class="heading">${icon("settings")}<div><h1>Toolkit Settings</h1><p id="game">Loading settings…</p></div></div>
<div class="toolbar"><input class="px-input" id="query" type="search" placeholder="Search settings" aria-label="Search settings">
<label class="toolbar-label" for="filter">Show <select class="px-select" id="filter"><option value="all">All settings</option><option value="changed">Changed here</option><option value="drafts">Unsaved drafts</option></select></label>
<label class="toolbar-label" for="sort">Sort <select class="px-select" id="sort"><option value="default">Default order</option><option value="name">Name</option><option value="changed">Changed first</option></select></label>
<label class="toolbar-label" for="scope">Save to <select class="px-select" id="scope" aria-label="Settings scope"></select></label></div>
<nav id="categories" aria-label="Settings categories"></nav></header>
<main id="content" tabindex="-1"><div class="content-inner" id="rows"></div></main>
<footer><span id="notice" role="status" aria-live="polite">Loading settings…</span><button class="px-btn" data-variant="ghost" id="refresh">Refresh status</button><button class="px-btn" data-variant="ghost" id="native">VS Code settings ${icon("externalLink")}</button></footer>
</div><script nonce="${nonce}" src="${scriptSrc}"></script></body></html>`;
}
