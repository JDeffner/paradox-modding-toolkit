/**
 * The Trait Creator booted in jsdom from the REAL page markup (html.ts) and
 * the REAL app bundle, with the host stubbed by a message recorder and fed the
 * REAL trait form (fixtures/traitForm.json, captured from the server the way
 * definitionForm.test.ts builds it: the bundled harvest and schema over one mod
 * trait and four vanilla ones copied out of the game's own 00_traits.txt).
 *
 * What it pins is the promise the form makes to a modder who cannot script: a
 * freshly opened creator is saveable with only a name typed, every list is a
 * picker over what the game HAS, every empty input shows a value the game
 * itself writes, and the panel on the right prints the trait the way the game's
 * tooltip will.
 */
import { describe, expect, it } from "vitest";
import * as path from "path";
import { JSDOM } from "jsdom";
import { buildSync } from "esbuild";
import { traitCreatorHtml } from "../src/webviews/traitCreator/html";
import type { AppToHost, TraitCreatorInit, TraitSave } from "../src/webviews/traitCreator/messages";
import traitForm from "./fixtures/traitForm.json";
import type { DefinitionForm } from "@px-lsp/protocol/protocol";

const PKG_ROOT = path.join(__dirname, "..");

let cachedBundle: string | null = null;
function appBundle(): string {
  if (cachedBundle) return cachedBundle;
  cachedBundle = buildSync({
    entryPoints: [path.join(PKG_ROOT, "src", "webviews", "traitCreator", "app", "main.ts")],
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
  const html = traitCreatorHtml({ scriptSrc: "app.js", nonce: "test", csp: "" });
  return html.replace(/<script nonce="test" src="app.js"><\/script>/, `<script>${appBundle()}</script>`);
}

const FORM = traitForm as unknown as DefinitionForm;

const INIT: TraitCreatorInit = {
  form: FORM,
  locLanguage: "english",
  prefix: "px",
  iconKeys: ["_frame_education.dds", "brave.dds", "craven.dds"],
};

/** Where the host says the next save goes, shown in the top bar. */
const TARGET = { modLabel: "cultivation", path: "common/traits/px_traits.txt" };

/**
 * A slice of what `paradox/modifierFormats` answers for CK3: the game prints
 * `martial` as a whole number where more is better, and gives a modifier its
 * own word rather than its key.
 */
const FORMATS = {
  martial: { label: "Martial", decimals: 0, color: "good" as const },
  dynasty_opinion: { label: "Dynasty Opinion", decimals: 0, color: "good" as const },
  // `hidden = yes` in the game's own 00_definitions.txt: the whole ai_* family.
  ai_boldness: { label: "Ai Boldness", decimals: 0, color: "good" as const, hidden: true },
};

/**
 * The entries the game's trait tooltip prints an opinion through, verbatim
 * from localization/english/custom_localization/character_relations_l_english.yml
 * and core_l_english.yml.
 */
const OPINION_LOC_VALUES = {
  TRAIT_OPINION_SAME_TRAIT: "Opinion of [TRAIT.GetName( GetNullCharacter )] Characters",
  TRAIT_OPINION_ATTRACTION: "[attraction|E] Opinion",
  TRAIT_COMPATIBILITY_LIKES: "$TRAIT$ likes $OTHER_TRAIT$: $VALUE|=+0$",
};

interface Booted {
  window: Window & typeof globalThis;
  document: Document;
  posted: AppToHost[];
  send(message: unknown): void;
  save(): TraitSave | undefined;
  labels(): string[];
  script(): string;
}

function boot(init: TraitCreatorInit = INIT): Booted {
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
    // Every name the form shows: the field rows and the skills row's captions.
    labels: () =>
      [...window.document.querySelectorAll("#sections .px-label, #sections .skill > span")].map(
        (l) => l.textContent ?? ""
      ),
    script: () => window.document.querySelector(".px-script > pre")?.textContent ?? "",
  };
}

/** Type into a text/number input the way a user does. */
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

/** One of the six skill inputs, which sit under their caption, not beside it. */
function skill(app: Booted, key: string): HTMLInputElement {
  return app.document.querySelector<HTMLInputElement>(`#sections input[data-key="${key}"]`)!;
}

/** A number field that sits beside its label (an opinion, a rule). */
function setNumber(app: Booted, key: string, value: string): void {
  const input = control(app, key).querySelector("input")!;
  input.value = value;
  input.dispatchEvent(new app.window.Event("change", { bubbles: true }));
}

function setSkill(app: Booted, key: string, value: string): void {
  const input = skill(app, key);
  input.value = value;
  input.dispatchEvent(new app.window.Event("change", { bubbles: true }));
}

/** The entries a just-opened picker offers, as "label | hint". */
function offered(app: Booted, within = ""): string[] {
  return [...app.document.querySelectorAll(`${within} .px-menu-item`)].map((row) =>
    [row.querySelector(".px-grow")?.textContent, row.querySelector(".px-menu-hint")?.textContent]
      .filter(Boolean)
      .join(" | ")
  );
}

function pickEnum(app: Booted, key: string, value: string): void {
  (control(app, key) as HTMLButtonElement).click();
  const row = [...app.document.querySelectorAll(".px-menu-item")].find(
    (item) => item.querySelector(".px-grow")?.textContent === value
  ) as HTMLElement;
  row.click();
}

describe("the Trait Creator boots on the real form", () => {
  it("asks the host for nothing until it is told what a trait is", () => {
    const app = boot();
    expect(app.posted[0]).toEqual({ type: "ready" });
    expect(app.posted.some((m) => m.type === "icons")).toBe(true);
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

  it("prefills the name from the mod prefix and says where it saves", () => {
    const app = boot();
    expect(app.document.querySelector<HTMLInputElement>("#name")!.value).toBe("px_trait");
    expect(app.document.getElementById("target")!.textContent).toContain("cultivation");
    expect(app.document.getElementById("target")!.textContent).toContain("traits/px_traits.txt");
    expect(app.document.getElementById("source")!.textContent).toBe("New");
  });

  it("says what is missing instead of opening a form whose Save would fail", () => {
    const app = boot({ ...INIT, problem: "No mod folder found." });
    expect(app.document.getElementById("problem")!.hidden).toBe(false);
    expect(app.document.querySelector<HTMLButtonElement>("#save")!.disabled).toBe(true);
  });

  it("refuses a name the engine cannot read", () => {
    const app = boot();
    type(app, "#name", "Px Stoic");
    expect(app.document.querySelector<HTMLButtonElement>("#save")!.disabled).toBe(true);
    type(app, "#name", "px_stoic");
    expect(app.document.querySelector<HTMLButtonElement>("#save")!.disabled).toBe(false);
  });
});

describe("every list is a picker over what the game has", () => {
  it("offers the categories the game's own traits write, not a text box", () => {
    const app = boot();
    const trigger = control(app, "category") as HTMLButtonElement;
    expect(trigger.tagName).toBe("BUTTON");
    // The form sampled these out of the indexed traits; nothing is listed here.
    trigger.click();
    expect(offered(app)).toContain("personality");
    expect(offered(app)).toContain("education");
  });

  it("names a trait the way the player reads it, with its key as the hint", () => {
    const app = boot();
    (control(app, "opposites").querySelector("button") as HTMLButtonElement).click();
    expect(offered(app, ".px-picker-results")).toContain("Brave | brave");
  });

  it("names a modifier the way the game prints it, with its key as the hint", () => {
    const app = boot();
    app.send({ type: "modifierFormats", formats: FORMATS });
    const add = [...app.document.querySelectorAll("#sections .px-btn")].find(
      (b) => b.textContent === "Add modifier"
    ) as HTMLButtonElement;
    add.click();
    (app.document.querySelector("#sections .modrow > .px-dropdown") as HTMLButtonElement).click();
    expect(offered(app)).toContain("Dynasty Opinion | dynasty_opinion");
  });

  it("shows the body the game writes as a script field's placeholder", () => {
    const example = "{ parameter = mountain_trait_bonuses mountains_max_combat_roll = 3 }";
    const app = boot({
      ...INIT,
      form: {
        ...FORM,
        keys: FORM.keys.map((key) => (key.key === "culture_modifier" ? { ...key, example } : key)),
      },
    });
    const area = control(app, "culture_modifier").querySelector("textarea")!;
    expect(area.placeholder).toBe(example);
  });

  it("shows the value the game writes most often as every skill's placeholder", () => {
    const app = boot();
    // `martial = 2` is the literal the indexed traits write most; a blank field
    // that says only "not set" is what this replaces.
    expect(skill(app, "martial").placeholder).toBe("2");
    for (const key of ["diplomacy", "martial", "stewardship", "intrigue", "learning", "prowess"]) {
      expect(skill(app, key)).toBeTruthy();
    }
  });
});

describe("the preview is the game's own tooltip", () => {
  it("prints a skill the way the game prints it, and frames it by category", () => {
    const app = boot();
    app.send({ type: "modifierFormats", formats: FORMATS });
    setSkill(app, "martial", "3");
    pickEnum(app, "category", "education");
    // The frame is asked for by name; the host answers with a decoded picture.
    expect(app.posted.some((m) => m.type === "icons" && m.keys.includes("_frame_education.dds"))).toBe(true);
    app.send({ type: "icons", urls: { "_frame_education.dds": "https://host/frame.png" } });

    const line = app.document.querySelector("#tip .px-mod-line")!;
    expect(line.querySelector(".px-mod-value")!.textContent).toBe("+3");
    expect(line.querySelector(".px-mod-label")!.textContent).toBe("Martial");
    // `color = good` and a positive value: the player's green.
    expect(line.className).toContain("good");
    expect(app.document.querySelector<HTMLImageElement>("#tip .tip-icon img.frame")!.src).toBe(
      "https://host/frame.png"
    );
  });

  it("draws the category frame UNDER the picture, at the same size", () => {
    const app = boot();
    type(app, "#name", "brave");
    pickEnum(app, "category", "education");
    app.send({
      type: "icons",
      urls: { "_frame_education.dds": "https://host/frame.png", "brave.dds": "https://host/brave.png" },
    });
    // The frames are opaque in the middle and share the picture's own 120x120
    // canvas, so drawn over it they would hide the trait entirely.
    const images = [...app.document.querySelectorAll<HTMLImageElement>("#tip .tip-icon img")];
    expect(images.map((img) => img.className)).toEqual(["frame", ""]);
    expect(images[1].src).toBe("https://host/brave.png");
  });

  it("prints the opinion keys through the game's own tooltip loc entries", () => {
    const app = boot();
    type(app, "#name", "px_stoic");
    setNumber(app, "same_opinion", "10");
    // The panel asks for the entries rather than carrying words of its own.
    expect(app.posted.some((m) => m.type === "loc" && m.keys.includes("TRAIT_OPINION_SAME_TRAIT"))).toBe(
      true
    );
    app.send({ type: "loc", values: OPINION_LOC_VALUES });
    const line = [...app.document.querySelectorAll("#tip .px-mod-line")].find((el) =>
      el.textContent?.includes("Opinion of")
    )!;
    expect(line.querySelector(".px-mod-label")!.textContent).toBe("Opinion of Px Stoic Characters");
    expect(line.querySelector(".px-mod-value")!.textContent).toBe("+10");
  });

  it("puts a modifier the game marks hidden under its own heading", () => {
    const app = boot();
    app.send({ type: "modifierFormats", formats: FORMATS });
    setSkill(app, "martial", "3");
    const add = [...app.document.querySelectorAll("#sections .px-btn")].find(
      (b) => b.textContent === "Add modifier"
    ) as HTMLButtonElement;
    add.click();
    (app.document.querySelector("#sections .modrow > .px-dropdown") as HTMLButtonElement).click();
    (
      [...app.document.querySelectorAll(".px-menu-item")].find(
        (item) => item.querySelector(".px-menu-hint")?.textContent === "ai_boldness"
      ) as HTMLElement
    ).click();

    const hidden = app.document.querySelector("#tip .tip-hidden")!;
    expect(hidden.textContent).toContain("Not shown to the player");
    expect(hidden.textContent).toContain("Ai Boldness");
    // The skill the player DOES read stays above the rule.
    expect(hidden.textContent).not.toContain("Martial");
  });

  it("puts a rule the game prints no tooltip line for under the same heading, with its doc", () => {
    const app = boot();
    app.send({
      type: "form",
      form: {
        ...FORM,
        current: {
          file: "D:/mod/common/traits/px_traits.txt",
          line: 0,
          source: "mod" as const,
          text: "px_undying = {\n\tcategory = fame\n\timmortal = yes\n}",
        },
      },
    });
    const hidden = app.document.querySelector("#tip .tip-hidden")!;
    expect(hidden.textContent).toContain("immortal = yes");
    // The note is _traits.info's own sentence about the key, by way of the harvest.
    expect(hidden.textContent).toContain("Will stop visual aging");
  });

  it("words a triggered_opinion with the modifier's own loc, and keeps the key when it is a datafunction", () => {
    // Both blocks kinslayer_1 writes in the game's own 00_traits.txt.
    const text =
      "px_kinslayer = {\n" +
      "\tcategory = fame\n" +
      "\ttriggered_opinion = {\n\t\topinion_modifier = kinslayer_intolerant\n\t}\n" +
      "\ttriggered_opinion = {\n\t\topinion_modifier = kinslayer_crime_dynasty\n\t\tsame_dynasty = yes\n\t}\n" +
      "}";
    const app = boot();
    app.send({
      type: "form",
      form: {
        ...FORM,
        current: { file: "D:/mod/common/traits/px_traits.txt", line: 0, source: "mod" as const, text },
      },
    });
    expect(app.posted.some((m) => m.type === "loc" && m.keys.includes("kinslayer_intolerant"))).toBe(true);
    app.send({
      type: "loc",
      values: {
        // secrets_l_english.yml: an entry the panel has no character to resolve
        // the datafunction against.
        kinslayer_intolerant: "Known [GetTrait('kinslayer_3').GetName( Getnullcharacter )]",
        // religion_l_english.yml: prose, so the player's word is shown.
        kinslayer_crime_dynasty: "Kinslayer",
      },
    });
    const facts = [...app.document.querySelectorAll("#tip .tip-fact")].map((el) => el.textContent ?? "");
    expect(facts.some((text) => text.startsWith("kinslayer_intolerant"))).toBe(true);
    expect(facts.some((text) => text.startsWith("Kinslayer") && text.includes("same_dynasty = yes"))).toBe(
      true
    );
    expect(app.document.querySelector("#tip")!.textContent).not.toContain("GetTrait");
  });

  it("shows an empty tile that names the missing picture when nothing resolved one", () => {
    const app = boot();
    type(app, "#name", "px_stoic");
    const tile = app.document.querySelector<HTMLElement>("#tip .tip-icon .noicon")!;
    expect(tile.textContent).toBe("");
    expect(tile.title).toContain("px_stoic");
    // The name follows the key until the modder types over it.
    expect(app.document.querySelector("#tip .px-game-tip-title")!.textContent).toBe("Px Stoic");
  });
});

describe("a new trait saves with a name and one stat", () => {
  it("posts the block the form shows, with the loc the name derives", () => {
    const app = boot();
    type(app, "#name", "px_stoic");
    pickEnum(app, "category", "personality");
    setSkill(app, "martial", "3");

    app.document.querySelector<HTMLButtonElement>("#save")!.click();
    const save = app.save()!;
    expect(save.mode).toBe("create");
    expect(save.name).toBe("px_stoic");
    expect(save.block).toBe("px_stoic = {\n\tcategory = personality\n\tmartial = 3\n}");
    // The script panel is the same text, so what a modder reads is what is written.
    expect(app.script()).toBe(save.block);
    expect(save.loc).toEqual([{ key: "trait_px_stoic", value: "Px Stoic" }]);
  });

  it("renaming moves the loc keys with the name", () => {
    const app = boot();
    type(app, "#name", "px_iron_willed");
    app.document.querySelector<HTMLButtonElement>("#save")!.click();
    expect(app.save()!.loc).toEqual([{ key: "trait_px_iron_willed", value: "Px Iron Willed" }]);
  });
});

describe("editing a trait the mod already has", () => {
  const CURRENT = {
    file: "D:/mod/common/traits/px_traits.txt",
    line: 3,
    source: "mod" as const,
    text: "px_stoic = {\n\tcategory = personality\n\tmartial = 2\n}",
  };

  it("sends only the key that moved, and the file it came from", () => {
    const app = boot();
    app.send({ type: "form", form: { ...FORM, current: CURRENT } });
    expect(app.document.getElementById("source")!.textContent).toBe("Mod");
    setSkill(app, "martial", "5");
    app.document.querySelector<HTMLButtonElement>("#save")!.click();

    const save = app.save()!;
    expect(save.mode).toBe("edit");
    expect(save.changed).toEqual([{ key: "martial", value: "5" }]);
    expect(save.sourceFile).toBe("px_traits.txt");
    // The whole block travels too, byte-identical apart from the one line.
    expect(save.block).toBe(CURRENT.text.replace("martial = 2", "martial = 5"));
  });

  it("a repeated block key opens as one script box per statement, and saves back", () => {
    const text =
      "px_stoic = {\n" +
      "\tcategory = personality\n" +
      "\ttriggered_opinion = {\n\t\topinion_modifier = a\n\t}\n" +
      "\ttriggered_opinion = {\n\t\topinion_modifier = b\n\t}\n" +
      "}";
    const app = boot();
    app.send({ type: "form", form: { ...FORM, current: { ...CURRENT, text } } });
    // Nothing is left as raw text a form cannot reach: both statements are
    // boxes, and saving with neither touched writes the file back as it was.
    const areas = control(app, "triggered_opinion").querySelectorAll("textarea");
    expect(areas.length).toBe(2);
    expect(areas[1].value).toContain("opinion_modifier = b");
    app.document.querySelector<HTMLButtonElement>("#save")!.click();
    expect(app.save()!.block).toBe(text);
  });

  it("a game trait opens as a duplicate under the mod's prefix", () => {
    const app = boot();
    app.send({
      type: "form",
      form: {
        ...FORM,
        current: { ...CURRENT, source: "vanilla" as const, text: "brave = {\n\tmartial = 2\n}" },
      },
    });
    expect(app.document.getElementById("source")!.textContent).toBe("Game");
    expect(app.document.getElementById("mode")!.hidden).toBe(false);
  });
});
