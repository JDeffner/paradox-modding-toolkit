/**
 * A browser dev server for webview UI work, the successor of the one-shot
 * gui-preview-page. Two pages, both rebuilt on save and auto-reloaded, with
 * a Dark/Light toggle standing in for the VS Code theme:
 *
 *   /gallery  the px-ui component gallery (scripts/webview-preview/galleryApp.ts)
 *   /gui      the REAL GUI editor bundle over a stub host: a real layout of
 *             one .gui file (game + mod store), textures from the same cache
 *             the host uses, and honest refusals for what a static host
 *             cannot do (nothing is written)
 *
 *   pnpm run preview:webviews                     (gallery only)
 *   pnpm run preview:webviews -- <file.gui> [--game <path>] [--mod <path>] [--port <n>]
 *
 * Paths default to dev-paths.json. Not a build step, not shipped. For
 * host-integration behavior use the F5 dev host or a test vsix with
 * px.dev.webviewSource; this server is for UI iteration with browser
 * devtools.
 */
import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { context } from "esbuild";
import { computeGuiLayoutResult, getGuiDefs } from "../packages/server/src/gui/layoutService";
import { computeGuiWidgetInfo } from "../packages/server/src/gui/widgetInfo";
import { computeGuiVocabulary } from "../packages/server/src/gui/vocabulary";
import { guiEditorHtml } from "../packages/vscode/src/webviews/guiEditor/html";
import { GuiTextureCache } from "../packages/vscode/src/webviews/guiEditor/textureCache";
import { devPath } from "./devPaths";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const VALUE_FLAGS = ["--game", "--mod", "--port"];
const guiFile = args.find((a, i) => !a.startsWith("--") && !VALUE_FLAGS.includes(args[i - 1] ?? ""));
const gamePath = flag("--game") ?? devPath("gamePath") ?? null;
const modPath = flag("--mod") ?? devPath("modPath") ?? null;
const port = Number(flag("--port") ?? 5317);

const cacheDir = path.resolve("dist", "preview", "texture-cache");
fs.mkdirSync(cacheDir, { recursive: true });
const cache = new GuiTextureCache(cacheDir, { gamePath, modPath });

/** In-memory app bundles, rebuilt on save. */
const bundles = new Map<string, string>();
let version = 0;
const clients = new Set<http.ServerResponse>();
const broadcast = (): void => {
  for (const c of clients) c.write("data: reload\n\n");
};

async function watchApp(name: string, entry: string): Promise<void> {
  const ctx = await context({
    entryPoints: [entry],
    bundle: true,
    write: false,
    outfile: `${name}.js`,
    format: "iife",
    platform: "browser",
    target: "es2020",
    loader: { ".css": "text" },
    plugins: [
      {
        name: "serve",
        setup(build) {
          build.onEnd((result) => {
            const when = new Date().toLocaleTimeString();
            if (result.errors.length) {
              console.log(`[${when}] ${name}: ${result.errors.length} error(s)`);
              return;
            }
            bundles.set(name, result.outputFiles?.[0]?.text ?? "");
            version++;
            broadcast();
            console.log(`[${when}] ${name} rebuilt`);
          });
        },
      },
    ],
  });
  await ctx.watch();
}

/** The theme toggle and the reload listener, appended to every page. */
const CHROME = `<script>
(() => {
  const themes = {
    dark: { cls: "vscode-dark", vars: {
      "--vscode-editor-background": "#1f1f1f", "--vscode-editor-foreground": "#cccccc",
      "--vscode-font-family": "'Segoe UI', system-ui, sans-serif",
      "--vscode-editor-font-family": "Consolas, 'Courier New', monospace", "--vscode-font-size": "13px",
      "--vscode-button-background": "#0078d4", "--vscode-button-foreground": "#ffffff",
      "--vscode-button-hoverBackground": "#026ec1", "--vscode-errorForeground": "#f85149",
      "--vscode-sideBar-background": "#181818" } },
    light: { cls: "vscode-light", vars: {
      "--vscode-editor-background": "#ffffff", "--vscode-editor-foreground": "#3b3b3b",
      "--vscode-font-family": "'Segoe UI', system-ui, sans-serif",
      "--vscode-editor-font-family": "Consolas, 'Courier New', monospace", "--vscode-font-size": "13px",
      "--vscode-button-background": "#005fb8", "--vscode-button-foreground": "#ffffff",
      "--vscode-button-hoverBackground": "#0258a8", "--vscode-errorForeground": "#cd3131",
      "--vscode-sideBar-background": "#f8f8f8" } },
  };
  const bar = document.createElement("div");
  bar.style.cssText = "position:fixed;bottom:10px;right:10px;z-index:2147483647;display:flex;gap:4px;font:12px system-ui;opacity:.85";
  const buttons = {};
  const apply = (name) => {
    const t = themes[name];
    document.body.classList.remove("vscode-dark", "vscode-light");
    document.body.classList.add(t.cls);
    for (const [k, v] of Object.entries(t.vars)) document.documentElement.style.setProperty(k, v);
    for (const [n, b] of Object.entries(buttons)) b.style.outline = n === name ? "2px solid #888" : "none";
    try { localStorage.setItem("px-preview-theme", name); } catch { /* private mode */ }
  };
  for (const name of Object.keys(themes)) {
    const b = document.createElement("button");
    b.textContent = name;
    b.style.cssText = "padding:3px 10px;border-radius:6px;border:1px solid #8886;background:#22222240;color:inherit;cursor:pointer";
    b.addEventListener("click", () => apply(name));
    buttons[name] = b;
    bar.appendChild(b);
  }
  document.body.appendChild(bar);
  let saved = "dark";
  try { saved = localStorage.getItem("px-preview-theme") || "dark"; } catch { /* private mode */ }
  apply(saved);
  new EventSource("/events").onmessage = () => location.reload();
})();
</script>`;

const withChrome = (html: string): string => html.replace("</body>", `${CHROME}</body>`);

/**
 * ui.css read fresh from disk on every page load, NOT from this bundle: the
 * stylesheet is one of the things this server exists to iterate on. The GUI
 * editor page carries a baked copy inside guiEditorHtml, so the fresh one is
 * appended after it and wins the cascade at equal specificity.
 */
const UI_CSS_PATH = path.resolve("packages/vscode/src/webviews/shared/ui.css");
const freshUiCss = (): string => fs.readFileSync(UI_CSS_PATH, "utf8");

const galleryShell = (): string =>
  withChrome(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>px-ui gallery</title><style>${freshUiCss()}</style></head>
<body class="vscode-dark"><script src="/assets/gallery.js?v=${version}"></script></body>
</html>`);

const page = (title: string, body: string): string =>
  withChrome(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title>
<style>body{font:13px system-ui;background:#1f1f1f;color:#ccc;padding:32px;line-height:1.6}
body.vscode-light{background:#fff;color:#3b3b3b} a{color:inherit} code{opacity:.8}</style>
</head><body>${body}</body></html>`);

/** The stub host + page for the real GUI editor bundle, built per request. */
function guiPage(): string {
  if (!guiFile) {
    return page(
      "webview preview",
      `<h3>No .gui file</h3><p>Start the server with one to open the GUI editor here:</p>
       <p><code>pnpm run preview:webviews -- path/to/file.gui</code></p>`
    );
  }
  const text = fs.readFileSync(guiFile, "utf8");
  const result = computeGuiLayoutResult(text, gamePath, modPath, [], [], undefined);
  const textures: Record<string, string | null> = {};
  for (const t of result.textures) {
    const png = cache.resolve(t);
    textures[t] = png ? `/textures/${path.relative(cacheDir, png).replace(/\\/g, "/")}` : null;
  }
  const infos: Record<number, unknown> = {};
  const visit = (n: { line?: number; editable: boolean; children: typeof result.nodes }): void => {
    if (n.line !== undefined && n.editable && !(n.line in infos)) {
      try {
        infos[n.line] = computeGuiWidgetInfo(text, n.line, getGuiDefs(gamePath, modPath), {
          placement: true,
        });
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

  const stub = `
const __layout = ${JSON.stringify({
    type: "layout",
    file: path.basename(guiFile),
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
        case "requestLoc": return post({ type: "loc", key: m.key, value: "(preview server: no loc index)" });
        case "checkEdit": case "checkOps": case "checkReorder":
          return post({ type: "editVerdict", id: m.id, refused: "preview server: nothing is written" });
        case "applyEdit": case "applyOps": case "reorder": case "copyBlocks": case "pasteInto": case "saveComponent": case "insertComponent":
          return post({ type: "editVerdict", id: m.id, refused: "preview server: nothing is written" });
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
    `<script>${stub}</script><script src="/assets/guiEditor.js?v=${version}"></script>`
  );
  html = html.replace("</head>", `<style>${freshUiCss()}</style></head>`);
  return withChrome(html);
}

function serve(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = (req.url ?? "/").split("?")[0];
  const send = (status: number, type: string, body: string | Buffer): void => {
    res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
    res.end(body);
  };
  try {
    if (url === "/") {
      send(
        200,
        "text/html",
        page(
          "webview preview",
          `<h3>Webview preview</h3>
           <p><a href="/gallery">/gallery</a> — the px-ui component gallery</p>
           <p><a href="/gui">/gui</a> — the GUI editor over a stub host${guiFile ? ` (<code>${path.basename(guiFile)}</code>)` : " (no file given)"}</p>
           <p>Pages reload when a bundle or the .gui file changes. The buttons
           bottom-right switch the stand-in VS Code theme.</p>`
        )
      );
    } else if (url === "/gallery") {
      send(200, "text/html", galleryShell());
    } else if (url === "/gui") {
      send(200, "text/html", guiPage());
    } else if (url === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      });
      res.write("\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
    } else if (url.startsWith("/assets/")) {
      const name = url.slice("/assets/".length).replace(/\.js$/, "");
      const js = bundles.get(name);
      if (js === undefined) send(404, "text/plain", "not built");
      else send(200, "text/javascript", js);
    } else if (url.startsWith("/textures/")) {
      const rel = decodeURIComponent(url.slice("/textures/".length));
      const abs = path.resolve(cacheDir, rel);
      if (!abs.startsWith(cacheDir) || !fs.existsSync(abs)) send(404, "text/plain", "no texture");
      else send(200, "image/png", fs.readFileSync(abs));
    } else {
      send(404, "text/plain", "not found");
    }
  } catch (err) {
    send(500, "text/plain", err instanceof Error ? (err.stack ?? err.message) : String(err));
  }
}

async function main(): Promise<void> {
  await watchApp("gallery", path.resolve("scripts/webview-preview/galleryApp.ts"));
  await watchApp("guiEditor", path.resolve("packages/vscode/src/webviews/guiEditor/app/main.ts"));
  const watchFile = (file: string): void => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    fs.watch(file, () => {
      clearTimeout(timer);
      timer = setTimeout(broadcast, 200);
    });
  };
  if (guiFile) watchFile(guiFile);
  watchFile(UI_CSS_PATH);
  http.createServer(serve).listen(port, () => {
    console.log(`webview preview: http://localhost:${port}  (gallery: /gallery, gui editor: /gui)`);
  });
}

void main();
