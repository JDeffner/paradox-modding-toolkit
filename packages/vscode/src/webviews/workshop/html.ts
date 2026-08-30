/**
 * The Workshop panel page: markup and page-specific styles on top of the
 * shared px-ui stylesheet, no host API. The app (app/main.ts) fills the
 * fields, the translation rows and the statistics at runtime.
 */
import uiCss from "../shared/ui.css";
import { icon } from "../shared/icons";

export interface WorkshopHtmlOptions {
  scriptSrc: string;
  nonce: string;
  csp: string;
}

export function workshopHtml({ scriptSrc, nonce, csp }: WorkshopHtmlOptions): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>Steam Workshop</title>
<style>
${uiCss}
  body { overflow: hidden; }
  #app { display: flex; flex-direction: column; height: 100%; }
  #toolbar {
    display: flex; align-items: center; gap: 6px; flex: 0 0 auto;
    padding: 6px 8px; border-bottom: 1px solid var(--px-border);
  }
  #toolbar .px-grow { flex: 1 1 auto; }
  /* Indeterminate activity line under the toolbar while the bridge runs. */
  #busy { height: 2px; flex: 0 0 auto; overflow: hidden; visibility: hidden; }
  #busy.on { visibility: visible; }
  #busy > div {
    height: 100%; width: 30%; background: var(--px-primary); border-radius: 1px;
    animation: busy-slide 1.2s ease-in-out infinite;
  }
  @keyframes busy-slide {
    0% { transform: translateX(-110%); }
    100% { transform: translateX(440%); }
  }
  #main { flex: 1 1 auto; overflow-y: auto; min-height: 0; }
  #page { max-width: 760px; margin: 0 auto; padding: 12px 16px 40px; display: flex; flex-direction: column; gap: 10px; }
  .section { display: flex; flex-direction: column; gap: 8px; padding: 10px 0; }
  .section + .section { border-top: 1px solid var(--px-border); }
  #noDescriptor { display: none; flex-direction: row; align-items: center; gap: 10px; padding: 12px;
    border: 1px solid var(--px-border); border-radius: var(--px-radius-md); }
  #noDescriptor.on { display: flex; }
  #itemGrid { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 14px; align-items: start; }
  #previewBox { display: flex; flex-direction: column; gap: 4px; align-items: center; }
  #preview {
    width: 168px; height: 168px; object-fit: cover; border-radius: var(--px-radius-md);
    background: var(--px-muted); border: 1px solid var(--px-border);
  }
  #preview[hidden] { display: none; }
  #previewEmpty {
    width: 168px; height: 168px; display: flex; align-items: center; justify-content: center;
    text-align: center; padding: 12px; border: 1px dashed var(--px-border); border-radius: var(--px-radius-md);
    color: var(--px-muted-fg); font-size: var(--px-text-xs);
  }
  #previewName { max-width: 168px; }
  #fields { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .field-row { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 8px; align-items: center; }
  .field-row > .px-label { text-align: right; }
  .field-row .px-input { width: 100%; }
  #tags { display: flex; flex-wrap: wrap; gap: 4px; }
  #itemMeta { color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  #stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(108px, 1fr)); gap: 6px; }
  .stat {
    display: flex; flex-direction: column; gap: 2px; padding: 8px 10px;
    border: 1px solid var(--px-border); border-radius: var(--px-radius-md);
  }
  .stat .v { font-size: 16px; font-weight: 600; }
  .stat .k { display: flex; align-items: center; gap: 4px; color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  .stat .k .px-icon { width: 12px; height: 12px; }
  #desc { min-height: 170px; width: 100%; resize: vertical; font-family: var(--vscode-editor-font-family, monospace); }
  .hintline { display: flex; align-items: center; gap: 8px; color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  .hintline .px-grow { flex: 1 1 auto; }
  #langGate { display: none; align-items: center; gap: 6px; padding: 8px 10px;
    border: 1px solid var(--px-border); border-radius: var(--px-radius-md);
    color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  #langGate.on { display: flex; }
  #translations { display: flex; flex-direction: column; gap: 6px; }
  .lang { border: 1px solid var(--px-border); border-radius: var(--px-radius-md); }
  .lang > .head {
    display: flex; align-items: center; gap: 6px; padding: 4px 6px 4px 10px; cursor: pointer; user-select: none;
  }
  .lang > .head .px-icon.caret { transition: transform var(--px-ease); }
  .lang[data-collapsed] > .head .px-icon.caret { transform: rotate(-90deg); }
  .lang > .head .state { color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  .lang > .body { display: flex; flex-direction: column; gap: 6px; padding: 0 10px 10px; }
  .lang[data-collapsed] > .body { display: none; }
  .lang .px-input { width: 100%; }
  .lang textarea { min-height: 90px; width: 100%; resize: vertical; font-family: var(--vscode-editor-font-family, monospace); }
  .lang .livehint { display: flex; align-items: baseline; gap: 6px; color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  .lang .livehint .text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  #publishRows { display: flex; flex-direction: column; gap: 6px; }
  .pub-row { display: flex; align-items: center; gap: 10px; min-height: 26px; }
  .pub-row .lbl { min-width: 0; }
  .pub-row .sub { color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  #note { width: 100%; }
  .section > .px-panel-title { padding: 0; }
</style>
</head>
<body>
<div id="app">
  <div id="toolbar">
    <button id="mod" class="px-btn px-dropdown" data-variant="outline" style="width:auto;max-width:320px;min-width:160px" data-tip="Mod this panel manages">${icon("package")}<span class="px-truncate"></span>${icon("chevronDown")}</button>
    <button id="refresh" class="px-btn" data-variant="ghost" data-size="icon" data-tip="Fetch the item's live state from Steam">${icon("rotate")}</button>
    <span id="liveState" class="px-muted px-xs"></span>
    <span class="px-grow"></span>
    <button id="openPage" class="px-btn" data-variant="ghost" data-size="icon" data-tip="Open the item's Workshop page in the browser">${icon("externalLink")}</button>
    <button id="upload" class="px-btn" data-variant="default" data-tip="Upload what is checked under Publish">${icon("cloudUpload")} Upload</button>
  </div>
  <div id="busy"><div></div></div>
  <div id="main"><div id="page">

    <div id="noDescriptor">
      <span>${icon("alert")}</span>
      <span class="px-grow">This mod has no descriptor. The Workshop needs one for the title and tags.</span>
      <button id="createDescriptor" class="px-btn" data-variant="outline" data-size="sm">Create Descriptor</button>
    </div>

    <div class="section" id="itemSection">
      <div class="px-panel-title">Item</div>
      <div id="itemGrid">
        <div id="previewBox">
          <img id="preview" alt="Preview image" hidden />
          <div id="previewEmpty">No preview image.<br/>Add a thumbnail.png to the mod.</div>
          <span id="previewName" class="px-muted px-xs px-truncate"></span>
        </div>
        <div id="fields">
          <div class="field-row">
            <span class="px-label">Title</span>
            <input id="title" class="px-input" readonly data-tip="The descriptor's name= is the item's title. Edit it in the descriptor; translated titles live below." />
          </div>
          <div class="field-row">
            <span class="px-label">Visibility</span>
            <button id="visibility" class="px-btn px-dropdown" data-variant="outline" style="width:auto;min-width:180px"><span></span>${icon("chevronDown")}</button>
          </div>
          <div class="field-row">
            <span class="px-label">Tags</span>
            <div id="tags"></div>
          </div>
          <div class="field-row">
            <span class="px-label">Item</span>
            <div id="itemIdBox" class="px-row" style="gap:6px;align-items:center"></div>
          </div>
          <div class="field-row">
            <span class="px-label"></span>
            <div id="itemMeta"></div>
          </div>
        </div>
      </div>
    </div>

    <div class="section" id="statsSection" hidden>
      <div class="px-panel-title">Statistics</div>
      <div id="stats"></div>
    </div>

    <div class="section">
      <div class="px-panel-title">Description</div>
      <textarea id="desc" class="px-textarea" spellcheck="false" placeholder="The item's description, in Steam's BBCode ([h1], [b], [list], [url=…])."></textarea>
      <div class="hintline">
        <span>Saved locally to the mod's workshop.json as you type; goes to Steam on Upload.</span>
        <span class="px-grow"></span>
        <button id="pullDesc" class="px-btn" data-variant="ghost" data-size="sm" data-tip="Replace the draft with the description currently on Steam" disabled>${icon("arrowDown")} Fetch from Steam</button>
      </div>
    </div>

    <div class="section">
      <div class="px-panel-title">${icon("globe")} Translations
        <span class="px-grow"></span>
        <button id="addLang" class="px-btn" data-variant="outline" data-size="sm">${icon("plus")} Add language</button>
      </div>
      <div class="hintline"><span>Title and description shown to Workshop visitors browsing Steam in that language. The default text above is what everyone else sees.</span></div>
      <div id="langGate">${icon("alert")}<span id="langGateText"></span></div>
      <div id="translations"></div>
    </div>

    <div class="section">
      <div class="px-panel-title">Publish</div>
      <div id="publishRows">
        <div class="pub-row">
          <label class="px-switch"><input id="incContent" type="checkbox" checked /><span></span></label>
          <span class="lbl">Mod files <span class="sub">- upload the mod's content</span></span>
        </div>
        <div class="pub-row">
          <label class="px-switch"><input id="incDetails" type="checkbox" checked /><span></span></label>
          <span class="lbl">Details <span class="sub">- title, description, visibility, tags, preview image</span></span>
        </div>
        <div class="pub-row">
          <label class="px-switch"><input id="incLangs" type="checkbox" checked /><span></span></label>
          <span class="lbl">Translations <span id="langCount" class="sub"></span></span>
        </div>
        <div class="field-row" style="grid-template-columns: 92px minmax(0,1fr)">
          <span class="px-label">Changenote</span>
          <input id="note" class="px-input" spellcheck="false" placeholder="Shown on the item's Change Notes tab" />
        </div>
      </div>
    </div>

  </div></div>
</div>
<script nonce="${nonce}" src="${scriptSrc}"></script>
</body>
</html>`;
}
