import { expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import manifest from "../package.json";
import { ck3Meta } from "@px-lsp/server/games/ck3/meta";
import { visibleActionGroups } from "../src/webviews/dashboard/actions";
vi.mock("vscode", () => ({}));
vi.mock("../src/config", () => ({}));
vi.mock("../src/steam/workshopFiles", () => ({}));
import { buildHtml, DASHBOARD_SECTIONS, type DashboardSection } from "../src/webviews/dashboard/view";

it.each(Object.keys(DASHBOARD_SECTIONS) as DashboardSection[])(
  "renders %s independently and keeps its moved title",
  (id) => {
    const view = manifest.contributes.views.px.find((view) => view.id === id);
    expect(view?.contextualTitle).toBe(DASHBOARD_SECTIONS[id]);
    expect(view?.type).toBe("webview");
    const messages: unknown[] = [];
    const setState = vi.fn();
    const dom = new JSDOM(buildHtml(id), {
      runScripts: "dangerously",
      beforeParse(window) {
        Object.assign(window, {
          acquireVsCodeApi: () => ({
            postMessage: (message: unknown) => messages.push(message),
            getState: () => ({ groups: { "group-view": false } }),
            setState,
          }),
        });
      },
    });
    dom.window.dispatchEvent(
      new dom.window.MessageEvent("message", {
        data: {
          type: "state",
          state: {
            gameName: "Crusader Kings III",
            gameAuto: true,
            focusLabel: "Follow: Example",
            paths: [],
            mods: [],
            pinnedRoot: null,
            focusRoot: null,
            hasTiger: true,
            tigerBaseline: false,
            watcherOn: false,
            watcherAvailable: true,
            diagnosticsVanilla: false,
            scopeInlayHints: false,
            completionMode: "minimal",
            hoverDetail: "standard",
            actions: visibleActionGroups(ck3Meta, 0, []),
          },
        },
      })
    );
    const document = dom.window.document;
    expect(document.querySelector(".section-toggle")).toBeNull();
    expect(document.querySelector("#game") !== null).toBe(id === "px.tools");
    expect(document.querySelector("#body-mods") !== null).toBe(id === "px.tools");
    expect(document.querySelector("#inlay") !== null).toBe(id === "px.tools");
    if (id === "px.tools") {
      expect([...document.querySelectorAll("summary")].map((item) => item.textContent?.trim())).toEqual([
        "Workspace Mods",
        "View",
        "Create",
        "Publish",
        "Info",
        "Settings",
      ]);
      for (const command of ["px.createMod", "px.addModToWorkspace"]) {
        document.querySelector<HTMLButtonElement>(`[data-mod-command="${command}"]`)!.click();
        expect(messages).toContainEqual({ type: "run", command });
      }
      expect(document.querySelector("#body-mods")?.textContent).not.toContain("Find Existing Mod");
      const view = document.querySelector<HTMLDetailsElement>("#group-view")!;
      expect(view.open).toBe(false);
      view.open = true;
      view.dispatchEvent(new dom.window.Event("toggle"));
      expect(setState).toHaveBeenCalledWith(
        expect.objectContaining({
          groups: expect.objectContaining({ "group-view": true }),
        })
      );
      const inlay = document.querySelector<HTMLInputElement>("#inlay")!;
      expect(inlay.closest("details")?.id).toBe("group-settings");
      expect(inlay.checked).toBe(false);
      inlay.checked = true;
      inlay.dispatchEvent(new dom.window.Event("change"));
      expect(messages).toContainEqual({ type: "setting", key: "scopeInlayHints", value: true });
      expect(document.getElementById("completionMode-value")?.textContent).toBe("Minimal fields");
      expect(document.getElementById("hoverDetail-value")?.textContent).toBe("Standard");
      document.querySelector<HTMLButtonElement>('[data-setting="completionMode"]')!.click();
      expect(messages).toContainEqual({ type: "pickSetting", key: "completionMode" });
      document.querySelector<HTMLButtonElement>('[data-setting="hoverDetail"]')!.click();
      expect(messages).toContainEqual({ type: "pickSetting", key: "hoverDetail" });
      document.getElementById("all-settings")!.click();
      expect(messages).toContainEqual({ type: "openSettings" });
      expect(document.querySelector('[data-actions="View"]')?.textContent).toContain("Event Graph");
      const compatch = [...document.querySelectorAll('[data-actions="View"] .px-item')].find((item) =>
        item.textContent?.includes("Compatch Workspace")
      );
      expect(compatch).toBeTruthy();
      compatch!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      expect(messages).toContainEqual({ type: "run", command: "px.openCompatch" });
      expect(document.querySelector('[data-actions="Create"]')?.textContent).toContain("New Content");
      expect(document.querySelector('[data-actions="Publish"]')?.textContent).toContain("Steam Workshop");
    }
    if (id === "px.utils") {
      const row = [...document.querySelectorAll(".px-item")].find((item) =>
        item.textContent?.includes("Convert DDS")
      )!;
      expect(row).toBeTruthy();
      row.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      expect(messages).toContainEqual({ type: "run", command: "px.convertDdsToImage" });
      expect(document.body.textContent).not.toContain("Event Graph");
    }
    dom.window.close();
  }
);

it("exposes direct, labelled file actions alongside compatch", () => {
  const commands = new Map(manifest.contributes.commands.map((command) => [command.command, command.title]));
  for (const key of ["editor/context", "explorer/context"] as const) {
    for (const item of manifest.contributes.menus[key]) {
      expect(item).not.toHaveProperty("submenu");
      expect(commands.get(item.command)).toMatch(/^PX: /);
    }
  }
  expect(commands.has("px.openCompatch")).toBe(true);
  expect(commands.has("px.updateModForGame")).toBe(true);
  expect(manifest.contributes.views["px-review"].map((view) => view.id)).toContain("px.compatch");
  expect(Object.keys(DASHBOARD_SECTIONS)).toEqual(["px.tools", "px.utils", "px.test", "px.paths"]);
  expect(manifest.contributes.views.px.some((view) => view.id === "px.settings")).toBe(false);
});
