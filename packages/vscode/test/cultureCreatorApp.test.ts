/**
 * The Culture Creator app, booted in jsdom from the REAL page markup (html.ts)
 * and the REAL app bundle (built the way compile:webview builds it), against a
 * REAL paradox/definitionForm answer: the form is computed here from the
 * bundled CK3 schema and harvest, so a fixture cannot drift away from what the
 * server actually sends.
 *
 * What it pins is the whole trip a modder makes: type a name, pick a pillar and
 * a tradition, press Save, and get a block the game can read.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { JSDOM } from "jsdom";
import { buildSync } from "esbuild";
import type { DefinitionForm } from "@px-lsp/protocol/protocol";
import { computeDefinitionForm } from "@px-lsp/server/creators/definitionForm";
import { loadSchema } from "@px-lsp/server/schema/loader";
import { ServerData } from "@px-lsp/server/serverData";
import { cultureCreatorHtml } from "../src/webviews/cultureCreator/html";

const PKG_ROOT = path.join(__dirname, "..");

let cachedBundle: string | null = null;
function appBundle(): string {
  if (cachedBundle) return cachedBundle;
  cachedBundle = buildSync({
    entryPoints: [path.join(PKG_ROOT, "src", "webviews", "cultureCreator", "app", "main.ts")],
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
  const html = cultureCreatorHtml({ scriptSrc: "app.js", nonce: "test", csp: "" });
  return html.replace(/<script nonce="test" src="app.js"><\/script>/, `<script>${appBundle()}</script>`);
}

// A pillar file and a tradition, indexed the way the real workspace indexes
// them; the schema's groupKey reads `type` out of the pillar's own block.
const PILLARS_TXT = "ethos_stoic = {\n\ttype = ethos\n}\n\nheritage_arabic = {\n\ttype = heritage\n}\n";

// What the panel reads out of the game folder (catalog.ts): the shape
// game/common/culture/traditions/00_combat_traditions.txt writes, with the
// layer values already resolved to files.
const CATALOG = {
  traditions: {
    tradition_mubarizuns: {
      category: "combat",
      layers: [
        "gfx/interface/icons/culture_tradition/0-background/martial/martial1.dds",
        "gfx/interface/icons/culture_tradition/4-items/duel.dds",
      ],
    },
  },
  descs: { ethos_stoic: "This culture endures.", tradition_mubarizuns: "Champions duel before battle." },
  dlcFlags: ["royal_court"],
};

let dir: string;
let form: DefinitionForm;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "px-culture-app-"));
  const pillars = path.join(dir, "pillars.txt");
  fs.writeFileSync(pillars, PILLARS_TXT, "utf8");
  const data = new ServerData();
  data.index.addAll([
    { name: "ethos_stoic", kind: "culture_pillar", file: pillars, line: 0, source: "vanilla" },
    { name: "heritage_arabic", kind: "culture_pillar", file: pillars, line: 3, source: "vanilla" },
    { name: "tradition_mubarizuns", kind: "culture_tradition", file: "t.txt", line: 0, source: "vanilla" },
    { name: "name_list_bedouin", kind: "name_list", file: "n.txt", line: 0, source: "vanilla" },
  ]);
  form = computeDefinitionForm(data, loadSchema(null), { kind: "culture" })!;
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

interface Booted {
  window: Window & typeof globalThis;
  document: Document;
  posted: Array<Record<string, unknown>>;
}

function boot(): Booted {
  const posted: Array<Record<string, unknown>> = [];
  const dom = new JSDOM(panelHtml(), {
    runScripts: "dangerously",
    beforeParse(window) {
      (window as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
        postMessage: (msg: Record<string, unknown>) => posted.push(msg),
      });
      // jsdom has no layout, and menu() scrolls its active row into view.
      window.Element.prototype.scrollIntoView = () => undefined;
    },
  });
  const window = dom.window as unknown as Window & typeof globalThis;
  window.dispatchEvent(
    new window.MessageEvent("message", {
      data: {
        type: "init",
        init: {
          form,
          locLanguage: "english",
          prefix: "px",
          namedColors: { bedouin: [26, 191, 26] },
          catalog: CATALOG,
          noMod: false,
          noGame: true,
        },
      },
    })
  );
  return { window, document: window.document, posted };
}

/** The control of the row whose label reads `label`. */
function rowControl(document: Document, label: string): HTMLElement {
  const span = [...document.querySelectorAll(".px-label")].find((s) => s.textContent === label);
  return span!.nextElementSibling as HTMLElement;
}

/**
 * The labels of the open menu. The first row of a `refField` menu CLEARS the
 * field and is labelled with the placeholder, which carries an example value,
 * so a test must match a row's label exactly and not the text it contains.
 */
function menuLabels(document: Document): string[] {
  return [...document.querySelectorAll(".px-menu .px-menu-item .px-grow")].map((s) => s.textContent ?? "");
}

/** The menu row that offers exactly `value`, never the placeholder row. */
function menuRow(document: Document, value: string): HTMLElement {
  const label = [...document.querySelectorAll(".px-menu .px-menu-item .px-grow")].find(
    (s) => s.textContent === value
  );
  return label!.parentElement as HTMLElement;
}

/** The chip list's Add button, then the entry for the indexed tradition. */
function addTradition(document: Document): void {
  const add = rowControl(document, "Traditions").querySelector("button") as HTMLButtonElement;
  add.click();
  const row = [...document.querySelectorAll(".px-picker-results .px-menu-item")].find((i) =>
    i.textContent?.includes("tradition_mubarizuns")
  ) as HTMLElement;
  row.click();
}

describe("culture creator app", () => {
  it("asks for a culture with only the name typed, and boots ready to save", () => {
    const { document, posted } = boot();
    expect(posted[0]).toEqual({ type: "ready" });
    expect((document.getElementById("name") as HTMLInputElement).value).toBe("px_culture");
    // The loc keys the schema says the game generates, with a Title Case default.
    const keys = [...document.querySelectorAll("#body-identity code")].map((c) => c.textContent);
    expect(keys).toEqual(["px_culture", "px_culture_prefix", "px_culture_collective_noun"]);
    // Nothing is required of the modder before saving; the empty pillars are named.
    expect(document.getElementById("saveNote")!.textContent).toContain("ethos");
  });

  it("splits the one pillar folder into a picker per family", () => {
    const { document } = boot();
    const rows = [...document.querySelectorAll("#body-pillars .px-label")].map((s) => s.textContent);
    expect(rows).toEqual(["Ethos", "Heritage", "Language", "Martial custom", "Head determination"]);
    // The Ethos picker offers the ethos pillar and NOT the heritage one, which
    // is the whole reason the server labels each option with its `type`.
    (rowControl(document, "Ethos") as HTMLButtonElement).click();
    const offered = menuLabels(document);
    expect(offered).toContain("ethos_stoic");
    expect(offered).not.toContain("heritage_arabic");
  });

  it("puts a chosen tradition into the culture window preview", () => {
    const { document } = boot();
    expect(document.getElementById("pvCount")!.textContent).toBe("0 traditions");
    addTradition(document);
    const tiles = [...document.querySelectorAll("#pvTraditions .pvtrad")];
    expect(tiles).toHaveLength(1);
    expect(tiles[0].textContent).toContain("tradition_mubarizuns");
    expect(document.getElementById("pvCount")!.textContent).toBe("1 tradition");
    // Both layers the catalog gave are stacked, in index order.
    const layers = [...tiles[0].querySelectorAll("img")].map((i) => i.getAttribute("data-rel"));
    expect(layers).toEqual(CATALOG.traditions.tradition_mubarizuns.layers);
  });

  it("hands a tradition chip to the Tradition Creator, and a blank form for a new one", () => {
    const { document, posted } = boot();
    addTradition(document);
    const edit = document.querySelector<HTMLButtonElement>('.px-chip button[data-tip*="Tradition Creator"]');
    expect(edit, document.querySelector(".px-chip")?.outerHTML).not.toBeNull();
    edit!.click();
    expect(posted.at(-1)).toEqual({ type: "editTradition", name: "tradition_mubarizuns" });
    const create = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("New tradition")
    );
    expect(create).toBeDefined();
    create!.click();
    expect(posted.at(-1)).toEqual({ type: "editTradition", name: "" });
  });

  it("writes a named color when one is picked, not three components", () => {
    const { document, posted } = boot();
    const color = rowControl(document, "Color");
    (color.querySelector('.px-toggle[data-value="named"]') as HTMLButtonElement).click();
    (color.querySelector(".px-dropdown") as HTMLButtonElement).click();
    menuRow(document, "bedouin").click();
    (document.getElementById("save") as HTMLButtonElement).click();
    const save = posted.at(-1) as { block: string };
    expect(save.block).toContain("color = bedouin");
  });

  it("writes the block a typed name, a pillar and a tradition make", () => {
    const { window, document, posted } = boot();
    const name = document.getElementById("name") as HTMLInputElement;
    name.value = "px_bedouin";
    name.dispatchEvent(new window.Event("change"));

    // Pillar: the dropdown's menu, then the entry for the ethos pillar.
    (rowControl(document, "Ethos") as HTMLButtonElement).click();
    menuRow(document, "ethos_stoic").click();

    addTradition(document);

    (document.getElementById("save") as HTMLButtonElement).click();
    const save = posted.at(-1) as { type: string; mode: string; name: string; block: string; loc: unknown };
    expect(save.type).toBe("save");
    expect(save.mode).toBe("create");
    expect(save.name).toBe("px_bedouin");
    expect(save.block).toBe(
      "px_bedouin = {\n\tethos = ethos_stoic\n\ttraditions = {\n\t\ttradition_mubarizuns\n\t}\n}"
    );
    // The loc value follows the name until the modder types over it.
    expect(save.loc).toEqual([
      { key: "px_bedouin", value: "Px Bedouin" },
      { key: "px_bedouin_prefix", value: "Px Bedouin" },
      { key: "px_bedouin_collective_noun", value: "Px Bedouin" },
    ]);
  });

  it("refuses a key the game cannot read rather than writing it", () => {
    const { window, document, posted } = boot();
    const name = document.getElementById("name") as HTMLInputElement;
    name.value = "Px Bedouin";
    name.dispatchEvent(new window.Event("change"));
    const before = posted.length;
    (document.getElementById("save") as HTMLButtonElement).click();
    expect(posted.length).toBe(before);
  });
});
