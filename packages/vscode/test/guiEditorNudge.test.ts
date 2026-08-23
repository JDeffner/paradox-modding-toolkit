/**
 * The pure halves of the keyboard: what an arrow key means (app/nudge.ts), how
 * a held key becomes ONE op, and where Tab, Enter and Shift+Enter land
 * (app/keys.ts). The shell's wiring of both is driven in guiEditorSmoke.test.ts.
 */
import { describe, expect, it } from "vitest";
import type { GuiLayoutNode } from "@px-lsp/protocol/protocol";
import { NudgeBurst, nudgeStep, nudgeVector } from "../src/webviews/guiEditor/app/nudge";
import { firstChildOf, firstRoot, isTypingTarget, siblingFrom } from "../src/webviews/guiEditor/app/keys";
import { buildScene } from "../src/webviews/guiEditor/app/scene";

describe("what an arrow key asks for", () => {
  const plain = { shiftKey: false, altKey: false };
  it("one pixel, ten with Shift, a grid step with Alt", () => {
    expect(nudgeStep(plain, 8)).toBe(1);
    expect(nudgeStep({ shiftKey: true, altKey: false }, 8)).toBe(10);
    expect(nudgeStep({ shiftKey: false, altKey: true }, 8)).toBe(8);
    expect(nudgeStep({ shiftKey: true, altKey: true }, 8)).toBe(8);
  });

  it("maps the four arrows and nothing else", () => {
    expect(nudgeVector("ArrowLeft", plain, 8)).toEqual([-1, 0]);
    expect(nudgeVector("ArrowRight", plain, 8)).toEqual([1, 0]);
    expect(nudgeVector("ArrowUp", plain, 8)).toEqual([0, -1]);
    expect(nudgeVector("ArrowDown", { shiftKey: true, altKey: false }, 8)).toEqual([0, 10]);
    expect(nudgeVector("a", plain, 8)).toBeNull();
  });
});

/** A hand-cranked timer, so the burst's trailing window is stepped rather than waited for. */
function fakeClock() {
  const timers = new Map<number, { at: number; run: () => void }>();
  let now = 0;
  let next = 1;
  return {
    setTimer: (run: () => void, ms: number) => {
      const handle = next++;
      timers.set(handle, { at: now + ms, run });
      return handle;
    },
    clearTimer: (handle: unknown) => {
      timers.delete(handle as number);
    },
    advance(ms: number) {
      now += ms;
      for (const [handle, timer] of [...timers]) {
        if (timer.at > now) continue;
        timers.delete(handle);
        timer.run();
      }
    },
  };
}

describe("a held key is one op", () => {
  it("folds every key inside the window into one commit, after the last one", () => {
    const clock = fakeClock();
    const commits: [number, number][] = [];
    const previews: [number, number][] = [];
    const burst = new NudgeBurst({
      busy: () => false,
      commit: (dx, dy) => commits.push([dx, dy]),
      onChange: (dx, dy) => previews.push([dx, dy]),
      ms: 250,
      ...clock,
    });
    burst.add(1, 0);
    clock.advance(200);
    burst.add(1, 0);
    clock.advance(200);
    burst.add(0, 10);
    // Every key pushed the deadline out: nothing has been committed.
    expect(commits).toEqual([]);
    expect(previews).toEqual([
      [1, 0],
      [2, 0],
      [2, 10],
    ]);
    clock.advance(250);
    expect(commits).toEqual([[2, 10]]);
    expect(burst.pending).toBe(false);
  });

  it("waits while a commit is in flight, and keeps accumulating", () => {
    const clock = fakeClock();
    const commits: [number, number][] = [];
    let busy = true;
    const burst = new NudgeBurst({
      busy: () => busy,
      commit: (dx, dy) => commits.push([dx, dy]),
      onChange: () => undefined,
      ms: 250,
      ...clock,
    });
    burst.add(1, 0);
    clock.advance(250);
    expect(commits).toEqual([]);
    burst.add(1, 0);
    clock.advance(250);
    expect(commits).toEqual([]);
    busy = false;
    clock.advance(250);
    expect(commits).toEqual([[2, 0]]);
  });

  it("a cancel drops what was accumulated", () => {
    const clock = fakeClock();
    const commits: [number, number][] = [];
    const burst = new NudgeBurst({
      busy: () => false,
      commit: (dx, dy) => commits.push([dx, dy]),
      onChange: () => undefined,
      ms: 250,
      ...clock,
    });
    burst.add(0, -1);
    burst.cancel();
    clock.advance(300);
    expect(commits).toEqual([]);
    expect(burst.pending).toBe(false);
  });
});

describe("where the navigation keys land", () => {
  const node = (name: string, children: GuiLayoutNode[] = []): GuiLayoutNode => ({
    key: "widget",
    name,
    rect: { x: 0, y: 0, w: 10, h: 10 },
    clip: false,
    positioned: true,
    editable: true,
    children,
  });
  const scene = buildScene([node("a", [node("a1"), node("a2")]), node("b"), node("c")]);
  const at = (name: string) => scene.items.findIndex((i) => i.name === name);

  it("Tab walks the siblings and wraps", () => {
    expect(siblingFrom(scene, at("a"), 1, null)).toBe(at("b"));
    expect(siblingFrom(scene, at("c"), 1, null)).toBe(at("a"));
    expect(siblingFrom(scene, at("a"), -1, null)).toBe(at("c"));
    expect(siblingFrom(scene, at("a1"), 1, null)).toBe(at("a2"));
  });

  it("skips what the canvas skips", () => {
    const skip = new Uint8Array(scene.items.length);
    skip[at("b")] = 1;
    expect(siblingFrom(scene, at("a"), 1, skip)).toBe(at("c"));
  });

  it("Enter descends to the first child, and a leaf has nowhere to go", () => {
    expect(firstChildOf(scene, at("a"), null)).toBe(at("a1"));
    expect(firstChildOf(scene, at("b"), null)).toBeNull();
    expect(firstRoot(scene, null)).toBe(at("a"));
  });

  it("a key typed into a field is the field's", () => {
    expect(isTypingTarget({ tagName: "INPUT" } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: "DIV" } as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
