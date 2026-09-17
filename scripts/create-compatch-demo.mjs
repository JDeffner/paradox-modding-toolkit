// Local CK3 fixture, derived from the selected installation and Joel's supplied UGC announcements.
// Generated vanilla text stays outside this repository.
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const [gameArgument, outputArgument] = process.argv.slice(2);
if (!gameArgument || !outputArgument)
  throw new Error("Usage: node scripts/create-compatch-demo.mjs <CK3 game data folder> <new output folder>");
const game = await fs.realpath(gameArgument);
const requestedOutput = path.resolve(outputArgument);
const output = path.join(await fs.realpath(path.dirname(requestedOutput)), path.basename(requestedOutput));
const contains = (parent, child) => {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
};
const installation = path.basename(game).toLowerCase() === "game" ? path.dirname(game) : game;
if (contains(installation, output)) throw new Error("Keep fixtures outside the game installation.");
await fs.mkdir(output); // Never replace an existing example or its Git history.
const mod = path.join(output, "Mod");
const original = path.join(output, "Vanilla");
const next = path.join(output, "New Game Version");
for (const folder of [mod, original, next]) await fs.mkdir(folder);
const event = "events/legacy_events/dynasty_legacy_events.txt";
const hooks = ["traits_on_actions.txt", "court_type_on_actions.txt", "decision_on_actions.txt"];
const sourcePaths = [event, ...hooks.map((name) => `common/on_action/${name}`), "events/misc_events.txt"];
const provenance = [];
const write = async (root, file, text) => {
  const target = path.join(root, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const normalized = text.replace(/^\uFEFF/, "");
  await fs.writeFile(target, /\.(txt|yml)$/.test(file) ? "\uFEFF" + normalized : text, "utf8");
};
for (const relative of sourcePaths) {
  const source = await fs.realpath(path.join(game, relative));
  if (!contains(game, source)) throw new Error("A source link leaves the game directory.");
  const bytes = await fs.readFile(source);
  const text = bytes.toString("utf8");
  provenance.push({ relative, sha256: createHash("sha256").update(bytes).digest("hex") });
  for (const folder of [mod, original, next]) await write(folder, relative, text);
}
const oldEvent = await fs.readFile(path.join(original, event), "utf8");
if (!oldEvent.includes("add_diplomacy_skill = 1"))
  throw new Error("Installed event changed: review the sample before generating it.");
await write(mod, event, oldEvent.replace("add_diplomacy_skill = 1", "add_diplomacy_skill = 2"));
await write(
  next,
  event,
  oldEvent
    .replace(
      "hidden = yes",
      "hidden = yes\n\t# MOCK: priority value is illustrative; the announcement does not define ordering.\n\tid_override_priority = 10"
    )
    .replace(
      "add_diplomacy_skill = 1",
      "add_diplomacy_skill = 3 # MOCK balance change to exercise an overlapping edit"
    )
);

const additions = [
  "# MOCK Announcement 1: names announced; hook scopes and payloads are not assumed.\non_trait_gained = { }\non_trait_lost = { }\n",
  "# MOCK Announcement 3: hook name announced; payload not specified.\non_player_character_change = { }\n",
  "# MOCK Announcement 1: directly created characters, not births. No payload assumed.\non_character_created = { }\n",
];
for (let i = 0; i < hooks.length; i++) {
  const file = `common/on_action/${hooks[i]}`;
  await write(next, file, (await fs.readFile(path.join(original, file), "utf8")) + "\n" + additions[i]);
}
await write(
  mod,
  "events/graceful_learning.txt",
  "namespace = graceful_learning\n\ngraceful_learning.1 = {\n\thidden = yes\n\timmediate = { add_learning_skill = 1 }\n}\n"
);
await write(
  next,
  "common/on_action/announced_liberation_hook.txt",
  "# MOCK Announcement 1. New-game-only file: exclude from the compatch queue.\non_liberation_siege_completion = { }\n"
);
await write(
  mod,
  "descriptor.mod",
  'name="Graceful Learning: Compatch Practice"\nversion="0.1.0"\ntags={ "Gameplay" }\n'
);
await write(
  mod,
  ".px-toolkit/compatch.json",
  JSON.stringify({ version: 1, vanilla: "../Vanilla", newGame: "../New Game Version" }, null, 2) + "\n"
);
await write(mod, "ck3-tiger.conf", 'languages = { check = "english" }\n');
await write(
  mod,
  "README.md",
  "# Graceful Learning\n\nThis practice mod doubles the diplomacy reward in the vanilla Graceful Aging event from 1 to 2. The other four skill rewards remain 1. The mod-only hidden event `graceful_learning.1` adds one learning skill and demonstrates a file that compatching must preserve.\n\nThe three unchanged on_action copies are deliberate practice material. A real mod would normally avoid copying files it does not edit. They exercise automatic carry-over when upstream changes arrive.\n\nCompatch this original Git-tracked folder. Use Source Control to inspect the edits. The sibling New Game Version folder is a mock, not an installed or verified CK3 release.\n"
);
await fs.writeFile(
  path.join(output, "source-provenance.json"),
  JSON.stringify(
    {
      game,
      sources: provenance,
      mockSource:
        "User-supplied PDX UGC Modding Announcements 1 and 3; no release date or complete syntax contract supplied.",
    },
    null,
    2
  )
);
const workspace = path.join(output, "Compatch Practice.code-workspace");
await fs.writeFile(
  workspace,
  JSON.stringify(
    {
      folders: [
        { name: "Mod · Graceful Learning", path: "Mod" },
        { name: "Vanilla · previous version", path: "Vanilla" },
        { name: "New Game Version · MOCK", path: "New Game Version" },
      ],
      settings: {
        "px.gameId": "ck3",
        "px.gamePath": game,
        "px.modPath": mod,
        "px.excludedMods": [original, next],
        "px.tigerRunOn": "manual",
        "px.indexAssets": false,
        "git.openRepositoryInParentFolders": "never",
      },
    },
    null,
    2
  )
);
await fs.writeFile(
  path.join(output, "README.md"),
  `# Compatch practice\n\nOpen **Compatch Practice.code-workspace** in VS Code, then run **Paradox: Open Compatch Workspace**. The mod's .px-toolkit/compatch.json selects the three source folders automatically. All edits go to Mod, which has an initial Git commit. Vanilla and New Game Version are comparison sources.\n\n## Work through the update\n\n1. Expand **Files by path**. Three on_action files contain game-only changes. Preview their three-way merge, then use **Apply Clean Game Changes** from the row actions. They should disappear from the work list after applying.\n2. Select **${event}**. New Game Version is on the left; your original mod is editable on the right. Use the row actions to compare Vanilla with each side.\n3. Preview the event merge. The mod changes diplomacy from 1 to 2, while the mock update changes it to 3. This is an intentional conflict. Applying a clean merge must leave the mod untouched and show the conflicting proposal. Choose your reward manually in Mod; inspect the proposed priority property without treating its numeric value as verified engine advice.\n4. Open Source Control to review your mod changes. Nothing commits them automatically. The initial commit is the original mod.\n\nClick the Mod, Vanilla or New Game Version rows to search files in that folder. The unchanged misc_events.txt, the mod-only graceful_learning.txt, and the new-game-only announced_liberation_hook.txt must not appear as update tasks. They remain browsable.\n\n## What is simulated\n\nThe old files are a small subset copied from your installed CK3, not a complete historical installation. The mock adds the announced on_trait_gained, on_trait_lost, on_character_created and on_player_character_change names as empty hooks. It adds id_override_priority to the event with an illustrative value, and a synthetic reward change to create a conflict. These edits are demonstration inputs, not actual Paradox patches.\n\nThe announcements do not define the exact contracts for history overrides, effect_even_if_dead, independent doctrine/law files, death-reason scopes, the new list and trigger signatures, or priority ties. This example does not invent those contracts. Engine bug fixes and the accessory-index limit also cannot be reproduced by editing script files. The installed engine and Tiger cannot validate the mock as a future release.\n\nsource-provenance.json records the original file hashes. Neither generation nor compatching writes to the installed game.\n`
);
const git = (...args) => execFileSync("git", ["-C", mod, ...args], { encoding: "utf8", windowsHide: true });
git("init", "-b", "practice/original");
git("add", ".");
git("commit", "-m", "Create original Graceful Learning mod for compatch practice");
console.log(`Created ${workspace}\nOriginal mod Git commit: ${git("rev-parse", "--short", "HEAD").trim()}`);
