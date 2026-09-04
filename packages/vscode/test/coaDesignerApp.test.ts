/**
 * The Coat of Arms Designer's app, booted in jsdom from the REAL page markup
 * (html.ts) and the REAL app bundle (built the way compile:webview builds it),
 * with the host stubbed by a message recorder.
 *
 * What it pins is the four decisions a reader cannot check by eye, each of
 * them a rule taken from the game's own designer files:
 *
 * - "Start From Scratch" is the game's `coa_designer_blank_default` template,
 *   not something this panel invented;
 * - picking a layout keeps the pattern and the colors and replaces only the
 *   emblem layers, substituting the layout's `@texture_*` / `@color_*` holes;
 * - picking an emblem fits the layer's color slots to the `colors` count that
 *   emblem declares in `50_coa_designer_emblems.txt`;
 * - a mirror is a NEGATIVE scale on that axis, which is how the game writes
 *   a flipped instance.
 *
 * The catalog is a hand-cut miniature of the real files, not a capture: these
 * cases are about what the app does with a catalog, and the readers that turn
 * the game's files into one have their own tests in server/test/coa.test.ts.
 *
 * jsdom has no canvas and no IntersectionObserver; both are stubbed as plumbing
 * (a no-op 2d context and an observer that never fires), so nothing the panel
 * decides is mocked.
 */
import { describe, expect, it } from "vitest";
import * as path from "path";
import { JSDOM, VirtualConsole } from "jsdom";
import { buildSync } from "esbuild";
import { parseCoaFile } from "@px-lsp/server/coa/coaParse";
import type { CoaFlag } from "@px-lsp/server/coa/coa";
import { coaDesignerHtml } from "../src/webviews/coaDesigner/html";
import type { AppToHost, HostToApp } from "../src/webviews/coaDesigner/messages";
import type { DesignerCatalog, FlagDatabase } from "../src/webviews/flagBuilder/messages";

const PKG_ROOT = path.join(__dirname, "..");

let cachedBundle: string | null = null;
function appBundle(): string {
  if (cachedBundle) return cachedBundle;
  cachedBundle = buildSync({
    entryPoints: [path.join(PKG_ROOT, "src", "webviews", "coaDesigner", "app", "main.ts")],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    absWorkingDir: PKG_ROOT,
    loader: { ".css": "text" },
    write: false,
  }).outputFiles[0].text;
  return cachedBundle;
}

function panelHtml(): string {
  const html = coaDesignerHtml({ scriptSrc: "app.js", nonce: "test", csp: "" });
  return html.replace(/<script nonce="test" src="app.js"><\/script>/, `<script>${appBundle()}</script>`);
}

// The template the game ships (99_coa_designer_templates.txt), with its
// `list "…"` colors already resolved the way the catalog reader resolves them.
const TEMPLATE = parseCoaFile(
  `coa_designer_blank_default = {
	pattern = "pattern_solid.dds"
	color1 = "red"
	color2 = "yellow"
	colored_emblem = {
		texture = "ce_fleur.dds"
		color1 = color2
		instance = { position = { 0.5 0.5 } scale = { 0.7 0.7 } }
	}
}`
)[0];

// One layout, in the placeholder form the layouts file writes: two emblems.
const LAYOUT = parseCoaFile(
  `coa_designer_diagonal_duo = {
	pattern = @pattern
	color1 = @color_1
	colored_emblem = {
		texture = @texture_1
		color1 = @color_2
		instance = { position = { 0.3 0.3 } scale = { 0.4 0.4 } }
		instance = { position = { 0.7 0.7 } scale = { 0.4 0.4 } }
	}
}`
)[0];

const CATALOG: DesignerCatalog = {
  patterns: [
    { file: "pattern_solid.dds", colors: 1, visible: true, category: "" },
    { file: "pattern_bend_01.dds", colors: 2, visible: true, category: "" },
  ],
  emblems: [
    { file: "ce__empty_designer.dds", colors: 0, visible: true, category: "abstract" },
    { file: "ce_lion.dds", colors: 2, visible: true, category: "abstract" },
    { file: "ce_dot.dds", colors: 1, visible: true, category: "abstract" },
  ],
  categories: ["abstract"],
  palette: [
    { name: "red", rgb: [255, 0, 0] },
    { name: "yellow", rgb: [255, 255, 0] },
  ],
  layouts: [{ name: LAYOUT.name, flag: LAYOUT }],
  layoutDefaults: {
    "@pattern": "pattern_solid.dds",
    "@color_1": "grey",
    "@color_2": "white",
    "@color_3": "black",
    "@texture_1": "ce_fleur.dds",
    "@texture_2": "ce_crown_small.dds",
  },
  template: TEMPLATE,
  frames: [{ id: "title", label: "Title" }],
  emptyEmblem: "ce__empty_designer.dds",
};

const DB: FlagDatabase = {
  gameName: "Test Game",
  textures: { patterns: [], colored_emblems: [], textured_emblems: [] },
  namedColors: { red: [255, 0, 0], yellow: [255, 255, 0], white: [255, 255, 255], grey: [128, 128, 128] },
  flags: [],
  definitions: {},
  gameMissing: false,
  designer: CATALOG,
};

interface Booted {
  window: Window & typeof globalThis;
  document: Document;
  posted: AppToHost[];
  /** The definition the panel would save, parsed back out of its own writer. */
  current(): CoaFlag;
  click(selector: string): void;
  tab(name: "background" | "layout" | "emblems"): void;
  /** Send the app a host message, as the host would. */
  push(message: HostToApp): void;
  /** Anything the page threw. jsdom swallows handler errors into its console. */
  errors: string[];
}

function boot(): Booted {
  const posted: AppToHost[] = [];
  const errors: string[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e: Error) => errors.push(String(e.message ?? e)));
  virtualConsole.on("error", (...args: unknown[]) => errors.push(args.map(String).join(" ")));
  const dom = new JSDOM(panelHtml(), {
    virtualConsole,
    runScripts: "dangerously",
    beforeParse(win) {
      const w = win as unknown as Record<string, unknown>;
      w.acquireVsCodeApi = () => ({ postMessage: (msg: AppToHost) => posted.push(msg) });
      // Plumbing jsdom has none of. The canvas swallows every call; the
      // observer never fires, so a tile paints only when something asks it to.
      const context = new Proxy(
        { measureText: (t: string) => ({ width: t.length * 7 }) },
        { get: (target, key) => (key in target ? target[key as keyof typeof target] : () => undefined) }
      );
      win.HTMLCanvasElement.prototype.getContext = (() =>
        context) as unknown as HTMLCanvasElement["getContext"];
      w.IntersectionObserver = class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      };
      const noop = (): undefined => undefined;
      (win.Element.prototype as unknown as Record<string, unknown>).setPointerCapture = noop;
      (win.Element.prototype as unknown as Record<string, unknown>).releasePointerCapture = noop;
    },
  });
  const window = dom.window as unknown as Window & typeof globalThis;
  const push = (message: HostToApp): void => {
    window.dispatchEvent(new window.MessageEvent("message", { data: message }));
  };
  push({ type: "init", db: DB, mods: [{ label: "test_mod", path: "/mods/test" }] });

  const click = (selector: string): void => {
    const el = window.document.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`no element for ${selector}`);
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  };
  return {
    window,
    document: window.document,
    posted,
    errors,
    click,
    push,
    tab: (name) => click(`.px-tab[data-tab="${name}"]`),
    current: () => {
      click("#copy");
      const last = [...posted].reverse().find((m) => m.type === "copy");
      if (!last || last.type !== "copy") throw new Error("the panel copied nothing");
      return parseCoaFile(last.text)[0];
    },
  };
}

describe("the Coat of Arms Designer boots on the game's own catalog", () => {
  it("Start From Scratch is the game's blank template", () => {
    const app = boot();
    const flag = app.current();
    expect(flag.pattern).toBe(TEMPLATE.pattern);
    expect(flag.colors).toEqual(TEMPLATE.colors);
    expect(flag.layers).toEqual(TEMPLATE.layers);
  });

  it("picking a layout replaces the layers and keeps the pattern and colors", () => {
    const app = boot();
    app.tab("layout");
    app.click("#layoutGrid .tile");
    const flag = app.current();
    expect(flag.pattern).toBe("pattern_solid.dds");
    expect(flag.colors).toEqual(TEMPLATE.colors);
    // The layout's two instances, with the design's own emblem in the
    // @texture_1 hole rather than the layouts file's default.
    expect(flag.layers).toHaveLength(1);
    const layer = flag.layers[0];
    if (layer.kind !== "colored_emblem") throw new Error("expected a colored emblem");
    expect(layer.texture).toBe("ce_fleur.dds");
    expect(layer.instances.map((i) => i.position)).toEqual([
      [0.3, 0.3],
      [0.7, 0.7],
    ]);
  });

  it("picking an emblem fits the layer's color slots to the emblem's count", () => {
    const app = boot();
    app.tab("emblems");
    const tiles = (): NodeListOf<HTMLElement> =>
      app.document.querySelectorAll<HTMLElement>("#emblemBody .grid .tile");
    // The catalog's order: empty (0 colors), ce_lion (2), ce_dot (1).
    tiles()[1].dispatchEvent(new app.window.MouseEvent("click", { bubbles: true }));
    let layer = app.current().layers[0];
    if (layer.kind !== "colored_emblem") throw new Error("expected a colored emblem");
    expect(layer.texture).toBe("ce_lion.dds");
    expect(layer.colors.map((c) => c.name)).toEqual(["color1", "color2"]);

    tiles()[2].dispatchEvent(new app.window.MouseEvent("click", { bubbles: true }));
    layer = app.current().layers[0];
    if (layer.kind !== "colored_emblem") throw new Error("expected a colored emblem");
    expect(layer.texture).toBe("ce_dot.dds");
    expect(layer.colors.map((c) => c.name)).toEqual(["color1"]);
  });

  it("Mirror horizontally writes a negative scale on that axis alone", () => {
    const app = boot();
    app.tab("emblems");
    const flip = [...app.document.querySelectorAll<HTMLElement>("#placement .selTools button")].find(
      (b) => b.dataset.tip === "Mirror horizontally"
    );
    if (!flip) throw new Error("no mirror tool");
    flip.dispatchEvent(new app.window.MouseEvent("click", { bubbles: true }));
    const layer = app.current().layers[0];
    if (layer.kind !== "colored_emblem") throw new Error("expected a colored emblem");
    expect(layer.instances[0].scale).toEqual([-0.7, 0.7]);

    // Placement lives in the LEFT panel, so it survives a tab that is not Emblems.
    app.tab("background");
    expect(app.document.querySelectorAll("#placement .px-field").length).toBeGreaterThan(0);
    expect(app.document.querySelector("#emblemBody .px-field")).toBeNull();
    expect(app.errors).toEqual([]);
  });

  it("the scale lock is closed before anyone touches it", () => {
    const app = boot();
    app.tab("emblems");
    expect(app.document.querySelector("#scaleLock")?.getAttribute("aria-pressed")).toBe("true");
    // And it bites: one axis pulls the other with it.
    const scaleY = [...app.document.querySelectorAll<HTMLElement>("#placement .px-field")].find((f) =>
      f.querySelector(".px-label")?.textContent?.startsWith("Scale")
    );
    const input = scaleY!.querySelector<HTMLInputElement>("input")!;
    input.value = "0.4";
    input.dispatchEvent(new app.window.Event("input", { bubbles: true }));
    const layer = app.current().layers[0];
    if (layer.kind !== "colored_emblem") throw new Error("expected a colored emblem");
    expect(layer.instances[0].scale).toEqual([0.4, 0.4]);
  });

  it("selecting every instance of an emblem and centring them moves all of them", () => {
    const app = boot();
    app.tab("layout");
    // The layout puts the design's emblem down twice, at 0.3 and at 0.7.
    app.click("#layoutGrid .tile");
    app.tab("emblems");
    const selectAll = [...app.document.querySelectorAll<HTMLElement>("#layerList button")].find((b) =>
      b.dataset.tip?.startsWith("Select all")
    );
    if (!selectAll) throw new Error("no select-all-instances action");
    selectAll.dispatchEvent(new app.window.MouseEvent("click", { bubbles: true }));

    const centre = [...app.document.querySelectorAll<HTMLElement>("#placement .selTools button")].find(
      (b) => b.dataset.tip === "Centre horizontally, to the selection"
    );
    if (!centre) throw new Error("no align tool for a multi-selection");
    centre.dispatchEvent(new app.window.MouseEvent("click", { bubbles: true }));

    const layer = app.current().layers[0];
    if (layer.kind !== "colored_emblem") throw new Error("expected a colored emblem");
    const xs = layer.instances.map((i) => i.position[0]);
    expect(xs).toHaveLength(2);
    expect(xs[0]).toBe(xs[1]);
    // Only that axis moved.
    expect(layer.instances.map((i) => i.position[1])).toEqual([0.3, 0.7]);
  });

  it("the library overlay shows a stored design, and a file it cannot read", async () => {
    const app = boot();
    // Import asks about unsaved work first, so the request is one tick out.
    app.click("#libImport");
    await Promise.resolve();
    expect(app.posted.some((m) => m.type === "libraryList")).toBe(true);
    app.push({
      type: "library",
      dir: "C:/docs/px-toolkit/coat_of_arms",
      items: [
        { name: "stored_coa", file: "stored_coa.txt", flag: { ...TEMPLATE, name: "stored_coa" } },
        { name: "notes", file: "notes.txt", flag: null },
      ],
    });
    const names = [...app.document.querySelectorAll("#libGrid .libItem .px-label")].map((n) => n.textContent);
    expect(names).toEqual(["stored_coa", "notes"]);
    expect(app.document.querySelectorAll("#libGrid .libBroken")).toHaveLength(1);

    // Picking one loads it under the name the library kept.
    app.document
      .querySelector<HTMLElement>("#libGrid .tile")!
      .dispatchEvent(new app.window.MouseEvent("click", { bubbles: true }));
    expect(app.document.querySelector(".px-dialog-backdrop")).toBeNull();
    expect(app.current().name).toBe("stored_coa");
    expect(app.errors).toEqual([]);
  });

  it("an empty library names the folder instead of showing nothing", async () => {
    const app = boot();
    app.click("#libImport");
    await Promise.resolve();
    app.push({ type: "library", dir: "C:/docs/px-toolkit/coat_of_arms", items: [] });
    const text = app.document.querySelector(".px-dialog")?.textContent ?? "";
    expect(text).toContain("Nothing here yet");
    expect(text).toContain("C:/docs/px-toolkit/coat_of_arms");
  });
});
