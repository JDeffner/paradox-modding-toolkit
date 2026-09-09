import { afterEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { snippetCatalogueHtml } from "../src/snippetCatalogueHtml";
import type { SnippetCatalogueResult } from "@px-lsp/protocol/protocol";

const result: SnippetCatalogueResult = {
  gameId: "test",
  gameName: "Test game",
  generatedAt: "2026-09-09",
  indexing: false,
  entries: [
    {
      id: "engine:test",
      label: "set_variable",
      category: "Engine",
      detail: "effect",
      variants: [
        {
          label: "Minimal",
          snippet: "set_variable = {\n name = $1\n}",
          plain: "set_variable = {\n name = \n}",
          preview:
            "**Insertion preview**\n\n```paradox\nset_variable = {\n name = <name>\n}\n```\n\n**Expected values**\n\n| Field | From documentation |\n| --- | --- |\n| name | Variable name |",
        },
        {
          label: "Examples",
          snippet: "set_variable = { name = ${1:X} }",
          plain: "set_variable = { name = X }",
          preview: "```paradox\nset_variable = { name = X }\n```",
        },
      ],
    },
    {
      id: "definition:test",
      label: "new test",
      category: "Definitions",
      detail: "measured",
      variants: [
        {
          label: "Template",
          snippet: "test = $1",
          plain: "test = ",
          preview: "```paradox\ntest = <value>\n```",
        },
      ],
    },
  ],
};
const doms: JSDOM[] = [];
afterEach(() => doms.splice(0).forEach((dom) => dom.window.close()));
function boot(data = result) {
  const dom = new JSDOM(snippetCatalogueHtml(data), { runScripts: "dangerously" });
  doms.push(dom);
  return dom;
}

describe("printable snippet catalogue", () => {
  it("filters the complete list, shows hints and switches to raw snippet syntax", () => {
    const dom = boot(),
      doc = dom.window.document;
    const search = doc.querySelector<HTMLInputElement>("#search")!;
    search.value = "variable";
    search.dispatchEvent(new dom.window.Event("input"));
    expect(doc.querySelector("#count")!.textContent).toContain("1 of 2");
    const item = doc.querySelector("details")!;
    item.open = true;
    item.dispatchEvent(new dom.window.Event("toggle"));
    expect(item.querySelector("table")!.textContent).toContain("Variable name");
    const stops = doc.querySelector<HTMLInputElement>("#stops")!;
    stops.checked = true;
    stops.dispatchEvent(new dom.window.Event("change"));
    expect(item.querySelector("pre")!.textContent).toContain("$1");
    const mode = doc.querySelector<HTMLSelectElement>("#mode")!;
    mode.value = "Examples";
    mode.dispatchEvent(new dom.window.Event("change"));
    expect(item.querySelector("pre")!.textContent).toContain("${1:X}");
    mode.value = "All variants";
    mode.dispatchEvent(new dom.window.Event("change"));
    expect(item.querySelectorAll("pre")).toHaveLength(2);
  });

  it("expands every matching entry for printing and restores the open state", () => {
    const dom = boot(),
      doc = dom.window.document;
    const print = vi.fn();
    dom.window.print = print;
    doc.querySelector<HTMLButtonElement>("#print")!.click();
    expect(print).toHaveBeenCalledOnce();
    dom.window.dispatchEvent(new dom.window.Event("beforeprint"));
    expect(doc.querySelectorAll("details[open]")).toHaveLength(2);
    expect(doc.querySelectorAll("pre")).toHaveLength(2);
    dom.window.dispatchEvent(new dom.window.Event("afterprint"));
    expect(doc.querySelectorAll("details[open]")).toHaveLength(0);
  });

  it("copies insertion text and keeps game documentation inert", async () => {
    const malicious = structuredClone(result);
    malicious.entries[0].label = '</script><img src=x onerror="window.injected=true">';
    malicious.entries[0].variants[0].preview += '\n| attack | <img src=x onerror="window.injected=true"> |';
    const dom = boot(malicious),
      doc = dom.window.document;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(dom.window.navigator, "clipboard", { value: { writeText } });
    const item = doc.querySelector("details")!;
    item.open = true;
    item.dispatchEvent(new dom.window.Event("toggle"));
    item.querySelector<HTMLButtonElement>("button")!.click();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith(result.entries[0].variants[0].plain);
    expect(doc.querySelector("img")).toBeNull();
    expect(doc.querySelectorAll("script")).toHaveLength(2);
  });
});
