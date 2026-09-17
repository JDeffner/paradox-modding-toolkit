// Local fixture generator. Vanilla content stays in the supplied output directory.
import * as fs from "node:fs/promises";
import * as path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { parseScript } from "@px-lsp/server/parser";
import { ck3Meta } from "@px-lsp/server/games/ck3/meta";
import { addFile, emptyInventory } from "../packages/vscode/src/compatch/core";
import {
  mergeGameUpdate,
  needsGameUpdate,
  gameUpdateStatus,
} from "../packages/vscode/src/compatch/gameUpdate";

const [oldArg, nextArg, outputArg] = process.argv.slice(2);
assert.ok(oldArg && nextArg && outputArg, "Pass old game, new game and a NEW output directory");
const old = await fs.realpath(oldArg),
  next = await fs.realpath(nextArg);
const output = path.resolve(outputArg);
for (const root of [old, next]) {
  const relative = path.relative(path.dirname(root), output);
  assert.ok(relative.startsWith("..") || path.isAbsolute(relative), "Output must be outside both installs");
}
await fs.mkdir(output); // Exclusive creation protects previous exercises.
const write = async (relative: string, text: string) => {
  const file = path.join(output, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, "utf8");
};
const read = (root: string, relative: string) => fs.readFile(path.join(root, relative), "utf8");
const bom = (text: string) => "\uFEFF" + text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
const replaceOnce = (text: string, from: string, to: string) => {
  assert.equal(text.split(from).length, 2, `Expected one occurrence: ${from}`);
  return text.replace(from, to);
};
function editDefinition(text: string, id: string, edit: (body: string) => string) {
  const parsed = parseScript(text);
  assert.equal(parsed.errors.length, 0);
  const matches = parsed.root.statements.filter((s) => s.kind === "assignment" && s.key.text === id);
  assert.equal(matches.length, 1, id);
  const { start, end } = matches[0].range;
  return text.slice(0, start) + edit(text.slice(start, end)) + text.slice(end);
}
const eventPath = "events/activities/pilgrimage_activity/pilgrimage_events.txt";
const activityPath = "common/activities/activity_types/pilgrimage.txt";
const holyOld = "common/religion/holy_sites/00_holy_sites.txt";
const holyNew = "common/religion/holy_site_types/00_holy_site_types.txt";
const provenance: Record<string, unknown> = {};
const sources = new Map<string, string>();
for (const [role, root, files] of [
  ["Vanilla 1.18", old, [eventPath, activityPath, holyOld]],
  ["Vanilla 1.19", next, [eventPath, activityPath, holyNew]],
] as const) {
  for (const file of files) {
    const text = await read(root, file);
    sources.set(`${role}/${file}`, text);
    provenance[`${role}/${file}`] = {
      sha256: createHash("sha256").update(text).digest("hex"),
      bytes: Buffer.byteLength(text),
    };
    await write(`${role}/${file}`, text);
  }
}
const option = `
\t# Hospice patrons can answer an insult with practical charity.
\toption = {
\t\tname = ph_hospice_charity_option
\t\ttrigger = { has_character_modifier = ph_hospice_patron short_term_gold >= 25 }
\t\tremove_short_term_gold = 25
\t\tadd_piety = 75
\t\tadd_stress = -15
\t\tai_chance = { base = 0 }
\t}
`;
function eventMod(text: string, version: "1.18" | "1.19") {
  const changed = editDefinition(text, "pilgrimage.2005", (body) => {
    body = replaceOnce(
      body,
      `cooldown = { years = ${version === "1.18" ? 2 : 5} }`,
      "cooldown = { years = 4 }"
    );
    return body.slice(0, -1) + option + "}";
  });
  // Event replacements in 1.18 require the complete file at the original path.
  const namespaces = [...changed.matchAll(/^namespace\s*=\s*\w+.*$/gm)].map((m) => m[0]);
  assert.ok(namespaces.length);
  return bom(
    namespaces.join("\n") + "\n" + changed.replace(/^\uFEFF/, "").replace(/^namespace\s*=\s*\w+.*\r?\n/gm, "")
  );
}
const discount = `\t\t\t\t# Pilgrim Hospices: patron discount stacks with native pilgrimage discounts.
\t\t\t\tif = {
\t\t\t\t\tlimit = { has_character_modifier = ph_hospice_patron }
\t\t\t\t\tmultiply = { value = 0.75 desc = ph_hospice_discount }
\t\t\t\t}
`;
function activityMod(text: string) {
  return bom(
    replaceOnce(text, "\t\t\t\t#House Aspiration Humility", discount + "\t\t\t\t#House Aspiration Humility")
  );
}
function holyMod(text: string) {
  for (const id of ["rome", "cologne", "santiago", "kent", "jerusalem"]) {
    text = editDefinition(text, id, (body) =>
      id === "santiago"
        ? replaceOnce(body, "supply_duration = 0.2", "supply_duration = 0.3")
        : replaceOnce(body, "character_modifier = {", "character_modifier = {\n\t\tsupply_duration = 0.1")
    );
  }
  return bom(text);
}
const decision = bom(`ph_fund_hospices_decision = {
\tpicture = { reference = "gfx/interface/illustrations/decisions/decision_major_religion.dds" }
\tdesc = ph_fund_hospices_decision_desc
\tdecision_group_type = major
\tai_check_interval = 0
\tcooldown = { years = 10 }
\tis_shown = { is_ai = no is_landed = yes is_adult = yes }
\tis_valid = { is_at_war = no NOT = { has_character_modifier = ph_hospice_patron } }
\tcost = { gold = 100 }
\teffect = {
\t\tadd_character_modifier = { modifier = ph_hospice_patron years = 10 }
\t\tcustom_tooltip = ph_hospice_benefits_tt
\t}
\tai_will_do = { base = 0 }
}
`);
const loc = bom(`l_english:
 ph_fund_hospices_decision:0 "Fund Pilgrim Hospices"
 ph_fund_hospices_decision_desc:0 "A chain of hospices gives pilgrims food, shelter and a place to recover. I can fund their upkeep for ten years and travel under their protection."
 ph_fund_hospices_decision_tooltip:0 "Fund ten years of shelter for pilgrims."
 ph_fund_hospices_decision_confirm:0 "Endow the hospices"
 ph_hospice_patron:0 "Patron of Pilgrim Hospices"
 ph_hospice_patron_desc:0 "This ruler funds food and shelter along the pilgrim roads."
 ph_hospice_discount:0 "Hospice patronage"
 ph_hospice_benefits_tt:0 "For ten years, reduce the main pilgrimage activity gold cost by 25%. Travel options and route costs remain separate. During a dispute with a fellow pilgrim, you can pay 25 gold for 75 piety and lose 15 stress."
 ph_hospice_charity_option:0 "Let us share a meal at my hospice instead."
`);
for (const version of ["1.18", "1.19"] as const) {
  const role = `Vanilla ${version}`;
  const dir = version === "1.18" ? "Original 1.18" : "Reference 1.19";
  const files = new Map([
    [eventPath, eventMod(sources.get(`${role}/${eventPath}`)!, version)],
    [activityPath, activityMod(sources.get(`${role}/${activityPath}`)!)],
    [
      version === "1.18" ? holyOld : holyNew,
      holyMod(sources.get(`${role}/${version === "1.18" ? holyOld : holyNew}`)!),
    ],
    ["common/decisions/ph_hospices.txt", decision],
    [
      "common/modifiers/ph_hospices.txt",
      bom("ph_hospice_patron = {\n\ticon = learning_positive\n\tmonthly_piety = 0.2\n}\n"),
    ],
    ["localization/english/ph_hospices_l_english.yml", loc],
    [
      "descriptor.mod",
      `version="0.1.0"\nname="Pilgrim Hospices (${version})"\ntags={ "Gameplay" "Religion" }\nsupported_version="${version}.*"\n`,
    ],
  ]);
  for (const [file, text] of files) await write(`${dir}/${file}`, text);
}
await fs.cp(path.join(output, "Original 1.18"), path.join(output, "Practice"), {
  recursive: true,
  errorOnExist: true,
});
for (const dir of ["Practice", "Original 1.18", "Reference 1.19"]) {
  await write(`${dir}/.gitignore`, ".px-toolkit/\n.vscode/\n");
  const settings = {
    "px.gameId": "ck3",
    "px.gamePath": dir === "Original 1.18" ? old : next,
    "px.modPath": path.join(output, dir),
    "px.indexAssets": false,
    "px.tigerRunOn": "manual",
  };
  await write(`${dir}/.vscode/settings.json`, JSON.stringify(settings, null, 2));
}
await write(
  "Practice/.px-toolkit/compatch.json",
  JSON.stringify({ version: 1, vanilla: "../Vanilla 1.18", newGame: "../Vanilla 1.19" }, null, 2)
);
// An index baseline supports Git diffs without creating a commit on the user's behalf.
execFileSync("git", ["init", "-b", "practice/pilgrim-hospices", path.join(output, "Practice")], {
  windowsHide: true,
});
execFileSync("git", ["-C", path.join(output, "Practice"), "add", "."], { windowsHide: true });
const inventory = emptyInventory();
for (const [key, text] of sources) {
  const role = key.startsWith("Vanilla 1.18/") ? "base" : "B";
  addFile(inventory, role, key.slice("Vanilla 1.18/".length), text, ck3Meta.compatch);
}
for (const file of [eventPath, activityPath, holyOld])
  addFile(inventory, "A", file, await read(path.join(output, "Practice"), file), ck3Meta.compatch);
const tasks = [];
for (const entry of [...inventory.entries.values()].filter(needsGameUpdate)) {
  const merge =
    entry.kind === "file" && entry.sites.B.length === 1
      ? await mergeGameUpdate(entry.sites.base[0].text, entry.sites.B[0].text, entry.sites.A[0].text)
      : undefined;
  tasks.push({
    name: entry.name,
    kind: entry.kind,
    status: gameUpdateStatus(entry),
    conflicts: merge?.conflicts,
  });
}
assert.ok(tasks.some((t) => t.name === holyOld && t.status === "Missing at old path: review"));
assert.equal(tasks.find((t) => t.name === eventPath)?.conflicts, true);
assert.equal(tasks.find((t) => t.name === activityPath)?.conflicts, false);
await write("fixture-results.json", JSON.stringify({ old, next, provenance, tasks }, null, 2));
await write(
  "Pilgrim Hospices.code-workspace",
  JSON.stringify(
    {
      folders: [{ name: "Practice: edit this mod", path: "Practice" }],
      settings: { "window.title": "Pilgrim Hospices compatch${separator}${appName}" },
    },
    null,
    2
  )
);
console.log(JSON.stringify({ output, tasks }, null, 2));
