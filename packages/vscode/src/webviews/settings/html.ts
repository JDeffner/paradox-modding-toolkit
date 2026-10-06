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
.detail-toggle { margin-left: auto; display: flex; align-items: center; gap: 9px; cursor: pointer; color: var(--px-muted-fg); }
#show-details:indeterminate + span::after { transform: translateX(7px); }
h1 { margin: 0; font-size: 21px; font-weight: 600; letter-spacing: -.3px; }
#game { margin: 3px 0 0; color: var(--px-muted-fg); }
.toolbar { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; }
#query { flex: 1 1 240px; min-width: 0; }
.toolbar-label { display: flex; align-items: center; gap: 8px; color: var(--px-muted-fg); white-space: nowrap; min-width: 0; }
.toolbar-label .px-dropdown { min-width: 0; max-width: 240px; }
nav { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 4px; }
nav .px-btn { min-height: 34px; gap: 8px; }
nav .px-btn[aria-current="page"] { background: var(--px-muted); font-weight: 600; }
nav .count { color: var(--px-muted-fg); font-size: 11px; }
#content { min-width: 0; min-height: 0; overflow: auto; padding: 24px 24px 40px; scroll-behavior: smooth; }
.content-inner { max-width: 1200px; margin: 0 auto; }
.settings-grid { border: 1px solid var(--px-border); border-radius: var(--px-radius); overflow: clip; margin-bottom: 28px; }
.settings-grid:empty { display: none; }
.group-heading { display: flex; align-items: baseline; gap: 12px; margin: 28px 0 10px; }
.group-heading h3 { margin: 0; font-size: 15px; font-weight: 600; }
.group-heading > span { color: var(--px-muted-fg); font-size: var(--px-text-xs); }
h2 { font-size: 18px; font-weight: 600; margin: 0 0 6px; }
.intro { color: var(--px-muted-fg); line-height: 1.6; margin: 0 0 20px; max-width: 70ch; }
.health { background: var(--px-muted); border: 1px solid var(--px-border); border-radius: var(--px-radius); padding: 14px 16px; margin-bottom: 20px; line-height: 1.6; }
.health summary { font-weight: 500; color: var(--px-fg); }
.health p { margin: 4px 0; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.action-note { color: var(--px-muted-fg); margin: 0 0 22px; font-size: var(--px-text-xs); }
.setting { min-width: 0; padding: 7px 14px 7px 8px; display: grid; grid-template-columns: 28px minmax(0, 1fr) minmax(0, 1.25fr); column-gap: 12px; align-items: center; background: var(--px-popover); }
.setting.is-expanded { padding-top: 16px; padding-bottom: 16px; align-items: start; }
.setting + .setting { border-top: 1px solid var(--px-border); }
.setting:focus-within { background: var(--px-muted); }
.setting-copy, .setting-editor { min-width: 0; }
.row-expander.px-btn { padding: 0; width: 28px; min-height: 30px; color: var(--px-muted-fg); }
.row-expander .px-icon { width: 12px; height: 12px; }
.setting.is-expanded .row-expander { margin-top: -5px; }
.setting-help.px-btn { padding: 2px; min-height: 22px; width: 22px; color: var(--px-muted-fg); }
.setting-help .px-icon { width: 14px; height: 14px; }
.setting-source { color: var(--px-muted-fg); font-size: var(--px-text-xs); margin: 3px 0 0; line-height: 1.45; }
.destination-row { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; margin-top: 14px; font-size: var(--px-text-xs); color: var(--px-muted-fg); }
.destination-row .px-dropdown { max-width: 100%; font-size: var(--px-text-xs); }
.active-value { margin: 0 0 7px; font-size: var(--px-text-xs); line-height: 1.55; overflow-wrap: anywhere; }
.resume-draft.px-btn { margin-top: 5px; font-size: var(--px-text-xs); }
.setting.is-disabled .setting-head label { color: var(--px-muted-fg); }
.draft-badge { display: none; color: var(--px-fg); font-size: 10px; font-weight: 600; }
.setting.has-draft .draft-badge { display: inline; }
.setting-head { display: flex; gap: 5px 8px; align-items: center; flex-wrap: wrap; }
.setting-head label { font-size: 13px; font-weight: 500; cursor: pointer; }
.setting.is-expanded .setting-head label { font-weight: 600; }
.setting-head .px-badge { font-size: 10px; padding: 1px 6px; background: transparent; color: var(--px-muted-fg); border-color: var(--px-border); }
.setting [hidden] { display: none !important; }
.description { margin: 7px 0 0; color: var(--px-muted-fg); line-height: 1.65; max-width: 65ch; white-space: pre-line; }
.setting code { font-family: var(--px-font-mono); font-size: .92em; background: var(--px-muted); padding: 1px 4px; border-radius: 3px; overflow-wrap: anywhere; }
.control-line { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.control-line > input:not([type="checkbox"]), .control-line > .px-dropdown, .value-summary { flex: 1 1 140px; min-width: 0; }
.value-summary { justify-content: space-between; color: var(--px-muted-fg); }
.control-line > textarea { width: 100%; min-width: 0; }
.control-line > input[type="text"] { font-family: var(--px-font-mono); font-size: 12px; }
.setting-choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); width: 100%; gap: 6px; }
.setting-choice { display: flex; flex-direction: column; gap: 5px; padding: 11px 12px; text-align: left; font: inherit; line-height: 1.5; color: var(--px-fg); border: 1px solid var(--px-border); border-radius: var(--px-radius-md); background: transparent; cursor: pointer; }
.setting-choice:hover:not(:disabled) { background: var(--px-muted); }
.setting-choice[aria-checked="true"] { background: var(--px-muted-strong); }
.setting-choice[aria-checked="true"] .choice-label { font-weight: 650; }
.choice-label { display: flex; align-items: center; gap: 8px; }
.choice-label::before { content: ''; box-sizing: border-box; flex-shrink: 0; width: 12px; height: 12px; border: 1px solid currentColor; border-radius: 50%; }
.setting-choice[aria-checked="true"] .choice-label::before { background: var(--px-fg); box-shadow: inset 0 0 0 3px var(--px-muted-strong); }
.choice-description { color: var(--px-muted-fg); font-size: var(--px-text-sm); }
.setting-choice:disabled { cursor: default; opacity: .55; }
textarea.px-input { min-height: 90px; resize: vertical; padding: 9px 10px; line-height: 1.5; }
.control-line > textarea.calendar { min-height: 150px; font-family: var(--px-font-mono); }
.toggle { display: inline-flex; align-items: center; gap: 10px; min-height: 32px; }
.toggle .px-switch { padding: 4px 0; }
.setting-key { color: var(--px-muted-fg); font: 10px var(--px-font-mono); margin: 10px 0 0; overflow-wrap: anywhere; }
.field-note, .resolved, .warning, .field-error { line-height: 1.55; margin: 9px 0 0; white-space: pre-line; overflow-wrap: anywhere; }
.field-note, .resolved { color: var(--px-muted-fg); }
.warning { color: var(--px-fg); display: flex; gap: 8px; }
.warning::before { content: '!'; font-weight: 700; }
.field-error { color: var(--px-destructive); }
.extra-help summary { display: flex; align-items: center; gap: 5px; list-style: none; font-size: var(--px-text-xs); }
.extra-help summary::-webkit-details-marker { display: none; }
.extra-help summary .px-icon { width: 14px; height: 14px; }
.extra-help[open] summary { color: var(--px-fg); }
details { margin-top: 10px; color: var(--px-muted-fg); line-height: 1.6; }
summary { cursor: pointer; width: fit-content; }
details p { white-space: pre-line; }
footer { border-top: 1px solid var(--px-border); padding: 8px 20px; display: flex; flex-wrap: wrap; align-items: center; gap: 12px; min-height: 38px; }
#notice { color: var(--px-muted-fg); flex: 1; }
#notice.error { color: var(--px-destructive); }
#draft-count { color: var(--px-fg); font-weight: 500; }
:focus-visible { outline: 2px solid var(--px-ring); outline-offset: 3px; }
@media (max-width: 900px) {
 .setting.is-expanded { grid-template-columns: 28px minmax(0, 1fr); row-gap: 12px; }
 .setting.is-expanded .setting-editor { grid-column: 2; }
 .setting-choices { grid-template-columns: repeat(auto-fit, minmax(145px, 1fr)); }
}
@media (prefers-reduced-motion: reduce) { #content { scroll-behavior: auto; } }
@media (max-width: 680px) {
 header { padding: 14px 16px 10px; } #content { padding: 18px 16px 30px; }
 #query { flex-basis: 100%; } .toolbar { gap: 8px 12px; }
 .toolbar-label { flex: 1 1 130px; } .toolbar-label .px-dropdown { flex: 1; }
 nav { flex-wrap: nowrap; overflow-x: auto; padding: 3px 0; }
 nav .px-btn { flex-shrink: 0; } .heading { margin-bottom: 12px; }
 .heading { flex-wrap: wrap; gap: 10px; } .detail-toggle { font-size: var(--px-text-xs); }
 .setting { column-gap: 8px; } footer { padding: 8px 16px; gap: 6px 10px; }
 #notice { flex-basis: 100%; }
}
@media (max-width: 520px) {
 .heading > .px-icon { display: none; }
 h1 { font-size: 18px; }
 .setting { grid-template-columns: 24px minmax(0, 1fr); row-gap: 5px; }
 .setting-editor { grid-column: 2; }
 .setting-head { min-height: 28px; }
 .row-expander.px-btn { width: 24px; }
}
</style></head><body><div id="app">
<header><div class="heading">${icon("settings")}<div><h1>Toolkit Settings</h1><p id="game">Loading settings…</p></div><label class="detail-toggle"><span class="px-switch"><input id="show-details" type="checkbox"><span aria-hidden="true"></span></span>Show all details</label></div>
<div class="toolbar"><input class="px-input" id="query" type="search" placeholder="Search settings" aria-label="Search settings">
<label class="toolbar-label" for="filter">Show <button type="button" class="px-btn px-dropdown" data-variant="outline" id="filter" aria-label="Show settings"></button></label>
<label class="toolbar-label" for="sort">Sort <button type="button" class="px-btn px-dropdown" data-variant="outline" id="sort" aria-label="Sort settings"></button></label>
<label class="toolbar-label" for="scope">Settings for <button type="button" class="px-btn px-dropdown" data-variant="outline" id="scope" aria-label="Settings context"></button></label></div>
<nav id="categories" aria-label="Settings categories"></nav></header>
<main id="content" tabindex="-1"><div class="content-inner" id="rows"></div></main>
<footer><span id="notice" role="status" aria-live="polite">Loading settings…</span><span id="draft-count" aria-live="polite"></span><button class="px-btn" data-variant="secondary" id="save-drafts" hidden>Save all drafts</button><button class="px-btn" data-variant="ghost" id="refresh">Refresh status</button><button class="px-btn" data-variant="ghost" id="native">VS Code settings ${icon("externalLink")}</button></footer>
</div><script nonce="${nonce}" src="${scriptSrc}"></script></body></html>`;
}
