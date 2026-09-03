/**
 * Creator preview server: every content creator's REAL page and bundle over
 * the REAL language server, in a browser, without VS Code.
 *
 *   pnpm run preview:creators [-- --port 5331]
 *   http://localhost:5331/creator/traitCreator      (dynastyTree, legacyCreator,
 *                                                     cultureCreator, coaDesigner)
 *
 * The server bundle (packages/server/dist/server.js, so `pnpm run compile`
 * first) is forked over node IPC with the game and mod from dev-paths.json and
 * indexes the whole install once (about a minute). A stub host in the page
 * proxies every app message to this process over fetch; HANDLERS below is a
 * reduced port of each panel.ts: reads are real (forms, loc, icons through
 * the same texture cache the extension uses), writes are refused with a toast.
 *
 * Scripted states for screenshots go in the hash:
 *   #open=<definition>     load that definition (a dynasty id, a trait key...)
 *   #wait=5000             delay before the steps run (ms)
 *   #steps=click:.perktile;hover:.tile;click:text=Emblems
 *   #light                 the light theme
 * Not a build step, not shipped: a dev tool next to preview:webviews.
 */
import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { fork, type ChildProcess } from "child_process";
import { buildSync } from "esbuild";
import {
  createMessageConnection,
  IPCMessageReader,
  IPCMessageWriter,
  type MessageConnection,
} from "vscode-jsonrpc/node";
import { devPath, requireDevPath } from "./devPaths";
import type { DefinitionForm, LocEntryInfo, ModifierFormatsResult } from "../packages/protocol/src/protocol";

const ROOT = process.cwd();
const VSCODE = path.join(ROOT, "packages/vscode");
const gamePath = requireDevPath("gamePath", "creator-preview");
const modPath = requireDevPath("modPath", "creator-preview");
const logsPath = devPath("logsPath");
const portArg = process.argv.indexOf("--port");
const port = Number(portArg >= 0 ? process.argv[portArg + 1] : 5331);

import { GuiTextureCache } from "../packages/vscode/src/webviews/guiEditor/textureCache";
import {
  perkLinks,
  commonPerkCount,
  perksOfTrack,
} from "../packages/vscode/src/webviews/legacyCreator/perkIndex";
import { buildCatalog } from "../packages/vscode/src/webviews/cultureCreator/catalog";
import { parseNamedColors } from "../packages/server/src/coa/coaParse";
import {
  buildFlagDatabase,
  locateTexture,
  locateDesignerFrame,
} from "../packages/vscode/src/webviews/flagBuilder/database";
const cacheDir = path.join(ROOT, "dist/preview/texture-cache");
fs.mkdirSync(cacheDir, { recursive: true });
const cache = new GuiTextureCache(cacheDir, { gamePath, modPath });
const roots = [gamePath, modPath];

function imageUrl(rel: string, maxDim = 0): string | null {
  if (rel.includes("..") || path.isAbsolute(rel)) return null;
  for (let i = roots.length - 1; i >= 0; i--) {
    const abs = path.join(roots[i], rel);
    if (!fs.existsSync(abs)) continue;
    const png = cache.resolveFile(abs, maxDim);
    if (png) return `/textures/${path.relative(cacheDir, png).replace(/\\/g, "/")}`;
  }
  return null;
}
const images = (keys: string[], maxDim = 0): Record<string, string | null> =>
  Object.fromEntries(keys.map((k) => [k, imageUrl(k, maxDim)]));

// ---- language server ------------------------------------------------------
let conn: MessageConnection;
let child: ChildProcess;
let ready = false;
const toUri = (p: string): string => "file:///" + p.replace(/\\/g, "/").replace(/^\//, "");

async function startServer(): Promise<void> {
  child = fork(path.join(ROOT, "packages/server/dist/server.js"), ["--node-ipc"], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    silent: true,
  });
  child.stderr?.on("data", (d) => process.stderr.write(String(d)));
  conn = createMessageConnection(new IPCMessageReader(child), new IPCMessageWriter(child));
  let last: { indexing?: boolean; definitions?: number } = {};
  conn.onNotification("paradox/status", (p: typeof last) => {
    last = p;
  });
  conn.onNotification(() => undefined);
  conn.onRequest("window/workDoneProgress/create", () => null);
  conn.listen();
  await conn.sendRequest("initialize", {
    processId: process.pid,
    rootUri: toUri(modPath),
    workspaceFolders: [{ uri: toUri(modPath), name: "preview" }],
    capabilities: {},
    initializationOptions: {
      storageDir: path.join(ROOT, "dist/preview/storage"),
      wikidocsDir: path.join(ROOT, "packages/server/data/ck3/wikidocs"),
      clientCommands: true,
      settings: {
        gamePath,
        logsPath,
        modPath,
        parentPaths: [],
        workspaceMods: [],
        locLanguage: "english",
        scopeInlayHints: false,
        diagnosticsIgnore: [],
        diagnosticsIgnorePatterns: [],
        diagnosticsVanilla: false,
      },
    },
  });
  await conn.sendNotification("initialized", {});
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (last.indexing === false && (last.definitions ?? 0) > 1000) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  ready = true;
  console.log("server ready:", JSON.stringify(last));
}
const req = <T>(method: string, params: unknown): Promise<T> => conn.sendRequest<T>(method, params);

// ---- per-creator hosts ----------------------------------------------------
type Reply = Record<string, unknown>;
type Handler = (m: Record<string, unknown>) => Promise<Reply[]>;
const refuse = (what: string): Reply => ({
  type: "toast",
  message: `preview: ${what} is not written here`,
  variant: "destructive",
});
const mods = [{ label: path.basename(modPath), path: modPath }];

// ---- shared creator helpers ----
const form = (kind: string, name?: string): Promise<DefinitionForm> =>
  req("paradox/definitionForm", { kind, ...(name ? { name } : {}), modRoot: modPath });
async function lookup(keys: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const r = await req<{ value?: string }[]>("paradox/lookupLoc", { key });
    const v = r.find((e) => e.value !== undefined)?.value;
    if (v !== undefined) out[key] = v;
  }
  return out;
}
function iconEntries(folder: string | undefined): { key: string; url: string; source: string }[] {
  if (!folder) return [];
  const found = new Map<string, { key: string; url: string; source: string }>();
  for (const root of roots) {
    const dir = path.join(root, folder);
    let files: string[] = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".dds"));
    } catch {
      continue;
    }
    for (const f of files) {
      const url = imageUrl(`${folder}/${f}`, 256);
      if (url)
        found.set(f.slice(0, -4), {
          key: f.slice(0, -4),
          url,
          source: root === gamePath ? "game" : path.basename(root),
        });
    }
  }
  return [...found.values()].sort((a, b) => a.key.localeCompare(b.key));
}
function allPerkLinks(folder: string) {
  const links: ReturnType<typeof perkLinks> = [];
  for (const root of roots) {
    const dir = path.join(root, folder);
    let files: string[] = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".txt"));
    } catch {
      continue;
    }
    for (const f of files) {
      try {
        links.push(...perkLinks(fs.readFileSync(path.join(dir, f), "utf8")));
      } catch {
        /* skip */
      }
    }
  }
  return links;
}
async function refIconFolders(f: DefinitionForm): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const kind of new Set<string>(f.keys.flatMap((k) => k.refKinds ?? []))) {
    const rf = await form(kind);
    if (rf?.iconFolder) out[kind] = rf.iconFolder;
  }
  return out;
}

const HANDLERS: Record<string, { html: string; entry: string; handle: Handler }> = {
  cultureCreator: {
    html: "src/webviews/cultureCreator/html.ts",
    entry: "src/webviews/cultureCreator/app/main.ts",
    handle: async (m) => {
      const load = async (name?: string) => {
        const f = await form("culture", name);
        const namedColors: Record<string, [number, number, number]> = {};
        for (const root of roots) {
          const dir = path.join(root, "common/named_colors");
          try {
            for (const file of fs
              .readdirSync(dir)
              .filter((x) => x.endsWith(".txt"))
              .sort())
              Object.assign(namedColors, parseNamedColors(fs.readFileSync(path.join(dir, file), "utf8")));
          } catch {
            /* none */
          }
        }
        const describe = [...(f.options.culture_pillar ?? []), ...(f.options.culture_tradition ?? [])].map(
          (i) => i.value
        );
        const catalog = await buildCatalog(roots, describe, (key: string) =>
          req<LocEntryInfo[]>("paradox/lookupLoc", { key })
        );
        return [
          {
            type: "init",
            init: {
              form: f,
              saveMod: path.basename(modPath),
              locLanguage: "english",
              prefix: "cult",
              namedColors,
              catalog,
              noMod: false,
              noGame: false,
            },
          },
        ];
      };
      switch (m.type) {
        case "ready":
        case "new":
          return load();
        case "open":
        case "load":
          return load(String(m.name));
        case "images":
          return [{ type: "images", urls: images(m.keys as string[], (m.maxDim as number) ?? 0) }];
        default:
          return String(m.type) === "save" ? [refuse("save")] : [];
      }
    },
  },
  traitCreator: {
    html: "src/webviews/traitCreator/html.ts",
    entry: "src/webviews/traitCreator/app/main.ts",
    handle: async (m) => {
      const iconKeys = (f: DefinitionForm): string[] => {
        const seen = new Set<string>();
        if (!f.iconFolder) return [];
        for (const root of roots) {
          try {
            for (const file of fs.readdirSync(path.join(root, f.iconFolder)).sort())
              if (/\.(dds|tga|png)$/i.test(file)) seen.add(file);
          } catch {
            /* none */
          }
        }
        return [...seen];
      };
      switch (m.type) {
        case "ready": {
          const f = await form("trait");
          const formats = await req<ModifierFormatsResult | null>("paradox/modifierFormats", {
            modRoot: modPath,
          });
          return [
            {
              type: "init",
              init: {
                form: f,
                locLanguage: "english",
                prefix: "cult",
                iconKeys: iconKeys(f),
              },
            },
            // The host resolves where a save lands; here the default name is
            // enough to show the line the panel draws.
            {
              type: "target",
              target: { modLabel: path.basename(modPath), path: `${f.folder}/cult_traits.txt` },
            },
            { type: "modifierFormats", formats: formats?.formats ?? null },
          ];
        }
        case "open":
        case "load": {
          const f = await form("trait", String(m.name));
          return f ? [{ type: "form", form: f }] : [];
        }
        case "icons": {
          const f = await form("trait");
          const urls: Record<string, string | null> = {};
          for (const key of m.keys as string[]) urls[key] = imageUrl(`${f.iconFolder}/${key}`, 96);
          return [{ type: "icons", urls }];
        }
        case "images":
          return [{ type: "images", urls: images(m.keys as string[], (m.maxDim as number) ?? 0) }];
        case "loc":
          return [{ type: "loc", values: await lookup(m.keys as string[]) }];
        default:
          return ["save", "convertIcon"].includes(String(m.type)) ? [refuse(String(m.type))] : [];
      }
    },
  },
  legacyCreator: {
    html: "src/webviews/legacyCreator/html.ts",
    entry: "src/webviews/legacyCreator/app/main.ts",
    handle: async (m) => {
      switch (m.type) {
        case "ready": {
          const [legacy, perk, formats] = await Promise.all([
            form("dynasty_legacy"),
            form("dynasty_perk"),
            req<ModifierFormatsResult | null>("paradox/modifierFormats", { modRoot: modPath }),
          ]);
          return [
            {
              type: "init",
              init: {
                legacy,
                perk,
                formats: formats?.formats ?? null,
                refIconFolders: await refIconFolders(perk),
                modLabel: path.basename(modPath),
                locLanguage: "english",
                prefix: "cult",
                perksPerTrack: commonPerkCount(allPerkLinks(perk.folder)),
                icons: iconEntries(legacy.iconFolder),
                problem: null,
              },
            },
          ];
        }
        case "open":
        case "load": {
          const name = String(m.name);
          const track = await form("dynasty_legacy", name);
          const perkForm = await form("dynasty_perk");
          const perks: { name: string; file: string; source: string; text: string }[] = [];
          for (const n of perksOfTrack(allPerkLinks(perkForm.folder), name)) {
            const f = await form("dynasty_perk", n);
            if (f?.current)
              perks.push({ name: n, file: f.current.file, source: f.current.source, text: f.current.text });
          }
          const keys = [
            ...track.locPatterns.map((p: string) => p.replace(/\$/g, name)),
            ...perks.flatMap((pk) => perkForm.locPatterns.map((p: string) => p.replace(/\$/g, pk.name))),
          ];
          return [{ type: "loaded", track, perks, loc: await lookup(keys) }];
        }
        case "images":
          return [{ type: "images", urls: images(m.keys as string[], (m.maxDim as number) ?? 0) }];
        case "loc":
          return [{ type: "locValues", values: await lookup(m.keys as string[]) }];
        default:
          return String(m.type) === "save" || String(m.type) === "customIcon" ? [refuse(String(m.type))] : [];
      }
    },
  },
  coaDesigner: {
    html: "src/webviews/coaDesigner/html.ts",
    entry: "src/webviews/coaDesigner/app/main.ts",
    handle: async (m) => {
      const flagRoots = [
        { label: "game", path: gamePath },
        { label: path.basename(modPath), path: modPath },
      ];
      const db = () => buildFlagDatabase("Crusader Kings III", flagRoots, undefined, false, true);
      switch (m.type) {
        case "ready":
          return [
            { type: "init", db: db(), mods },
            {
              type: "target",
              target: {
                modLabel: mods[0]?.label ?? path.basename(modPath),
                path: "common/coat_of_arms/coat_of_arms/preview_coat_of_arms.txt",
              },
            },
          ];
        case "textures": {
          const urls: Record<string, string | null> = {};
          for (const key of m.keys as string[]) {
            const slash = key.indexOf("/");
            const kind = key.slice(0, slash);
            const rest = key.slice(slash + 1);
            const abs =
              kind === "frames" || kind === "masks"
                ? locateDesignerFrame(flagRoots, undefined, rest, kind === "masks")
                : locateTexture(flagRoots, undefined, kind as never, rest);
            const png = abs ? cache.resolveFile(abs, m.thumbs ? 96 : 0) : null;
            urls[key] = png ? `/textures/${path.relative(cacheDir, png).split(path.sep).join("/")}` : null;
          }
          return [{ type: "textures", urls, thumbs: m.thumbs }];
        }
        case "open": {
          const d = db();
          const name = (m.name as string) || "k_france";
          const entry = d.flags.find((f) => f.name === name) ?? d.flags[0];
          return entry ? [{ type: "opened", entry, flag: d.definitions[entry.name] }] : [];
        }
        default:
          return ["save", "paste", "exportPng", "copy", "changeTarget"].includes(String(m.type))
            ? [refuse(String(m.type))]
            : [];
      }
    },
  },
  dynastyTree: {
    html: "src/webviews/dynastyTree/html.ts",
    entry: "src/webviews/dynastyTree/app/main.ts",
    handle: async (m) => {
      switch (m.type) {
        case "ready": {
          const t0 = Date.now();
          const r = await req<Record<string, unknown>>("paradox/dynastyTree", { modRoot: modPath });
          return [
            { type: "init", gameName: "Crusader Kings III", mods },
            {
              type: "list",
              supported: r.supported,
              dynasties: r.dynasties,
              nextDynastyId: r.nextDynastyId ?? "1",
              nextCharacterId: r.nextCharacterId ?? "1",
              ms: Date.now() - t0,
            },
          ];
        }
        case "list": {
          const t0 = Date.now();
          const r = await req<Record<string, unknown>>("paradox/dynastyTree", { modRoot: modPath });
          return [
            {
              type: "list",
              supported: r.supported,
              dynasties: r.dynasties,
              nextDynastyId: r.nextDynastyId ?? "1",
              nextCharacterId: r.nextCharacterId ?? "1",
              ms: Date.now() - t0,
            },
          ];
        }
        case "open": {
          const t0 = Date.now();
          const r = await req<Record<string, unknown>>("paradox/dynastyTree", {
            modRoot: modPath,
            dynasty: m.dynasty,
          });
          const sets: Record<string, unknown> = {};
          for (const [kind, seed] of [
            ["culture", "norse"],
            ["religion", "catholic"],
            ["trait", "brave"],
          ]) {
            try {
              const o = await req<{ items?: unknown[] }>("paradox/eventValueOptions", {
                modRoot: modPath,
                value: seed,
                kind,
              });
              sets[kind] = o?.items ?? [];
            } catch {
              sets[kind] = [];
            }
          }
          return [
            {
              type: "tree",
              tree: {
                dynasty: r.dynasty,
                houses: r.houses ?? [],
                characters: r.characters ?? [],
                nextCharacterId: r.nextCharacterId ?? "1",
              },
              ms: Date.now() - t0,
            },
            { type: "options", sets },
          ];
        }
        default:
          return m.type?.toString().startsWith("save") ? [refuse(String(m.type))] : [];
      }
    },
  },
};

// ---- pages ----------------------------------------------------------------
const VARS_DARK =
  "--vscode-editor-background:#1f1f1f;--vscode-editor-foreground:#cccccc;--vscode-font-family:'Segoe UI',system-ui,sans-serif;--vscode-editor-font-family:Consolas,monospace;--vscode-font-size:13px;--vscode-button-background:#0078d4;--vscode-button-foreground:#fff;--vscode-button-hoverBackground:#026ec1;--vscode-errorForeground:#f85149;--vscode-sideBar-background:#181818;--vscode-focusBorder:#0078d4;--vscode-input-background:#313131;--vscode-input-foreground:#ccc;--vscode-input-border:#3c3c3c;--vscode-widget-border:#313131;--vscode-descriptionForeground:#9d9d9d";
const VARS_LIGHT =
  "--vscode-editor-background:#fff;--vscode-editor-foreground:#3b3b3b;--vscode-font-family:'Segoe UI',system-ui,sans-serif;--vscode-editor-font-family:Consolas,monospace;--vscode-font-size:13px;--vscode-button-background:#005fb8;--vscode-button-foreground:#fff;--vscode-button-hoverBackground:#0258a8;--vscode-errorForeground:#cd3131;--vscode-sideBar-background:#f8f8f8;--vscode-focusBorder:#005fb8;--vscode-input-background:#fff;--vscode-input-foreground:#3b3b3b;--vscode-input-border:#cecece;--vscode-widget-border:#e5e5e5;--vscode-descriptionForeground:#717171";

const STUB_TEMPLATE = `<script>
(() => {
  const light = location.hash.includes("light");
  document.documentElement.style.cssText = light ? __VARS_LIGHT__ : __VARS_DARK__;
  document.addEventListener("DOMContentLoaded", () => document.body.classList.add(light ? "vscode-light" : "vscode-dark"));
  const dispatch = (m) => window.dispatchEvent(new MessageEvent("message", { data: m }));
  let state;
  window.acquireVsCodeApi = () => ({
    postMessage(m) {
      console.log("app->host", JSON.stringify(m).slice(0, 300));
      fetch("/host/__NAME__", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(m) })
        .then((r) => r.json()).then((replies) => replies.forEach(dispatch));
    },
    getState: () => state,
    setState: (s) => { state = s; },
  });
  window.__afterLoad = [];
  window.addEventListener("load", () => setTimeout(() => {
    const o = /open=([^&#]+)/.exec(location.hash);
    if (o) fetch("/host/__NAME__", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "open", dynasty: o[1], name: o[1] }) }).then((r) => r.json()).then((rs) => rs.forEach(dispatch));
  }, 800));
})();
</script>
<script>
// Scripted steps for screenshots: #steps=click:.card[data-id="8"];click:text=Edit
window.addEventListener("load", () => setTimeout(() => {
  const m = /steps=([^&]+)/.exec(decodeURIComponent(location.hash)); if (!m) return;
  const steps = m[1].split(";"); let i = 0;
  const run = () => { const s = steps[i++]; if (!s) return; const [kind, sel] = s.split(/:(.+)/);
    let el = sel.startsWith("text=") ? [...document.querySelectorAll("button, .px-item, .px-tab")].find((b) => b.textContent.trim() === sel.slice(5)) : document.querySelector(sel);
    if (el) { if (kind === "click") el.dispatchEvent(new MouseEvent("click", { bubbles: true })); if (kind === "hover") { const r = el.getBoundingClientRect(); const o = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }; for (const t of ["pointerover", "pointerenter", "mouseover", "mouseenter", "pointermove", "mousemove"]) el.dispatchEvent(new (t.startsWith("pointer") ? PointerEvent : MouseEvent)(t, o)); } if (kind === "type") { el.value = sel; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); } }
    setTimeout(run, 400); };
  run();
}, Number((/wait=(\\d+)/.exec(location.hash) || [])[1] || 1200)));
</script>`;
const STUB = (name: string): string =>
  STUB_TEMPLATE.replace(/__NAME__/g, name)
    .replace(/__VARS_LIGHT__/g, JSON.stringify(VARS_LIGHT))
    .replace(/__VARS_DARK__/g, JSON.stringify(VARS_DARK));

function creatorPage(name: string): string {
  const h = HANDLERS[name];
  if (!h) return `<h3>unknown creator ${name}; known: ${Object.keys(HANDLERS).join(", ")}</h3>`;
  const bundle = buildSync({
    entryPoints: [path.join(VSCODE, h.entry)],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2020",
    absWorkingDir: VSCODE,
    loader: { ".css": "text" },
  }).outputFiles[0].text;
  // The html module is TS: bundle it for node on the fly and evaluate it.
  const mod = buildSync({
    entryPoints: [path.join(VSCODE, h.html)],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    absWorkingDir: VSCODE,
    loader: { ".css": "text" },
  }).outputFiles[0].text;
  const m = { exports: {} as Record<string, (o: Record<string, string>) => string> };
  new Function("exports", "module", "require", mod)(m.exports, m, require);
  const fn = Object.values(m.exports).find((v) => typeof v === "function")!;
  let html = fn({
    scriptSrc: "app.js",
    nonce: "dev",
    csp: "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:",
  });
  html = html.replace(/<script nonce="dev" src="app.js"><\/script>/, `<script>${bundle}</script>`);
  html = html.replace("<head>", `<head><style>html,body{height:100%;margin:0}</style>${STUB(name)}`);
  return html;
}

http.createServer((rq, rs) => void serve(rq, rs)).listen(port, () => console.log("creator preview on", port));

async function serve(rq: http.IncomingMessage, rs: http.ServerResponse): Promise<void> {
  {
    const url = new URL(rq.url ?? "/", "http://x");
    if (url.pathname.startsWith("/textures/")) {
      const file = path.join(cacheDir, url.pathname.slice("/textures/".length));
      fs.readFile(file, (err, data) => {
        if (err) {
          rs.writeHead(404);
          rs.end();
        } else {
          rs.writeHead(200, { "content-type": "image/png" });
          rs.end(data);
        }
      });
      return;
    }
    if (url.pathname.startsWith("/host/")) {
      const name = url.pathname.slice(6);
      let body = "";
      for await (const c of rq) body += c;
      if (!ready) {
        rs.writeHead(200, { "content-type": "application/json" });
        rs.end(JSON.stringify([{ type: "toast", message: "server still indexing" }]));
        return;
      }
      try {
        const replies = await HANDLERS[name].handle(JSON.parse(body));
        rs.writeHead(200, { "content-type": "application/json" });
        rs.end(JSON.stringify(replies));
      } catch (e) {
        console.error("host error", name, e);
        rs.writeHead(200, { "content-type": "application/json" });
        rs.end(JSON.stringify([{ type: "toast", message: String(e), variant: "destructive" }]));
      }
      return;
    }
    if (url.pathname.startsWith("/creator/")) {
      rs.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      try {
        rs.end(creatorPage(url.pathname.slice(9)));
      } catch (e) {
        console.error(e);
        rs.end(`<pre>${String(e)}</pre>`);
      }
      return;
    }
    rs.writeHead(200, { "content-type": "text/html" });
    rs.end(
      `<p>${ready ? "ready" : "indexing"}</p>` +
        Object.keys(HANDLERS)
          .map((n) => `<a href="/creator/${n}">${n}</a><br>`)
          .join("")
    );
  }
}

void startServer();
