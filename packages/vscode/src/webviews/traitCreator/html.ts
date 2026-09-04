/**
 * The Trait Creator page: markup and page styles on top of the shared px-ui
 * stylesheet. The app (app/main.ts) builds every field at runtime from the
 * form the server answered; nothing here knows a key name.
 *
 * The page is a form on the left and the game's own trait tooltip on the right
 * (`.px-game-tip`, ui.css), because the question a trait designer actually has
 * is "what will the player read", and script is not an answer to it.
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
  /* An author rule beats the browser's own [hidden] rule, and px-ui gives
     every control a display of its own (px-btn is inline-flex), so a button
     the app hides would still be drawn without this. */
  [hidden] { display: none !important; }
  #app { display: flex; flex-direction: column; height: 100%; }
  #toolbar {
    display: flex; align-items: center; gap: 6px; flex: 0 0 auto; flex-wrap: wrap;
    padding: 6px 8px; border-bottom: 1px solid var(--px-border);
  }
  #name { width: 200px; font-family: var(--px-font-mono); }
  /* A dropdown fills its field cell by default; in a toolbar it is a button. */
  #mode { width: auto; }
  /* The save target line (shared/saveTarget.ts) sits in the toolbar. */
  #target { display: flex; min-width: 0; }
  #body { flex: 1 1 auto; display: flex; min-height: 0; }
  #form { flex: 1 1 auto; overflow-y: auto; min-width: 0; }
  #sections {
    max-width: 760px; padding: 12px 16px 60px; display: flex; flex-direction: column; gap: 6px;
  }

  /* A folding section (px-ui rule 7: sections fold, with a caret in the head). */
  .fold { display: flex; flex-direction: column; border-bottom: 1px solid var(--px-border); }
  .fold:last-of-type { border-bottom: 0; }
  .fold-head {
    display: flex; align-items: center; gap: 6px; width: 100%;
    padding: 8px 2px; border: 0; background: none; cursor: pointer; text-align: left;
    color: var(--px-fg); font: inherit;
  }
  .fold-head:hover { background: var(--px-muted); }
  .fold-head > svg { flex: 0 0 auto; transition: transform var(--px-ease); }
  .fold[data-open] > .fold-head > svg { transform: rotate(90deg); }
  .fold-title {
    font-size: var(--px-text-xs); text-transform: uppercase; letter-spacing: 0.04em;
    font-weight: 600; color: var(--px-muted-fg);
  }
  .fold-note { color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  .fold-body { display: flex; flex-direction: column; gap: 8px; padding: 2px 2px 14px; }
  .fold:not([data-open]) > .fold-body { display: none; }
  .lede { color: var(--px-muted-fg); font-size: var(--px-text-xs); margin: -2px 0 2px; }

  /* Six skills in ONE row: the caption sits over the input, because six 112px
     label columns would not fit and a trait's skills are read as a set. */
  .skills { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 6px; }
  .skill { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .skill > span {
    font-size: var(--px-text-xs); color: var(--px-muted-fg); overflow-wrap: break-word; line-height: 1.2;
  }
  .skill > input { width: 100%; }
  /* Two opinion fields per row; one column when the panel is narrow. */
  .pairs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 18px; }
  @media (max-width: 700px) {
    .skills { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .pairs { grid-template-columns: minmax(0, 1fr); }
  }

  /* A modifier row: what gets written on top, what the player reads under it. */
  .modrow { display: grid; grid-template-columns: minmax(0, 1fr) 92px 24px; gap: 6px; align-items: center; }
  .modrow > .px-mod-line, .modrow > .modrow-empty { grid-column: 1 / -1; padding-left: 2px; }
  .modrow-empty { color: var(--px-muted-fg); font-size: var(--px-text-xs); }

  /* One statement of a key written as script; the game reads a repeated key as
     several, so each gets its own box and its own remove button. */
  .scriptrow { display: grid; grid-template-columns: minmax(0, 1fr) 24px; gap: 6px; align-items: start; }

  /* The preview panel. */
  #side > .px-sidepanel-body { gap: 10px; padding: 10px; }
  #sideHead {
    display: flex; align-items: center; gap: 6px;
    font-size: var(--px-text-xs); text-transform: uppercase; letter-spacing: 0.04em;
    font-weight: 600; color: var(--px-muted-fg);
  }
  /* The framed icon. The game's trait tooltip draws ONE widget for it
     (character_trait_tooltip in gui/shared/cooltip.gui, trait_icon_texture at
     size = { 52 52 }), and a trait's picture shares one 120x120 canvas with the
     _frame_*.dds templates (measured): so the frame sits UNDER the picture,
     same box, same size. */
  .tip-head { display: flex; align-items: center; gap: 8px; }
  .tip-icon { position: relative; width: 52px; height: 52px; flex: 0 0 auto; }
  .tip-icon > img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
  .tip-icon > .noicon {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    padding: 2px; border: 1px dashed var(--px-border); border-radius: var(--px-radius-sm);
    font-family: var(--px-font-mono); font-size: var(--px-text-xs); color: var(--px-muted-fg);
    text-align: center; overflow-wrap: anywhere; line-height: 1.1;
  }
  .tip-mods { display: flex; flex-direction: column; gap: 1px; }
  .tip-rel { display: flex; flex-wrap: wrap; gap: 4px; }
  .tip-rel > span {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 1px 6px 1px 2px; border: 1px solid var(--px-border);
    border-radius: var(--px-radius-sm); font-size: var(--px-text-xs);
  }
  .tip-rel img { width: 20px; height: 20px; object-fit: contain; }
  .tip-note { color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  .tip-fact { display: flex; flex-direction: column; gap: 1px; font-size: var(--px-text-sm); }
  /* What the player never reads, kept in the tooltip but behind a rule so it
     cannot be mistaken for a line the game prints. */
  .tip-hidden {
    display: flex; flex-direction: column; gap: 4px;
    margin-top: 4px; padding-top: 6px; border-top: 1px solid var(--px-border);
  }
  .tip-hidden-title {
    font-size: var(--px-text-xs); text-transform: uppercase; letter-spacing: 0.04em;
    font-weight: 600; color: var(--px-muted-fg);
  }
  .tip-hidden .tip-fact > div:first-child { font-family: var(--px-font-mono); }
  #problem {
    margin: 12px 16px; padding: 10px 12px; border: 1px solid var(--px-border);
    border-radius: var(--px-radius-md); background: var(--px-muted);
    font-size: var(--px-text-sm);
  }
</style>
</head>
<body>
<div id="app">
  <div id="toolbar">
    <input id="name" class="px-input" data-size="sm" spellcheck="false" autocomplete="off"
      placeholder="trait key" data-tip="The key the game reads. Lowercase letters, digits and _." data-tip-wrap />
    <span id="source" class="px-badge" data-variant="outline">New</span>
    <button id="new" class="px-btn" data-variant="ghost" data-size="icon-sm"
      data-tip="Start a new trait">${icon("filePlus")}</button>
    <button id="open" class="px-btn" data-variant="ghost" data-size="icon-sm"
      data-tip="Open an existing trait in this form">${icon("folderOpen")}</button>
    <button id="reveal" class="px-btn" data-variant="ghost" data-size="icon-sm" hidden
      data-tip="Open the file this trait comes from">${icon("fileText")}</button>
    <!-- The script section's copy button lands here (shared/scriptSection.ts). -->
    <span id="scriptCopy"></span>
    <span class="px-grow"></span>
    <span id="target"></span>
    <button id="mode" class="px-btn px-dropdown" data-variant="outline" data-size="sm" hidden
      data-tip="This trait belongs to the game. Choose how your mod changes it." data-tip-wrap>
      <span class="px-truncate">Duplicate</span>${icon("chevronDown")}</button>
    <button id="save" class="px-btn" data-size="sm">${icon("save")}Save</button>
    <span class="px-separator" data-orientation="vertical"></span>
    <button id="togglePreview" class="px-btn" data-variant="ghost" data-size="icon-sm"
      data-tip="Show or hide the tooltip preview">${icon("panelRightClose")}</button>
    <button id="helpBtn" class="px-btn" data-variant="ghost" data-size="icon-sm"
      data-tip="How this view works" data-tip-side="left">${icon("circleHelp")}</button>
  </div>
  <div id="problem" hidden></div>
  <div id="body">
    <div id="form"><div id="sections"></div></div>
    <div id="side" class="px-sidepanel" data-side="right">
      <div class="px-sidepanel-resizer"></div>
      <div class="px-sidepanel-body">
        <div id="sideHead">Preview</div>
        <div id="tip"></div>
        <div id="scriptSlot"></div>
      </div>
    </div>
  </div>
</div>
<script nonce="${nonce}" src="${scriptSrc}"></script>
</body>
</html>`;
}
