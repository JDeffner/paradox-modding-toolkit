import uiCss from "../shared/ui.css";
import pageCss from "./style.css";
import { icon } from "../shared/icons";

/** Author content is escaped by the client. Author code never runs in the webview. */
export function migrationHtml({
  scriptSrc,
  nonce,
  csp,
}: {
  scriptSrc: string;
  nonce: string;
  csp: string;
}): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>Mod Compatibility</title><style>${uiCss}\n${pageCss}</style></head>
<body><main><header class="page-heading"><div class="heading-title">${icon("layers")}<h1>Mod Compatibility</h1><span class="px-badge">Experimental</span></div><p class="muted intro">Update your mod with guidance and migrations for each game version.</p></header><div id="app" aria-busy="true">Loading compatibility library…</div></main>
<script nonce="${nonce}" src="${scriptSrc}"></script></body></html>`;
}
