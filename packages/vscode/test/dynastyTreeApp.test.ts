/**
 * The Dynasty Tree app booted in jsdom from the REAL page markup (html.ts) and
 * the REAL app bundle, with the host stubbed by a message recorder.
 *
 * What it pins is that the page and the app agree: the ids html.ts writes are
 * the ids main.ts reaches for, the picker turns a click into the request the
 * host expects, and a tree draws one card per character with the vanilla ones
 * marked apart from the mod's.
 */
import { describe, expect, it } from "vitest";
import * as path from "path";
import { JSDOM } from "jsdom";
import { buildSync } from "esbuild";
import { dynastyTreeHtml } from "../src/webviews/dynastyTree/html";

const PKG_ROOT = path.join(__dirname, "..");

let cachedBundle: string | null = null;
function appBundle(): string {
  if (cachedBundle) return cachedBundle;
  const result = buildSync({
    entryPoints: [path.join(PKG_ROOT, "src", "webviews", "dynastyTree", "app", "main.ts")],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    absWorkingDir: PKG_ROOT,
    write: false,
  });
  cachedBundle = result.outputFiles[0].text;
  return cachedBundle;
}

function panelHtml(): string {
  const html = dynastyTreeHtml({ scriptSrc: "app.js", nonce: "test", csp: "" });
  return html.replace(/<script nonce="test" src="app.js"><\/script>/, `<script>${appBundle()}</script>`);
}

const DYNASTY = {
  id: "9000001",
  nameKey: "dynn_Smoke",
  name: "Smoke",
  culture: "anglo_saxon",
  source: "mod" as const,
  file: "f.txt",
  line: 0,
  characterCount: 2,
  houseCount: 1,
};

const TREE = {
  dynasty: DYNASTY,
  houses: [
    {
      id: "house_smoke",
      nameKey: "dynn_Smoke",
      name: "Smoke",
      dynasty: "9000001",
      source: "mod" as const,
      file: "h.txt",
      line: 0,
    },
  ],
  characters: [
    {
      id: "1",
      name: "Smoky",
      female: false,
      house: "house_smoke",
      traits: [],
      spouses: ["2"],
      source: "mod" as const,
      file: "c.txt",
      line: 0,
      birth: "1000.1.1",
    },
    {
      id: "2",
      name: "Smokina",
      female: true,
      traits: [],
      spouses: ["1"],
      external: true as const,
      source: "vanilla" as const,
      file: "v.txt",
      line: 0,
      birth: "1002.1.1",
    },
    {
      id: "3",
      name: "Smokelet",
      female: false,
      house: "house_smoke",
      father: "1",
      mother: "2",
      traits: [],
      spouses: [],
      source: "mod" as const,
      file: "c.txt",
      line: 0,
      birth: "1025.1.1",
    },
  ],
  nextCharacterId: "4",
};

interface Booted {
  window: Window & typeof globalThis;
  posted: Array<Record<string, unknown>>;
  send(data: unknown): void;
}

function boot(): Booted {
  const posted: Array<Record<string, unknown>> = [];
  const dom = new JSDOM(panelHtml(), {
    runScripts: "dangerously",
    beforeParse(window) {
      (window as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
        postMessage: (msg: Record<string, unknown>) => posted.push(msg),
      });
    },
  });
  const window = dom.window as unknown as Window & typeof globalThis;
  return {
    window,
    posted,
    send: (data) => window.dispatchEvent(new window.MessageEvent("message", { data })),
  };
}

describe("the Dynasty Tree app", () => {
  it("asks the host for its state as soon as it boots", () => {
    expect(boot().posted).toEqual([{ type: "ready" }]);
  });

  it("lists dynasties and turns a click into an open request", () => {
    const app = boot();
    app.send({
      type: "list",
      supported: true,
      dynasties: [DYNASTY],
      nextDynastyId: "2",
      nextCharacterId: "4",
      ms: 3,
    });
    const rows = app.window.document.querySelectorAll("#picker .px-item");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("Smoke");
    expect(rows[0].textContent).toContain("2 characters");
    (rows[0] as HTMLElement).click();
    expect(app.posted).toContainEqual({ type: "open", dynasty: "9000001" });
  });

  it("says so when the game has no dynasties at all, instead of an empty list", () => {
    const app = boot();
    app.send({ type: "init", gameName: "Victoria 3", mods: [] });
    app.send({
      type: "list",
      supported: false,
      dynasties: [],
      nextDynastyId: "1",
      nextCharacterId: "1",
      ms: 1,
    });
    expect(app.window.document.getElementById("pickerNote")!.textContent).toContain(
      "Victoria 3 has no dynasties"
    );
  });

  it("draws one card per character, vanilla and external ones marked apart", () => {
    const app = boot();
    app.send({ type: "tree", tree: TREE, ms: 4 });
    const cards = app.window.document.querySelectorAll("#scene .card");
    expect(cards).toHaveLength(3);
    const external = app.window.document.querySelectorAll("#scene .card[data-external]");
    expect(external).toHaveLength(1);
    expect(app.window.document.querySelectorAll('#scene .card[data-source="mod"]')).toHaveLength(2);
    // One marriage and two parent links.
    expect(app.window.document.querySelectorAll('#scene .edge[data-kind="spouse"]')).toHaveLength(1);
    expect(app.window.document.querySelectorAll('#scene .edge[data-kind="parent"]')).toHaveLength(2);
  });

  it("shows the dynasty in the inspector until a character is picked", () => {
    const app = boot();
    app.send({ type: "tree", tree: TREE, ms: 4 });
    const side = app.window.document.getElementById("sideBody")!;
    expect(side.textContent).toContain("Smoke");
    expect(side.textContent).toContain("Houses (1)");

    const card = app.window.document.querySelector("#scene .card") as unknown as HTMLElement;
    card.dispatchEvent(new app.window.MouseEvent("click", { bubbles: true }));
    expect(side.textContent).toContain("Smoky");
    expect(side.textContent).toContain("Add child");
  });

  it("says a vanilla character is read only, and still offers to add to them", () => {
    const app = boot();
    app.send({ type: "tree", tree: TREE, ms: 4 });
    const cards = app.window.document.querySelectorAll("#scene .card");
    const vanilla = [...cards].find((c) => c.getAttribute("data-external") !== null)!;
    vanilla.dispatchEvent(new app.window.MouseEvent("click", { bubbles: true }));
    const side = app.window.document.getElementById("sideBody")!;
    expect(side.textContent).toContain("comes from the game files");
    expect(side.textContent).toContain("Add spouse");
    expect(side.textContent).not.toContain("Edit");
  });

  it("prefills a new child from the parent it was started on", () => {
    const app = boot();
    app.send({ type: "tree", tree: TREE, ms: 4 });
    const card = app.window.document.querySelector("#scene .card") as unknown as HTMLElement;
    card.dispatchEvent(new app.window.MouseEvent("click", { bubbles: true }));
    const side = app.window.document.getElementById("sideBody")!;
    const add = [...side.querySelectorAll("button")].find((b) => b.textContent?.includes("Add child"))!;
    add.click();
    expect(side.textContent).toContain("New character 4");
    const inputs = [...side.querySelectorAll("input.px-input")].map((i) => (i as HTMLInputElement).value);
    // The father is the character it was started on, and the birth is his plus
    // the offset, so the form is saveable with only a name typed.
    expect(inputs).toContain("1020.1.1");
    const save = [...side.querySelectorAll("button")].find((b) => b.textContent?.includes("Create"))!;
    save.click();
    // No name yet, so nothing is sent.
    expect(app.posted.some((m) => m.type === "saveCharacter")).toBe(false);
    const name = side.querySelector("input.px-input") as HTMLInputElement;
    name.value = "Newborn";
    name.dispatchEvent(new app.window.Event("input"));
    save.click();
    const sent = app.posted.find((m) => m.type === "saveCharacter") as
      { form: { name: string; father?: string; house?: string; birth?: string } } | undefined;
    expect(sent?.form).toMatchObject({
      name: "Newborn",
      father: "1",
      house: "house_smoke",
      birth: "1020.1.1",
    });
  });
});
