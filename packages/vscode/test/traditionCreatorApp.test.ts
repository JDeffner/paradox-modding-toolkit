/**
 * The Tradition Creator booted in jsdom from the REAL page markup (html.ts) and
 * the REAL app bundle, with the host stubbed by a message recorder and fed the
 * REAL tradition form (fixtures/traditionForm.json, captured from the server the
 * way definitionForm.test.ts builds it: the bundled harvest and schema over one
 * mod tradition and four vanilla ones copied out of the game's own files).
 *
 * What it pins is the promise the form makes to a modder who cannot script: a
 * freshly opened creator is saveable with only a name typed, the picture is one
 * picker per layer folder rather than one icon file, every list is a picker over
 * what the game HAS, and the panel on the right prints the tile and tooltip the
 * game will draw.
 */
import { describe, expect, it } from "vitest";
import * as path from "path";
import { JSDOM } from "jsdom";
import { buildSync } from "esbuild";
import { traditionCreatorHtml } from "../src/webviews/traditionCreator/html";
import type {
  AppToHost,
  TraditionCatalog,
  TraditionCreatorInit,
  TraditionSave,
} from "../src/webviews/traditionCreator/messages";
import traditionForm from "./fixtures/traditionForm.json";
import type { DefinitionForm } from "@px-lsp/protocol/protocol";

const PKG_ROOT = path.join(__dirname, "..");

let cachedBundle: string | null = null;
function appBundle(): string {
  if (cachedBundle) return cachedBundle;
  cachedBundle = buildSync({
    entryPoints: [path.join(PKG_ROOT, "src", "webviews", "traditionCreator", "app", "main.ts")],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    absWorkingDir: PKG_ROOT,
    write: false,
  }).outputFiles[0].text;
  return cachedBundle;
}

function panelHtml(): string {
  const html = traditionCreatorHtml({ scriptSrc: "app.js", nonce: "test", csp: "" });
  return html.replace(/<script nonce="test" src="app.js"><\/script>/, `<script>${appBundle()}</script>`);
}

const FORM = traditionForm as unknown as DefinitionForm;

const ICONS = "gfx/interface/icons/culture_tradition";

/**
 * A slice of what the panel's catalog reads off the game folder: the five layer
 * folders CULTURE_TRADITION_LAYER_PATHS names, the three currencies
 * _cultural_traits.info documents for a cost, and one existing tradition's own
 * picks (game/common/culture/traditions/00_combat_traditions.txt).
 */
const CATALOG: TraditionCatalog = {
  layers: [
    {
      index: 0,
      path: `${ICONS}/0-background`,
      label: "0-background",
      choices: [
        { value: "martial", rel: `${ICONS}/0-background/martial/martial1.dds`, folder: true },
        { value: "learning", rel: `${ICONS}/0-background/learning/learning1.dds`, folder: true },
      ],
    },
    {
      index: 1,
      path: `${ICONS}/1-pattern`,
      label: "1-pattern",
      choices: [{ value: "western", rel: `${ICONS}/1-pattern/western/western1.dds`, folder: true }],
    },
    { index: 2, path: `${ICONS}/2-support`, label: "2-support", choices: [] },
    {
      index: 3,
      path: `${ICONS}/3-stroke`,
      label: "3-stroke",
      choices: [{ value: "1.dds", rel: `${ICONS}/3-stroke/1.dds`, folder: false }],
    },
    {
      index: 4,
      path: `${ICONS}/4-items`,
      label: "4-items",
      choices: [
        { value: "boat.dds", rel: `${ICONS}/4-items/boat.dds`, folder: false },
        { value: "fight.dds", rel: `${ICONS}/4-items/fight.dds`, folder: false },
      ],
    },
  ],
  costKeys: ["gold", "prestige", "piety"],
  // Two the game's own traditions set (00_combat_traditions.txt,
  // 00_ritual_traditions.txt): a switch and one written as a number.
  parameters: ["mountain_trait_bonuses", "number_of_spouses"],
  traditions: {
    tradition_winter_warriors: {
      category: "combat",
      layers: { "0": "learning", "1": "western", "4": "fight.dds" },
    },
  },
  examples: { is_shown: "always = no", ai_will_do: "value = 400" },
};

const INIT: TraditionCreatorInit = {
  form: FORM,
  locLanguage: "english",
  prefix: "px",
  catalog: CATALOG,
};

/** Where the host says the next save goes, shown in the top bar. */
const TARGET = { modLabel: "cultivation", path: "common/culture/traditions/px_culture_traditions.txt" };

/**
 * A slice of what `paradox/modifierFormats` answers for CK3: the game gives a
 * modifier its own word rather than its key, and says which direction is good.
 */
const FORMATS = {
  naval_movement_speed_mult: {
    label: "Naval Movement Speed",
    decimals: 0,
    percent: true,
    color: "good" as const,
  },
};

/**
 * The game's own cost line for prestige, as `paradox/modifierFormats` answers
 * `PRESTIGE_COST` = `"[prestige_i] $VALUE|0$"` (core_l_english.yml) through
 * `game_concept_prestige_i` = `"@prestige_icon!"` and texticons.gui.
 */
const PRESTIGE_ICON = "gfx/interface/icons/modifiers/icon_prestige_01.dds";
const COST_LINES = {
  PRESTIGE_COST: [{ icon: { texture: PRESTIGE_ICON } }, { text: " $VALUE|0$" }],
};

interface Booted {
  window: Window & typeof globalThis;
  document: Document;
  posted: AppToHost[];
  send(message: unknown): void;
  save(): TraditionSave | undefined;
  labels(): string[];
  script(): string;
}

function boot(init: TraditionCreatorInit = INIT): Booted {
  const posted: AppToHost[] = [];
  const dom = new JSDOM(panelHtml(), {
    runScripts: "dangerously",
    beforeParse(window) {
      (window as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
        postMessage: (msg: AppToHost) => posted.push(msg),
      });
      // jsdom has no layout, and menu() scrolls its active row into view.
      window.Element.prototype.scrollIntoView = () => undefined;
    },
  });
  const window = dom.window as unknown as Window & typeof globalThis;
  const send = (message: unknown): void => {
    window.dispatchEvent(new window.MessageEvent("message", { data: message }));
  };
  send({ type: "init", init });
  // The host resolves where a save lands and says so as the form loads.
  send({ type: "target", target: TARGET });
  return {
    window,
    document: window.document,
    posted,
    send,
    save: () =>
      posted
        .filter((m) => m.type === "save")
        .map((m) => m.save)
        .at(-1),
    labels: () =>
      [...window.document.querySelectorAll("#sections .px-label, .kept > code")].map(
        (l) => l.textContent ?? ""
      ),
    script: () => window.document.querySelector(".px-script > pre")?.textContent ?? "",
  };
}

/** Type into a text input the way a user does. */
function type(app: Booted, selector: string, value: string): void {
  const input = app.document.querySelector<HTMLInputElement>(selector)!;
  input.value = value;
  input.dispatchEvent(new app.window.Event("input", { bubbles: true }));
  input.dispatchEvent(new app.window.Event("change", { bubbles: true }));
}

/** The control of the field whose label is `key`. */
function control(app: Booted, key: string): HTMLElement {
  const label = [...app.document.querySelectorAll("#sections .px-label")].find((l) => l.textContent === key)!;
  return label.nextElementSibling as HTMLElement;
}

/** The entries a just-opened picker offers, as "label | hint". */
function offered(app: Booted, within = ""): string[] {
  return [...app.document.querySelectorAll(`${within} .px-menu-item`)].map((row) =>
    [row.querySelector(".px-grow")?.textContent, row.querySelector(".px-menu-hint")?.textContent]
      .filter(Boolean)
      .join(" | ")
  );
}

/** Pick a value out of the open menu of a dropdown trigger. */
function pickFrom(app: Booted, trigger: HTMLElement, value: string): void {
  (trigger as HTMLButtonElement).click();
  const row = [...app.document.querySelectorAll(".px-menu-item")].find(
    (item) => item.querySelector(".px-grow")?.textContent === value
  ) as HTMLElement;
  row.click();
}

function pickEnum(app: Booted, key: string, value: string): void {
  pickFrom(app, control(app, key), value);
}

/** The dropdown of one layer row, by the layer folder's own name. */
function layerTrigger(app: Booted, label: string): HTMLButtonElement {
  const caption = [...app.document.querySelectorAll(".layerrow > .px-label")].find(
    (l) => l.textContent === label
  )!;
  return caption.parentElement!.querySelector<HTMLButtonElement>(".px-dropdown")!;
}

/** Turn one parameter on, out of the ones the catalog offers. */
function addParameter(app: Booted, name: string): void {
  const add = [...app.document.querySelectorAll("#sections .px-btn")].find(
    (b) => b.textContent === "Add parameter"
  ) as HTMLButtonElement;
  add.click();
  (
    [...app.document.querySelectorAll(".px-picker-results .px-menu-item")].find(
      (row) => row.querySelector(".px-grow")?.textContent === name
    ) as HTMLElement
  ).click();
}

/** A loc field names the key it writes under, so that is how one is found. */
function locInput(app: Booted, key: string): HTMLInputElement | null {
  const code = [...app.document.querySelectorAll("#sections code")].find((c) => c.textContent === key);
  return (code?.previousElementSibling as HTMLInputElement | undefined) ?? null;
}

/** Commit a value into a control the way a user leaving the field does. */
function setValue(app: Booted, input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new app.window.Event("change", { bubbles: true }));
}

/** A parameter the game's own combat traditions set, and its sentence's key. */
const PARAM = "mountain_trait_bonuses";
const PARAM_KEY = `culture_parameter_${PARAM}`;

describe("the Tradition Creator boots on the real form", () => {
  it("asks the host for nothing until it is told what a tradition is", () => {
    const app = boot();
    expect(app.posted[0]).toEqual({ type: "ready" });
  });

  it("shows every key the form answered, in its designed section", () => {
    const app = boot();
    const labels = app.labels();
    // The whole harvest reaches the panel: nothing is dropped for being
    // uncommon, it is only folded away under Advanced (AD-5).
    for (const key of FORM.keys) expect(labels).toContain(key.key);
    expect(labels).toContain("Name");
    expect(labels).toContain("Description");
  });

  it("prefills the name with the game's own tradition_ prefix and says where it saves", () => {
    const app = boot();
    expect(app.document.querySelector<HTMLInputElement>("#name")!.value).toBe("tradition_px");
    expect(app.document.getElementById("target")!.textContent).toContain("cultivation");
    expect(app.document.getElementById("target")!.textContent).toContain(
      "culture/traditions/px_culture_traditions.txt"
    );
    expect(app.document.getElementById("source")!.textContent).toBe("New");
  });

  it("says what is missing instead of opening a form whose Save would fail", () => {
    const app = boot({ ...INIT, problem: "No mod folder found." });
    expect(app.document.getElementById("problem")!.hidden).toBe(false);
    expect(app.document.querySelector<HTMLButtonElement>("#save")!.disabled).toBe(true);
  });

  it("refuses a name the engine cannot read", () => {
    const app = boot();
    type(app, "#name", "Tradition Px");
    expect(app.document.querySelector<HTMLButtonElement>("#save")!.disabled).toBe(true);
    type(app, "#name", "tradition_px_seafarers");
    expect(app.document.querySelector<HTMLButtonElement>("#save")!.disabled).toBe(false);
  });
});

describe("every list is a picker over what the game has", () => {
  it("offers the categories the game's own traditions write, not a text box", () => {
    const app = boot();
    const trigger = control(app, "category") as HTMLButtonElement;
    expect(trigger.tagName).toBe("BUTTON");
    // The form sampled these out of the indexed traditions; nothing is listed
    // in the panel's own code.
    trigger.click();
    expect(offered(app)).toContain("combat");
    expect(offered(app)).toContain("regional");
  });

  it("draws one picker per layer folder, the way the engine stacks them", () => {
    const app = boot();
    const captions = [...app.document.querySelectorAll(".layerrow > .px-label")].map((l) => l.textContent);
    expect(captions).toEqual(["0-background", "1-pattern", "2-support", "3-stroke", "4-items"]);
    // An empty layer keeps its slot and its picker names the layer, so the row
    // reads as empty rather than as a control that lost its label.
    expect(app.document.querySelectorAll(".layerrow > .layerthumb[data-empty]")).toHaveLength(5);
    expect(layerTrigger(app, "0-background").textContent).toBe("No background");
    expect(layerTrigger(app, "0-background").hasAttribute("data-placeholder")).toBe(true);
    // A subfolder is offered as itself: that is what the game randomizes over.
    layerTrigger(app, "0-background").click();
    expect(offered(app)).toContain("martial | a folder the game picks from");
    // The thumbnails are asked for lazily, when the picker opens, capped.
    const martial = `${ICONS}/0-background/martial/martial1.dds`;
    expect(app.posted.some((m) => m.type === "images" && m.maxDim === 256 && m.keys.includes(martial))).toBe(
      true
    );
  });

  it("draws the picked layers full size beside the rows, and only those", () => {
    const app = boot();
    const martial = `${ICONS}/0-background/martial/martial1.dds`;
    pickFrom(app, layerTrigger(app, "0-background"), "martial");
    // The composed tile sits in the Icon section, at the game's own 220x120.
    const live = [...app.document.querySelectorAll<HTMLImageElement>(".iconlive .px-tradicon > img")];
    expect(live.map((img) => img.dataset.rel)).toEqual([martial]);
    // Full-size decodes are asked for the chosen file alone, never a folder.
    const full = app.posted.filter((m) => m.type === "images" && m.maxDim === 0);
    expect(full.flatMap((m) => (m.type === "images" ? m.keys : []))).toEqual([martial]);
    // A full-size answer paints the tile; the row's slot keeps its thumbnail.
    app.send({ type: "images", urls: { [martial]: "https://host/full.png" }, maxDim: 0 });
    expect(live[0].src).toBe("https://host/full.png");
    const slot = app.document.querySelector<HTMLImageElement>(".layerrow > img.layerthumb")!;
    expect(slot.dataset.rel).toBe(martial);
    expect(slot.hidden).toBe(true);
    app.send({ type: "images", urls: { [martial]: "https://host/thumb.png" }, maxDim: 256 });
    expect(slot.src).toBe("https://host/thumb.png");
  });

  it("names a modifier the way the game prints it, with its key as the hint", () => {
    const app = boot();
    app.send({ type: "modifierFormats", formats: FORMATS });
    const add = [...app.document.querySelectorAll("#sections .px-btn")].find(
      (b) => b.textContent === "Add modifier"
    ) as HTMLButtonElement;
    add.click();
    (app.document.querySelector("#sections .modrow > .px-dropdown") as HTMLButtonElement).click();
    expect(offered(app)).toContain("Naval Movement Speed | naval_movement_speed_mult");
  });

  it("offers one cost field per currency the game's own doc names", () => {
    const app = boot();
    const captions = [...app.document.querySelectorAll(".costrow > .px-label")].map((l) => l.textContent);
    expect(captions).toEqual(["gold", "prestige", "piety"]);
  });

  it("prints a cost the way the game's own cost line does: the icon, then the whole number", () => {
    const app = boot();
    app.send({ type: "modifierFormats", formats: FORMATS, lines: COST_LINES });
    setValue(app, app.document.querySelector('input[data-currency="prestige"]')!, "300");
    // The texticon is asked for as a thumbnail and drawn where it arrives: in
    // the cost row's caption and in the tile's cost line.
    expect(app.posted.some((m) => m.type === "images" && m.keys.includes(PRESTIGE_ICON))).toBe(true);
    app.send({ type: "images", urls: { [PRESTIGE_ICON]: "https://host/prestige.png" }, maxDim: 256 });
    const line = app.document.querySelector("#tip .tile-cost-line")!;
    expect([...line.children].map((c) => c.className)).toEqual(["px-texticon", "tile-cost-value"]);
    expect(line.querySelector(".tile-cost-value")!.textContent).toBe("300");
    expect(line.textContent).toBe(" 300");
    const caption = [...app.document.querySelectorAll(".costrow > .px-label")][1];
    expect(caption.querySelector(".px-texticon")).not.toBeNull();
    // A script value's name is the game's to resolve: printed as written.
    setValue(app, app.document.querySelector('input[data-currency="prestige"]')!, "tradition_base_cost");
    expect(app.document.querySelector("#tip .tile-cost-value")!.textContent).toBe("tradition_base_cost");
    // A currency whose icon the host could not resolve (the game picks the
    // piety icon by faith at runtime) reads as number and word, never a guess.
    setValue(app, app.document.querySelector('input[data-currency="piety"]')!, "150");
    const piety = [...app.document.querySelectorAll("#tip .tile-cost-line")][1];
    expect(piety.querySelector(".px-texticon")).toBeNull();
    expect(piety.textContent).toBe("150piety");
  });
});

describe("the preview is the game's own tile", () => {
  it("stacks the picked layers, drawing the pattern twice the way the gui does", () => {
    const app = boot();
    pickFrom(app, layerTrigger(app, "0-background"), "martial");
    pickFrom(app, layerTrigger(app, "1-pattern"), "western");
    const drawn = [...app.document.querySelectorAll<HTMLImageElement>("#tip .px-tradicon > img")];
    // background, pattern, pattern mirrored: `widget_tradition_icon` draws the
    // pattern layer a second time with `mirror = horizontal`.
    expect(drawn.map((img) => img.dataset.rel)).toEqual([
      `${ICONS}/0-background/martial/martial1.dds`,
      `${ICONS}/1-pattern/western/western1.dds`,
      `${ICONS}/1-pattern/western/western1.dds`,
    ]);
    expect(drawn[2].style.transform).toContain("scaleX(-1)");
  });

  it("prints a modifier the way the game prints it, under the block it is in", () => {
    const app = boot();
    app.send({ type: "modifierFormats", formats: FORMATS });
    const add = [...app.document.querySelectorAll("#sections .px-btn")].find(
      (b) => b.textContent === "Add modifier"
    ) as HTMLButtonElement;
    add.click();
    pickFrom(app, app.document.querySelector("#sections .modrow > .px-dropdown")!, "Naval Movement Speed");
    const value = app.document.querySelector("#sections .modrow input[type=number]") as HTMLInputElement;
    value.value = "0.1";
    value.dispatchEvent(new app.window.Event("change", { bubbles: true }));

    const line = app.document.querySelector("#tip .px-mod-line")!;
    expect(line.querySelector(".px-mod-value")!.textContent).toBe("+10%");
    expect(line.querySelector(".px-mod-label")!.textContent).toBe("Naval Movement Speed");
    expect(line.className).toContain("good");
    expect(app.document.querySelector("#tip .tip-note")!.textContent).toBe("character_modifier");
  });

  it("heads the tile with the category's own word once the loc resolves it", () => {
    const app = boot();
    pickEnum(app, "category", "combat");
    expect(app.posted.some((m) => m.type === "loc" && m.keys.includes("tradition_group_combat"))).toBe(true);
    app.send({ type: "loc", values: { tradition_group_combat: "Warfare" } });
    expect(app.document.querySelector("#tip .tip-group")!.textContent).toBe("Warfare");
  });
});

describe("a new tradition saves with a name, a category and a layer", () => {
  it("posts the block the form shows, with the loc the name derives", () => {
    const app = boot();
    type(app, "#name", "tradition_px_seafarers");
    pickEnum(app, "category", "regional");
    pickFrom(app, layerTrigger(app, "4-items"), "boat.dds");

    app.document.querySelector<HTMLButtonElement>("#save")!.click();
    const save = app.save()!;
    expect(save.mode).toBe("create");
    expect(save.name).toBe("tradition_px_seafarers");
    // The form's own order: identity first, then the picture.
    expect(save.block).toBe(
      "tradition_px_seafarers = {\n\tcategory = regional\n\tlayers = {\n\t\t4 = boat.dds\n\t}\n}"
    );
    // The script panel is the same text, so what a modder reads is what is written.
    expect(app.script()).toBe(save.block);
    // BOTH keys, always: a description nobody typed used to write no key at
    // all, and the game printed `tradition_px_seafarers_desc` at the player.
    expect(save.loc).toEqual([
      { key: "tradition_px_seafarers_name", value: "Tradition Px Seafarers" },
      { key: "tradition_px_seafarers_desc", value: "Tradition Px Seafarers" },
    ]);
  });

  it("writes the parameters block as the switches the game reads", () => {
    const app = boot();
    type(app, "#name", "tradition_px_raiders");
    addParameter(app, PARAM);
    expect(app.script()).toContain(`parameters = {\n\t\t${PARAM} = yes\n\t}`);
  });

  it("writes the keys in the order the game's own traditions write them", () => {
    const app = boot();
    type(app, "#name", "tradition_px_seafarers");
    pickEnum(app, "category", "regional");
    pickFrom(app, layerTrigger(app, "4-items"), "boat.dds");
    addParameter(app, PARAM);
    setValue(app, app.document.querySelector('input[data-currency="prestige"]')!, "300");
    setValue(app, app.document.querySelector("#sections textarea.px-mono")!, "{ always = yes }");
    const add = [...app.document.querySelectorAll("#sections .px-btn")].find(
      (b) => b.textContent === "Add modifier"
    ) as HTMLButtonElement;
    add.click();
    pickFrom(
      app,
      app.document.querySelector("#sections .modrow > .px-dropdown")!,
      "naval_movement_speed_mult"
    );

    // Measured over game/common/culture/traditions: category, layers, the
    // triggers, parameters, the modifier blocks, cost, and ai_will_do last.
    const written = [...app.script().matchAll(/^\t([a-z_]+) =/gm)].map((m) => m[1]);
    expect(written).toEqual(["category", "layers", "is_shown", "parameters", "character_modifier", "cost"]);
  });
});

describe("a parameter carries a sentence of its own", () => {
  it("asks for one the workspace has not written, and saves it with the tradition", () => {
    const app = boot();
    type(app, "#name", "tradition_px_seafarers");
    addParameter(app, PARAM);
    // ck3-tiger reports a parameter with no culture_parameter_ key as a missing
    // localization, so the form asks the workspace first and then asks for it.
    expect(app.posted.some((m) => m.type === "loc" && m.keys.includes(PARAM_KEY))).toBe(true);
    setValue(app, locInput(app, PARAM_KEY)!, "Mountain folk fight better.");

    // The tooltip reads the sentence, not the switch's key.
    expect(app.document.querySelector("#tip .tip-params")!.textContent).toBe("Mountain folk fight better.");

    app.document.querySelector<HTMLButtonElement>("#save")!.click();
    expect(app.save()!.loc).toContainEqual({ key: PARAM_KEY, value: "Mountain folk fight better." });
  });

  it("says nothing to fill in when the workspace already words it", () => {
    const app = boot();
    addParameter(app, PARAM);
    app.send({ type: "loc", values: { [PARAM_KEY]: "Mountain folk fight better." } });
    expect(locInput(app, PARAM_KEY)).toBe(null);
    expect([...app.document.querySelectorAll(".kept")].map((row) => row.textContent).join(" ")).toContain(
      'already reads "Mountain folk fight better."'
    );
    expect(app.document.querySelector("#tip .tip-params")!.textContent).toBe("Mountain folk fight better.");
  });
});

describe("editing a tradition the mod already has", () => {
  const CURRENT = {
    file: "D:/mod/common/culture/traditions/px_culture_traditions.txt",
    line: 1,
    source: "mod" as const,
    text: "tradition_px_seafarers = {\n\tcategory = regional\n\tcost = {\n\t\tprestige = 300\n\t}\n}",
  };

  it("sends only the key that moved, and the file it came from", () => {
    const app = boot();
    app.send({ type: "form", form: { ...FORM, current: CURRENT } });
    expect(app.document.getElementById("source")!.textContent).toBe("Mod");
    const prestige = app.document.querySelector<HTMLInputElement>('input[data-currency="prestige"]')!;
    expect(prestige.value).toBe("300");
    prestige.value = "500";
    prestige.dispatchEvent(new app.window.Event("change", { bubbles: true }));

    app.document.querySelector<HTMLButtonElement>("#save")!.click();
    const save = app.save()!;
    expect(save.mode).toBe("edit");
    // The server drops the value over the old one at the statement's own
    // place, so the block's own lines have to arrive indented.
    expect(save.changed).toEqual([{ key: "cost", value: "{\n\t\tprestige = 500\n\t}" }]);
    expect(save.sourceFile).toBe("px_culture_traditions.txt");
    // The whole block travels too, byte-identical apart from the one value.
    expect(save.block).toBe(CURRENT.text.replace("prestige = 300", "prestige = 500"));
  });

  it("keeps a cost the form cannot stand for exactly as the file writes it", () => {
    const app = boot();
    // What 195 of 197 vanilla traditions write: a script value block, not a
    // number a currency field could hold.
    const text =
      "tradition_px_seafarers = {\n\tcategory = regional\n\tcost = {\n\t\tprestige = {\n\t\t\tvalue = tradition_base_cost\n\t\t}\n\t}\n}";
    app.send({ type: "form", form: { ...FORM, current: { ...CURRENT, text } } });
    expect(app.labels()).toContain("cost");
    expect(app.document.querySelector(".kept")!.textContent).toContain("script block");
    // Saving it back changes nothing about the block it could not model.
    app.document.querySelector<HTMLButtonElement>("#save")!.click();
    expect(app.save()!.block).toBe(text);
  });

  it("a game tradition opens as a duplicate under the mod's prefix", () => {
    const app = boot();
    app.send({
      type: "form",
      form: {
        ...FORM,
        current: {
          ...CURRENT,
          source: "vanilla" as const,
          text: "tradition_seafaring = {\n\tcategory = regional\n}",
        },
      },
    });
    expect(app.document.getElementById("source")!.textContent).toBe("Game");
    expect(app.document.getElementById("mode")!.hidden).toBe(false);
  });
});
