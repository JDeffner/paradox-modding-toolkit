/**
 * The Culture Creator page: markup and page-specific styles on top of the
 * shared px-ui stylesheet. The app (app/main.ts) fills every section at
 * runtime; nothing here talks to the host.
 */
import uiCss from "../shared/ui.css";
import { icon } from "../shared/icons";

export interface CultureCreatorHtmlOptions {
  scriptSrc: string;
  nonce: string;
  csp: string;
}

/** The sections, in the order a culture is decided. */
const SECTIONS: Array<{ id: string; title: string; note?: string }> = [
  { id: "identity", title: "Identity" },
  { id: "pillars", title: "Pillars" },
  { id: "traditions", title: "Traditions" },
  { id: "names", title: "Names" },
  { id: "look", title: "Look" },
  {
    id: "origin",
    title: "Origin",
    // _cultures.info: "created = date # Optional creation date"; the vanilla
    // hybrid levantine (00_arabic.txt) is the shape both keys appear in.
    note: "A hybrid or divergent culture names the cultures it came from and the date it appeared. Leave both empty for a culture that was always there.",
  },
  { id: "other", title: "Other keys" },
];

export function cultureCreatorHtml({ scriptSrc, nonce, csp }: CultureCreatorHtmlOptions): string {
  const sections = SECTIONS.map(
    (s) => `<section class="sec" id="sec-${s.id}" hidden>
      <div class="px-panel-title">${s.title}</div>
      ${s.note ? `<div class="note">${s.note}</div>` : ""}
      <div class="body" id="body-${s.id}"></div>
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
  #app { display: flex; flex-direction: column; height: 100%; }
  #toolbar {
    display: flex; align-items: center; gap: 6px; flex: 0 0 auto; flex-wrap: wrap;
    padding: 6px 8px; border-bottom: 1px solid var(--px-border);
  }
  #name { width: 220px; font-family: var(--px-font-mono); }
  #form { flex: 1 1 auto; overflow-y: auto; padding: 10px 14px 40px; }
  #inner { max-width: 720px; display: flex; flex-direction: column; gap: 16px; }
  .sec { display: flex; flex-direction: column; gap: 6px; }
  .sec > .px-panel-title { padding: 0; }
  .sec > .body { display: flex; flex-direction: column; gap: 6px; }
  .note { color: var(--px-muted-fg); font-size: var(--px-text-xs); max-width: 620px; }
  #banner { display: flex; flex-direction: column; gap: 4px; }
  #banner:empty { display: none; }
  #saveNote { color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  /* The script preview folds: it is a check, not the working surface. */
  #preview { display: block; }
  #preview > summary { cursor: pointer; color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  #preview pre {
    margin: 6px 0 0; padding: 8px 10px; overflow-x: auto; background: var(--px-muted);
    border-radius: var(--px-radius-md); font-family: var(--px-font-mono); font-size: var(--px-text-sm);
  }
  /* A weight and a name on one row, the shape ethnicities has in the file. */
  .wrow { display: flex; align-items: center; gap: 6px; }
  .wrow > input[type="number"] { width: 72px; }
  .pair { display: flex; align-items: center; gap: 6px; }
  .pair > input { width: 88px; }
</style>
</head>
<body>
<div id="app">
  <div id="toolbar">
    <input id="name" class="px-input" data-size="sm" spellcheck="false" autocomplete="off" placeholder="culture key" data-tip="The culture's key: lowercase letters, digits and underscores. Everything else follows it." data-tip-wrap />
    <span id="source" class="px-badge" data-variant="outline" hidden></span>
    <button id="open" class="px-btn" data-variant="ghost" data-size="sm" data-tip="Load a culture that already exists into this form">${icon("folderOpen")}Open</button>
    <span class="px-grow"></span>
    <span id="target" class="px-muted px-xs"></span>
    <button id="save" class="px-btn" data-variant="default" data-size="sm">${icon("save")}Save</button>
    <button id="wiki" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Look this culture's words up in the Examples Wiki" data-tip-side="left">${icon("bookOpen")}</button>
  </div>
  <div id="form">
    <div id="inner">
      <div id="banner"></div>
      <div id="saveNote"></div>
      ${sections}
      <details id="preview">
        <summary>Script preview</summary>
        <pre id="previewText"></pre>
      </details>
      <div class="note">A culture nobody has is invisible in game. Assign it to characters or counties in history to see it.</div>
    </div>
  </div>
</div>
<script nonce="${nonce}" src="${scriptSrc}"></script>
</body>
</html>`;
}
