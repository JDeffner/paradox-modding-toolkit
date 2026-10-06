import { afterEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

vi.mock("vscode", () => ({}));
vi.mock("../src/config", () => ({}));
vi.mock("../src/steam/workshopFiles", () => ({}));
import { buildHtml } from "../src/webviews/dashboard/view";

const windows: JSDOM[] = [];
afterEach(() => windows.splice(0).forEach((dom) => dom.window.close()));

function open() {
  const messages: unknown[] = [];
  const dom = new JSDOM(buildHtml("px.tools"), {
    runScripts: "dangerously",
    beforeParse(window) {
      Object.assign(window, {
        acquireVsCodeApi: () => ({
          postMessage: (message: unknown) => messages.push(message),
          getState: () => undefined,
          setState() {},
        }),
      });
    },
  });
  windows.push(dom);
  const mods = Array.from({ length: 12 }, (_, index) => ({
    root: `/mods/mod-${index + 1}`,
    name: `Mod ${index + 1}`,
    excluded: index === 5,
    missing: false,
  }));
  const state = {
    gameName: "Test game",
    gameAuto: true,
    focusLabel: "Follow: Mod 1",
    paths: [],
    mods,
    pinnedRoot: null as string | null,
    focusRoot: mods[0].root,
    hasTiger: true,
    tigerBaseline: false,
    watcherOn: false,
    watcherAvailable: true,
    diagnosticsVanilla: false,
    scopeInlayHints: false,
    completionMode: "minimal",
    hoverDetail: "standard",
    actions: [],
  };
  const update = () =>
    dom.window.dispatchEvent(new dom.window.MessageEvent("message", { data: { type: "state", state } }));
  update();
  return { document: dom.window.document, window: dom.window, messages, state, update };
}

describe("Workspace Mods list", () => {
  it("renders all twelve mods plus Follow and exposes a labelled keyboard scroll region", () => {
    const { document, state } = open();
    const list = document.getElementById("body-mods")!;
    expect(list.querySelectorAll(".mod-row")).toHaveLength(12);
    expect(list.children).toHaveLength(13);
    expect([...list.querySelectorAll(".mod-row .px-item-label")].map((label) => label.textContent)).toEqual(
      state.mods.map((mod) => mod.name)
    );
    expect(document.getElementById("mod-count")?.textContent).toBe("12");
    expect(list.getAttribute("role")).toBe("region");
    expect(list.getAttribute("aria-label")).toContain("Workspace mods (12)");
    expect(list.tabIndex).toBe(0);
    list.focus();
    expect(document.activeElement).toBe(list);
  });

  it("keeps scroll and keyboard focus when pin or index state changes", () => {
    const { document, window, state, messages, update } = open();
    const list = document.getElementById("body-mods")!;
    const last = state.mods.at(-1)!;
    list.scrollTop = 250;
    const pin = document.getElementById(`mod-pin-${last.root}`)!;
    pin.focus();
    pin.click();
    expect(messages.at(-1)).toEqual({ type: "focus", root: last.root });
    state.pinnedRoot = last.root;
    state.focusRoot = last.root;
    update();
    expect(list.scrollTop).toBe(250);
    expect(document.activeElement?.id).toBe(pin.id);
    expect(document.getElementById(pin.id)?.getAttribute("aria-checked")).toBe("true");

    const index = document.getElementById(`mod-index-${last.root}`) as HTMLInputElement;
    index.focus();
    index.checked = false;
    index.dispatchEvent(new window.Event("change"));
    expect(messages.at(-1)).toEqual({ type: "exclude", root: last.root, excluded: true });
    last.excluded = true;
    state.pinnedRoot = null;
    state.focusRoot = state.mods[0].root;
    update();
    expect(list.scrollTop).toBe(250);
    expect(document.activeElement?.id).toBe(index.id);
    expect((document.activeElement as HTMLInputElement).checked).toBe(false);
    expect(document.getElementById("mod-follow")?.getAttribute("aria-checked")).toBe("true");
    expect(list.querySelectorAll(".mod-row")).toHaveLength(12);
  });

  it("keeps the New and Add actions outside the scrolling list without toggling its group", () => {
    const { document, messages } = open();
    const section = document.getElementById("section-mods") as HTMLDetailsElement;
    for (const command of ["px.createMod", "px.addModToWorkspace"]) {
      const button = document.querySelector<HTMLButtonElement>(`[data-mod-command="${command}"]`)!;
      expect(button.closest("#body-mods")).toBeNull();
      button.click();
      expect(section.open).toBe(true);
      expect(messages.at(-1)).toEqual({ type: "run", command });
    }
  });
});
