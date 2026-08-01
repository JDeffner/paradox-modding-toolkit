/**
 * The newer script_docs dump dialects (GameMeta.scriptDocs): markdown
 * effects/triggers/event_targets plus the two modifier shapes. Fixtures under
 * test/fixtures/logs-markdown-* are trimmed excerpts of real game dumps,
 * trailing markdown hard-breaks and dump bugs included.
 *
 * The dialect is chosen from the active profile, so the loader tests swap it in
 * and restore the default afterwards — the classic path must stay untouched.
 */
import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  loadTokenDataFromLogs,
  parseMarkdownLog,
  parseMaskedBlockModifiers,
  parseTagLineModifiers,
} from "../src/data/docsParser";
import { activeProfile, setActiveProfile } from "../src/games/active";
import { defaultProfile } from "../src/games/registry";
import type { GameProfile } from "../src/games/profile";

const MASKED_LOGS = path.join(__dirname, "fixtures", "logs-markdown-masked");
const TAGLINE_LOGS = path.join(__dirname, "fixtures", "logs-markdown-tagline");

const read = (dir: string, file: string) => fs.readFileSync(path.join(dir, file), "utf8");

/** The active profile with a dump dialect swapped in (no game ids involved). */
function withDialect(scriptDocs: GameProfile["scriptDocs"]): GameProfile {
  return { ...activeProfile(), scriptDocs };
}

afterEach(() => setActiveProfile(defaultProfile));

describe("parseMarkdownLog", () => {
  it("parses `## name` effects with docs, scopes and targets", () => {
    const tokens = parseMarkdownLog(read(MASKED_LOGS, "effects.log"), "effect");
    expect(tokens.map((t) => t.name)).toEqual([
      "abandon_revolution",
      "add_amendment",
      "add_banned_goods",
      "switch",
    ]);
    const abandon = tokens[0];
    expect(abandon.kind).toBe("effect");
    // Trailing markdown hard-break spaces are stripped, not kept in the doc.
    expect(abandon.doc).toBe("Removes interest group from revolution");
    expect(abandon.scopes).toEqual(["interest_group"]);
    expect(abandon.usage).toBe("abandon_revolution = yes/no");

    const banned = tokens[2];
    expect(banned.scopes).toEqual(["country"]);
    expect(banned.traits).toBe("Supported Targets: goods");
  });

  it("keeps a multi-line `name = { … }` example in usage, out of the prose", () => {
    const [, amendment] = parseMarkdownLog(read(MASKED_LOGS, "effects.log"), "effect");
    expect(amendment.doc).toBe("Adds an amendment to the scoped law.");
    expect(amendment.usage).toBe(
      "add_amendment = {\n\ttype = amendment_example\n\tsponsor = interest_group\n}"
    );
    expect(amendment.scopes).toEqual(["law"]);
  });

  it("recovers when a dumped example never closes its braces (the `switch` entry)", () => {
    const tokens = parseMarkdownLog(read(MASKED_LOGS, "effects.log"), "effect");
    const sw = tokens.find((t) => t.name === "switch")!;
    expect(sw.usage).toContain("fallback = { <effects> }");
    // The metadata line ends the example instead of being swallowed by it.
    expect(sw.usage).not.toContain("Supported Scopes");
    expect(sw.scopes).toEqual(["none"]);
  });

  it("parses triggers with Traits lines and merges the lowercase scope line", () => {
    const tokens = parseMarkdownLog(read(MASKED_LOGS, "triggers.log"), "trigger");
    const age = tokens.find((t) => t.name === "age")!;
    expect(age.kind).toBe("trigger");
    expect(age.usage).toBe("age > 20");
    expect(age.traits).toBe("Traits: <, <=, =, !=, >, >=");
    expect(age.doc).toBe("Compares the character age\nReads gamestate for all scopes.");
    expect(age.scopes).toEqual(["character"]);

    const always = tokens.find((t) => t.name === "always")!;
    expect(always.traits).toBe("Traits: yes/no");
    expect(always.doc).toContain("always = no  # always fails"); // only the first example is usage

    // Both the bold and the plain `Supported scopes:` line feed the same field.
    const combat = tokens.find((t) => t.name === "any_combat_unit")!;
    expect(combat.scopes).toEqual(["building", "front", "battle", "battle", "building", "front"]);
  });

  it("parses `### name` event targets with input/output scopes", () => {
    const tokens = parseMarkdownLog(read(MASKED_LOGS, "event_targets.log"), "event_target");
    const controller = tokens.find((t) => t.name === "controller")!;
    expect(controller.scopes).toEqual(["input: province", "input: state", "output: country"]);
    const mg = tokens.find((t) => t.name === "mg")!;
    expect(mg.traits).toBe("Requires Data: yes");
    expect(mg.scopes).toEqual(["input: market", "output: market_goods"]);
    // The trailing `-----` appendix (bare code-saved scope names) is not an entry.
    expect(tokens.map((t) => t.name)).toEqual(["controller", "mg", "root"]);
  });

  it("captures the EU5-shaped extras (Global Link) and leaves brace-y prose alone", () => {
    const targets = parseMarkdownLog(read(TAGLINE_LOGS, "event_targets.log"), "event_target");
    const advance = targets.find((t) => t.name === "advance_type")!;
    expect(advance.traits).toBe("Requires Data: yes\nGlobal Link: yes");
    expect(advance.scopes).toEqual(["output: advance_type"]);

    const effects = parseMarkdownLog(read(TAGLINE_LOGS, "effects.log"), "effect");
    const antagonism = effects.find((t) => t.name === "add_antagonism")!;
    expect(antagonism.usage).toBeUndefined(); // the braces sit inside a prose sentence
    expect(antagonism.doc).toContain("X is a scripted modifier name.");
  });
});

describe("modifier dialects", () => {
  it("parses masked blocks: name/description into doc, mask into traits", () => {
    const tokens = parseMaskedBlockModifiers(read(MASKED_LOGS, "modifiers.log"), "modifier");
    expect(tokens.map((t) => t.name)).toEqual([
      "battle_casualties_mult",
      "military_formation_organization_gain_add",
      "building_academics_shares_add",
      "building_academics_fertility_mult",
    ]);
    expect(tokens[0].doc).toBe(
      "Casualties Taken\nA bonus or penalty to the number of Casualties this side takes in Battle"
    );
    expect(tokens[0].traits).toBe("Mask: battle");
    // Unindented continuation lines belong to the description above them.
    expect(tokens[1].doc).toContain("A Formation with low Organization will be less effective");
    expect(tokens[1].doc).toContain("-75% Offense");
    // Section banners separate entries; a mask-only entry still parses.
    expect(tokens[3].doc).toBe("");
    expect(tokens[3].traits).toBe("Mask: building");
  });

  it("parses tag lines, dropping the padding in the category list", () => {
    const tokens = parseTagLineModifiers(read(TAGLINE_LOGS, "modifiers.log"), "modifier");
    expect(tokens.map((t) => t.name)).toEqual([
      "ai_require_cb_for_war",
      "army_logistics_distance",
      "monthly_imperial_authority",
      "bare_tag_without_categories",
    ]);
    expect(tokens[0].traits).toBe("Categories: Country, All");
    expect(tokens[2].traits).toBe("Categories: None, Location, Country, All");
    expect(tokens[3].traits).toBeUndefined();
    expect(tokens[0].scopes).toEqual([]);
  });
});

describe("loadTokenDataFromLogs dialect selection", () => {
  it("reads markdown + masked-block logs when the profile declares them", () => {
    setActiveProfile(withDialect({ format: "markdown", modifiers: "masked-block" }));
    const result = loadTokenDataFromLogs(MASKED_LOGS);
    expect(result.missing).toEqual([]);
    expect(result.templates).toEqual([]);
    const kinds = new Map<string, number>();
    for (const t of result.tokens) kinds.set(t.kind, (kinds.get(t.kind) ?? 0) + 1);
    expect(Object.fromEntries(kinds)).toEqual({ trigger: 3, effect: 4, event_target: 3, modifier: 4 });
  });

  it("reads markdown + tag-line logs when the profile declares them", () => {
    setActiveProfile(withDialect({ format: "markdown", modifiers: "tag-line" }));
    const result = loadTokenDataFromLogs(TAGLINE_LOGS);
    const kinds = new Map<string, number>();
    for (const t of result.tokens) kinds.set(t.kind, (kinds.get(t.kind) ?? 0) + 1);
    expect(Object.fromEntries(kinds)).toEqual({ trigger: 2, effect: 3, event_target: 3, modifier: 4 });
  });

  it("keeps using the classic parser for a profile that declares no dialect", () => {
    expect(activeProfile().scriptDocs).toBeUndefined();
    const classic = loadTokenDataFromLogs(path.join(__dirname, "fixtures", "logs"));
    expect(classic.tokens.some((t) => t.name === "add_gold")).toBe(true);
    expect(classic.templates.map((t) => t.name)).toContain("$CULTURE$_opinion");
    // The markdown dumps are unreadable to it, which is what the cache bump is for.
    setActiveProfile(withDialect(undefined));
    const mangled = loadTokenDataFromLogs(MASKED_LOGS);
    expect(mangled.tokens.length).toBeLessThan(4);
  });
});
