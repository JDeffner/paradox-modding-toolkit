/**
 * The Dynasty Legacy Creator's app, booted in jsdom from the REAL page markup
 * (html.ts) and the REAL app bundle (built the way compile:webview builds it),
 * with the host stubbed by a message recorder.
 *
 * What it pins is what a reader cannot check by eye: that a panel opened on
 * nothing and given only a track key produces a track block, five perk blocks
 * in the game's own count, `legacy = <track>` on every one of them, and the loc
 * the modder never typed.
 *
 * The two forms are the ones `computeDefinitionForm` really answers for CK3
 * (captured 2026-09-03 from the bundled data/ck3/structures.json and the schema
 * table). Only `modifiers` is filled in by hand: that list comes from a user's
 * script_docs dump at runtime and is empty in a bare ServerData.
 */
import { describe, expect, it } from "vitest";
import * as path from "path";
import { JSDOM } from "jsdom";
import { buildSync } from "esbuild";
import type { DefinitionForm } from "@px-lsp/protocol/protocol";
import { legacyCreatorHtml } from "../src/webviews/legacyCreator/html";
import type { CreatorInit, SaveDefinition } from "../src/webviews/legacyCreator/messages";

const PKG_ROOT = path.join(__dirname, "..");

let cachedBundle: string | null = null;
function appBundle(): string {
  if (cachedBundle) return cachedBundle;
  const result = buildSync({
    entryPoints: [path.join(PKG_ROOT, "src", "webviews", "legacyCreator", "app", "main.ts")],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    absWorkingDir: PKG_ROOT,
    loader: { ".css": "text" },
    write: false,
  });
  cachedBundle = result.outputFiles[0].text;
  return cachedBundle;
}

function panelHtml(): string {
  const html = legacyCreatorHtml({ scriptSrc: "app.js", nonce: "test", csp: "" });
  return html.replace(/<script nonce="test" src="app.js"><\/script>/, `<script>${appBundle()}</script>`);
}

const LEGACY_FORM: DefinitionForm = {
  kind: "dynasty_legacy",
  folder: "common/dynasty_legacies",
  locPatterns: ["$_name", "$_desc"],
  iconFolder: "gfx/interface/icons/dynasty",
  keys: [
    {
      key: "is_shown",
      doc: "Can be used to determine if a particular legacy track should be shown or not based on the requirements Trigger in character scope. See notes on triggers below.",
      values: "block",
      freq: 14,
    },
  ],
  options: {},
  modifiers: [],
  existing: [],
};

const PERK_FORM: DefinitionForm = {
  kind: "dynasty_perk",
  folder: "common/dynasty_perks",
  locPatterns: ["$_name"],
  keys: [
    { key: "legacy", doc: "What legacy does this belong to?", freq: 105 },
    { key: "effect", doc: "Run on unlock. Character scope", values: "block", freq: 82 },
    {
      key: "character_modifier",
      doc: "Applied to characters in dynasties with the perk",
      values: "block",
      freq: 78,
    },
    { key: "can_be_picked", doc: "Trigger in character scope", values: "block", freq: 54 },
    {
      key: "ai_chance",
      doc: "Script value for weight for selection by the AI. Defaults to 1000",
      values: "block",
      freq: 37,
    },
    {
      key: "doctrine_character_modifier",
      doc: "Applied to characters in dynasties with the perk if they have the given doctrine",
      values: "block",
      freq: 5,
    },
    {
      key: "traits",
      doc: "If you do this, traits will be selectable when unlocking this perk.",
      values: "block",
      freq: 4,
      refKinds: ["trait"],
    },
  ],
  options: { trait: [] },
  modifiers: [{ name: "prowess", doc: "Prowess" }],
  existing: [],
};

const INIT: CreatorInit = {
  legacy: LEGACY_FORM,
  perk: PERK_FORM,
  modLabel: "mymod",
  locLanguage: "english",
  prefix: "px",
  // The number the host measured over the game's own perk files.
  perksPerTrack: 5,
  icons: [],
  problem: null,
};

interface Booted {
  window: Window & typeof globalThis;
  posted: Array<Record<string, unknown>>;
  name: HTMLInputElement;
  type(input: HTMLInputElement, text: string): void;
  cards(): HTMLElement[];
  save(): { track: SaveDefinition; perks: SaveDefinition[] };
}

function boot(init: CreatorInit = INIT): Booted {
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
  const document = window.document;
  window.dispatchEvent(new window.MessageEvent("message", { data: { type: "init", init } }));
  return {
    window,
    posted,
    name: document.getElementById("name") as HTMLInputElement,
    type(input: HTMLInputElement, text: string) {
      input.value = text;
      input.dispatchEvent(new window.Event("change"));
    },
    cards: () => [...document.querySelectorAll<HTMLElement>(".perk")],
    save() {
      (document.getElementById("save") as HTMLButtonElement).click();
      const last = posted.at(-1) as unknown as { track: SaveDefinition; perks: SaveDefinition[] };
      return last;
    },
  };
}

describe("dynasty legacy creator app", () => {
  it("asks the host for its forms as soon as it boots", () => {
    const app = boot();
    expect(app.posted[0]).toEqual({ type: "ready" });
  });

  it("opens with the game's own number of perk slots and the prefixed key", () => {
    const app = boot();
    expect(app.name.value).toBe("px_legacy_track");
    expect(app.cards()).toHaveLength(5);
    expect(app.window.document.getElementById("perkNote")?.textContent).toBe("vanilla tracks have 5 perks");
  });

  it("saves a whole track from nothing but the key", () => {
    const app = boot();
    app.type(app.name, "px_iron_legacy_track");
    const { track, perks } = app.save();

    expect(track.mode).toBe("create");
    expect(track.name).toBe("px_iron_legacy_track");
    expect(track.block).toBe("px_iron_legacy_track = {\n}");
    expect(track.loc).toEqual([{ key: "px_iron_legacy_track_name", value: "Px Iron Legacy Track" }]);

    expect(perks).toHaveLength(5);
    expect(perks.map((perk) => perk.name)).toEqual([
      "px_iron_legacy_1",
      "px_iron_legacy_2",
      "px_iron_legacy_3",
      "px_iron_legacy_4",
      "px_iron_legacy_5",
    ]);
    // The link the modder is never asked for, on every card.
    expect(perks[0].block).toBe("px_iron_legacy_1 = {\n\tlegacy = px_iron_legacy_track\n}");
    expect(perks[0].loc).toEqual([{ key: "px_iron_legacy_1_name", value: "Px Iron Legacy 1" }]);
    expect(perks.every((perk) => perk.mode === "create")).toBe(true);
  });

  it("shows the same blocks in the script preview that it would write", () => {
    const app = boot();
    app.type(app.name, "px_iron_legacy_track");
    const preview = app.window.document.getElementById("script")!.textContent;
    const { track, perks } = app.save();
    expect(preview).toBe([track.block, ...perks.map((perk) => perk.block)].join("\n\n"));
  });

  it("refuses a key the game could not read", () => {
    const app = boot();
    app.type(app.name, "Px Legacy!");
    (app.window.document.getElementById("save") as HTMLButtonElement).click();
    expect(app.posted.some((msg) => msg.type === "save")).toBe(false);
  });

  it("says so, and writes nothing, when there is no mod to write into", () => {
    const app = boot({ ...INIT, modLabel: null, problem: "No mod folder found." });
    expect((app.window.document.getElementById("save") as HTMLButtonElement).disabled).toBe(true);
    expect(app.window.document.getElementById("problem")?.textContent).toBe("No mod folder found.");
  });
});
