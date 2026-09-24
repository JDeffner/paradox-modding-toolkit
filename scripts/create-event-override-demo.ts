// Derive a local, future-engine exercise from CK3. Never distribute its vanilla text.
// Bundle with esbuild before running; arguments are the game data folder and a NEW output folder.
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { parseScript } from "@px-lsp/server/parser";
import { ck3Meta } from "@px-lsp/server/games/ck3/meta";
import { addFile, emptyInventory } from "../packages/vscode/src/compatch/core";
import { mergeEventUpdate, needsGameUpdate } from "../packages/vscode/src/compatch/gameUpdate";

async function main() {
  const [gameArgument, outputArgument] = process.argv.slice(2);
  if (!gameArgument || !outputArgument)
    throw new Error("Pass the CK3 game data folder and a new output folder.");
  const game = await fs.realpath(gameArgument);
  const requested = path.resolve(outputArgument);
  const output = path.join(await fs.realpath(path.dirname(requested)), path.basename(requested));
  const within = (root: string, file: string) => {
    const relative = path.relative(root, file);
    return !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`);
  };
  const installation = path.basename(game).toLowerCase() === "game" ? path.dirname(game) : game;
  assert.ok(!within(installation, output), "Keep the exercise outside the game installation");
  const source = await fs.realpath(path.join(game, "events/health_events.txt"));
  assert.ok(within(game, source), "No source link may leave the supplied game folder");
  const sourceBytes = await fs.readFile(source);
  const vanilla = sourceBytes.toString("utf8");
  const parsed = parseScript(vanilla);
  assert.equal(parsed.errors.length, 0);
  const events = parsed.root.statements.filter(
    (s) => s.kind === "assignment" && s.value?.kind === "block" && s.key.text.includes(".")
  );
  const eventText = (id: string) => {
    const statement = events.find((s) => s.kind === "assignment" && s.key.text === id);
    assert.ok(statement, id);
    return vanilla.slice(statement.range.start, statement.range.end);
  };
  const originalEvent = eventText("health.0001");
  const unrelatedEvent = eventText("health.0002");
  assert.ok(originalEvent.includes("chance = 40") && originalEvent.includes("max = 25"));
  assert.ok(unrelatedEvent.includes("chance = 20"));
  // Preserve the original body and local provenance. The priority convention is a test assumption.
  const modEvent = originalEvent
    .replace("hidden = yes", "hidden = yes\n\tid_override_priority = 10")
    .replace("chance = 40", "chance = 10");
  const modText =
    "\uFEFFnamespace = health\n\n# Gentler Wound Recovery: only health.0001 is overridden.\n" +
    modEvent +
    "\n";
  const newEvent = originalEvent.replace("max = 25", "max = 30");
  const newUnrelated = unrelatedEvent.replace("chance = 20", "chance = 15");
  const next = vanilla.replace(originalEvent, newEvent).replace(unrelatedEvent, newUnrelated);
  const modRelative = "events/gentler_wounds/health_0001.txt";
  const gameRelative = "events/health_events.txt";
  const inventory = emptyInventory();
  addFile(inventory, "base", gameRelative, vanilla, ck3Meta.compatch);
  addFile(inventory, "B", gameRelative, next, ck3Meta.compatch);
  addFile(inventory, "A", modRelative, modText, ck3Meta.compatch);
  const tasks = [...inventory.entries.values()].filter(needsGameUpdate);
  assert.deepEqual(
    tasks.map((entry) => entry.name),
    ["health.0001"],
    "Only the overridden event needs attention"
  );
  const merged = await mergeEventUpdate(vanilla, next, modText, "health.0001");
  assert.equal(merged.conflicts, false);
  assert.ok(merged.text.includes("chance = 10") && merged.text.includes("max = 30"));
  assert.ok(merged.text.includes("id_override_priority = 10"));
  assert.ok(!merged.text.includes("health.0002"));
  assert.equal(parseScript(merged.text).errors.length, 0);
  const conflict = await mergeEventUpdate(
    vanilla,
    next.replace("chance = 40", "chance = 20"),
    modText,
    "health.0001"
  );
  assert.equal(conflict.conflicts, true, "An overlapping scar-chance change needs the modder");
  // Small explicit oracle for the assumed future ID-override contract, not an engine emulator.
  const effective = new Map<string, string>();
  const updated = parseScript(next).root.statements;
  for (const statement of updated)
    if (
      statement.kind === "assignment" &&
      statement.value?.kind === "block" &&
      statement.key.text.includes(".")
    )
      effective.set(statement.key.text, next.slice(statement.range.start, statement.range.end));
  const mergedEvent = parseScript(merged.text).root.statements.find(
    (s) => s.kind === "assignment" && s.key.text === "health.0001"
  )!;
  effective.set("health.0001", merged.text.slice(mergedEvent.range.start, mergedEvent.range.end));
  assert.equal(effective.size, events.length);
  assert.equal(effective.get("health.0002"), newUnrelated);
  await fs.mkdir(output); // Never replace a previous exercise or its Git history.
  const write = async (relative: string, text: string | Uint8Array) => {
    const target = path.join(output, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(
      target,
      typeof text === "string" && relative.endsWith(".txt") ? "\uFEFF" + text.replace(/^\uFEFF/, "") : text
    );
  };
  await write(`Vanilla/${gameRelative}`, sourceBytes);
  await write(`New Game Version/${gameRelative}`, next);
  await write(`Mod/${modRelative}`, modText);
  await write(`Expected Result/${modRelative}`, merged.text);
  // A non-loaded reference shows the obsolete full-file approach, also usable for current-Tiger validation.
  const legacy =
    "namespace = health\n" +
    vanilla
      .replace(/^\uFEFF/, "")
      .replace(/namespace\s*=\s*health/, "")
      .replace(originalEvent, originalEvent.replace("chance = 40", "chance = 10"));
  await write(`Before Single Event Override/${gameRelative}`, legacy);
  const descriptor =
    'name="Gentler Wound Recovery: Single Event Override"\nversion="0.1.0"\ntags={ "Gameplay" }\n';
  await write("Mod/descriptor.mod", descriptor);
  await write("Before Single Event Override/descriptor.mod", descriptor);
  await write("Before Single Event Override/ck3-tiger.conf", 'languages = { check = "english" }\n');
  await write(
    "Mod/.px-toolkit/compatch.json",
    JSON.stringify({ version: 1, vanilla: "../Vanilla", newGame: "../New Game Version" }, null, 2)
  );
  await write(
    "Mod/README.md",
    "# Gentler Wound Recovery\n\nChanges the non-infected wound recovery scar chance in vanilla event health.0001 from 40% to 10%. All other behavior stays as written by the game. The infected-wound path is unchanged.\n\nThis exercise assumes the announced single-event override feature exists: a mod event with id_override_priority = 10 overrides the same vanilla ID at priority 0. Priority direction and default 0 are explicit exercise assumptions, not verified engine rules. The events/gentler_wounds folder is only an organizational subfolder. No special override-folder loader is assumed.\n\nOnly health.0001 is copied. All other health events are inherited from the game. The existing health on_action still calls the same ID.\n"
  );
  await write(
    "Event Override Practice.code-workspace",
    JSON.stringify(
      {
        folders: [
          { name: "Mod: Gentler Wound Recovery", path: "Mod" },
          { name: "Vanilla: installed source", path: "Vanilla" },
          { name: "New Game Version: simulated update", path: "New Game Version" },
        ],
        settings: {
          "px.gameId": "ck3",
          "px.gamePath": game,
          "px.modPath": path.join(output, "Mod"),
          "px.excludedMods": [path.join(output, "Vanilla"), path.join(output, "New Game Version")],
          "px.tigerRunOn": "manual",
          "px.indexAssets": false,
          "git.openRepositoryInParentFolders": "never",
        },
      },
      null,
      2
    )
  );
  const metrics = {
    source,
    sha256: createHash("sha256").update(sourceBytes).digest("hex"),
    vanillaEvents: events.length,
    copiedEventsBefore: events.length,
    copiedEventsAfter: 1,
    modRelative,
    gameRelative,
    vanillaBytes: sourceBytes.length,
    overrideBytes: Buffer.byteLength(modText),
    targetEvent: "health.0001",
    inheritedEvent: "health.0002",
    pendingTasks: tasks.map((entry) => entry.name),
    checks: [
      "Only health.0001 needs compatching",
      "Clean update preserves scar chance 10 and priority 10",
      "Scar XP max updates from 25 to 30",
      "Unrelated health.0002 inherits its new chance 15",
      "All other event IDs remain available",
      "Overlapping chance change produces a conflict",
      "Output parses without errors",
    ],
    assumption:
      "Higher id_override_priority wins; vanilla without it is 0. Test-only contract, not verified against a future engine.",
  };
  await write("fixture-results.json", JSON.stringify(metrics, null, 2));
  await write(
    "README.md",
    `# Single-event override practice\n\nThis is a local exercise built from your installed health_events.txt (${events.length} events). The Mod folder contains one real event in ${modRelative}, with the announced id_override_priority property. Before Single Event Override shows the old full-file replacement; Expected Result is a reference, not a loaded mod.\n\n## Assumed future feature\n\nFor this exercise, priority 10 beats vanilla priority 0 for the same event ID. We assume the feature exists, but this numeric convention is not established by the announcement. The subfolder is organizational, not an invented engine feature. The current installed game is not claimed to support this mod.\n\n## What changes\n\n- Mod: health.0001 changes scar chance 40 to 10 on the normal, non-infected recovery path.\n- Mock new game: health.0001 changes the maximum scar trait XP from 25 to 30. This should carry over while preserving the mod's chance and priority.\n- Mock new game: health.0002 changes its scar-flag chance from 20 to 15. The mod never overrides this event, so there is no work to do for it.\n\n## Try it\n\n1. Open Event Override Practice.code-workspace in Extension Testing. Only Project starts expanded. Open Compatch explicitly from Project or the command palette.\n2. Expand Events by ID and select health.0001. Matching is by event ID, even though the filenames differ. File-only comparison would miss this override.\n3. Compare Vanilla with Mod and with New Game Version. The fixed status-bar control identifies the sources while you scroll. Its tooltip contains the paths; clicking it opens Compatch actions.\n4. Preview the three-way merge, then apply the clean game change. Only the actual event body in Mod is updated. The mod keeps chance 10 and priority 10, and receives max 30.\n5. Inspect Source Control. Only ${modRelative} changes. Compare it with Expected Result if needed, then save and mark health.0001 reviewed. Vanilla and New Game Version must stay unchanged.\n\nThis mock patch is a test input, not a real Paradox balance announcement. fixture-results.json records provenance, size reduction, the assumed priority rule and the checks run by the generator. Current-Tiger validation uses the equivalent Before Single Event Override full-file mod because the current validator does not establish future priority behavior.\n`
  );
  const mod = path.join(output, "Mod");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", mod, ...args], { encoding: "utf8", windowsHide: true });
  git("init", "-b", "practice/single-event-override");
  git("add", ".");
  git("commit", "-m", "Create Gentler Wound Recovery using the assumed single-event override feature");
  console.log(
    JSON.stringify({ output, baseline: git("rev-parse", "--short", "HEAD").trim(), ...metrics }, null, 2)
  );
}
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
