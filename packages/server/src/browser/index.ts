/**
 * `@px-lsp/server/browser` — the language service without node.
 *
 * Completion, hover, diagnostics and scope inference against a single in-memory
 * document, with no filesystem, no workspace scan and no LSP transport. The
 * token tables come in as JSON baked by `scripts/bake-browser-data.ts`; the
 * host decides whether to bundle them or fetch them.
 *
 *   import { createBrowserLanguageService } from "@px-lsp/server/browser";
 *   import tokens from "@px-lsp/server/browser-data/<gameId>/tokens.json";
 *
 *   const svc = createBrowserLanguageService({ tokens });
 *   const doc = svc.openDocument("events/tutorial.txt", text);
 *   doc.diagnostics();
 *   doc.completions(offset);
 *
 * Read `capabilities` before showing results to a user: this build cannot see
 * any file except the one open, and says so rather than guessing.
 */
export {
  createBrowserLanguageService,
  activeGameId,
  type BrowserCapabilities,
  type BrowserDocument,
  type BrowserLanguageService,
  type BrowserServiceOptions,
} from "./service";

export { BROWSER_DATA_VERSION, toTokenData, type BakedDocs, type BakedToken, type BakedTokens } from "./data";
