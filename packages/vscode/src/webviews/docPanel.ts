/**
 * A read-only document panel: one webview that renders the markdown subset our
 * generated docs actually use (headings, tables, bullet lists, paragraphs,
 * `code`, **bold**, *italic*). The Mod Report and the image guidelines both go
 * through it, so they read like the rest of the toolkit instead of like VS
 * Code's markdown preview.
 *
 * Deliberately not a markdown library: the two documents are ours, the subset
 * is known, and the vsix stays dependency-free.
 */
import * as vscode from "vscode";
import { makeNonce } from "./nonce";
import uiCss from "./shared/ui.css";
import { escapeHtml, renderMarkdown } from "./markdown";

const panels = new Map<string, vscode.WebviewPanel>();

/** Shows (or refreshes) the panel for `viewType`; one panel per document kind. */
export function showDocPanel(viewType: string, title: string, markdown: string): void {
  let panel = panels.get(viewType);
  if (!panel) {
    panel = vscode.window.createWebviewPanel(viewType, title, vscode.ViewColumn.Active, {
      retainContextWhenHidden: true,
    });
    panel.onDidDispose(() => panels.delete(viewType));
    panels.set(viewType, panel);
  } else {
    panel.reveal(panel.viewColumn ?? vscode.ViewColumn.Active);
  }
  panel.title = title;
  panel.webview.html = docHtml(title, renderMarkdown(markdown));
}

function docHtml(title: string, body: string): string {
  const nonce = makeNonce();
  const csp = [`default-src 'none'`, `style-src 'nonce-${nonce}'`].join("; ");
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>${escapeHtml(title)}</title>
<style nonce="${nonce}">
${uiCss}
  body { overflow: auto; }
  #page { max-width: 860px; margin: 0 auto; padding: 18px 24px 48px; }
  h1 { font-size: 1.7em; margin: 0 0 4px; }
  h2 { font-size: 1.25em; margin: 26px 0 8px; padding-bottom: 4px; border-bottom: 1px solid var(--px-border); }
  h3 { font-size: 1.05em; margin: 18px 0 6px; }
  p, ul { margin: 8px 0; }
  ul { padding-left: 20px; }
  li { margin: 3px 0; }
  a { color: var(--vscode-textLink-foreground, var(--px-primary)); text-decoration: none; }
  a:hover { text-decoration: underline; }
  code { font-family: var(--px-font-mono); font-size: 0.92em; background: var(--px-muted); border-radius: var(--px-radius-sm); padding: 1px 5px; }
  table { border-collapse: collapse; margin: 10px 0; width: 100%; }
  th, td { text-align: left; padding: 5px 10px; border-bottom: 1px solid var(--px-border); }
  th { font-weight: 600; color: var(--px-muted-fg); font-size: var(--px-text-sm); }
  tbody tr:hover { background: var(--px-muted); }
</style>
</head>
<body>
<div id="page">
${body}
</div>
</body>
</html>`;
}
