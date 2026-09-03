/**
 * The Workshop panel page: markup and page-specific styles on top of the
 * shared px-ui stylesheet, no host API. The app (app/main.ts) fills the
 * fields, the translation rows and the statistics at runtime.
 */
import uiCss from "../shared/ui.css";
import { BBPREV_CSS } from "./bbcodeCss";
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
  /* Step strip under the toolbar while a job runs: names, the one in flight, its percent. */
  #progress { display: none; flex: 0 0 auto; padding: 4px 12px 6px; border-bottom: 1px solid var(--px-border); gap: 4px; flex-direction: column; }
  #progress.on { display: flex; }
  #steps { display: flex; align-items: center; gap: 6px; font-size: var(--px-text-xs); color: var(--px-muted-fg); flex-wrap: wrap; }
  #steps .st { display: inline-flex; align-items: center; gap: 4px; }
  #steps .st .px-icon { width: 12px; height: 12px; }
  #steps .st[data-state="done"] { color: var(--px-fg); }
  #steps .st[data-state="on"] { color: var(--px-primary); font-weight: 600; }
  #steps .sep { opacity: 0.5; }
  #steps .msg { margin-left: auto; color: var(--px-fg); }
  #bar { height: 3px; border-radius: 2px; background: var(--px-muted); overflow: hidden; }
  #bar > div { height: 100%; width: 0; background: var(--px-primary); transition: width 200ms linear; }
  #bar.indeterminate > div { width: 30%; animation: busy-slide 1.2s ease-in-out infinite; }
  #main { flex: 1 1 auto; overflow-y: auto; min-height: 0; }
  /* The editor area is usually the window minus the Activity Bar and an open
     Project sidebar (about 1000 to 1500px). One column until both cards get
     about 560px (2 * 560 + gap + padding = 1164px); capped and centered when
     the sidebar is closed. */
  #page {
    max-width: 1400px; margin: 0 auto; padding: 12px 16px 40px;
    display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; align-items: start;
  }
  @media (min-width: 1164px) { #page { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  .section {
    display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; min-width: 0;
    border: 1px solid var(--px-border); border-radius: var(--px-radius-md); background: var(--px-card, transparent);
  }
  .section.wide, #noDescriptor { grid-column: 1 / -1; }
  .section[hidden] { display: none; }
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
  #previewInfo {
    position: absolute; top: 4px; left: 4px; z-index: 1; display: flex;
    padding: 2px; border-radius: var(--px-radius-md); color: var(--px-muted-fg);
    opacity: 0.55; transition: opacity var(--px-ease); cursor: help;
  }
  #previewInfo:hover, #previewInfo:focus-visible { opacity: 1; background: var(--px-muted); }
  #previewInfo .px-icon { width: 13px; height: 13px; }
  #fields { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  /* Stacked label: the label on its own line above the control. */
  .field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .field > .px-label { display: flex; align-items: center; gap: 4px; }
  .field .px-input { width: 100%; }
  .field-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
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
  #note { width: 100%; min-height: 56px; resize: vertical; }
  .section > .px-panel-title { padding: 0; }
  /* Edit | Preview segmented toggle (description and translations). */
  .seg { display: flex; border: 1px solid var(--px-border); border-radius: var(--px-radius-md); overflow: hidden; }
  .seg button {
    border: none; background: none; color: var(--px-muted-fg); font: inherit;
    font-size: var(--px-text-xs); padding: 2px 9px; cursor: pointer;
  }
  .seg button.on { background: var(--px-muted); color: var(--px-fg); }
  /* Editable tag chips. */
  .tag-chip { display: inline-flex; align-items: center; gap: 3px; }
  .tag-chip button { border: none; background: none; color: inherit; cursor: pointer; padding: 0; display: flex; opacity: 0.7; }
  .tag-chip button:hover { opacity: 1; }
  .tag-chip button .px-icon { width: 11px; height: 11px; }
  #tagAdd input { width: 130px; }
${BBPREV_CSS}
  .lang .bbprev { min-height: 90px; }
  /* Upload confirmation modal rows. */
  .modal-rows { display: flex; flex-direction: column; gap: 6px; margin: 4px 0; text-align: left; }
  .modal-rows .pub-row { min-height: 24px; }
  .modal-note {
    border-left: 3px solid var(--px-destructive); padding: 6px 10px; margin-top: 6px;
    color: var(--px-muted-fg); font-size: var(--px-text-xs); text-align: left;
  }
  .modal-line { color: var(--px-muted-fg); font-size: var(--px-text-xs); text-align: left; }
  .gallery { display: flex; flex-wrap: wrap; gap: 8px; }
  .gallery .tile { position: relative; width: 112px; height: 84px; border: 1px solid var(--px-border); border-radius: var(--px-radius); overflow: hidden; background: var(--px-muted); }
  .gallery .tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .gallery .tile .cap { position: absolute; left: 0; right: 0; bottom: 0; padding: 2px 4px; font-size: var(--px-text-xs); background: color-mix(in srgb, var(--px-bg) 80%, transparent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .gallery .tile .rm { position: absolute; top: 2px; right: 2px; }
  .gallery .tile.video { display: flex; align-items: center; justify-content: center; color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  .gallery .tile[draggable="true"] { cursor: grab; }
  .gallery .tile.dragging { opacity: 0.4; }
  .gallery .tile.drop-before { box-shadow: -3px 0 0 var(--px-primary); }
  .gallery .tile.drop-after { box-shadow: 3px 0 0 var(--px-primary); }
  .check-row { display: flex; align-items: flex-start; gap: 6px; font-size: var(--px-text-xs); padding: 2px 0; }
  .check-row[data-level="error"] { color: var(--px-destructive); }
  .check-row[data-level="warn"] { color: var(--px-muted-fg); }
  .dlc-row { display: flex; align-items: center; gap: 8px; padding: 2px 0; font-size: var(--px-text-sm); }
  .dlc-row .own { color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  .req-item { display: flex; align-items: center; gap: 6px; padding: 2px 0; font-size: var(--px-text-sm); }
</style>
</head>
<body>
<div id="app">
  <div id="toolbar">
    <button id="mod" class="px-btn px-dropdown" data-variant="outline" style="width:auto;max-width:420px;min-width:220px" data-tip="Mod this panel manages">${icon("package")}<span class="px-truncate"></span>${icon("chevronDown")}</button>
    <button id="refresh" class="px-btn" data-variant="ghost" data-size="icon" data-tip="Fetch the item's live state from Steam">${icon("rotate")}</button>
    <button id="pull" class="px-btn" data-variant="ghost" data-size="icon" data-tip="Download the listing from Steam into the workshop folder as files." data-tip-wrap>${icon("download")}</button>
    <span id="liveState" class="px-muted px-xs"></span>
    <span class="px-grow"></span>
    <button id="openPage" class="px-btn" data-variant="ghost" data-size="icon" data-tip="Open the item's Workshop page in the browser">${icon("externalLink")}</button>
    <button id="upload" class="px-btn" data-variant="default" data-tip="Upload what is checked under Publish">${icon("cloudUpload")} Upload</button>
    <button id="helpBtn" class="px-btn" data-variant="ghost" data-size="icon" data-tip="How this panel works" data-tip-side="left" aria-label="How this panel works">${icon("circleHelp")}</button>
  </div>
  <div id="busy"><div></div></div>
  <div id="progress">
    <div id="steps"></div>
    <div id="bar"><div></div></div>
  </div>
  <div id="main"><div id="page">

    <div id="noDescriptor">
      <span>${icon("alert")}</span>
      <span class="px-grow">This mod has no descriptor. The Workshop needs one for the title and tags.</span>
      <button id="createDescriptor" class="px-btn" data-variant="outline" data-size="sm">Create Descriptor</button>
    </div>

    <div class="section" id="itemSection">
      <div class="px-panel-title">Item</div>
      <div id="itemGrid">
        <div id="previewBox" style="position:relative">
          <span id="previewInfo" tabindex="0" data-tip="A square image, 512x512 or larger, PNG or JPG, under 1 MB." data-tip-wrap>${icon("alert")}</span>
          <img id="preview" alt="Preview image" hidden />
          <div id="previewEmpty">No preview image.<br/>Add a thumbnail.png to the mod.</div>
          <span id="previewName" class="px-muted px-xs px-truncate"></span>
          <button id="changePreview" class="px-btn" data-variant="ghost" data-size="sm" data-tip="Pick a new preview image, copied into the mod.">${icon("image")} Change…</button>
        </div>
        <div id="fields">
          <div class="field">
            <span class="px-label">Title</span>
            <input id="title" class="px-input" spellcheck="false" data-tip="The item's title, from the descriptor. Editing here writes it." />
          </div>
          <div class="field-pair">
            <div class="field">
              <span class="px-label">Mod version</span>
              <input id="version" class="px-input" spellcheck="false" data-tip="Your mod's own version, from the descriptor." data-tip-wrap />
            </div>
            <div class="field">
              <span class="px-label">Game version</span>
              <input id="supported" class="px-input" spellcheck="false" data-tip="The game version the mod declares it works with." data-tip-wrap />
            </div>
          </div>
          <div class="field">
            <span class="px-label">Visibility</span>
            <button id="visibility" class="px-btn px-dropdown" data-variant="outline" style="width:auto;min-width:180px;align-self:flex-start"><span></span>${icon("chevronDown")}</button>
          </div>
          <div class="field">
            <span class="px-label">Tags</span>
            <div id="tags" style="align-items:center"></div>
          </div>
          <div class="field">
            <span class="px-label">Files
              <button id="filesInfo" class="px-btn" data-variant="ghost" data-size="icon-xs" aria-label="Where the listing files live" data-tip="The listing lives in .px-toolkit/workshop inside the mod. The px.workshop.dir setting moves it." data-tip-wrap>${icon("info")}</button>
            </span>
            <div id="filesBox" class="px-row" style="gap:6px;align-items:center;min-width:0"></div>
          </div>
          <div class="field">
            <span class="px-label">Item</span>
            <div id="itemIdBox" class="px-row" style="gap:6px;align-items:center"></div>
          </div>
          <div id="itemMeta"></div>
        </div>
      </div>
      <div id="statsSection" hidden><div id="stats"></div></div>
    </div>
    <div class="section">
      <div class="px-panel-title">Publish</div>
      <div id="checks" style="margin-bottom:6px"></div>
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
        <div class="field" style="margin-top:4px">
          <span class="px-label">Changenote</span>
          <textarea id="note" class="px-textarea" spellcheck="false" placeholder="Shown on the item's Change Notes tab"></textarea>
          <div class="hintline">
            <button id="noteSourceBtn" class="px-btn px-dropdown" data-variant="ghost" data-size="sm" style="width:auto;max-width:340px">${icon("fileText")}<span class="px-truncate"></span>${icon("chevronDown")}</button>
            <span class="px-grow"></span>
            <button id="noteHelp" class="px-btn" data-variant="ghost" data-size="icon-xs" aria-label="How changenotes work" data-tip="Type a changenote, or fill it from your changelog or last commit." data-tip-wrap data-tip-side="left">${icon("circleHelp")}</button>
          </div>
        </div>
      </div>
    </div>
    <div class="section" id="previewsSection">
      <div class="px-panel-title">Previews</div>
      <div id="previewsHint" class="px-muted px-xs" style="margin-bottom:6px"></div>
      <div id="gallery" class="gallery"></div>
      <div class="hintline" style="margin-top:6px">
        <button id="addPreviews" class="px-btn" data-variant="outline" data-size="sm" data-tip="Copy images into the previews folder of the listing. Under 1 MB each; Steam shows them in file-name order." data-tip-wrap>${icon("plus")} Add images</button>
        <button id="openPreviews" class="px-btn" data-variant="ghost" data-size="sm" data-tip="Open the previews folder. Reorder by renaming, remove by deleting." data-tip-wrap>${icon("folderOpen")} Folder</button>
      </div>
      <div class="field" style="margin-top:8px">
        <span class="px-label">Videos</span>
        <input id="videos" class="px-input" spellcheck="false" placeholder="YouTube links or ids, comma separated" data-tip="Saved to previews/videos.txt. Enter or leaving the field writes it." data-tip-wrap />
      </div>
    </div>
    <div class="section" id="requirementsSection">
      <div class="px-panel-title">Requirements</div>
      <div class="px-label" style="margin-bottom:4px">Required DLC</div>
      <div id="dlcBox"></div>
      <div class="px-label" style="margin:10px 0 4px">Required items</div>
      <div id="itemsBox"></div>
      <div class="field" style="margin-top:6px">
        <span class="px-label">Add a required item</span>
        <div class="px-row" style="gap:6px;align-items:center">
          <input id="itemIdInput" class="px-input" spellcheck="false" placeholder="Workshop id or link, then Enter" style="flex:1 1 auto;min-width:0;max-width:320px" />
          <button id="addItem" class="px-btn px-dropdown" data-variant="outline" data-size="sm" style="width:auto;flex:0 0 auto" data-tip="Pick an installed Workshop mod">${icon("plus")} Installed${icon("chevronDown")}</button>
        </div>
      </div>
    </div>
    <div class="section wide">
      <div class="px-panel-title">Description
        <span class="px-grow"></span>
        <div class="seg" id="descMode" data-tip="Preview renders the BBCode roughly as the Workshop page will.">
          <button data-mode="edit" class="on">Edit</button>
          <button data-mode="preview">Preview</button>
        </div>
      </div>
      <textarea id="desc" class="px-textarea" spellcheck="false" placeholder="The item's description, in Steam's BBCode ([h1], [b], [list], [url=…])."></textarea>
      <div id="descPreview" class="bbprev" hidden></div>
      <div class="hintline">
        <span>Saved to description.bbcode as you type; goes to Steam on Upload.</span>
        <span class="px-grow"></span>
        <button id="openDescFile" class="px-btn" data-variant="ghost" data-size="sm" data-tip="Open the workshop folder's description.bbcode in the editor">${icon("pencil")} Open file</button>
        <button id="reloadLocal" class="px-btn" data-variant="ghost" data-size="sm" data-tip="Re-read the description and translations from the local files" data-tip-wrap>${icon("rotate")} Reload</button>
        <button id="pullDesc" class="px-btn" data-variant="ghost" data-size="sm" data-tip="Replace the draft with the description currently on Steam" disabled>${icon("arrowDown")} Fetch from Steam</button>
      </div>
    </div>
    <div class="section wide">
      <div class="px-panel-title">${icon("globe")} Translations
        <span class="px-grow"></span>
        <button id="addLang" class="px-btn" data-variant="outline" data-size="sm">${icon("plus")} Add language</button>
      </div>
      <div class="hintline"><span>Title and description shown to Workshop visitors browsing Steam in that language. The default text above is what everyone else sees.</span></div>
      <div id="translations"></div>
    </div>








  </div></div>
</div>
<script nonce="${nonce}" src="${scriptSrc}"></script>
</body>
</html>`;
}
