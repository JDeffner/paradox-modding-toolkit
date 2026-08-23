/**
 * Render the GUI editor as a static page for a quick visual check without VS
 * Code: the real bundle, the real page, a real layout of one .gui file (game +
 * mod store, resolved text), textures from the same cache the host uses, and
 * a stub host that answers what a static page can (layout, vocabulary,
 * widget info) and says so for the rest.
 *
 *   npx esbuild scripts/gui-preview-page.ts --bundle --platform=node --format=cjs --outfile=dist/gui-preview-page.cjs
 *   node dist/gui-preview-page.cjs <file.gui> <out.html> [--game <path>] [--mod <path>]
 *
 * Paths default to dev-paths.json. Not a build step, not shipped.
 */
import * as fs from "fs";
import * as path from "path";
import { computeGuiLayoutResult, getGuiDefs } from "../packages/server/src/gui/layoutService";
import { computeGuiWidgetInfo } from "../packages/server/src/gui/widgetInfo";
import { computeGuiVocabulary } from "../packages/server/src/gui/vocabulary";
import { guiEditorHtml } from "../packages/vscode/src/webviews/guiEditor/html";
import { GuiTextureCache } from "../packages/vscode/src/webviews/guiEditor/textureCache";
import { devPath } from "./devPaths";

const args = process.argv.slice(2);
const file = args[0];
const out = args[1];
if (!file || !out) {
  console.error("usage: node dist/gui-preview-page.cjs <file.gui> <out.html> [--game <path>] [--mod <path>]");
  process.exit(2);
}
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const gamePath = flag("--game") ?? devPath("gamePath") ?? null;
const modPath = flag("--mod") ?? devPath("modPath") ?? null;

const text = fs.readFileSync(file, "utf8");
const result = computeGuiLayoutResult(text, gamePath, modPath, [], [], undefined);
const cacheDir = path.join(path.dirname(out), "texture-cache");
fs.mkdirSync(cacheDir, { recursive: true });
const cache = new GuiTextureCache(cacheDir, { gamePath, modPath });
const textures: Record<string, string | null> = {};
for (const t of result.textures) {
  const png = cache.resolve(t);
  // Relative to the page, so it works served over http as well as from disk.
  textures[t] = png ? path.relative(path.dirname(out), png).replace(/\\/g, "/") : null;
}
const infos: Record<number, unknown> = {};
const visit = (n: { line?: number; editable: boolean; children: typeof result.nodes }): void => {
  if (n.line !== undefined && n.editable && !(n.line in infos)) {
    try {
      infos[n.line] = computeGuiWidgetInfo(text, n.line, getGuiDefs(gamePath, modPath), { placement: true });
    } catch {
      infos[n.line] = null;
    }
  }
  for (const c of n.children) visit(c);
};
for (const n of result.nodes) visit(n);
let vocabulary: unknown = { entries: [], total: 0, properties: {}, commonProperties: [] };
try {
  vocabulary = computeGuiVocabulary(
    text,
    JSON.parse(fs.readFileSync(path.resolve("packages/server/data/ck3/guiSchema.json"), "utf8"))
  );
} catch {
  /* a game without a schema file */
}

const bundle = fs.readFileSync(path.resolve("packages/vscode/dist/webview/guiEditor.js"), "utf8");
const stub = `
const __layout = ${JSON.stringify({
  type: "layout",
  file: path.basename(file),
  result,
  textures,
  visibility: { mode: "showAll" },
  lineHeightRatio: undefined,
})};
const __infos = ${JSON.stringify(infos)};
const __vocabulary = ${JSON.stringify(vocabulary)};
function acquireVsCodeApi() {
  const post = (m) => window.postMessage(m, "*");
  return {
    postMessage(m) {
      switch (m.type) {
        case "ready": case "requestLayout": return post(__layout);
        case "setVisibility": return post({ ...__layout, visibility: { mode: m.mode, checks: m.checks } });
        case "requestWidgetInfo": return post({ type: "widgetInfo", line: m.line, info: __infos[m.line] ?? null });
        case "requestVocabulary": return post({ type: "vocabulary", ...__vocabulary });
        case "requestUserData": return post({ type: "userData", components: [], presets: [] });
        case "requestDependencies": return post({ type: "dependencies", line: m.line, result: null });
        case "requestTextureList": return post({ type: "textureList", entries: [], total: 0, roots: false });
        case "requestLoc": return post({ type: "loc", key: m.key, value: "(static page: no loc index)" });
        case "checkEdit": case "checkOps": case "checkReorder":
          return post({ type: "editVerdict", id: m.id, refused: "static preview page: nothing is written" });
        case "applyEdit": case "applyOps": case "reorder": case "copyBlocks": case "pasteInto": case "saveComponent": case "insertComponent":
          return post({ type: "editVerdict", id: m.id, refused: "static preview page: nothing is written" });
        default: console.log("host <-", m);
      }
    },
  };
}
`;
let html = guiEditorHtml({
  scriptSrc: "app.js",
  nonce: "dev",
  csp: "default-src * 'unsafe-inline' 'unsafe-eval' data: file:",
  fontDataUri: null,
});
html = html.replace(
  '<script nonce="dev" src="app.js"></script>',
  `<script>${stub}</script><script>${bundle}</script>`
);
fs.writeFileSync(out, html);
console.log(
  `wrote ${out}: ${result.nodeCount} nodes, ${Object.values(textures).filter(Boolean).length}/${result.textures.length} textures`
);
