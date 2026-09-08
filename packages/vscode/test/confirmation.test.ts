import { afterEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { closePopover, confirmDialog, menu } from "../src/webviews/shared/overlay";

let dom: JSDOM;
afterEach(() => {
  closePopover();
  vi.clearAllTimers();
  vi.useRealTimers();
  dom.window.close();
  vi.unstubAllGlobals();
});

describe("menu keyboard focus", () => {
  it.each([false, true])("announces active options and scopes keys to the menu (search=%s)", (search) => {
    vi.useFakeTimers();
    dom = new JSDOM('<button id="launch">Choose</button><input id="outside">');
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("window", dom.window);
    dom.window.HTMLElement.prototype.scrollIntoView = () => undefined;
    const anchor = document.getElementById("launch")!;
    const picked = vi.fn();
    menu(
      anchor,
      [
        { value: "a", label: "Alpha" },
        { value: "b", label: "Beta" },
      ],
      { search, onPick: picked }
    );
    vi.runAllTimers();
    const focus = document.activeElement!;
    expect(focus.getAttribute("role")).toBe(search ? "combobox" : "listbox");
    focus.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    const active = document.getElementById(focus.getAttribute("aria-activedescendant")!)!;
    expect(active.textContent).toBe("Beta");
    const outside = document.getElementById("outside")!;
    outside.focus();
    outside.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(picked).not.toHaveBeenCalled();
    (focus as HTMLElement).focus();
    focus.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(picked).toHaveBeenCalledWith("b");
    expect(document.activeElement).toBe(anchor);
  });
});

function open() {
  dom = new JSDOM('<button id="launch">Upload</button>');
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  const launch = document.getElementById("launch")!;
  launch.focus();
  const result = confirmDialog({ title: "Upload mod?", confirmLabel: "Upload", destructive: true });
  const region = document.querySelector<HTMLElement>(".px-confirmation")!;
  const [cancel, confirm] = region.querySelectorAll("button");
  return { result, region, cancel, confirm, launch };
}

describe("action confirmation", () => {
  it("Enter on Cancel cannot authorize an upload", async () => {
    const { result, cancel, launch } = open();
    expect(document.activeElement).toBe(cancel);
    const pageKey = vi.fn();
    dom.window.addEventListener("keydown", pageKey);
    cancel.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(pageKey).not.toHaveBeenCalled();
    // jsdom does not synthesize a native button click for a keyboard event.
    cancel.click();
    expect(await result).toBe(false);
    expect(document.activeElement).toBe(launch);
  });

  it("keeps the page usable and requires the confirmation button", async () => {
    const { result, region, confirm, launch } = open();
    expect(region.getAttribute("role")).toBe("region");
    expect(document.querySelector(".px-dialog-backdrop")).toBeNull();
    launch.focus();
    confirm.click();
    expect(await result).toBe(true);
    expect(document.activeElement).toBe(launch);
  });

  it("Escape inside the toast cancels", async () => {
    const { result, cancel } = open();
    cancel.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(await result).toBe(false);
  });

  it("changing the underlying page dismisses stale consent", async () => {
    const { result, launch, region } = open();
    launch.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true }));
    expect(await result).toBe(false);
    expect(region.isConnected).toBe(false);
  });

  it("a new confirmation cancels the previous request", async () => {
    const { result } = open();
    const next = confirmDialog({ title: "Delete?" });
    expect(await result).toBe(false);
    expect(document.querySelectorAll(".px-confirmation")).toHaveLength(1);
    document.querySelector<HTMLButtonElement>(".px-confirmation button")!.click();
    expect(await next).toBe(false);
  });
});
