/**
 * The Dynasty Tree app booted in jsdom from the REAL page markup (html.ts) and
 * the REAL app bundle, with the host stubbed by a message recorder.
 *
 * What it pins is that the page and the app agree: the ids html.ts writes are
 * the ids main.ts reaches for, the picker turns a click into the request the
 * host expects, a tree draws one card per character with orthogonal lines
 * between them, and the card's own actions open the form the modder wanted.
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
      dna: "3_smokelet",
      skills: { martial: 7, learning: 2 },
    },
  ],
  nextCharacterId: "4",
};

/**
 * A total conversion's calendar: script year 8000 is year 1 of "AC", earlier
 * years count backwards as "BC", and the year is six moons long. What the panel
 * writes is still the engine's `Y.M.D`.
 */
const CALENDAR = {
  epoch: 8000,
  after: "AC",
  before: "BC",
  months: [
    { name: "First Moon", days: 30 },
    { name: "Second Moon", days: 30 },
    { name: "Third Moon", days: 31 },
    { name: "Fourth Moon", days: 30 },
    { name: "Fifth Moon", days: 31 },
    { name: "Sixth Moon", days: 30 },
  ],
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
      // jsdom has no layout, so the menu's keyboard scrolling needs a stand-in.
      window.Element.prototype.scrollIntoView = () => undefined;
      // ... and no IntersectionObserver, which is how the trait picker decides
      // a row is worth a picture. Observing nothing leaves the first screen,
      // which the app asks for outright.
      (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      };
    },
  });
  const window = dom.window as unknown as Window & typeof globalThis;
  return {
    window,
    posted,
    send: (data) => window.dispatchEvent(new window.MessageEvent("message", { data })),
  };
}

/** The card of one character, by the id the renderer stamps on it. */
function card(app: Booted, id: string): Element {
  const found = app.window.document.querySelector(`#scene .card[data-id="${id}"]`);
  if (!found) throw new Error(`no card for ${id}`);
  return found;
}

function click(app: Booted, element: Element): void {
  element.dispatchEvent(new app.window.MouseEvent("click", { bubbles: true }));
}

function sideButton(app: Booted, label: string): HTMLButtonElement {
  const side = app.window.document.getElementById("sideBody")!;
  const found = [...side.querySelectorAll("button")].find((b) => b.textContent?.includes(label));
  if (!found) throw new Error(`no ${label} button`);
  return found;
}

describe("the Dynasty Tree app", () => {
  it("lists dynasties and turns a click into an open request", () => {
    const app = boot();
    // Nothing is drawn until the host answers, so the app asks as it boots.
    expect(app.posted).toEqual([{ type: "ready" }]);
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

  it("draws a card per character and one orthogonal line per relationship", () => {
    const app = boot();
    app.send({ type: "tree", tree: TREE, ms: 4 });
    const doc = app.window.document;
    expect(doc.querySelectorAll("#scene .card")).toHaveLength(3);
    expect(doc.querySelectorAll("#scene .card[data-external]")).toHaveLength(1);
    expect(doc.querySelectorAll('#scene .card[data-source="mod"]')).toHaveLength(2);
    // The marriage is one bar, and the couple's child hangs on one line from it.
    expect(doc.querySelectorAll('#scene .edge[data-kind="spouse"]')).toHaveLength(1);
    const child = doc.querySelectorAll('#scene .edge[data-kind="parent"]');
    expect(child).toHaveLength(1);
    const points = child[0]
      .getAttribute("points")!
      .split(" ")
      .map((p) => p.split(",").map(Number));
    for (const [i, point] of points.entries()) {
      if (i === 0) continue;
      expect(point[0] === points[i - 1][0] || point[1] === points[i - 1][1]).toBe(true);
    }
    // The card carries the name, the years and the house as a text badge.
    expect(card(app, "1").textContent).toContain("Smoky");
    expect(card(app, "1").textContent).toContain("1000–");
    expect(card(app, "1").querySelector(".ctagtext")!.textContent).toBe("Smoke");

    // The inspector shows the dynasty until a character is picked.
    const side = doc.getElementById("sideBody")!;
    expect(side.textContent).toContain("Houses (1)");
    click(app, card(app, "1"));
    expect(side.textContent).toContain("Smoky");
    expect(doc.querySelector("#scene .card[data-selected]")).not.toBeNull();
  });

  it("offers add child, add spouse and edit on a card, but no edit on a vanilla one", () => {
    const app = boot();
    app.send({ type: "tree", tree: TREE, ms: 4 });
    expect([...card(app, "1").querySelectorAll(".cact")].map((a) => a.getAttribute("data-act"))).toEqual([
      "child",
      "spouse",
      "edit",
    ]);
    expect([...card(app, "2").querySelectorAll(".cact")].map((a) => a.getAttribute("data-act"))).toEqual([
      "child",
      "spouse",
    ]);
    click(app, card(app, "1").querySelector('.cact[data-act="spouse"]')!);
    const side = app.window.document.getElementById("sideBody")!;
    expect(side.textContent).toContain("New character 4");
    expect(side.textContent).toContain("Smoky (1)");
  });

  it("prefills a new child from the couple, and only suggests the birth date", () => {
    const app = boot();
    app.send({ type: "tree", tree: TREE, ms: 4 });
    click(app, card(app, "1").querySelector('.cact[data-act="child"]')!);
    const side = app.window.document.getElementById("sideBody")!;
    expect(side.textContent).toContain("New character 4");
    // A guessed birth date is an offer, not a value: it must not be saved
    // because nobody looked at the field. Without a calendar the year reads as
    // the script year it is.
    const born = side.querySelector("input.year") as HTMLInputElement;
    expect(born.placeholder).toBe("1020");
    expect(born.value).toBe("");

    sideButton(app, "Create").click();
    expect(app.posted.some((m) => m.type === "saveCharacter")).toBe(false);
    const name = side.querySelector("input.px-input") as HTMLInputElement;
    name.value = "Newborn";
    name.dispatchEvent(new app.window.Event("input"));
    sideButton(app, "Create").click();
    const sent = app.posted.find((m) => m.type === "saveCharacter") as
      | { form: { name: string; father?: string; mother?: string; house?: string; birth?: string } }
      | undefined;
    expect(sent?.form).toMatchObject({
      name: "Newborn",
      father: "1",
      mother: "2",
      house: "house_smoke",
    });
    expect(sent?.form.birth).toBeUndefined();
  });

  it("reads and writes a date through the mod's own calendar", () => {
    const app = boot();
    app.send({ type: "init", gameName: "Crusader Kings III", mods: [], calendar: CALENDAR });
    app.send({ type: "tree", tree: TREE, ms: 4 });
    const side = app.window.document.getElementById("sideBody")!;
    click(app, card(app, "1"));
    // Script 1000.1.1 is 7000 years before the epoch, so it READS as 7000 BC.
    expect(side.textContent).toContain("7000 BC");

    click(app, card(app, "1").querySelector('.cact[data-act="edit"]')!);
    const parts = side.querySelector(".dparts")!;
    expect((parts.querySelector("input.year") as HTMLInputElement).value).toBe("7000");
    expect(parts.querySelector("button.era .val")!.textContent).toBe("BC");

    // The months are the calendar's own, and the day list is that month's length.
    const open = (selector: string): string[] => {
      (parts.querySelector(selector) as HTMLButtonElement).click();
      const items = [...app.window.document.querySelectorAll(".px-menu-item .px-grow")];
      return items.map((row) => row.textContent ?? "");
    };
    const pick = (label: string): void => {
      const item = [...app.window.document.querySelectorAll(".px-menu-item")].find(
        (row) => row.querySelector(".px-grow")?.textContent === label
      );
      if (!item) throw new Error(`no ${label} to pick`);
      (item as HTMLElement).click();
    };
    expect(open("button.month")).toEqual(CALENDAR.months.map((m) => m.name));
    pick("Third Moon");
    expect(open("button.day")).toHaveLength(31);
    pick("31");

    sideButton(app, "Save").click();
    const sent = app.posted.find((m) => m.type === "saveCharacter") as {
      form: { birth?: string };
      file?: string;
    };
    // 7000 BC in that calendar is script year 1000: the file never sees a
    // display year.
    expect(sent.form.birth).toBe("1000.3.31");
    expect(sent.file).toBe("c.txt");
    // Editing an existing character re-asks where a save would land, so the
    // top bar names the file that character is already in.
    expect(app.posted).toContainEqual({ type: "target", file: "c.txt" });
  });

  it("carries the dna and the skills it read back to the host", () => {
    const app = boot();
    app.send({ type: "tree", tree: TREE, ms: 4 });
    const side = app.window.document.getElementById("sideBody")!;
    click(app, card(app, "3"));
    expect(side.textContent).toContain("3_smokelet");
    expect(side.textContent).toContain("martial 7");

    click(app, card(app, "3").querySelector('.cact[data-act="edit"]')!);
    const prowess = [...side.querySelectorAll(".skills .px-field")].find(
      (f) => f.querySelector(".px-label")?.textContent === "prowess"
    )!;
    const input = prowess.querySelector("input.px-input") as HTMLInputElement;
    input.value = "9";
    input.dispatchEvent(new app.window.Event("change"));
    sideButton(app, "Save").click();
    const sent = app.posted.find((m) => m.type === "saveCharacter") as {
      form: { dna?: string; skills?: Record<string, number> };
    };
    // The two skills the block already set are untouched by typing a third.
    expect(sent.form).toMatchObject({ dna: "3_smokelet", skills: { martial: 7, learning: 2, prowess: 9 } });
  });

  it("offers a trait by the name the player reads, with its key beside it", () => {
    const app = boot();
    app.send({ type: "tree", tree: TREE, ms: 4 });
    app.send({
      type: "options",
      sets: {
        culture: [],
        religion: [],
        trait: [
          { value: "brave", label: "Brave", hint: "vanilla" },
          { value: "craven", label: "Craven", hint: "vanilla" },
        ],
      },
    });
    click(app, card(app, "3").querySelector('.cact[data-act="edit"]')!);
    const side = app.window.document.getElementById("sideBody")!;
    const traits = [...side.querySelectorAll(".px-field")].find(
      (f) => f.querySelector(".px-label")?.textContent === "Traits"
    )!;
    (
      [...traits.querySelectorAll("button")].find((b) => b.textContent?.includes("Add")) as HTMLElement
    ).click();

    const rows = (): Element[] => [...app.window.document.querySelectorAll(".tpicker .px-menu-item")];
    expect(rows().map((r) => r.querySelector(".tname")?.textContent)).toEqual(["Brave", "Craven"]);
    expect(rows().map((r) => r.querySelector(".tid")?.textContent)).toEqual(["brave", "craven"]);
    // Every row has its picture tile from the start, hidden until the host
    // answers with a URL for it; a trait with no file resolved stays hidden.
    expect(rows().map((r) => (r.querySelector("img[data-trait]") as HTMLImageElement).hidden)).toEqual([
      true,
      true,
    ]);
    app.send({ type: "traitIcons", urls: { brave: "brave.png", craven: null } });
    const thumb = (row: Element): HTMLImageElement => row.querySelector("img[data-trait]")!;
    expect(thumb(rows()[0]).hidden).toBe(false);
    expect(thumb(rows()[0]).getAttribute("src")).toBe("brave.png");
    expect(thumb(rows()[1]).hidden).toBe(true);

    // A row also says what the trait DOES, printed by the game's own rules,
    // and marks the traits a workspace mod defines.
    app.send({
      type: "traitStats",
      rows: {
        brave: {
          modifiers: [{ name: "prowess", value: 3 }],
          formats: { prowess: { label: "Prowess", decimals: 0, color: "good" } },
          images: {},
          mod: true,
        },
        craven: null,
      },
    });
    expect(rows()[0].querySelector(".tstats")!.textContent).toBe("+3Prowess");
    expect(rows()[0].querySelector(".tmod")).not.toBeNull();
    expect(rows()[1].querySelector(".tstats")!.textContent).toBe("");
    expect(rows()[1].querySelector(".tmod")).toBeNull();

    // The search matches the player's word and the key alike.
    const search = app.window.document.querySelector(".tpicker input.px-input") as HTMLInputElement;
    const shown = (): (string | undefined)[] => rows().map((r) => r.querySelector(".tname")?.textContent);
    search.value = "brav";
    search.dispatchEvent(new app.window.Event("input"));
    expect(shown()).toEqual(["Brave"]);
    // A key nothing in the words matches still finds its trait.
    search.value = "craven";
    search.dispatchEvent(new app.window.Event("input"));
    expect(shown()).toEqual(["Craven"]);

    (rows()[0] as HTMLElement).click();
    expect(traits.textContent).toContain("Craven");
    sideButton(app, "Save").click();
    const sent = app.posted.find((m) => m.type === "saveCharacter") as { form: { traits: string[] } };
    // The chip reads "Craven"; the file gets the key.
    expect(sent.form.traits).toEqual(["craven"]);
  });

  it("offers only men born before the child in the father picker", () => {
    const app = boot();
    app.send({ type: "tree", tree: TREE, ms: 4 });
    click(app, card(app, "3").querySelector('.cact[data-act="edit"]')!);
    const side = app.window.document.getElementById("sideBody")!;
    const father = [...side.querySelectorAll(".px-field")].find((f) =>
      f.querySelector(".px-label")?.textContent?.includes("Father")
    )!;
    (father.querySelector("button.pick") as HTMLButtonElement).click();
    const offered = [...app.window.document.querySelectorAll(".px-menu-item .px-grow")].map(
      (row) => row.textContent
    );
    // Not the mother (wrong sex) and not the child itself.
    expect(offered).toEqual(["none", "Smoky (1)"]);
  });
});
