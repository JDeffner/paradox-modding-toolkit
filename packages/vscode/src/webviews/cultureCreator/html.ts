/**
 * The Culture Creator page: the form on the left, the game's culture window on
 * the right. Markup and page-specific styles on top of the shared px-ui
 * stylesheet; the app (app/main.ts) fills every section at runtime and nothing
 * here talks to the host.
 *
 * The preview mirrors game/gui/window_culture.gui: the culture's name over its
 * color, then the pillar row (icon plus name, the description on hover), then
 * the traditions grid (the composed layer icon with the name under it) and the
 * count the window prints beside the traditions label.
 */
import uiCss from "../shared/ui.css";
import { icon } from "../shared/icons";

export interface CultureCreatorHtmlOptions {
  scriptSrc: string;
  nonce: string;
  csp: string;
}

/** The sections, in the order a culture is decided. */
const SECTIONS: Array<{ id: string; title: string; note?: string; folded?: boolean }> = [
  { id: "identity", title: "Identity" },
  { id: "pillars", title: "Pillars" },
  { id: "traditions", title: "Traditions" },
  { id: "names", title: "Names" },
  { id: "graphics", title: "Graphics" },
  {
    id: "advanced",
    title: "Advanced",
    // _cultures.info: "created = date # Optional creation date"; the vanilla
    // hybrid levantine (00_arabic.txt) is the shape `parents` and `created`
    // appear in. Everything the game may write and no widget models lands here
    // as raw script (AD-5: annotate, never hide).
    note: "Where a culture came from, the coat of arms frame it puts on houses, and every other key the game reads. A key with no widget stays script.",
    folded: true,
  },
];

export function cultureCreatorHtml({ scriptSrc, nonce, csp }: CultureCreatorHtmlOptions): string {
  const sections = SECTIONS.map(
    (s) => `<section class="sec" id="sec-${s.id}" hidden>
      <button type="button" class="fold" id="fold-${s.id}" aria-expanded="${s.folded ? "false" : "true"}">
        ${icon("chevronRight")}<span class="ftitle">${s.title}</span><span class="fcount" id="count-${s.id}"></span>
      </button>
      <div class="body" id="body-${s.id}"${s.folded ? " hidden" : ""}>
        ${s.note ? `<div class="note">${s.note}</div>` : ""}
        <div class="rows" id="rows-${s.id}"></div>
      </div>
    </section>`
  ).join("");
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>Culture Creator</title>
<style>
${uiCss}
  body { overflow: hidden; }
  /* .px-btn and .px-badge set their own display, which beats the browser's
     rule for [hidden]; without this a hidden toolbar button still draws. */
  [hidden] { display: none !important; }
  #app { display: flex; flex-direction: column; height: 100%; }
  #toolbar {
    display: flex; align-items: center; gap: 6px; flex: 0 0 auto; flex-wrap: wrap;
    padding: 6px 8px; border-bottom: 1px solid var(--px-border);
  }
  /* .px-dropdown is a full-width form control; in the toolbar it is a button. */
  #mode { width: auto; }
  #name { width: 200px; font-family: var(--px-font-mono); }
  #main { flex: 1 1 auto; display: flex; min-height: 0; }
  #form { flex: 1 1 auto; overflow-y: auto; padding: 10px 14px 40px; }
  #inner { max-width: 720px; display: flex; flex-direction: column; gap: 10px; }
  .sec { display: flex; flex-direction: column; }
  .sec > .body { display: flex; flex-direction: column; gap: 6px; padding: 4px 0 10px; }
  .sec > .body > .rows { display: flex; flex-direction: column; gap: 6px; }
  /* The section header doubles as its fold control: one target, no stray chevron. */
  .fold {
    display: flex; align-items: center; gap: 6px; width: 100%;
    padding: 4px 2px; border: 0; border-bottom: 1px solid var(--px-border);
    background: none; color: var(--px-muted-fg); cursor: pointer; text-align: left;
    font: inherit; font-size: var(--px-text-xs); font-weight: 600;
    letter-spacing: 0.04em; text-transform: uppercase;
  }
  .fold:hover { color: var(--px-fg); }
  .fold > .px-icon { transition: transform var(--px-ease); }
  .fold[aria-expanded="true"] > .px-icon { transform: rotate(90deg); }
  .fold > .ftitle { flex: 1 1 auto; }
  .fold > .fcount { font-weight: 400; letter-spacing: 0; text-transform: none; }
  .note { color: var(--px-muted-fg); font-size: var(--px-text-xs); max-width: 620px; }
  #banner { display: flex; flex-direction: column; gap: 4px; }
  #banner:empty { display: none; }
  #saveNote { color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  /* The script preview folds: it is a check, not the working surface. */
  #script > summary { cursor: pointer; color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  #script pre {
    margin: 6px 0 0; padding: 8px 10px; overflow-x: auto; background: var(--px-muted);
    border-radius: var(--px-radius-md); font-family: var(--px-font-mono); font-size: var(--px-text-sm);
  }
  /* A weight and a name on one row, the shape ethnicities has in the file. */
  .wrow { display: flex; align-items: center; gap: 6px; }
  .wrow > input[type="number"] { width: 72px; }
  .pair { display: flex; align-items: center; gap: 6px; }
  .pair > input { width: 88px; }
  /* A dlc_tradition statement: three pickers and a remove, on their own card. */
  .dlcrow {
    display: flex; flex-direction: column; gap: 4px; padding: 6px 8px;
    border: 1px solid var(--px-border); border-radius: var(--px-radius-md);
  }
  .dlcrow .px-field { grid-template-columns: 104px minmax(0, 1fr); }
  .dlchead { display: flex; align-items: center; gap: 6px; }
  .dlchead > span { flex: 1 1 auto; font-size: var(--px-text-xs); color: var(--px-muted-fg); }

  /* The composed tradition icon: the game stacks its layer folders in index
     order, so the layers are absolutely positioned in DOM order. */
  .tradicon {
    position: relative; flex: 0 0 auto; display: block;
    width: var(--tradicon, 48px); height: var(--tradicon, 48px);
  }
  .tradicon > img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
  /* The tradition picker's group heading (the game groups by category). */
  .catgroup {
    padding: 8px 6px 2px; font-size: var(--px-text-xs); font-weight: 600;
    letter-spacing: 0.04em; text-transform: uppercase; color: var(--px-muted-fg);
  }
  .catgroup:first-child { padding-top: 2px; }

  /* --- the preview: the culture window's own header ---------------------- */
  #side > .px-sidepanel-body { gap: 10px; padding: 10px; }
  #pvBand {
    display: flex; flex-direction: column; gap: 2px; padding: 12px 12px 14px;
    border-radius: var(--px-radius-md); border: 1px solid var(--px-border);
    background: var(--px-band, var(--px-muted));
  }
  #pvName { font-size: 18px; font-weight: 600; color: var(--px-band-fg, var(--px-fg)); }
  #pvKey { font-family: var(--px-font-mono); font-size: var(--px-text-xs); opacity: 0.75;
    color: var(--px-band-fg, var(--px-muted-fg)); }
  .pvhead {
    display: flex; align-items: baseline; gap: 6px; font-size: var(--px-text-xs);
    font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--px-muted-fg);
  }
  .pvhead > .count { font-weight: 400; letter-spacing: 0; text-transform: none; }
  #pvPillars { display: flex; flex-direction: column; gap: 4px; }
  .pvpillar { display: flex; align-items: center; gap: 8px; min-height: 32px; }
  .pvpillar > .picon { width: 28px; height: 28px; flex: 0 0 auto; }
  .pvpillar > .picon > img { width: 100%; height: 100%; object-fit: contain; }
  .pvpillar > .ptext { display: flex; flex-direction: column; min-width: 0; }
  .pvpillar .pfam { font-size: var(--px-text-xs); color: var(--px-muted-fg); }
  .pvpillar .pname { font-size: var(--px-text-sm); }
  .pvpillar .pname[data-empty] { color: var(--px-muted-fg); font-style: italic; }
  #pvTraditions { display: grid; grid-template-columns: repeat(auto-fill, minmax(76px, 1fr)); gap: 8px; }
  .pvtrad { display: flex; flex-direction: column; align-items: center; gap: 3px; text-align: center; }
  .pvtrad > .tname { font-size: var(--px-text-xs); line-height: 1.25; overflow-wrap: anywhere; }
  .pvempty { color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  /* The hover card the preview quotes the game's own tooltip in. */
  #pvTip { position: fixed; z-index: 80; max-width: 280px; pointer-events: none; }
  #pvTip[hidden] { display: none; }
</style>
</head>
<body>
<div id="app">
  <div id="toolbar">
    <input id="name" class="px-input" data-size="sm" spellcheck="false" autocomplete="off" placeholder="culture key" data-tip="The culture's key: lowercase letters, digits and underscores. Everything else follows it." data-tip-wrap />
    <span id="source" class="px-badge" data-variant="outline" hidden></span>
    <button id="new" class="px-btn" data-variant="ghost" data-size="sm" data-tip="Start over on a blank culture">${icon("filePlus")}New</button>
    <button id="open" class="px-btn" data-variant="ghost" data-size="sm" data-tip="Load a culture that already exists into this form">${icon("folderOpen")}Open</button>
    <span class="px-grow"></span>
    <span id="target" class="px-muted px-xs"></span>
    <button id="mode" class="px-btn px-dropdown" data-variant="outline" data-size="sm" hidden data-tip="This culture belongs to the game. Choose how your mod changes it." data-tip-wrap>
      <span class="px-truncate">Duplicate</span>${icon("chevronDown")}</button>
    <button id="save" class="px-btn" data-variant="default" data-size="sm">${icon("save")}Save</button>
    <button id="wiki" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Open the Examples Wiki" data-tip-side="left">${icon("bookOpen")}</button>
  </div>
  <div id="main">
    <div id="form">
      <div id="inner">
        <div id="banner"></div>
        <div id="saveNote"></div>
        ${sections}
        <details id="script">
          <summary>Script preview</summary>
          <pre id="scriptText"></pre>
        </details>
        <div class="note">A culture nobody has is invisible in game. Assign it to characters or counties in history to see it.</div>
      </div>
    </div>
    <div id="side" class="px-sidepanel" data-side="right">
      <div class="px-sidepanel-resizer"></div>
      <div class="px-sidepanel-body">
        <div id="pvBand"><div id="pvName"></div><div id="pvKey"></div></div>
        <div class="pvhead">Pillars</div>
        <div id="pvPillars"></div>
        <div class="pvhead">Traditions <span class="count" id="pvCount"></span></div>
        <div id="pvTraditions"></div>
        <div class="note" id="pvNote"></div>
      </div>
    </div>
  </div>
</div>
<div id="pvTip" class="px-game-tip" hidden></div>
<script nonce="${nonce}" src="${scriptSrc}"></script>
</body>
</html>`;
}
