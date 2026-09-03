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
          saveMod: "mymod",
          locLanguage: "english",
          prefix: "px",
          namedColors: { bedouin: [26, 191, 26] },
          noMod: false,
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
  });

  it("writes the block a typed name, a pillar and a tradition make", () => {
    const { window, document, posted } = boot();
    const name = document.getElementById("name") as HTMLInputElement;
    name.value = "px_bedouin";
    name.dispatchEvent(new window.Event("change"));

    // Pillar: the dropdown's menu, then the entry for the ethos pillar.
    (rowControl(document, "Ethos") as HTMLButtonElement).click();
    const ethos = [...document.querySelectorAll(".px-menu-item")].find((i) =>
      i.textContent?.includes("ethos_stoic")
    ) as HTMLElement;
    ethos.click();

    // Tradition: the chip list's Add button, then the entry in the picker.
    const add = rowControl(document, "Traditions").querySelector("button") as HTMLButtonElement;
    add.click();
    const tradition = [...document.querySelectorAll(".px-picker-results .px-menu-item")].find((i) =>
      i.textContent?.includes("tradition_mubarizuns")
    ) as HTMLElement;
    tradition.click();

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
