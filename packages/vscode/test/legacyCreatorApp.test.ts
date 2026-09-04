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
  // The three lists `computeDefinitionForm` answers for CK3 (the profile's own
  // condition table): the features triggers.log enumerates, the settings of
  // common/game_rules, and the indexed scripted triggers.
  conditions: {
    has_dlc_feature: [{ value: "hybridize_culture" }, { value: "legends" }],
    has_game_rule: [{ value: "unrestricted_dynasty_legacies_all" }],
    scripted_trigger: [{ value: "eligible_for_fp1_dynasty_legacies_trigger" }],
  },
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
  options: {
    trait: [],
    doctrine: [{ value: "doctrine_no_head" }, { value: "doctrine_spiritual_head" }],
  },
  blocks: {
    doctrine_character_modifier: [{ key: "doctrine", refKinds: ["doctrine"] }],
  },
  conditions: {
    has_dlc_feature: [{ value: "hybridize_culture" }, { value: "legends" }],
    has_game_rule: [{ value: "unrestricted_dynasty_legacies_all" }],
    scripted_trigger: [{ value: "eligible_for_fp1_dynasty_legacies_trigger" }],
  },
  modifiers: [{ name: "prowess", doc: "Prowess" }],
  existing: [
    { name: "blood_legacy_2", file: "common/dynasty_perks/00_dynasty_perks.txt", line: 0, source: "vanilla" },
  ],
};

/**
 * How the game prints the two modifiers the fixtures use, in the shape
 * `paradox/modifierFormats` answers: `positive_random_genetic_chance` is a
 * fraction the game shows as a percentage, `prowess` a plain number.
 */
const FORMATS: CreatorInit["formats"] = {
  positive_random_genetic_chance: {
    label: "Positive Genetic Trait Inheritance Chance",
    decimals: 0,
    percent: true,
    color: "good",
  },
  prowess: { label: "Prowess", decimals: 0, color: "good" },
};

const INIT: CreatorInit = {
  legacy: LEGACY_FORM,
  perk: PERK_FORM,
  locLanguage: "english",
  prefix: "px",
  // The number the host measured over the game's own perk files.
  perksPerTrack: 5,
  icons: [],
  illustrations: [],
  illustrationFolder: "gfx/interface/illustrations/legacy_tracks",
  formats: FORMATS,
  refIconFolders: {},
  problem: null,
};

/**
 * blood_legacy_1 and blood_legacy_2 verbatim from the game's own
 * common/dynasty_perks/00_dynasty_perks.txt (CK3 1.19.0.6), which is what a
 * loaded track really hands the app.
 */
const LOADED_PERKS = [
  {
    name: "blood_legacy_1",
    file: "common/dynasty_perks/00_dynasty_perks.txt",
    source: "vanilla" as const,
    text:
      "blood_legacy_1 = { # Noble Veins\n" +
      "\tlegacy = blood_legacy_track\n" +
      "\n" +
      "\tcharacter_modifier = {\n" +
      "\t\tname = blood_legacy_1_modifier\n" +
      "\t\tpositive_random_genetic_chance = 0.30\n" +
      "\t}\n" +
      "}",
  },
  {
    name: "blood_legacy_2",
    file: "common/dynasty_perks/00_dynasty_perks.txt",
    source: "vanilla" as const,
    text:
      "blood_legacy_2 = {\n" +
      "\tlegacy = blood_legacy_track\n" +
      "\n" +
      "\teffect = {\n" +
      "\t\tcustom_description_no_bullet = {\n" +
      "\t\t\ttext = blood_legacy_2_effect\n" +
      "\t\t}\n" +
      "\t}\n" +
      "}",
  },
];

/**
 * blood_legacy_track as 99_legacies.txt has it, loaded the way the host loads
 * a track that belongs to the GAME: the mode toggle appears and a save has to
 * choose between duplicating it and overriding it.
 */
const VANILLA_TRACK: DefinitionForm = {
  ...LEGACY_FORM,
  current: {
    file: "common/dynasty_legacies/99_legacies.txt",
    line: 0,
    source: "vanilla",
    text: "blood_legacy_track = {\n\t\n}",
  },
};

/** The first button whose face contains `text`, the way a modder finds it. */
function buttonWith(root: ParentNode, text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    (button.textContent ?? "").includes(text)
  );
  if (!found) throw new Error(`no button reading "${text}"`);
  return found;
}

interface Booted {
  window: Window & typeof globalThis;
  posted: Array<Record<string, unknown>>;
  name: HTMLInputElement;
  type(input: HTMLInputElement, text: string): void;
  /** The perk tiles of the row, without the "Add perk" ghost that ends it. */
  cards(): HTMLElement[];
  post(message: unknown): void;
  hover(tile: HTMLElement): HTMLElement;
  /** Choose the entry of the open menu whose label says `label`. */
  pick(label: string): void;
  save(): { track: SaveDefinition; perks: SaveDefinition[] };
}

function boot(init: CreatorInit = INIT): Booted {
  const posted: Array<Record<string, unknown>> = [];
  const dom = new JSDOM(panelHtml(), {
    runScripts: "dangerously",
    beforeParse(window) {
      (window as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
        postMessage: (msg: Record<string, unknown>) => posted.push(msg),
        getState: () => null,
        setState: () => undefined,
      });
      // jsdom implements no scrolling, and the menu keeps its active row in
      // view. Without this every picker throws on open.
      window.Element.prototype.scrollIntoView = () => undefined;
    },
  });
  const window = dom.window as unknown as Window & typeof globalThis;
  const document = window.document;
  const post = (message: unknown): void => {
    window.dispatchEvent(new window.MessageEvent("message", { data: message }));
  };
  post({ type: "init", init });
  return {
    window,
    posted,
    post,
    name: document.getElementById("name") as HTMLInputElement,
    type(input: HTMLInputElement, text: string) {
      input.value = text;
      input.dispatchEvent(new window.Event("change"));
    },
    cards: () => [...document.querySelectorAll<HTMLElement>(".perktile:not([data-add])")],
    hover(tile: HTMLElement) {
      tile.dispatchEvent(new window.Event("pointerenter"));
      return document.getElementById("perkTip") as HTMLElement;
    },
    pick(label: string) {
      const row = [...document.querySelectorAll<HTMLElement>(".px-menu-item")].find((item) =>
        (item.textContent ?? "").includes(label)
      );
      if (!row) throw new Error(`no menu entry reading "${label}"`);
      row.click();
    },
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
    expect(app.window.document.getElementById("perkNote")?.textContent).toContain(
      "Vanilla tracks have 5 perks"
    );
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
    const preview = app.window.document.querySelector(".px-script pre")!.textContent;
    const { track, perks } = app.save();
    expect(preview).toBe([track.block, ...perks.map((perk) => perk.block)].join("\n\n"));
  });

  it("refuses a key the game could not read", () => {
    const app = boot();
    app.type(app.name, "Px Legacy!");
    (app.window.document.getElementById("save") as HTMLButtonElement).click();
    expect(app.posted.some((msg) => msg.type === "save")).toBe(false);
  });

  it("reads a perk's modifiers back as the game prints them", () => {
    const app = boot();
    app.post({ type: "loaded", track: LEGACY_FORM, perks: LOADED_PERKS, loc: {} });
    const tip = app.hover(app.cards()[0]);
    expect(tip.hidden).toBe(false);
    const line = tip.querySelector(".px-mod-line");
    // 0.30 with percent = a fraction the game shows scaled, and `good` is the
    // direction, so a positive number is the green one.
    expect(line?.className).toBe("px-mod-line good");
    expect(line?.textContent).toBe("+30%Positive Genetic Trait Inheritance Chance");
  });

  it("asks the host for the sentence a perk's effect prints", () => {
    const app = boot();
    app.post({ type: "loaded", track: LEGACY_FORM, perks: LOADED_PERKS, loc: {} });
    app.hover(app.cards()[1]);
    expect(app.posted).toContainEqual({ type: "loc", keys: ["blood_legacy_2_effect"] });
    app.post({ type: "locValues", values: { blood_legacy_2_effect: "Your children are born beautiful." } });
    const tip = app.hover(app.cards()[1]);
    expect(tip.textContent).toContain("Your children are born beautiful.");
  });

  it("opens the perk's form in the side panel when its tile is clicked", () => {
    const app = boot();
    const document = app.window.document;
    const side = document.getElementById("side") as HTMLElement;
    expect(side.hasAttribute("data-collapsed")).toBe(true);
    app.cards()[2].click();
    expect(side.hasAttribute("data-collapsed")).toBe(false);
    // The panel is titled with the perk itself, not with its number.
    expect(document.getElementById("sideTitle")?.textContent).toBe("Px Legacy 3");
    expect(document.getElementById("sideTitle")?.dataset.tip).toBe("Perk 3 of 5");
    const key = document.querySelector<HTMLInputElement>("#perkEditor input");
    expect(key?.value).toBe("px_legacy_3");
  });

  it("renumbers the track when a tile is dragged to another place", () => {
    const app = boot();
    const window = app.window;
    const list = window.document.getElementById("perks") as HTMLElement;
    (list as unknown as { setPointerCapture(id: number): void }).setPointerCapture = () => undefined;
    const first = app.cards()[0];
    const at = (type: string, clientX: number): Event =>
      new window.MouseEvent(type, { clientX, bubbles: true, button: 0 });
    first.dispatchEvent(at("pointerdown", 0));
    // Every tile measures as an empty box in jsdom, so the pointer lands past
    // all of them: the drag moves the first perk to the end of the track.
    list.dispatchEvent(at("pointermove", 400));
    list.dispatchEvent(at("pointerup", 400));

    expect(app.cards().map((tile) => tile.querySelector(".step")?.textContent)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
    ]);
    expect(app.save().perks.map((perk) => perk.name)).toEqual([
      "px_legacy_2",
      "px_legacy_3",
      "px_legacy_4",
      "px_legacy_5",
      "px_legacy_1",
    ]);
  });

  it("closes the perk editor on Escape", () => {
    const app = boot();
    const document = app.window.document;
    const side = document.getElementById("side") as HTMLElement;
    app.cards()[1].click();
    expect(side.hasAttribute("data-collapsed")).toBe(false);
    document.dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(side.hasAttribute("data-collapsed")).toBe(true);
  });

  it("builds a track's is_shown out of a picked DLC feature, with nothing typed", () => {
    const app = boot();
    const fields = app.window.document.getElementById("sections") as HTMLElement;
    buttonWith(fields, "Add condition").click();
    app.pick("Needs a DLC feature");
    buttonWith(fields, "pick a feature").click();
    app.pick("legends");
    expect(app.save().track.block).toBe(
      "px_legacy_track = {\n\tis_shown = {\n\t\thas_dlc_feature = legends\n\t}\n}"
    );
  });

  it("writes a perk's tooltip line and the sentence the player reads", () => {
    const app = boot();
    const document = app.window.document;
    app.cards()[0].click();
    const editor = document.getElementById("perkEditor") as HTMLElement;
    buttonWith(editor, "Add a tooltip line").click();
    const sentence = editor.querySelector<HTMLInputElement>('input[placeholder^="What this perk does"]')!;
    sentence.value = "Your heirs are born strong.";
    sentence.dispatchEvent(new app.window.Event("change"));

    const perk = app.save().perks[0];
    expect(perk.block).toBe(
      "px_legacy_1 = {\n\tlegacy = px_legacy_track\n\teffect = {\n" +
        "\t\tcustom_description_no_bullet = {\n\t\t\ttext = px_legacy_1_effect\n\t\t}\n\t}\n}"
    );
    expect(perk.loc).toContainEqual({ key: "px_legacy_1_effect", value: "Your heirs are born strong." });
  });

  it("starts an effect from a game perk's, under this perk's own loc key", () => {
    const app = boot();
    const document = app.window.document;
    app.cards()[0].click();
    const editor = document.getElementById("perkEditor") as HTMLElement;
    buttonWith(editor, "Start from a game perk's effect").click();
    app.pick("blood_legacy_2");
    expect(app.posted).toContainEqual({ type: "perkEffect", name: "blood_legacy_2" });

    app.post({ type: "perkEffect", name: "blood_legacy_2", block: LOADED_PERKS[1].text });
    // The words come from the perk the effect was copied off.
    app.post({ type: "locValues", values: { blood_legacy_2_effect: "Your bloodline runs true." } });
    const perk = app.save().perks[0];
    // The key the block prints is this perk's own: writing the game's key
    // would override the sentence of every perk that prints it.
    expect(perk.block).toContain("text = px_legacy_1_effect");
    expect(perk.loc).toContainEqual({ key: "px_legacy_1_effect", value: "Your bloodline runs true." });
  });

  it("leaves a loaded perk's own effect exactly as the file has it", () => {
    const app = boot();
    app.post({ type: "loaded", track: VANILLA_TRACK, perks: LOADED_PERKS, loc: {} });
    const preview = app.window.document.querySelector(".px-script pre")!.textContent ?? "";
    expect(preview).toContain(LOADED_PERKS[1].text);
  });

  it("duplicating a game track gives its perks keys of their own", () => {
    const app = boot();
    app.post({ type: "loaded", track: VANILLA_TRACK, perks: LOADED_PERKS, loc: {} });
    const duplicate = app.window.document.querySelector<HTMLButtonElement>('#mode [data-mode="duplicate"]')!;
    duplicate.click();
    expect(app.name.value).toBe("px_blood_legacy_track");
    const { track, perks } = app.save();
    expect(track.name).toBe("px_blood_legacy_track");
    expect(perks.map((perk) => perk.name)).toEqual(["px_blood_legacy_1", "px_blood_legacy_2"]);
    // A renamed definition is a new one, so nothing writes back into the game.
    expect(perks.every((perk) => perk.mode === "create")).toBe(true);
    expect(perks.every((perk) => perk.sourceFile === undefined)).toBe(true);
  });

  it("names the save on one line, and its menu moves either of the two files", () => {
    const app = boot();
    const document = app.window.document;
    app.post({
      type: "targets",
      track: { modLabel: "mymod", path: "common/dynasty_legacies/px_legacies.txt" },
      perks: { modLabel: "mymod", path: "common/dynasty_perks/px_dynasty_perks.txt" },
    });
    const lines = [...document.querySelectorAll<HTMLButtonElement>(".px-target")];
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toContain("dynasty_legacies/px_legacies.txt");
    // One line, but the tooltip owes the modder both files.
    expect(lines[0].dataset.tip).toContain("dynasty_perks/px_dynasty_perks.txt");
    lines[0].click();
    app.pick("The perks' file");
    expect(app.posted).toContainEqual({ type: "changeTarget", which: "perks" });
  });

  /**
   * erudition_legacy_4 verbatim from the game's own 00_dynasty_perks.txt: the
   * perk that writes three doctrine modifiers, which a form modelling one key
   * as one block used to reduce to the last of them.
   */
  const THREE_DOCTRINES = {
    name: "erudition_legacy_4",
    file: "common/dynasty_perks/00_dynasty_perks.txt",
    source: "vanilla" as const,
    text:
      "erudition_legacy_4 = {\n" +
      "\tlegacy = erudition_legacy_track\n" +
      "\tdoctrine_character_modifier = {\n" +
      "\t\tname = erudition_legacy_4_modifier_name\n" +
      "\t\tdoctrine = doctrine_no_head\n" +
      "\t\tdomain_tax_same_faith_mult = 0.05\n" +
      "\t}\n" +
      "\tdoctrine_character_modifier = {\n" +
      "\t\tname = erudition_legacy_4_modifier_name\n" +
      "\t\tdoctrine = doctrine_spiritual_head\n" +
      "\t\treligious_head_opinion = 15\n" +
      "\t}\n" +
      "}",
  };

  it("shows every doctrine modifier a loaded perk has, and writes them all back", () => {
    const app = boot();
    const document = app.window.document;
    app.post({ type: "loaded", track: LEGACY_FORM, perks: [THREE_DOCTRINES], loc: {} });
    app.cards()[0].click();
    const editor = document.getElementById("perkEditor") as HTMLElement;
    expect(editor.querySelectorAll(".doctrineblock")).toHaveLength(2);

    // Untouched, the two blocks come out exactly as the file has them (the
    // one line that moves is the link, which always follows the open track).
    expect(app.save().perks[0].block).toBe(
      THREE_DOCTRINES.text.replace("legacy = erudition_legacy_track", "legacy = px_legacy_track")
    );

    // A third block is added with its own doctrine and its name line.
    buttonWith(editor, "Add a doctrine modifier").click();
    const cards = [...editor.querySelectorAll<HTMLElement>(".doctrineblock")];
    expect(cards).toHaveLength(3);
    buttonWith(cards[2], "not set").click();
    app.pick("doctrine_spiritual_head");
    const written = app.save().perks[0];
    expect(written.block.match(/doctrine_character_modifier = \{/g)).toHaveLength(3);
    // A repeated key cannot go through setProperties, which rewrites the last
    // entry only, so a moved list is written as the whole block.
    expect(written.changed).toBeUndefined();
  });

  it("takes an empty script area back to its builder", () => {
    const app = boot();
    const document = app.window.document;
    app.cards()[0].click();
    const editor = document.getElementById("perkEditor") as HTMLElement;
    const toggle = buttonWith(editor, "Advanced: script");
    const area = toggle.parentElement!.querySelector("textarea") as HTMLTextAreaElement;
    toggle.click();
    expect(area.hidden).toBe(false);
    // Nothing was typed, so going back says nothing and shows the rows again.
    area.value = "   ";
    buttonWith(editor, "Back to the").click();
    expect(area.hidden).toBe(true);
    expect(toggle.parentElement!.querySelector<HTMLElement>(".note")!.hidden).toBe(true);
  });

  it("says which line kept a script from becoming rows, and offers to drop it", () => {
    const app = boot();
    const document = app.window.document;
    const fields = document.getElementById("sections") as HTMLElement;
    // A condition the builder can show, so the rows have something to restore.
    buttonWith(fields, "Add condition").click();
    app.pick("Needs a DLC feature");
    buttonWith(fields, "pick a feature").click();
    app.pick("legends");

    const toggle = buttonWith(fields, "Advanced: script");
    toggle.click();
    const area = toggle.parentElement!.querySelector("textarea") as HTMLTextAreaElement;
    // Opening the area seeds it with what the builder writes, so the block is
    // not lost to an empty box.
    expect(area.value).toContain("has_dlc_feature = legends");

    area.value = "{\n\thas_trait = brave\n}";
    buttonWith(fields, "Back to the").click();
    const note = toggle.parentElement!.querySelector<HTMLElement>(".note")!;
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain("has_trait = brave");
    expect(area.hidden).toBe(false);

    buttonWith(note, "Discard the script and go back").click();
    expect(area.hidden).toBe(true);
    expect(app.save().track.block).toBe(
      "px_legacy_track = {\n\tis_shown = {\n\t\thas_dlc_feature = legends\n\t}\n}"
    );
  });

  it("walks the track from the perk panel's own header", () => {
    const app = boot();
    const document = app.window.document;
    app.cards()[0].click();
    expect((document.getElementById("prevPerk") as HTMLButtonElement).disabled).toBe(true);
    (document.getElementById("nextPerk") as HTMLButtonElement).click();
    expect(document.getElementById("sideTitle")?.textContent).toBe("Px Legacy 2");
    expect((document.getElementById("prevPerk") as HTMLButtonElement).disabled).toBe(false);
    // The toolbar's own toggle closes it and opens it again on the same perk.
    (document.getElementById("togglePerk") as HTMLButtonElement).click();
    expect((document.getElementById("side") as HTMLElement).hasAttribute("data-collapsed")).toBe(true);
    (document.getElementById("togglePerk") as HTMLButtonElement).click();
    expect((document.getElementById("side") as HTMLElement).hasAttribute("data-collapsed")).toBe(false);
    expect(document.getElementById("sideTitle")?.textContent).toBe("Px Legacy 1");
  });

  it("opens a loaded track on its first perk", () => {
    const app = boot();
    app.post({ type: "loaded", track: LEGACY_FORM, perks: LOADED_PERKS, loc: {} });
    const document = app.window.document;
    expect((document.getElementById("side") as HTMLElement).hasAttribute("data-collapsed")).toBe(false);
    expect(document.getElementById("sideTitle")?.textContent).toBe("Blood Legacy 1");
  });

  it("draws the illustration behind the perks, twice, at a capped decode", () => {
    const app = boot({
      ...INIT,
      illustrations: [{ key: "px_legacy_track", url: "vscode://thumb.png", source: "mymod" }],
    });
    const document = app.window.document;
    // The strip's picture is asked for at its own cap, not the thumbnail's:
    // the file is 4216 px wide.
    expect(app.posted).toContainEqual({
      type: "images",
      keys: ["gfx/interface/illustrations/legacy_tracks/px_legacy_track.dds"],
      maxDim: 1024,
    });
    app.post({
      type: "images",
      urls: {
        "gfx/interface/illustrations/legacy_tracks/px_legacy_track.dds": "vscode://strip.png",
        "gfx/interface/component_tiles/tile_frame_thin_02.dds": "vscode://frame.png",
        "gfx/interface/component_masks/mask_legacy_track.dds": "vscode://mask.png",
      },
    });
    const strip = document.getElementById("stripArt") as HTMLElement;
    // One picture, drawn twice: the window's two background widgets both fill
    // the box the perks define.
    expect(strip.querySelectorAll("img")).toHaveLength(2);
    expect(strip.hasAttribute("data-empty")).toBe(false);
    expect([...strip.querySelectorAll("img")].every((img) => img.classList.contains("masked"))).toBe(true);
  });

  it("copies the script through the host, which owns the clipboard", () => {
    const app = boot();
    const copy = app.window.document.querySelector<HTMLButtonElement>(
      '#toolbar [data-tip^="Copy the script"]'
    )!;
    copy.click();
    const sent = app.posted.at(-1) as { type: string; text: string };
    expect(sent.type).toBe("copy");
    expect(sent.text).toContain("px_legacy_track = {");
  });

  it("says so, and writes nothing, when there is no mod to write into", () => {
    const app = boot({ ...INIT, problem: "No mod folder found." });
    expect((app.window.document.getElementById("save") as HTMLButtonElement).disabled).toBe(true);
    expect(app.window.document.getElementById("problem")?.textContent).toBe("No mod folder found.");
  });
});
