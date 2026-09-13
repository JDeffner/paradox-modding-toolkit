import { describe, expect, it } from "vitest";
import { mergeGameUpdate, needsGameUpdate } from "../src/compatch/gameUpdate";
import { addFile, emptyInventory } from "../src/compatch/core";
import { ck3Meta } from "@px-lsp/server/games/ck3/meta";

describe("game-update work list", () => {
  it("ignores source-unique and upstream-unchanged files but keeps mod overrides needing updates", () => {
    const inventory = emptyInventory();
    for (const [side, file, text] of [
      ["A", "mod-only.txt", "custom"],
      ["B", "new-only.txt", "new"],
      ["A", "unchanged.txt", "mod edit"],
      ["base", "unchanged.txt", "old"],
      ["B", "unchanged.txt", "old"],
      ["A", "changed.txt", "old"],
      ["base", "changed.txt", "old"],
      ["B", "changed.txt", "new"],
      ["A", "done.txt", "new"],
      ["base", "done.txt", "old"],
      ["B", "done.txt", "new"],
    ] as const)
      addFile(inventory, side, file, text, null);
    expect([...inventory.entries.values()].filter(needsGameUpdate).map((e) => e.name)).toEqual([
      "changed.txt",
    ]);
  });
  it("keeps cross-file semantic overrides even when the file paths are unique", () => {
    const inventory = emptyInventory();
    for (const [side, file, amount] of [
      ["base", "old.txt", 1],
      ["B", "new.txt", 2],
      ["A", "mod.txt", 3],
    ] as const)
      addFile(
        inventory,
        side,
        `events/${file}`,
        `namespace = demo\ndemo.1 = { immediate = { add_gold = ${amount} } }`,
        ck3Meta.compatch
      );
    expect([...inventory.entries.values()].filter(needsGameUpdate).map((e) => e.name)).toEqual(["demo.1"]);
  });
});

describe("three-way updates", () => {
  it("carries over unrelated changes and keeps mod edits, BOM and CRLF", async () => {
    const base = "title = old\n\na = 1\nb = 2\nc = 3\n\nreward = 1\n";
    const next = base.replace("title = old", "title = new");
    const mod = "\uFEFF" + base.replace("reward = 1", "reward = 9").replace(/\n/g, "\r\n");
    const merged = await mergeGameUpdate(base, next, mod);
    expect(merged.conflicts).toBe(false);
    expect(merged.text).toBe(mod.replace("title = old", "title = new"));
  });
  it("reports overlapping changes with all three roles", async () => {
    const merged = await mergeGameUpdate("a = 1\n", "a = 2\n", "a = 9\n");
    expect(merged.conflicts).toBe(true);
    for (const role of ["Mod", "Vanilla", "New Game Version"]) expect(merged.text).toContain(role);
  });
  it("handles unchanged mod, already updated mod and unchanged game", async () => {
    expect(await mergeGameUpdate("old", "new", "old")).toEqual({ text: "new", conflicts: false });
    expect(await mergeGameUpdate("old", "new", "new")).toEqual({ text: "new", conflicts: false });
    expect(await mergeGameUpdate("old", "old", "custom")).toEqual({ text: "custom", conflicts: false });
  });
});
