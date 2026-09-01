/**
 * The Examples Wiki page: markup and page-specific styles on top of the shared
 * px-ui stylesheet. The app (app/main.ts) fills the result list and the
 * reading pane at runtime; nothing here talks to the host.
 */
import uiCss from "../shared/ui.css";
import { icon } from "../shared/icons";

export interface ExampleWikiHtmlOptions {
  scriptSrc: string;
  nonce: string;
  csp: string;
}

/** One filter chip. The tips are the point: they teach the words. */
const CHIPS: Array<{ kind: string; label: string; tip: string }> = [
  { kind: "all", label: "All", tip: "Everything the toolkit knows about this game" },
  {
    kind: "trigger",
    label: "Triggers",
    tip: "A question the game answers with yes or no. Triggers go inside trigger, limit and is_valid blocks.",
  },
  {
    kind: "effect",
    label: "Effects",
    tip: "A change to the game world. Effects go inside immediate, option and on_action blocks.",
  },
  {
    kind: "event_target",
    label: "Targets",
    tip: "A step to another scope: from a character to that character's liege, culture or capital. Written as a block, or with a dot, like liege.capital_province.",
  },
  {
    kind: "modifier",
    label: "Modifiers",
    tip: "A named number the game adds to something: opinion, monthly income, levy size. Modifiers go inside modifier blocks, not inside effects.",
  },
  {
    kind: "datafn",
    label: "Datafunctions",
    tip: "The [ ... ] expressions in localization and gui files that read live values out of the running game.",
  },
  {
    kind: "variable",
    label: "Variables",
    tip: "The variables, flags and lists your own script files create with set_variable, add_to_list and their relatives. Names the engine never heard of until your mod wrote them.",
  },
  {
    kind: "keyword",
    label: "Keywords",
    tip: "The grammar around the triggers and effects: limit, NOT, base, days, and the scope words root, prev and from. The game documents none of them.",
  },
  {
    kind: "data_type",
    label: "Types",
    tip: "What a [ ... ] chain is holding at each step, like Character or Title. Every type has its own members you can ask for next.",
  },
];

export function exampleWikiHtml({ scriptSrc, nonce, csp }: ExampleWikiHtmlOptions): string {
  const chips = CHIPS.map(
    (c, i) =>
      `<button class="px-toggle" data-size="sm" data-kind="${c.kind}" aria-pressed="${i === 0}" data-tip="${c.tip}" data-tip-wrap>${c.label}</button>`
  ).join("");
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>Examples Wiki</title>
<style>
${uiCss}
  body { overflow: hidden; }
  #app { display: flex; flex-direction: column; height: 100%; }
  #toolbar {
    display: flex; align-items: center; gap: 6px; flex: 0 0 auto; flex-wrap: wrap;
    padding: 6px 8px; border-bottom: 1px solid var(--px-border);
  }
  #query { width: 260px; }
  #main { flex: 1 1 auto; display: flex; min-height: 0; }
  #listPane {
    flex: 0 0 var(--list-width, 42%); min-width: 200px; display: flex; flex-direction: column;
    overflow-y: auto;
  }
  #divider {
    flex: 0 0 5px; cursor: col-resize; background: var(--px-border);
    background-clip: content-box; border-left: 2px solid transparent; border-right: 2px solid transparent;
  }
  #divider:hover, #divider[data-dragging] { background-color: var(--px-primary); }
  /* While dragging, the pointer outruns the layout; keep it from selecting text. */
  body[data-dragging] { user-select: none; cursor: col-resize; }
  #results { padding: 4px; }
  /* The row holds four things of three text sizes; centred, they read as one
     line instead of hanging off a shared baseline. */
  #results .px-item { align-items: center; gap: 6px; }
  #results .px-item[aria-selected="true"] { background: var(--px-muted-strong); }
  /* The kind's own codicon, coloured by the kind (app/main.ts). */
  .kglyph {
    flex: 0 0 auto; display: flex;
    color: var(--px-muted-fg); cursor: help;
  }
  .kglyph > svg.px-icon { width: 14px; height: 14px; }
  .rname { flex: 0 0 auto; font-family: var(--px-font-mono); font-size: var(--px-text-sm); }
  .rname .owner { color: var(--px-muted-fg); }
  .rdoc {
    flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--px-muted-fg); font-size: var(--px-text-xs);
  }
  .rcount { flex: 0 0 auto; color: var(--px-muted-fg); font-size: var(--px-text-xs); cursor: help; }
  #more, #listNote {
    padding: 6px 12px; color: var(--px-muted-fg); font-size: var(--px-text-xs);
  }
  #detail { flex: 1 1 auto; overflow-y: auto; min-width: 0; }
  #detailBody { max-width: 760px; padding: 14px 18px 40px; display: flex; flex-direction: column; gap: 12px; }
  #detailBody h1 {
    margin: 0; font-family: var(--px-font-mono); font-size: 17px; font-weight: 600;
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  }
  #detailBody h1 .owner { color: var(--px-muted-fg); }
  #detailBody .sec { display: flex; flex-direction: column; gap: 6px; }
  #detailBody .sec > .px-panel-title { padding: 0; }
  #detailBody p { margin: 0; }
  #detailBody pre {
    margin: 0; padding: 8px 10px; overflow-x: auto; background: var(--px-muted);
    border-radius: var(--px-radius-md); font-family: var(--px-font-mono); font-size: var(--px-text-sm);
  }
  /* The disclosure behaviour wants the default block flow, not the .sec column. */
  #detailBody .fold { display: block; }
  #detailBody .fold > summary { cursor: pointer; }
  #detailBody .fold[open] > summary { margin-bottom: 6px; }
  #detailBody .fold > .note { margin-top: 6px; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; }
  /* A scope can carry hundreds of names: keep the list inside its own box. */
  .chips.scroll { max-height: 240px; overflow-y: auto; }
  .px-badge[data-link] { cursor: pointer; }
  .px-badge[data-link]:hover { background: var(--px-muted-strong); }
  .site {
    display: flex; flex-direction: column; gap: 2px; padding: 4px 6px;
    border-radius: var(--px-radius-md); cursor: pointer; text-align: left;
  }
  .site:hover { background: var(--px-muted); }
  .site .head {
    display: flex; align-items: baseline; gap: 6px;
    color: var(--px-muted-fg); font-size: var(--px-text-xs);
  }
  .site .tag { text-transform: uppercase; letter-spacing: 0.04em; }
  .site pre { background: var(--px-muted); padding: 6px 8px; }
  .site:hover pre { background: var(--px-muted-strong); }
  .site .cline { display: block; white-space: pre; }
  .site .cline.hit { color: var(--px-fg); font-weight: 600; }
  .site .cline:not(.hit) { color: var(--px-muted-fg); }
  /* Code hidden: the matched line and where it lives, on one row. */
  .site.compact { flex-direction: row; align-items: baseline; gap: 8px; }
  .site.compact .cline {
    flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-family: var(--px-font-mono); font-size: var(--px-text-xs); font-weight: 400;
  }
  .site.compact .where { flex: 0 0 auto; color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  /* One control, two pictures: the eye is the state, not the promise. */
  #codeToggle[aria-pressed="true"] > svg.off,
  #codeToggle[aria-pressed="false"] > svg.on { display: none; }
  .note { color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  #placeholder {
    padding: 40px 18px; color: var(--px-muted-fg); display: flex; flex-direction: column; gap: 8px;
    max-width: 520px;
  }
  /* An explicit display beats the hidden attribute, so say it again here. */
  #placeholder[hidden], #detailBody[hidden] { display: none; }
  .scope { cursor: help; }
</style>
</head>
<body>
<div id="app">
  <div id="toolbar">
    <div class="px-input-group">${icon("search")}<input id="query" class="px-input" data-size="sm" autocomplete="off" spellcheck="false" placeholder="Search triggers, effects, datafunctions…" data-tip="Type any part of a name. The most used names in the game come first." data-tip-wrap /></div>
    <button id="back" class="px-btn" data-variant="ghost" data-size="icon-sm" disabled data-tip="Back to the article you came from (Alt+Left)">${icon("chevronLeft")}</button>
    <button id="forward" class="px-btn" data-variant="ghost" data-size="icon-sm" disabled data-tip="Forward to the article you came back from (Alt+Right)">${icon("chevronRight")}</button>
    <div class="px-toggle-group" id="kinds">${chips}</div>
    <span class="px-grow"></span>
    <span id="count" class="px-muted px-xs"></span>
    <button id="codeToggle" class="px-toggle" data-size="sm" aria-pressed="true" data-tip-wrap>${icon("eye", "px-icon on")}${icon("eyeOff", "px-icon off")}Code</button>
    <button id="refresh" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Load the list again from the language server">${icon("rotate")}</button>
  </div>
  <div id="main">
    <div id="listPane">
      <div id="results" class="px-list"></div>
      <div id="more"></div>
      <div id="listNote"></div>
    </div>
    <div id="divider" role="separator" aria-orientation="vertical" title="Drag to resize"></div>
    <div id="detail">
      <div id="placeholder">
        <div>Pick a name on the left to read what it does, which scopes it works in, and where the game itself uses it.</div>
        <div class="note">Everything here comes from your game files and your script_docs dumps, not from a hand written list.</div>
        <div class="note" id="sourceLines"></div>
      </div>
      <div id="detailBody" hidden></div>
    </div>
  </div>
</div>
<script nonce="${nonce}" src="${scriptSrc}"></script>
</body>
</html>`;
}
