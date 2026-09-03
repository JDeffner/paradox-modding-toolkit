/**
 * The Credits page: one scrollable list of the projects the toolkit builds
 * on, rendered from the curated list in credits.ts.
 *
 * The page is static, so it has no app bundle. Links carry plain https hrefs;
 * a VS Code webview opens those in the browser by itself, with no host round
 * trip, so there is nothing for a script to do here.
 */
import uiCss from "../shared/ui.css";
import { icon } from "../shared/icons";
import { CREDIT_SECTIONS, type CreditEntry } from "./credits";

const NOTICES_URL = "https://github.com/JDeffner/paradox-modding-toolkit/blob/main/THIRD-PARTY-NOTICES.md";

function escape(text: string): string {
  return text.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string
  );
}

function entryHtml(entry: CreditEntry): string {
  const author = entry.author ? `<div class="author">${escape(entry.author)}</div>` : "";
  return /* html */ `<div class="entry">
  <div class="head">
    <a class="name" href="${escape(entry.url)}">${escape(entry.name)}${icon("externalLink")}</a>
    <span class="px-badge" data-variant="outline">${escape(entry.license)}</span>
  </div>
  ${author}
  <div class="used">${escape(entry.usedFor)}</div>
</div>`;
}

export function creditsHtml({ csp }: { csp: string }): string {
  const sections = CREDIT_SECTIONS.map(
    (section) => /* html */ `<h2>${escape(section.title)}</h2>
<div class="grid">
${section.entries.map(entryHtml).join("\n")}
</div>`
  ).join("\n");
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>Credits</title>
<style>
${uiCss}
  body { overflow-y: auto; }
  #page { max-width: 1180px; padding: 22px 24px 48px; }
  h1 { font-size: 1.6em; margin: 0 0 4px; }
  h2 {
    font-size: 1.05em; margin: 26px 0 10px; padding-bottom: 4px;
    border-bottom: 1px solid var(--px-border);
  }
  #intro { color: var(--px-muted-fg); margin: 0 0 6px; }
  /* Squarish cards that wrap: as many per row as the width allows, one column on narrow panes. */
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
  .entry {
    display: flex; flex-direction: column; gap: 4px; min-height: 120px; padding: 12px;
    border: 1px solid var(--px-border); border-radius: var(--px-radius-md);
    background: var(--px-sidebar);
  }
  .entry .used { flex: 1 1 auto; }
  .head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .name {
    display: inline-flex; align-items: center; gap: 5px;
    font-weight: 600; color: var(--px-fg); text-decoration: none;
  }
  .name:hover { text-decoration: underline; }
  .name svg { width: 13px; height: 13px; opacity: 0.7; }
  .author { color: var(--px-muted-fg); font-size: var(--px-text-xs); margin-top: 2px; }
  .used { margin-top: 6px; }
  #footer { margin-top: 28px; color: var(--px-muted-fg); font-size: var(--px-text-sm); }
</style>
</head>
<body>
<div id="page">
  <h1>Credits</h1>
  <p id="intro">The toolkit stands on these projects.</p>
${sections}
  <div id="footer">Full license texts and provenance are in <a href="${NOTICES_URL}">THIRD-PARTY-NOTICES.md</a>.</div>
</div>
</body>
</html>`;
}
