import { afterEach, describe, expect, it } from "vitest";
import { buildSync } from "esbuild";
import { JSDOM, VirtualConsole } from "jsdom";
import * as path from "path";
import { flagBuilderHtml } from "../src/webviews/flagBuilder/html";
import { coaDesignerHtml } from "../src/webviews/coaDesigner/html";
import { ddsPreviewHtml } from "../src/webviews/ddsPreview/html";
import type { FlagDatabase } from "../src/webviews/flagBuilder/messages";

const db: FlagDatabase = {
  gameName: "Test",
  textures: { patterns: [], colored_emblems: [], textured_emblems: [] },
  namedColors: {},
  flags: [],
  definitions: {},
  gameMissing: true,
};
const doms: JSDOM[] = [];
afterEach(() => doms.splice(0).forEach((dom) => dom.window.close()));

function boot(name: "flagBuilder" | "coaDesigner" | "ddsPreview", error: string | null = null) {
  const options = { scriptSrc: "app.js", nonce: "test", csp: "" };
  const html =
    name === "flagBuilder"
      ? flagBuilderHtml(options)
      : name === "coaDesigner"
        ? coaDesignerHtml(options)
        : ddsPreviewHtml({
            ...options,
            name: "test.dds",
            meta: "",
            dataUri: "data:image/png;base64,",
            error,
          });
  const bundle = buildSync({
    entryPoints: [path.join(__dirname, "../src/webviews", name, "app/main.ts")],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
  }).outputFiles[0].text;
  const posted: { type: string; value?: string; state?: { background?: string }; text?: string }[] = [];
  const errors: string[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e: Error) => errors.push(e.message));
  const dom = new JSDOM(
    html.replace(/<script[^>]+src="app.js"><\/script>/, () => `<script>${bundle}</script>`),
    {
      runScripts: "dangerously",
      url: "http://localhost/",
      virtualConsole,
      beforeParse(win) {
        const w = win as unknown as Record<string, unknown>;
        w.acquireVsCodeApi = () => ({
          postMessage: (message: (typeof posted)[number]) => posted.push(message),
        });
        // jsdom lacks layout, canvas rendering and observers; the app and its events are real.
        win.HTMLCanvasElement.prototype.getContext = (() =>
          new Proxy(
            {},
            {
              get: () => () => undefined,
            }
          )) as unknown as HTMLCanvasElement["getContext"];
        w.IntersectionObserver = w.ResizeObserver = class {
          observe(): void {}
          unobserve(): void {}
          disconnect(): void {}
        };
        win.HTMLElement.prototype.scrollIntoView = () => undefined;
      },
    }
  );
  doms.push(dom);
  const { document } = dom.window;
  const push = (data: unknown): void => {
    dom.window.dispatchEvent(new dom.window.MessageEvent("message", { data }));
  };
  push(
    name === "ddsPreview"
      ? { type: "background", value: "light" }
      : {
          type: "init",
          db,
          mods: [],
          library: { dir: "", chosen: false },
          ui: { panelWidth: 340, panelCollapsed: false, background: "light" },
        }
  );
  const choose = (label: string): void => {
    document.querySelector<HTMLButtonElement>('[aria-label="Viewer background"]')!.click();
    const row = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (el) => el.textContent === label
    );
    expect(row).toBeDefined();
    row!.click();
  };
  return { dom, document, posted, errors, choose, push };
}

describe.each(["flagBuilder", "coaDesigner", "ddsPreview"] as const)("%s viewer background", (name) => {
  it("restores a preference, previews presets and custom colors, and resets without editing the content", async () => {
    const app = boot(name);
    const stage = app.document.getElementById("stage")!;
    const image = app.document.getElementById("img");
    const pixels = image?.getAttribute("src");
    const copy = app.document.getElementById("copy");
    copy?.click();
    const script = [...app.posted].reverse().find((m) => m.type === "copy")?.text;
    expect(stage.style.background).toBe("rgb(242, 242, 242)");
    expect(app.document.querySelector('#stageTools [aria-label="Viewer background"]')).not.toBeNull();

    app.choose("Dark");
    expect(stage.style.background).toBe("rgb(24, 24, 24)");
    if (image) expect(image.style.background).toBe("none");
    app.choose("Light");
    expect(stage.style.background).toBe("rgb(242, 242, 242)");
    app.choose("Custom color…");
    const input = app.document.querySelector<HTMLInputElement>(".px-picker input")!;
    expect(app.document.activeElement).toBe(input);
    input.value = "#376694";
    input.dispatchEvent(new app.dom.window.Event("input", { bubbles: true }));
    expect(stage.style.background).toBe("rgb(55, 102, 148)");
    if (name === "ddsPreview")
      expect(app.posted.filter((m) => m.type === "background").at(-1)?.value).toBe("light");
    input.value = "#nope";
    input.dispatchEvent(new app.dom.window.Event("input", { bubbles: true }));
    expect(stage.style.background).toBe("rgb(55, 102, 148)");
    await new Promise((resolve) => setTimeout(resolve, 0));
    app.dom.window.document.dispatchEvent(
      new app.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    );
    expect(app.document.querySelector(".px-popover")).toBeNull();
    const saved = [...app.posted]
      .reverse()
      .find((m) => m.type === (name === "ddsPreview" ? "background" : "uiState"));
    expect(saved?.state?.background ?? saved?.value).toBe("#376694");

    app.choose(name === "ddsPreview" ? "Checkerboard" : "Reset to default");
    expect(stage.style.background).toBe("");
    if (image) {
      expect(image.style.background).toBe("");
      expect(image.getAttribute("src")).toBe(pixels);
      app.document.getElementById("savePng")!.click();
      expect(app.posted.at(-1)?.type).toBe("savePng");
    }
    copy?.click();
    expect([...app.posted].reverse().find((m) => m.type === "copy")?.text).toBe(script);
    expect(app.errors).toEqual([]);
  });
});

it("DDS decode errors still show the background tools and accept restored preferences", () => {
  const app = boot("ddsPreview", "Preview failed");
  expect(app.document.querySelector(".err")?.textContent).toBe("Preview failed");
  app.choose("Dark");
  expect(app.errors).toEqual([]);
});
