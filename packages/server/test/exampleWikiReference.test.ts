import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, expect, it } from "vitest";
import { ExampleWikiReference } from "../src/overview/exampleWikiReference";
import { activeProfile } from "../src/games/active";
import { buildExampleWikiIndex } from "../src/overview/exampleWiki";

let scratch: string | undefined;
afterEach(() => {
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});

it("reports missing game references without importing the active profile's knowledge", async () => {
  const base = path.resolve(".local/testing");
  fs.mkdirSync(base, { recursive: true });
  scratch = fs.mkdtempSync(path.join(base, "wiki-switch-reference-"));
  const profile = activeProfile();
  const reference = new ExampleWikiReference();
  const context = { gameId: "eu5", gamePath: null, logsPath: null };
  const snapshot = await reference.load(context, scratch, "");
  const index = buildExampleWikiIndex(snapshot.sources);
  expect(index.entries.some((entry) => entry.kind === "effect" || entry.kind === "datafn_global")).toBe(
    false
  );
  expect(snapshot.notes.join(" ")).toContain("No trigger, effect, target or modifier documentation");
  expect(snapshot.notes.join(" ")).toContain("No data-type documentation");
  expect(snapshot.sources.variables.size).toBe(0);
  expect(activeProfile()).toBe(profile);
  await expect(reference.load({ gameId: "eu5", gamePath: "relative/game" }, scratch, "")).rejects.toThrow(
    "absolute path"
  );
  const dumps = path.join(scratch, "eu5/script_docs");
  fs.mkdirSync(dumps, { recursive: true });
  fs.writeFileSync(path.join(dumps, "effects.log"), "## wiki_switch_new_effect\nFresh dump.\n");
  const refreshed = await reference.load(context, scratch, "", true);
  expect(refreshed.sources.tokens.some((token) => token.name === "wiki_switch_new_effect")).toBe(true);
  expect(activeProfile()).toBe(profile);
});

it("rereads same-size datafunction edits on an explicit refresh", async () => {
  const base = path.resolve(".local/testing");
  fs.mkdirSync(base, { recursive: true });
  scratch = fs.mkdtempSync(path.join(base, "wiki-switch-usage-"));
  const gamePath = path.join(scratch, "game");
  fs.mkdirSync(path.join(gamePath, "gui"), { recursive: true });
  const file = path.join(gamePath, "gui/reference.gui");
  fs.writeFileSync(file, 'widget = { text = "[GetAlpha]" }');
  const reference = new ExampleWikiReference();
  const context = { gameId: "eu5", gamePath };
  const storageDir = path.join(scratch, "storage");
  fs.mkdirSync(storageDir);
  const initial = await reference.load(context, scratch, storageDir);
  expect(initial.sources.usage.starts.has("GetAlpha")).toBe(true);
  fs.writeFileSync(file, 'widget = { text = "[GetBravo]" }');
  const refreshed = await reference.load(context, scratch, storageDir, true);
  expect(refreshed.sources.usage.starts.has("GetBravo")).toBe(true);
  expect(refreshed.sources.usage.starts.has("GetAlpha")).toBe(false);
});
