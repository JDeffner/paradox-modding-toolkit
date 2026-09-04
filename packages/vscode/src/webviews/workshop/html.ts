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
  /* Inline job progress in the toolbar: the step in flight and a slim bar.
     Fixed height (the toolbar's line) so nothing below moves. */
  #jobProgress { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 0 1 380px; font-size: var(--px-text-xs); color: var(--px-muted-fg); }
  #jobProgress[hidden] { display: none; }
  #jobProgress .step { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  #jobProgress .count { flex: 0 0 auto; color: var(--px-fg); }
  #jobProgress .bar { flex: 0 0 120px; height: 3px; border-radius: 2px; background: var(--px-muted); overflow: hidden; }
  #jobProgress .bar > span { display: block; height: 100%; width: 0; background: var(--px-primary); transition: width 200ms linear; }
  #jobProgress .bar[data-indeterminate] > span { width: 30%; animation: busy-slide 1.2s ease-in-out infinite; }
  /* Vertical only: overflow-y auto alone would make the x axis auto too,
     so anything too wide for the pane would scroll the whole page sideways.
     Every wide thing (preview tables, code blocks) scrolls in its own box. */
  #main { flex: 1 1 auto; overflow-y: auto; overflow-x: hidden; min-height: 0; }
  /* The editor area is usually the window minus the Activity Bar and an open
     Project sidebar (about 1000 to 1500px). One column until both cards get
     about 560px (2 * 560 + gap + padding = 1164px); capped and centered when
     the sidebar is closed. */
  #page {
    max-width: 1400px; margin: 0 auto; padding: 12px 16px 40px;
    display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; align-items: start;
  }
  @media (min-width: 1164px) {
    #page { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    /* The tall Item card on the left; Publish, Mod files and Changenote stack beside it. */
    #itemSection { grid-row: span 3; }
    #modFilesSection, #noteSection { grid-column: 2; }
  }
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
  #itemIdent { align-self: stretch; display: flex; flex-direction: column; gap: 4px; margin-top: 6px; max-width: 168px; }
  /* One row, always: the tiles shrink and their labels truncate before anything wraps. */
  #stats { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 4px; }
  .stat {
    display: flex; flex-direction: column; gap: 1px; padding: 5px 7px; min-width: 0;
    border: 1px solid var(--px-border); border-radius: var(--px-radius-md);
  }
  .stat .v { font-size: 14px; font-weight: 600; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .stat .k { display: flex; align-items: center; gap: 3px; color: var(--px-muted-fg); font-size: var(--px-text-xs); min-width: 0; }
  .stat .k .px-icon { width: 11px; height: 11px; flex: 0 0 auto; }
  .stat .k .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* Wraps: the buttons never shrink (nowrap), so a narrow pane has to move
     them to their own line rather than push the card past the page. */
  .hintline { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  .hintline .px-grow { flex: 1 1 auto; min-width: 0; }
  .hintline .hint { min-width: 0; }
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
  #publishRows { display: flex; flex-direction: column; gap: 8px; }
  .pub-row { display: flex; align-items: center; gap: 10px; min-height: 26px; }
  .pub-row .lbl { min-width: 0; }
  .pub-row .sub { color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  /* A card with a publish switch in its title row: off = the body dimmed,
     inert, and a "Not uploaded" chip beside the switch. */
  .hdr-switch { display: inline-flex; align-items: center; gap: 6px; font-weight: 400; font-size: var(--px-text-xs); color: var(--px-muted-fg); text-transform: none; letter-spacing: 0; cursor: pointer; }
  .hdr-switch .px-switch { transform: scale(0.85); }
  .off-chip { display: none; flex: 0 0 auto; text-transform: none; letter-spacing: 0; font-weight: 400; }
  .section[data-off] .px-panel-title .off-chip { display: inline-flex; }
  /* Off means "not uploaded", not locked: the body dims but stays editable. */
  .section[data-off] > :not(.px-panel-title) { opacity: 0.55; }
  .lang > .head .px-switch { transform: scale(0.85); margin-right: 2px; }
  .lang[data-off] > .body, .lang[data-off] > .head > .caret, .lang[data-off] > .head > .name { opacity: 0.55; }
  #publishSummary { font-size: var(--px-text-sm); }
  #publishSummary .sub { color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  #modRoot { font-family: var(--vscode-editor-font-family, monospace); font-size: var(--px-text-xs); }
  .lang-row { display: flex; align-items: center; gap: 8px; padding-left: 2px; min-height: 22px; font-size: var(--px-text-sm); }
  .lang-row[data-off] { opacity: 0.55; }
  .lang-row .px-switch { transform: scale(0.85); transform-origin: left center; }
  #enableAllBox { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  #enableAllConfirm { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 6px 10px; border-left: 3px solid var(--px-destructive); font-size: var(--px-text-xs); color: var(--px-muted-fg); }
  #enableAllConfirm[hidden] { display: none; }
  #note { width: 100%; min-height: 56px; resize: vertical; }
  /* The changenote's three sources: the picked one's body is the only one shown. */
  #noteSeg { align-self: flex-start; }
  #noteChangelog, #noteCommit, #noteWrite { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  /* A commit subject is one line: no scroll window, no grip. */
  #noteCommit .bbprev { min-height: 0; height: auto; resize: none; }
  .section > .px-panel-title { padding: 0; }
  /* Editable tag chips. */
  .tag-chip { display: inline-flex; align-items: center; gap: 3px; }
  .tag-chip button { border: none; background: none; color: inherit; cursor: pointer; padding: 0; display: flex; opacity: 0.7; }
  .tag-chip button:hover { opacity: 1; }
  .tag-chip button .px-icon { width: 11px; height: 11px; }
  #tagAdd input { width: 130px; }
${BBPREV_CSS}
  /* A starting height, not the final one: the reader drags the bottom edge
     down for more. The description gets the taller start, a language row the
     shorter one, and each can be dragged back to its min-height. */
  #descPreview { height: 220px; }
  .lang .bbprev, #noteChangelog .bbprev { min-height: 90px; height: 160px; }
  /* The description files are edited in the editor: an empty one says so. */
  .bbprev.empty { color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  /* Upload confirmation modal rows. */
  .modal-rows { display: flex; flex-direction: column; gap: 6px; margin: 4px 0; text-align: left; }
  .modal-rows .pub-row { min-height: 24px; }
  .modal-note {
    border-left: 3px solid var(--px-destructive); padding: 6px 10px; margin-top: 6px;
    color: var(--px-muted-fg); font-size: var(--px-text-xs); text-align: left;
  }
  .modal-line { color: var(--px-muted-fg); font-size: var(--px-text-xs); text-align: left; }
  .gallery { position: relative; display: flex; flex-wrap: wrap; gap: 8px; }
  .gallery .tile { position: relative; width: 112px; height: 84px; border: 1px solid var(--px-border); border-radius: var(--px-radius); overflow: hidden; background: var(--px-muted); }
  .gallery .tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .gallery .tile .cap { position: absolute; left: 0; right: 0; bottom: 0; padding: 2px 4px; font-size: var(--px-text-xs); background: color-mix(in srgb, var(--px-bg) 80%, transparent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .gallery .tile .rm { position: absolute; top: 2px; right: 2px; }
  .gallery .tile.video { display: flex; align-items: center; justify-content: center; color: var(--px-muted-fg); font-size: var(--px-text-xs); cursor: pointer; }
  /* Pointer-driven reorder: the lifted tile follows the pointer above the
     rest, its slot stays as a dashed placeholder, the others slide (FLIP). */
  .gallery .tile[data-name] { cursor: grab; touch-action: none; }
  .gallery .tile.slide { transition: transform 160ms cubic-bezier(0.2, 0, 0, 1); }
  .gallery .tile.lift {
    position: fixed; z-index: 20; margin: 0; cursor: grabbing; pointer-events: none;
    transform: scale(1.03); box-shadow: var(--px-shadow-md); transition: none;
  }
  .gallery .tile.placeholder { border-style: dashed; background: transparent; }
  .gallery .tile.placeholder > * { visibility: hidden; }
  .check-row { display: flex; align-items: flex-start; gap: 6px; font-size: var(--px-text-xs); padding: 2px 0; }
  .check-row[data-level="error"] { color: var(--px-destructive); }
  .check-row[data-level="warn"] { color: var(--px-muted-fg); }
  .dlc-grid { display: grid; grid-template-columns: repeat(auto-fill, 64px); gap: 6px; margin-bottom: 6px; }
  .dlc-tile {
    position: relative; width: 64px; height: 64px; padding: 0; display: flex; align-items: center; justify-content: center;
    border: 1px solid var(--px-border); border-radius: var(--px-radius-md); background: var(--px-muted);
    cursor: pointer; opacity: 0.5; overflow: hidden; color: var(--px-muted-fg);
    transition: opacity var(--px-ease), box-shadow var(--px-ease), border-color var(--px-ease);
  }
  .dlc-tile:hover, .dlc-tile:focus-visible { opacity: 0.85; }
  .dlc-tile[data-on="1"] { opacity: 1; border-color: var(--px-primary); box-shadow: 0 0 0 2px var(--px-primary); }
  .dlc-tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .dlc-tile .cap { font-size: 10px; line-height: 1.2; text-align: center; padding: 3px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
  .dlc-tile .mark {
    position: absolute; top: 3px; right: 3px; width: 16px; height: 16px; border-radius: 50%;
    display: none; align-items: center; justify-content: center;
    background: var(--px-primary); color: var(--px-primary-fg);
  }
  .dlc-tile .mark .px-icon { width: 11px; height: 11px; }
  .dlc-tile[data-on="1"] .mark { display: flex; }
  /* Required items are chips: they fill the row and wrap, rather than one
     mostly empty line each. The name truncates, the tooltip carries it whole. */
  #itemsBox .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 240px; }
  #itemsBox .id { color: var(--px-muted-fg); flex: 0 0 auto; }
</style>
</head>
<body>
<div id="app">
  <div id="toolbar">
    <button id="mod" class="px-btn px-dropdown" data-variant="outline" style="width:auto;max-width:420px;min-width:220px" data-tip="Mod this panel manages">${icon("package")}<span class="px-truncate"></span>${icon("chevronDown")}</button>
    <button id="refresh" class="px-btn" data-variant="ghost" data-size="icon" data-tip="Fetch the item's live state from Steam">${icon("rotate")}</button>
    <button id="pull" class="px-btn" data-variant="ghost" data-size="icon" data-tip="Download the listing from Steam into the workshop folder as files." data-tip-wrap>${icon("download")}</button>
    <span id="liveState" class="px-muted px-xs"></span>
    <span id="jobProgress" hidden><span class="step"></span><span class="count"></span><span class="bar"><span></span></span></span>
    <span class="px-grow"></span>
    <button id="openPage" class="px-btn" data-variant="ghost" data-size="icon" data-tip="Open the item's Workshop page in Steam (in the browser when Steam is not installed)" data-tip-wrap>${icon("externalLink")}</button>
    <button id="upload" class="px-btn" data-variant="default" data-tip="Upload what is checked under Publish">${icon("cloudUpload")} Upload</button>
    <button id="helpBtn" class="px-btn" data-variant="ghost" data-size="icon" data-tip="How this panel works" data-tip-side="left" aria-label="How this panel works">${icon("circleHelp")}</button>
  </div>
  <div id="busy"><div></div></div>
  <div id="main"><div id="page">

    <div id="noDescriptor">
      <span>${icon("alert")}</span>
      <span class="px-grow">This mod has no descriptor. The Workshop needs one for the title and tags.</span>
      <button id="createDescriptor" class="px-btn" data-variant="outline" data-size="sm">Create Descriptor</button>
    </div>

    <div class="section" id="itemSection">
      <div class="px-panel-title">Item
        <span class="px-grow"></span>
        <span class="px-badge off-chip" data-variant="outline">Not uploaded</span>
        <label class="hdr-switch" data-tip="Upload the details: title, description, visibility, tags and the preview image." data-tip-wrap data-tip-side="left">Details <span class="px-switch"><input id="incDetails" type="checkbox" checked /><span></span></span></label>
      </div>
      <div id="itemGrid">
        <div id="previewBox" style="position:relative">
          <span id="previewInfo" tabindex="0" data-tip="A square image, 512x512 or larger, PNG or JPG, under 1 MB." data-tip-wrap>${icon("alert")}</span>
          <img id="preview" alt="Preview image" hidden />
          <div id="previewEmpty">No preview image.<br/>Add a thumbnail.png to the mod.</div>
          <span id="previewName" class="px-muted px-xs px-truncate"></span>
          <button id="changePreview" class="px-btn" data-variant="ghost" data-size="sm" data-tip="Pick a new preview image, copied into the mod.">${icon("image")} Change…</button>
          <div id="itemIdent">
            <span class="px-label">ID</span>
            <div id="itemIdBox" class="px-row" style="gap:6px;align-items:center"></div>
            <div id="itemMeta"></div>
          </div>
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
            <span class="px-label">Files <span id="filesBadge"></span></span>
            <div id="filesBox" class="px-muted px-xs px-truncate"></div>
          </div>
        </div>
      </div>
      <div id="statsSection" hidden><div id="stats"></div></div>
    </div>
    <div class="section">
      <div class="px-panel-title">Publish</div>
      <div id="checks"></div>
      <div id="publishRows">
        <div id="publishSummary"></div>
        <div id="enableAllBox">
          <button id="enableAll" class="px-btn" data-variant="outline" data-size="sm" data-tip="Switch every part on, translations included">${icon("check")} Enable all</button>
          <div id="enableAllConfirm" hidden>
            <span>This uploads every part, including translations and the changenote. Continue?</span>
            <button id="enableAllYes" class="px-btn" data-variant="default" data-size="sm">Yes</button>
            <button id="enableAllNo" class="px-btn" data-variant="ghost" data-size="sm">Cancel</button>
          </div>
        </div>
      </div>
    </div>
    <div class="section" id="modFilesSection">
      <div class="px-panel-title">Mod files
        <span class="px-grow"></span>
        <span class="px-badge off-chip" data-variant="outline">Not uploaded</span>
        <label class="hdr-switch" data-tip="Upload every file of the mod, replacing what subscribers have." data-tip-wrap data-tip-side="left">Upload <span class="px-switch"><input id="incContent" type="checkbox" checked /><span></span></span></label>
      </div>
      <div id="modRoot" class="px-truncate"></div>
      <div class="px-muted px-xs">Everything in the mod folder except the workshop folder and what .pxignore excludes.</div>
    </div>
    <div class="section" id="noteSection">
      <div class="px-panel-title">Changenote
        <span class="px-grow"></span>
        <span class="px-badge off-chip" data-variant="outline">Not uploaded</span>
        <label class="hdr-switch" data-tip="Send the changenote with the upload; it appears on the item's Change Notes tab." data-tip-wrap data-tip-side="left">Upload <span class="px-switch"><input id="incNote" type="checkbox" checked /><span></span></span></label>
      </div>
      <div id="noteSeg" class="px-toggle-group" data-spacing="0">
        <button class="px-toggle" data-variant="outline" data-size="sm" data-src="changelog" data-tip="Send the changelog entry that matches the mod version." data-tip-wrap>Changelog</button>
        <button class="px-toggle" data-variant="outline" data-size="sm" data-src="commit" data-tip="Send the subject of the mod's last git commit." data-tip-wrap>Last commit</button>
        <button class="px-toggle" data-variant="outline" data-size="sm" data-src="write" data-tip="Write a note for this upload only." data-tip-wrap>Write</button>
      </div>
      <div id="noteChangelog"></div>
      <div id="noteCommit"></div>
      <div id="noteWrite">
        <textarea id="note" class="px-textarea" spellcheck="false" placeholder="A note for this upload. BBCode works: [b], [list], [url=…]."></textarea>
        <div class="hintline">
          <span class="hint">Sent with this upload only, not written to a changelog.</span>
          <button id="noteBBCodeHelp" class="px-btn" data-variant="ghost" data-size="icon-xs" aria-label="BBCode help" data-tip="The tags Steam renders">${icon("circleHelp")}</button>
        </div>
      </div>
    </div>
    <div class="section" id="previewsSection">
      <div class="px-panel-title">Previews
        <span class="px-grow"></span>
        <span class="px-badge off-chip" data-variant="outline">Not uploaded</span>
        <label class="hdr-switch" data-tip="Upload the gallery: the images and videos below replace the item's gallery on Steam. The thumbnail belongs to Details." data-tip-wrap data-tip-side="left">Previews <span class="px-switch"><input id="incPreviews" type="checkbox" checked /><span></span></span></label>
      </div>
      <div id="previewsHint" class="px-muted px-xs" style="margin-bottom:6px"></div>
      <div id="gallery" class="gallery"></div>
      <div class="hintline" style="margin-top:6px">
        <button id="addPreviews" class="px-btn" data-variant="outline" data-size="sm" data-tip="Copy images into the previews folder of the listing. Under 1 MB each; Steam shows them in file-name order." data-tip-wrap>${icon("plus")} Add images</button>
        <button id="openPreviews" class="px-btn" data-variant="ghost" data-size="sm" data-tip="Open the previews folder. Reorder by renaming, remove by deleting." data-tip-wrap>${icon("folderOpen")} Folder</button>
      </div>
      <div class="field" style="margin-top:8px">
        <span class="px-label" style="display:inline-flex;align-items:center;gap:4px">Videos <button id="videosHelp" class="px-btn" data-variant="ghost" data-size="icon-xs" aria-label="How to add several videos" data-tip="Several videos: separate the YouTube links or ids with commas. They show on the item in that order." data-tip-wrap>${icon("circleHelp")}</button></span>
        <input id="videos" class="px-input" spellcheck="false" placeholder="YouTube links or ids, comma separated" data-tip="Saved to previews/videos.txt. Enter or leaving the field writes it." data-tip-wrap />
      </div>
    </div>
    <div class="section" id="requirementsSection">
      <div class="px-panel-title">Requirements
        <span class="px-grow"></span>
        <span class="px-badge off-chip" data-variant="outline">Not uploaded</span>
        <label class="hdr-switch" data-tip="Upload the required DLC and items below, replacing what the item declares on Steam." data-tip-wrap data-tip-side="left">Upload <span class="px-switch"><input id="incRequirements" type="checkbox" checked /><span></span></span></label>
      </div>
      <div class="px-label" style="margin-bottom:4px">Required DLC</div>
      <div id="dlcBox"></div>
      <div class="px-label" style="margin:10px 0 4px">Required items</div>
      <div id="itemsBox" class="px-chips"></div>
      <div class="field" style="margin-top:6px">
        <span class="px-label">Add a required item</span>
        <div class="px-row" style="gap:6px;align-items:center">
          <input id="itemIdInput" class="px-input" spellcheck="false" placeholder="Workshop id or link, then Enter" style="flex:1 1 auto;min-width:0;max-width:360px" />
          <button id="addItem" class="px-btn px-dropdown" data-variant="outline" data-size="sm" style="width:auto;flex:0 0 auto" data-tip="Pick an installed Workshop mod">${icon("plus")} Installed${icon("chevronDown")}</button>
        </div>
      </div>
    </div>
    <div class="section wide">
      <div class="px-panel-title">Description</div>
      <div class="bbprev-box">
        <div id="descPreview" class="bbprev"></div>
        <button id="descPreviewEdit" class="px-btn bbprev-edit" data-variant="ghost" data-size="icon-xs" aria-label="Edit description.bbcode" data-tip="Edit description.bbcode">${icon("pencil")}</button>
      </div>
      <div class="hintline">
        <span class="hint">Edit description.bbcode in the editor; the preview is roughly how the Workshop page renders it.</span>
        <button id="bbcodeHelp" class="px-btn" data-variant="ghost" data-size="icon-xs" aria-label="BBCode help" data-tip="The tags Steam renders">${icon("circleHelp")}</button>
        <span class="px-grow"></span>
        <button id="openDescFile" class="px-btn" data-variant="outline" data-size="sm" data-tip="Open the workshop folder's description.bbcode in the editor">${icon("pencil")} Edit file</button>
        <button id="reloadLocal" class="px-btn" data-variant="ghost" data-size="sm" data-tip="Re-read the description and translations from the local files" data-tip-wrap>${icon("rotate")} Reload</button>
        <button id="pullDesc" class="px-btn" data-variant="ghost" data-size="sm" data-tip="Replace the draft with the description currently on Steam" disabled>${icon("arrowDown")} Fetch from Steam</button>
      </div>
    </div>
    <div class="section wide" id="translationsSection">
      <div class="px-panel-title">${icon("globe")} Translations
        <span class="px-grow"></span>
        <button id="addLang" class="px-btn" data-variant="outline" data-size="sm">${icon("plus")} Add language</button>
        <span class="px-badge off-chip" data-variant="outline">Not uploaded</span>
        <label class="hdr-switch" data-tip="Upload the drafted translations. Each language has its own switch on its row." data-tip-wrap data-tip-side="left"><span id="langCount"></span> <span class="px-switch"><input id="incLangs" type="checkbox" checked /><span></span></span></label>
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
