/**
 * PdxGui language features: property/type completion from the bundled vanilla
 * gui harvest, using= template completion from the index, hover cards.
 */
import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { provideGuiCompletion, provideGuiHover } from "../src/features/guiLanguage";
import { ServerData } from "../src/serverData";
import { parseDataTypesDump } from "../src/data/dataTypes";

let uriCounter = 0;
const uri = () => `file:///mod/gui/fixture-${uriCounter++}.gui`;

function makeData(): ServerData {
  const data = new ServerData();
  data.index.addAll([
    {
      name: "MyModTemplate",
      kind: "gui_type",
      file: "F:/mod/gui/my_templates.gui",
      line: 3,
      source: "mod",
    },
    {
      name: "Background_Area_Dark",
      kind: "gui_type",
      file: "F:/game/gui/shared.gui",
      line: 10,
      source: "vanilla",
    },
  ]);
  return data;
}

function provideAt(data: ServerData, text: string, marker = "|") {
  const cursor = text.indexOf(marker);
  const clean = text.slice(0, cursor) + text.slice(cursor + marker.length);
  const doc = TextDocument.create(uri(), "paradox-gui", 1, clean);
  return provideGuiCompletion(data, doc, cursor);
}

describe("GUI completion", () => {
  it("completes a multiline binding member on its own line and leaves closed expressions alone", () => {
    const data = makeData();
    data.dataTypes = parseDataTypesDump("Character.GetName\nDefinition type: Function\nReturn type: CString");
    const { items } = provideAt(
      data,
      'widget = { text = "[ObjectsEqual(\n Character.G|,\n GetPlayer()\n)]" }'
    );
    const item = items.find((item) => item.label === "GetName");
    expect(item).toBeDefined();
    expect(item!.textEdit).toEqual({
      range: { start: { line: 1, character: 11 }, end: { line: 1, character: 12 } },
      newText: "GetName",
    });
    expect(
      provideAt(data, 'widget = { text = "[Character.GetName]\n Character.G|" }').items
    ).not.toContainEqual(expect.objectContaining({ label: "GetName" }));
  });
  it("inside a widget block: properties of that type lead, from the vanilla harvest", () => {
    const { items } = provideAt(makeData(), "widget = {\n\t|\n}");
    const labels = items.map((i) => i.label);
    expect(labels).toContain("size");
    expect(labels).toContain("name");
    expect(labels).toContain("visible");
    // Properties rank in tier 0, widget types behind them.
    const size = items.find((i) => i.label === "size")!;
    expect(size.sortText!.startsWith("0")).toBe(true);
    expect(size.detail).toContain("property of widget");
  });

  it("inside a flowcontainer: container-specific layout props appear", () => {
    const { items } = provideAt(makeData(), "flowcontainer = {\n\t|\n}");
    const labels = items.map((i) => i.label);
    expect(labels).toContain("direction");
    expect(labels).toContain("margin_left");
  });

  it("offers widget types as children and at top level", () => {
    const inside = provideAt(makeData(), "widget = {\n\t|\n}");
    const flow = inside.items.find((i) => i.label === "flowcontainer");
    expect(flow).toBeDefined();
    expect(flow!.detail).toMatch(/child widget|widget type/);

    const top = provideAt(makeData(), "|");
    const window = top.items.find((i) => i.label === "window");
    expect(window).toBeDefined();
    expect(window!.detail).toContain("widget type");
  });

  it("using = | completes templates, mod first", () => {
    const { items } = provideAt(makeData(), "widget = {\n\tusing = |\n}");
    const labels = items.map((i) => i.label);
    expect(labels).toContain("MyModTemplate");
    expect(labels).toContain("Background_Area_Dark");
    expect(labels.indexOf("MyModTemplate")).toBeLessThan(labels.indexOf("Background_Area_Dark"));
  });

  it("unknown value positions stay quiet (no soup)", () => {
    const { items } = provideAt(makeData(), "widget = {\n\ttexture = |\n}");
    expect(items).toHaveLength(0);
  });

  it("typed word filters server-side", () => {
    const { items, isIncomplete } = provideAt(makeData(), "widget = {\n\tvis|\n}");
    expect(isIncomplete).toBe(true);
    expect(items.map((i) => i.label)).toContain("visible");
    expect(items.map((i) => i.label)).not.toContain("size");
  });

  // `$` is the cursor here since the fixtures contain literal `|` combinators.
  it("enum property: fresh value after = offers the harvested set", () => {
    const { items } = provideAt(makeData(), "widget = {\n\tparentanchor = $\n}", "$");
    const labels = items.map((i) => i.label);
    expect(labels).toContain("top");
    expect(labels).toContain("hcenter");
    expect(labels).toContain("center");
    const top = items.find((i) => i.label === "top")!;
    expect(top.detail).toContain("parentanchor value");
    expect(top.detail).toContain("combine with |");
  });

  it("enum property: after a `|` completes the next segment and drops used flags", () => {
    const { items } = provideAt(makeData(), "widget = {\n\tparentanchor = top|hcenter|$\n}", "$");
    const labels = items.map((i) => i.label);
    // Already-used flags are excluded from the combination.
    expect(labels).not.toContain("top");
    expect(labels).not.toContain("hcenter");
    // Remaining flags are still offered.
    expect(labels).toContain("bottom");
    expect(labels).toContain("left");
  });

  it("enum property: mid-token after `|` filters by the partial segment", () => {
    const { items, isIncomplete } = provideAt(makeData(), "widget = {\n\tparentanchor = top|hc$\n}", "$");
    expect(isIncomplete).toBe(true);
    const labels = items.map((i) => i.label);
    expect(labels).toContain("hcenter");
    expect(labels).not.toContain("bottom");
    expect(labels).not.toContain("top");
  });

  it("non-enum value positions still stay quiet", () => {
    const { items } = provideAt(makeData(), "widget = {\n\ttooltip = $\n}", "$");
    expect(items).toHaveLength(0);
  });
});

describe("GUI hover", () => {
  it("shows a later-line datafunction member with a line-local hover range", () => {
    const data = makeData();
    data.dataTypes = parseDataTypesDump("Character.GetName\nDefinition type: Function\nReturn type: CString");
    const text = 'widget = { text = "[ObjectsEqual(\n Character.GetName,\n GetPlayer()\n)]" }';
    const document = TextDocument.create(uri(), "paradox-gui", 1, text);
    const hover = provideGuiHover(data, document, { line: 1, character: 14 });
    expect(hover?.range).toEqual({ start: { line: 1, character: 11 }, end: { line: 1, character: 18 } });
    expect((hover!.contents as { value: string }).value).toContain("Character.GetName");
    const outside = TextDocument.create(
      uri(),
      "paradox-gui",
      1,
      'text = "[Character.GetName]\n Character.GetName"'
    );
    expect(provideGuiHover(data, outside, { line: 1, character: 14 })).toBeNull();
  });
  it("widget type hover shows usage and common properties", () => {
    const text = 'flowcontainer = {\n\tname = "x"\n}';
    const doc = TextDocument.create(uri(), "paradox-gui", 1, text);
    const hover = provideGuiHover(makeData(), doc, { line: 0, character: 3 });
    expect(hover).not.toBeNull();
    const value = (hover!.contents as { value: string }).value;
    expect(value).toContain("flowcontainer");
    expect(value).toContain("in vanilla gui");
  });

  it("template hover links to its definition", () => {
    const text = "widget = {\n\tusing = MyModTemplate\n}";
    const doc = TextDocument.create(uri(), "paradox-gui", 1, text);
    const hover = provideGuiHover(makeData(), doc, { line: 1, character: 10 });
    expect(hover).not.toBeNull();
    const value = (hover!.contents as { value: string }).value;
    expect(value).toContain("MyModTemplate");
    expect(value).toContain("my_templates.gui:4");
  });

  it("property hover names the enclosing type", () => {
    const text = "widget = {\n\tparentanchor = bottom\n}";
    const doc = TextDocument.create(uri(), "paradox-gui", 1, text);
    const hover = provideGuiHover(makeData(), doc, { line: 1, character: 3 });
    expect(hover).not.toBeNull();
    const value = (hover!.contents as { value: string }).value;
    expect(value).toContain("parentanchor");
  });

  it("enum value hover shows the property, allowed set and combinability", () => {
    // `parentanchor = top|hcenter`, hover on the `hcenter` token.
    const text = "widget = {\n\tparentanchor = top|hcenter\n}";
    const doc = TextDocument.create(uri(), "paradox-gui", 1, text);
    const hover = provideGuiHover(makeData(), doc, { line: 1, character: 22 });
    expect(hover).not.toBeNull();
    const value = (hover!.contents as { value: string }).value;
    expect(value).toContain("gui enum value");
    expect(value).toContain("hcenter");
    expect(value).toContain("parentanchor");
    expect(value).toContain("bottom"); // full allowed set is listed
    expect(value).toContain("Combine flags with");
  });

  it("enum value hover: non-combinable property omits the combine hint", () => {
    const text = "widget = {\n\tautoresize = yes\n}";
    const doc = TextDocument.create(uri(), "paradox-gui", 1, text);
    const hover = provideGuiHover(makeData(), doc, { line: 1, character: 15 });
    expect(hover).not.toBeNull();
    const value = (hover!.contents as { value: string }).value;
    expect(value).toContain("gui enum value");
    expect(value).toContain("autoresize");
    expect(value).not.toContain("Combine flags with");
  });
});
