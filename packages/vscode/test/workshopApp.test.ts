import { afterEach, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { buildSync } from "esbuild";
import * as path from "node:path";
import { workshopHtml } from "../src/webviews/workshop/html";
import type { AppToHost, HostToApp, WorkshopModInfo } from "../src/webviews/workshop/messages";

const bundle = buildSync({
  entryPoints: [path.join(__dirname, "../src/webviews/workshop/app/main.ts")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
}).outputFiles[0].text;
let dom: JSDOM;
afterEach(() => dom?.window.close());

function listing(overrides: Partial<WorkshopModInfo> = {}): WorkshopModInfo {
  return {
    root: "/mod",
    legacyKey: null,
    legacyVersions: [{ key: "1.19", supportedVersion: "1.19.*" }],
    legacyContent: null,
    visibility: null,
    gameName: "Test game",
    descriptorMissing: false,
    name: "Main title",
    tags: [],
    knownTags: [],
    publishedId: null,
    description: "Main description",
    translations: {},
    previewUri: null,
    previewName: null,
    previewTooLarge: false,
    changeNoteSuggestion: "",
    releaseNote: null,
    changelogNote: null,
    changelogDisplay: "changelog",
    changelogKind: null,
    changelogCandidates: [],
    version: "2.0",
    supportedVersion: "1.20.*",
    workshopDir: "/mod/workshop",
    workshopDirCustom: false,
    filesPresent: true,
    markdown: [],
    steamLanguages: [{ api: "german", label: "German" }],
    suggestedLanguages: [],
    gameLanguages: [],
    checks: [],
    previews: null,
    dependencies: null,
    dependencyCandidates: [],
    ...overrides,
  };
}

function boot(initial = listing()) {
  const messages: AppToHost[] = [];
  dom = new JSDOM(workshopHtml({ scriptSrc: "app.js", nonce: "test", csp: "" }), {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window) {
      window.HTMLElement.prototype.scrollIntoView = () => {};
      Object.assign(window, {
        structuredClone,
        acquireVsCodeApi: () => ({ postMessage: (m: AppToHost) => messages.push(m) }),
      });
    },
  });
  dom.window.eval(bundle);
  const post = (m: HostToApp) =>
    dom.window.dispatchEvent(new dom.window.MessageEvent("message", { data: m }));
  const info = (value: WorkshopModInfo) => post({ type: "info", active: value.root, info: value });
  post({
    type: "init",
    mods: [{ path: initial.root, label: "Test mod" }],
    active: initial.root,
    info: initial,
  });
  const element = <T extends HTMLElement = HTMLElement>(id: string) =>
    dom.window.document.getElementById(id) as T;
  const check = (id: string) => element<HTMLInputElement>(id);
  const change = (id: string, value: string) => {
    check(id).value = value;
    check(id).dispatchEvent(new dom.window.Event("change"));
  };
  return { messages, post, info, element, check, change, document: dom.window.document };
}

const legacy = (state: WorkshopModInfo["legacyContent"] = "published") =>
  listing({
    legacyKey: "1.19",
    legacyContent: state,
    supportedVersion: "1.19.*",
    name: "Legacy title",
    visibility: 2,
    description: "Legacy description",
    workshopDir: "/mod/workshop/legacy_version/1.19",
  });

it("offers main and saved legacy items, with creation and messages bound to the visible item", () => {
  const t = boot();
  expect(t.element("listing").textContent).toContain("Main item");
  expect(t.element("listing").textContent).toContain("Legacy 1.19.*");
  t.element("createLegacy").click();
  expect(t.messages.at(-1)).toEqual({ type: "createLegacy", target: { root: "/mod", legacyKey: null } });
  t.change("listing", "1.19");
  expect(t.messages.at(-1)).toEqual({
    type: "selectListing",
    key: "1.19",
    target: { root: "/mod", legacyKey: null },
  });
  t.info(legacy());
  expect(t.element("app").hasAttribute("data-legacy")).toBe(true);
  expect(t.element("legacyNotice").textContent).toContain("Legacy 1.19.*");
  expect(t.element("legacyNotice").textContent).toContain("separate project");
  expect(t.check("title").value).toBe("Legacy title");
  t.change("title", "Renamed legacy");
  expect(t.messages.at(-1)).toEqual({
    type: "setField",
    field: "title",
    value: "Renamed legacy",
    target: { root: "/mod", legacyKey: "1.19" },
  });
});

it.each(["new", "ready", "published", "submitted", "creating"] as const)(
  "enforces %s legacy content restrictions in page and confirmation",
  async (state) => {
    const t = boot(legacy(state));
    const required = state === "new" || state === "ready";
    expect(t.check("version").disabled).toBe(true);
    expect(t.check("supported").disabled).toBe(true);
    expect(t.check("incContent").disabled).toBe(true);
    expect(t.check("incContent").checked).toBe(required);
    expect(t.check("incDetails").disabled).toBe(required);
    t.element("enableAll").click();
    t.element("enableAllYes").click();
    expect(t.check("incContent").checked).toBe(required);
    t.element("upload").click();
    if (state === "creating") {
      expect(t.check("upload").disabled).toBe(true);
      expect(t.document.querySelector(".px-confirmation")).toBeNull();
      return;
    }
    const content = t.document.querySelector<HTMLInputElement>('[data-part="content"] input')!;
    expect(content.disabled).toBe(true);
    expect(content.checked).toBe(required);
    (t.document.querySelector(".px-dialog-actions button:last-child") as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(t.messages.filter((m) => m.type === "upload").at(-1)).toMatchObject({
      type: "upload",
      content: required,
      details: true,
      target: { root: "/mod", legacyKey: "1.19" },
    });
  }
);

it("clears pending drafts and transient state when switching to a legacy item in the same project", async () => {
  const t = boot(listing({ publishedId: "123", translations: { german: { title: "Old draft" } } }));
  const title =
    t.document.querySelector<HTMLInputElement>(".lang-row .body input") ??
    t.document.querySelector<HTMLInputElement>('#translations input:not([type="checkbox"])')!;
  title.value = "Pending main title";
  title.dispatchEvent(new dom.window.Event("input"));
  t.check("note").value = "Main note";
  t.check("incDescription").checked = false;
  t.post({ type: "uploadState", busy: true });
  t.post({ type: "progress", job: "upload", step: "Old upload", done: 1, total: 2 });
  t.info(legacy());
  expect(t.check("note").value).toBe("");
  expect(t.check("incDescription").checked).toBe(true);
  expect(t.element("stopWaiting").hidden).toBe(true);
  expect(t.element("jobProgress").hidden).toBe(true);
  expect(t.element("liveState").textContent).toBe("");
  expect(t.element("descPreview").textContent).toBe("Legacy description");
  await new Promise((resolve) => setTimeout(resolve, 650));
  expect(t.messages.filter((m) => m.type === "saveLocal")).toHaveLength(0);
  t.post({
    type: "live",
    item: null,
    translations: {},
    error: "Old main error",
    target: { root: "/mod", legacyKey: null },
  });
  expect(t.element("liveState").textContent).toBe("");
  t.info(listing());
  expect(t.element("app").hasAttribute("data-legacy")).toBe(false);
  expect(t.check("incContent").disabled).toBe(false);
  expect(t.check("version").disabled).toBe(false);
});

it("does not upload an old confirmation into the newly selected listing", async () => {
  const t = boot();
  t.element("upload").click();
  t.info(legacy());
  (t.document.querySelector(".px-dialog-actions button:last-child") as HTMLButtonElement).click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(t.messages.filter((m) => m.type === "upload")).toHaveLength(0);
});

it("keeps the visible selector and edits on the current item when the host rejects a legacy selection", () => {
  const t = boot();
  t.change("listing", "1.19");
  expect(t.messages.at(-1)).toMatchObject({ type: "selectListing", key: "1.19" });
  // A failed host selection only reports a notification, with no replacement info.
  expect(t.check("listing").value).toBe("");
  expect(t.check("title").value).toBe("Main title");
  expect(t.element("app").hasAttribute("data-legacy")).toBe(false);
  t.change("title", "Edit current main item");
  expect(t.messages.at(-1)).toMatchObject({ type: "setField", target: { root: "/mod", legacyKey: null } });
  t.info(legacy());
  expect(t.check("listing").value).toBe("1.19");
  t.change("listing", "");
  expect(t.check("listing").value).toBe("1.19");
  expect(t.messages.at(-1)).toMatchObject({ type: "selectListing", key: null });
});

it("saves pending translations to their original item before requesting a listing switch", () => {
  const t = boot(listing({ translations: { german: { title: "Main German title" } } }));
  const title = t.document.querySelector<HTMLInputElement>('#translations input:not([type="checkbox"])')!;
  title.value = "Unsaved main German title";
  title.dispatchEvent(new dom.window.Event("input"));
  t.change("listing", "1.19");
  expect(t.messages.slice(-2)).toEqual([
    {
      type: "saveLocal",
      description: "Main description",
      translations: { german: { title: "Unsaved main German title" } },
      target: { root: "/mod", legacyKey: null },
    },
    { type: "selectListing", key: "1.19", target: { root: "/mod", legacyKey: null } },
  ]);
  t.info(legacy());
  expect(t.element("descPreview").textContent).toBe("Legacy description");
  expect(t.element("translations").textContent).not.toContain("Unsaved main German title");
});

it("offers Stop waiting while a job runs and persists legacy visibility", () => {
  const t = boot(legacy());
  t.element("visibility").click();
  const option = [...t.document.querySelectorAll<HTMLElement>('[role="option"]')].find((el) =>
    el.textContent?.includes("Unlisted")
  )!;
  option.click();
  expect(t.messages.at(-1)).toMatchObject({
    type: "setVisibility",
    value: 3,
    target: { root: "/mod", legacyKey: "1.19" },
  });
  t.post({ type: "uploadState", busy: true });
  expect(t.element("stopWaiting").hidden).toBe(false);
  expect(t.check("listing").disabled).toBe(true);
  t.element("stopWaiting").click();
  expect(t.messages.at(-1)).toMatchObject({
    type: "stopWaiting",
    target: { root: "/mod", legacyKey: "1.19" },
  });
});

it("cancels an old gallery gesture when the listing changes", () => {
  const t = boot(
    listing({
      previews: {
        dir: "/mod/workshop/previews",
        images: [{ name: "main.png", uri: "main.png" }],
        videos: [],
      },
    })
  );
  t.document
    .querySelector<HTMLElement>(".tile[data-name]")!
    .dispatchEvent(new dom.window.MouseEvent("pointerdown", { button: 0, clientX: 0, clientY: 0 }));
  t.document.dispatchEvent(new dom.window.MouseEvent("pointermove", { clientX: 10, clientY: 10 }));
  expect(t.document.querySelector(".lift")).not.toBeNull();
  t.info({
    ...legacy(),
    previews: {
      dir: "/mod/workshop/legacy_version/1.19/previews",
      images: [{ name: "legacy.png", uri: "legacy.png" }],
      videos: [],
    },
  });
  t.document.dispatchEvent(new dom.window.MouseEvent("pointerup"));
  expect(t.messages.filter((m) => m.type === "reorderPreviews")).toHaveLength(0);
  expect(t.document.querySelector(".tile[data-name]")?.getAttribute("data-name")).toBe("legacy.png");
});
