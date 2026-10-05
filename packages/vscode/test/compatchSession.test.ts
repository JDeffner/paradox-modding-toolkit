import { afterEach, beforeEach, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ck3Meta } from "@px-lsp/server/games/ck3/meta";
import { addFile, emptyInventory, fingerprint, type Entry, type Session } from "../src/compatch/core";
import {
  applyRelocations,
  entryInputs,
  hasConflictMarkers,
  identifySession,
  mergeEligible,
  queueEntries,
  queueState,
  readSessionStore,
  recordReview,
  refreshFiles,
  replacementCandidates,
  replacementRulesForPath,
  isIntentionalReplacement,
  assertContentUpdateAllowed,
} from "../src/compatch/session";

let root: string;
let session: Session;
const event = (value: number) => `namespace = demo\ndemo.1 = { value = ${value} }\ndemo.2 = { value = 9 }\n`;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "px-compatch-session-"));
  for (const side of ["A", "B", "base"]) await fs.mkdir(path.join(root, side, "events"), { recursive: true });
  session = {
    version: 1,
    mode: "game-update",
    gameId: "ck3",
    localizationLanguage: "english",
    roots: { A: path.join(root, "A"), B: path.join(root, "B"), base: path.join(root, "base") },
    output: path.join(root, "A"),
    protectedRoots: [],
    reviews: {},
    results: {},
  };
});
afterEach(async () => {
  expect(path.dirname(root)).toBe(os.tmpdir());
  expect(path.basename(root)).toMatch(/^px-compatch-session-/);
  await fs.rm(root, { recursive: true, force: true });
});

async function fixture() {
  const inventory = emptyInventory();
  for (const side of ["A", "B", "base"] as const) {
    const text = event(side === "B" ? 2 : 1);
    await fs.writeFile(path.join(session.roots[side]!, "events/demo.txt"), text);
    addFile(inventory, side, "events/demo.txt", text, ck3Meta.compatch);
  }
  const file = inventory.entries.get(JSON.stringify(["file", "events/demo.txt"]))!;
  const definition = inventory.entries.get(JSON.stringify(["event", "demo.1"]))!;
  session.tracked = queueEntries(inventory, session).map((entry) => entry.id);
  return { inventory, file, definition };
}

it("refreshes only affected files and definitions, preserving unrelated inventory and sources", async () => {
  const { inventory, file, definition } = await fixture();
  addFile(inventory, "B", "unrelated.txt", "cached only", ck3Meta.compatch);
  const before = fingerprint(definition);
  await fs.writeFile(path.join(session.roots.B!, "events/demo.txt"), event(3));
  const changed = await refreshFiles(inventory, session, ck3Meta.compatch, entryInputs(file));
  expect(changed.has(definition.id)).toBe(true);
  expect(fingerprint(definition)).not.toBe(before);
  expect(inventory.files.B.get("unrelated.txt")).toBe("cached only");
  expect(inventory.entries.get(definition.id)!.sites.B[0].text).toContain("value = 3");
  expect(await fs.readFile(path.join(session.roots.A!, "events/demo.txt"), "utf8")).toBe(event(1));
});

it("retains completed rows when a file update makes the mod equal to the new game", async () => {
  const { inventory, file, definition } = await fixture();
  await fs.writeFile(path.join(session.roots.A!, "events/demo.txt"), event(2));
  await refreshFiles(inventory, session, ck3Meta.compatch, entryInputs(file));
  recordReview(session, inventory, file, "reviewed");
  expect(queueState(definition, session)).toBe("reviewed");
  expect(queueEntries(inventory, session).map((entry) => entry.id)).toContain(file.id);
  // The unchanged demo.2 was never part of the update queue.
  expect(session.reviews[JSON.stringify(["event", "demo.2"])]).toBeUndefined();
  delete session.reviews[file.id];
  expect(queueEntries(inventory, session).map((entry) => entry.id)).toContain(file.id);
  expect(queueState(file, session)).toBe("pending");
});

it("reopens reviewed work after changed or deleted input and marks missing files for manual review", async () => {
  const { inventory, file } = await fixture();
  recordReview(session, inventory, file, "reviewed");
  await fs.unlink(path.join(session.roots.B!, "events/demo.txt"));
  await refreshFiles(inventory, session, ck3Meta.compatch, entryInputs(file));
  expect(queueState(file, session)).toBe("manual");
  expect(mergeEligible(file)).toBe(false);
  expect(session.reviews[file.id].sites.B[0].text).toContain("value = 2");
});

it("invalidates a source that becomes non-UTF-8 without blocking other incremental updates", async () => {
  const { inventory, file } = await fixture();
  await fs.writeFile(path.join(session.roots.A!, "events/demo.txt"), event(8));
  await fs.writeFile(path.join(session.roots.B!, "events/demo.txt"), Buffer.from([255, 254]));
  await refreshFiles(inventory, session, ck3Meta.compatch, entryInputs(file));
  expect(file.sites.A[0].text).toBe(event(8));
  expect(file.sites.B).toEqual([]);
  expect(mergeEligible(file)).toBe(false);
  expect(inventory.issues.join(" ")).toContain("not UTF-8 text; skipped");
});

it("rechecks a previously missing file path and never assumes an upstream deletion", async () => {
  const { inventory, file } = await fixture();
  await fs.unlink(path.join(session.roots.B!, "events/demo.txt"));
  await refreshFiles(inventory, session, ck3Meta.compatch, entryInputs(file));
  await fs.writeFile(path.join(session.roots.B!, "events/demo.txt"), event(7));
  await refreshFiles(inventory, session, ck3Meta.compatch, entryInputs(file));
  expect(file.sites.B[0].text).toBe(event(7));
});

it("migrates one saved session and retains independent sessions and navigation", () => {
  const migrated = readSessionStore(session);
  expect(migrated.version).toBe(2);
  expect(migrated.active).toBe(session.id);
  session.navigation = {
    filter: "demo",
    state: "pending",
    lens: "definition",
    pages: { file: 0, event: 1, localization: 0 },
    selected: "demo.1",
  };
  const comparison = identifySession({
    ...session,
    id: undefined,
    mode: undefined,
    reviews: {},
    navigation: undefined,
  });
  const restored = readSessionStore(
    JSON.parse(JSON.stringify({ version: 2, active: comparison.id, sessions: [session, comparison] }))
  );
  expect(restored.sessions).toHaveLength(2);
  expect(restored.sessions[0].navigation?.filter).toBe("demo");
  expect(restored.sessions[1].navigation).toBeUndefined();
  expect(restored.sessions[0].id).not.toBe(restored.sessions[1].id);
});

it("offers relocation evidence from shared source IDs without selecting or moving a source", async () => {
  const inventory = emptyInventory();
  const text = "example_site = { value = 1 }\n";
  addFile(inventory, "base", "common/old/source.txt", text, ck3Meta.compatch);
  addFile(inventory, "A", "common/old/source.txt", text, ck3Meta.compatch);
  addFile(inventory, "B", "common/new/first.txt", "example_site = { value = 2 }", ck3Meta.compatch);
  addFile(inventory, "B", "common/new/second.txt", "example_site = { value = 3 }", ck3Meta.compatch);
  const file = inventory.entries.get(JSON.stringify(["file", "common/old/source.txt"]))!;
  expect(replacementCandidates(file, inventory)).toHaveLength(2);
  expect(file.sites.B).toEqual([]);
  session.relocations = { [file.id]: "common/new/second.txt" };
  applyRelocations(inventory, session);
  expect(file.sites.B[0].path).toBe("common/new/second.txt");
  expect(file.sites.A[0].path).toBe("common/old/source.txt");
  expect(file.sites.base[0].text).toBe(text);
});

it("rejects every diff3 marker, including a stray separator after partial resolution", () => {
  for (const marker of ["<<<<<<< Mod", "||||||| Old Game Version", "=======", ">>>>>>> New Game Version"])
    expect(hasConflictMarkers(`before\n${marker}\nafter`)).toBe(true);
  expect(hasConflictMarkers("value = 7\n# =============== comment\n")).toBe(false);
});

it("treats a known conflict and duplicate definitions as manual work until reviewed", async () => {
  const { inventory, file } = await fixture();
  session.manual = [file.id];
  expect(queueState(file, session)).toBe("manual");
  recordReview(session, inventory, file, "skipped");
  expect(queueState(file, session)).toBe("skipped");
  const duplicate: Entry = structuredClone(file);
  duplicate.sites.B.push(duplicate.sites.B[0]);
  expect(mergeEligible(duplicate)).toBe(false);
});

it("retains items discovered by incremental refresh after they are resolved", async () => {
  const { inventory, file, definition } = await fixture();
  await fs.writeFile(path.join(session.roots.B!, "events/demo.txt"), event(1));
  await refreshFiles(inventory, session, ck3Meta.compatch, entryInputs(file));
  session.tracked = [];
  expect(queueEntries(inventory, session)).toHaveLength(0);
  await fs.writeFile(path.join(session.roots.B!, "events/demo.txt"), event(6));
  await refreshFiles(inventory, session, ck3Meta.compatch, entryInputs(file));
  expect(session.tracked).toContain(file.id);
  expect(session.tracked).toContain(definition.id);
  await fs.writeFile(path.join(session.roots.A!, "events/demo.txt"), event(6));
  await refreshFiles(inventory, session, ck3Meta.compatch, entryInputs(file));
  recordReview(session, inventory, file, "reviewed");
  expect(queueState(file, session)).toBe("reviewed");
  expect(queueState(definition, session)).toBe("reviewed");
});

it("ignores directory and binary notifications and reports newly unsupported text files", async () => {
  const { inventory, file } = await fixture();
  await fs.mkdir(path.join(session.roots.B!, "created.txt"));
  await fs.writeFile(path.join(session.roots.B!, "image.dds"), Buffer.from([255, 0]));
  await refreshFiles(inventory, session, ck3Meta.compatch, [
    { side: "B", relative: "created.txt" },
    { side: "B", relative: "image.dds" },
  ]);
  expect(mergeEligible(file)).toBe(true);
  expect(inventory.files.B.has("image.dds")).toBe(false);
  expect(inventory.issues.join(" ")).toContain("not a regular file; skipped");
});

it.each(["ck3", "vic3", "eu5"])(
  "keeps replacement intent separate from review and validation for %s",
  async (gameId) => {
    const { inventory, file, definition } = await fixture();
    session.gameId = gameId;
    session.intentionalReplacements = [{ kind: "file", path: file.name }];
    session.validation = { at: "test", gamePath: session.roots.B!, summary: "existing findings" };
    recordReview(session, inventory, file, "reviewed");
    expect(queueState(file, session)).toBe("replacement");
    expect(queueState(definition, session)).toBe("replacement");
    expect(mergeEligible(file, session)).toBe(false);
    expect(mergeEligible(definition, session)).toBe(false);
    expect(session.reviews[file.id].status).toBe("reviewed");
    expect(session.validation.summary).toBe("existing findings");
    const restored = readSessionStore(JSON.parse(JSON.stringify(session))).sessions[0];
    expect(isIntentionalReplacement(file, restored)).toBe(true);
    await fs.writeFile(path.join(session.roots.B!, file.name), event(4));
    await refreshFiles(inventory, restored, ck3Meta.compatch, entryInputs(file));
    expect(queueState(file, restored)).toBe("replacement");
    restored.intentionalReplacements = [];
    expect(queueState(file, restored)).toBe("pending");
    expect(mergeEligible(file, restored)).toBe(true);
  }
);

it("applies folder rules only to descendant mod files, including empty and new files", async () => {
  const { inventory } = await fixture();
  session.intentionalReplacements = [{ kind: "folder", path: "common/bookmarks" }];
  addFile(inventory, "A", "common/bookmarks/nested/empty.txt", "# intentionally empty\n", ck3Meta.compatch);
  addFile(inventory, "A", "common/bookmarks/custom.txt", "bm_custom = {}", ck3Meta.compatch);
  addFile(inventory, "B", "common/bookmarks/new_vanilla.txt", "bm_vanilla = {}", ck3Meta.compatch);
  const rows = queueEntries(inventory, session).filter(
    (entry) => queueState(entry, session) === "replacement"
  );
  expect(rows.map((entry) => entry.name).sort()).toEqual([
    "common/bookmarks/custom.txt",
    "common/bookmarks/nested/empty.txt",
  ]);
  expect(replacementRulesForPath(session, "common/bookmarks_extra/file.txt")).toEqual([]);
  expect(replacementRulesForPath(session, "common/bookmarks")).toEqual([]);
  expect(() => assertContentUpdateAllowed(session, "common\\bookmarks\\custom.txt")).toThrow(
    "Intentional replacement"
  );
  expect(() => assertContentUpdateAllowed(session, "common/bookmarks_extra/custom.txt")).not.toThrow();
  session.mode = undefined;
  expect(replacementRulesForPath(session, "common/bookmarks/custom.txt")).toEqual([]);
});

it("does not remove mixed duplicate definitions from manual review when only one file is protected", async () => {
  const { inventory, definition } = await fixture();
  addFile(inventory, "A", "events/duplicate.txt", event(8), ck3Meta.compatch);
  session.intentionalReplacements = [{ kind: "file", path: "events/demo.txt" }];
  expect(queueState(definition, session)).toBe("manual");
  expect(mergeEligible(definition, session)).toBe(false);
});

it.each([
  "",
  "/absolute",
  "../outside",
  "common/../events",
  "C:/game",
  "common\\events",
  "common//events",
  "common/events/",
])("rejects malformed saved replacement path %j", (invalidPath) => {
  session.intentionalReplacements = [{ kind: "folder", path: invalidPath }];
  expect(() => readSessionStore(session)).toThrow("Invalid intentional replacement rule");
});
