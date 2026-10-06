import uiCss from "../shared/ui.css";
import pageCss from "./style.css";
import { icon } from "../shared/icons";

export function patchHtml(options: { scriptSrc: string; nonce: string; csp: string }): string {
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${options.csp}"><title>Compatibility Patch</title><style>${uiCss}\n${pageCss}</style></head><body><main><header class="page-heading"><div class="heading-title">${icon("layers")}<h1>Compatibility Patch</h1><span class="px-badge">Experimental</span></div><p class="muted">Combine your mods. Save the decisions. Review what changes with the next update.</p></header><div id="app" aria-busy="true">Loading patch project...</div></main><script nonce="${options.nonce}" src="${options.scriptSrc}"></script></body></html>`;
}
