/**
 * The Trait Creator booted in jsdom from the REAL page markup (html.ts) and
 * the REAL app bundle, with the host stubbed by a message recorder and fed the
 * REAL trait form (fixtures/traitForm.json, captured from the server the way
 * definitionForm.test.ts builds it: the bundled harvest, schema and modifier
 * dump, with the same four-trait stub index).
 *
 * What it pins is the promise a form makes: a freshly opened creator is
 * saveable with only a name typed, and the block it then posts is the script
 * the fields say - built from 60 keys nobody wrote down here.
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
  modLabel: "cultivation",
  locLanguage: "english",
  prefix: "px",
  iconKeys: ["brave.dds", "craven.dds"],
};

interface Booted {
  window: Window & typeof globalThis;
  document: Document;
  posted: AppToHost[];
  send(message: unknown): void;
  save(): TraitSave | undefined;
  labels(): string[];
  preview(): string;
}

function boot(init: TraitCreatorInit = INIT): Booted {
  const posted: AppToHost[] = [];
  const dom = new JSDOM(panelHtml(), {
    runScripts: "dangerously",
    beforeParse(window) {
      (window as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
        postMessage: (msg: AppToHost) => posted.push(msg),
      });
    },
  });
  const window = dom.window as unknown as Window & typeof globalThis;
  const send = (message: unknown): void => {
    window.dispatchEvent(new window.MessageEvent("message", { data: message }));
  };
  send({ type: "init", init });
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
      [...window.document.querySelectorAll("#sections .px-label")].map((l) => l.textContent ?? ""),
    preview: () => window.document.getElementById("preview")?.textContent ?? "",
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
function fieldInput(app: Booted, key: string): HTMLInputElement {
  const label = [...app.document.querySelectorAll("#sections .px-label")].find((l) => l.textContent === key)!;
  return label.parentElement!.querySelector("input, textarea") as HTMLInputElement;
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
    // The whole harvest reaches the panel: 60 keys, minus the two the Look
    // section renders as loc pairs and the modifier row, plus those three.
    for (const key of FORM.keys) expect(labels).toContain(key.key);
    expect(labels).toContain("Name");
    expect(labels).toContain("Description");
    expect(labels).toContain("modifiers");
  });

  it("prefills the name from the mod prefix and says where it saves", () => {
    const app = boot();
    expect(app.document.querySelector<HTMLInputElement>("#name")!.value).toBe("px_trait");
    expect(app.document.getElementById("target")!.textContent).toContain("cultivation");
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

describe("a new trait saves with a name and one stat", () => {
  it("posts the block the form shows, with the loc the name derives", () => {
    const app = boot();
    type(app, "#name", "px_stoic");
    type(app, `#sections input`, "personality"); // the first field is `category`
    fieldInput(app, "martial").value = "3";
    fieldInput(app, "martial").dispatchEvent(new app.window.Event("change", { bubbles: true }));

    app.document.querySelector<HTMLButtonElement>("#save")!.click();
    const save = app.save()!;
    expect(save.mode).toBe("create");
    expect(save.name).toBe("px_stoic");
    expect(save.block).toBe("px_stoic = {\n\tcategory = personality\n\tmartial = 3\n}");
    // The preview is the same text, so what a modder reads is what is written.
    expect(app.preview()).toBe(save.block);
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
    fieldInput(app, "martial").value = "5";
    fieldInput(app, "martial").dispatchEvent(new app.window.Event("change", { bubbles: true }));
    app.document.querySelector<HTMLButtonElement>("#save")!.click();

    const save = app.save()!;
    expect(save.mode).toBe("edit");
    expect(save.changed).toEqual([{ key: "martial", value: "5" }]);
    expect(save.sourceFile).toBe("px_traits.txt");
    // The whole block travels too, byte-identical apart from the one line.
    expect(save.block).toBe(CURRENT.text.replace("martial = 2", "martial = 5"));
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
