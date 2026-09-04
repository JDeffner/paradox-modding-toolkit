import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { loadTokenData, loadTokenDataFromLogs, parseLog } from "../src/data/docsParser";

const FIXTURE_LOGS = path.join(__dirname, "fixtures", "logs");

describe("parseLog", () => {
  it("parses effects.log entries with docs and scopes", () => {
    const tokens = parseLog(fs.readFileSync(path.join(FIXTURE_LOGS, "effects.log"), "utf8"), "effect");
    expect(tokens).toHaveLength(4);
    const addGold = tokens.find((t) => t.name === "add_gold");
    expect(addGold).toBeDefined();
    expect(addGold!.kind).toBe("effect");
    expect(addGold!.doc).not.toBe("");
    expect(addGold!.scopes).toEqual(["character"]);
  });

  it("keeps multi-line descriptions and records targets as traits", () => {
    const tokens = parseLog(fs.readFileSync(path.join(FIXTURE_LOGS, "effects.log"), "utf8"), "effect");
    const setRelation = tokens.find((t) => t.name === "set_relation")!;
    expect(setRelation.doc).toContain("scripted relations database");
    expect(setRelation.traits).toContain("Supported Targets: character");
  });

  it("parses event_targets input/output scopes", () => {
    const tokens = parseLog(
      fs.readFileSync(path.join(FIXTURE_LOGS, "event_targets.log"), "utf8"),
      "event_target"
    );
    const culture = tokens.find((t) => t.name === "culture")!;
    expect(culture.scopes).toContain("input: character");
    expect(culture.scopes).toContain("output: culture");
  });

  it("parses all modifiers.log styles (dashed, 1.19 blank-line) and skips preamble", () => {
    const tokens = parseLog(fs.readFileSync(path.join(FIXTURE_LOGS, "modifiers.log"), "utf8"), "modifier");
    expect(tokens.map((t) => t.name)).toEqual([
      "monthly_income",
      "diplomacy",
      "development_growth_factor",
      "$CULTURE$_opinion", // templated tags parse too; loaders partition them out
      "stationed_$MEN_AT_ARMS_TYPE$_damage_add",
      "dynasty_opinion", // 1.19 style: no separators, new "Tag:" begins an entry
    ]);
    expect(tokens[0].traits).toContain("Categories: character");
    // 1.19 metadata line is recorded on templated and concrete entries alike.
    expect(tokens[3].traits).toContain("Use areas: character");
    expect(tokens[5].traits).toContain("Use areas: character");
  });

  it("partitions templated tags into templates, never into concrete tokens", () => {
    const result = loadTokenDataFromLogs(FIXTURE_LOGS);
    expect(result.tokens.every((t) => !t.name.includes("$"))).toBe(true);
    expect(result.templates.map((t) => t.name).sort()).toEqual([
      "$CULTURE$_opinion",
      "stationed_$MEN_AT_ARMS_TYPE$_damage_add",
    ]);
    expect(result.templates[0].traits).toContain("Use areas: character");
  });

  it("does not crash on unknown lines; they land in doc", () => {
    const tokens = parseLog("----\nweird_token - desc\nSome ODD metadata nobody expects\n", "trigger");
    expect(tokens).toHaveLength(1);
    expect(tokens[0].doc).toContain("ODD metadata");
  });

  it("captures an inline `name = { … }` example as usage, keeping the description clean", () => {
    const log =
      "----\n" +
      "add_hook - Adds a hook on a character\n" +
      "add_hook = { type = X, target = Y }\n" +
      "Does send a toast to the player.\n" +
      "Supported Scopes: character\n" +
      "----\n";
    const [t] = parseLog(log, "effect");
    expect(t.usage).toBe("add_hook = { type = X, target = Y }");
    expect(t.doc).toContain("Adds a hook on a character");
    expect(t.doc).toContain("Does send a toast");
    expect(t.doc).not.toContain("type = X"); // syntax lives in usage, not the prose
    expect(t.scopes).toEqual(["character"]);
  });

  it("follows a header-less example until its braces balance", () => {
    // Verbatim out of the shipped CK3 effects.log (1.19), mixed tabs and
    // spaces included: the entry has no `usage:` header, so the block used to
    // be cut after its first line and the rest read as prose.
    const log =
      "----\n" +
      "create_holy_order - Create a new holy order\n" +
      "create_holy_order = {\n" +
      "    leader = scope:a_character\n" +
      "    capital = scope:a_barony_title\n" +
      "\t  name = <name> #Optional\n" +
      "\t  coat_of_arms = <coa_name> #Optional\n" +
      "    save_scope_as/save_temporary_scope_as = new_holy_order # optional way to get a reference to the new holy order\n" +
      "}\n" +
      "Supported Scopes: none\n" +
      "----\n";
    const [t] = parseLog(log, "effect");
    expect(t.usage).toBe(
      "create_holy_order = {\n" +
        "    leader = scope:a_character\n" +
        "    capital = scope:a_barony_title\n" +
        "\t  name = <name> #Optional\n" +
        "\t  coat_of_arms = <coa_name> #Optional\n" +
        "    save_scope_as/save_temporary_scope_as = new_holy_order # optional way to get a reference to the new holy order\n" +
        "}"
    );
    expect(t.doc).toBe("Create a new holy order");
    expect(t.scopes).toEqual(["none"]);
  });

  it("a metadata line ends an example that never closes its block", () => {
    const log =
      "----\n" +
      "switch - Switch on a value\n" +
      "switch = {\n" +
      "\ttrigger = simple_assign_trigger\n" +
      "\tcase_1 = { <effects> }\n" +
      "Supported Scopes: none\n" +
      "some more prose\n" +
      "----\n";
    const [t] = parseLog(log, "effect");
    expect(t.usage).toBe("switch = {\n\ttrigger = simple_assign_trigger\n\tcase_1 = { <effects> }");
    expect(t.scopes).toEqual(["none"]);
    // The capture is over, so what follows the metadata line is prose again.
    expect(t.doc).toBe("Switch on a value\nsome more prose");
  });

  it("captures a multi-line `usage:` block verbatim, dropping the header", () => {
    const log =
      "----\n" +
      "start_scheme - Starts a new scheme of the given type.\n" +
      "usage:\n" +
      "<scheme starting character> =\n" +
      "\tstart_scheme = {\n" +
      "\t\ttype = X\n" +
      "\t}\n" +
      "Supported Scopes: character\n" +
      "----\n";
    const [t] = parseLog(log, "effect");
    expect(t.doc).toBe("Starts a new scheme of the given type.");
    expect(t.usage).toContain("<scheme starting character> =");
    expect(t.usage).toContain("\t\ttype = X"); // indentation preserved
    expect(t.usage).not.toContain("usage:"); // the header itself is dropped
    expect(t.scopes).toEqual(["character"]);
  });

  it("catches a comparison-form inline example (`monthly_income > 10`)", () => {
    const log = "----\nmonthly_income - Check income\nmonthly_income > 10\nTraits: <, <=, =\n----\n";
    const [t] = parseLog(log, "trigger");
    expect(t.usage).toBe("monthly_income > 10");
    expect(t.doc).toBe("Check income");
  });
});

describe("loadTokenData caching", () => {
  it("uses the cache when mtimes are unchanged and re-parses on force", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ck3-docs-"));
    const cacheFile = path.join(tmp, "cache", "docsCache.json");

    const first = loadTokenData(FIXTURE_LOGS, cacheFile);
    expect(first.fromCache).toBe(false);
    expect(first.tokens.length).toBeGreaterThan(0);
    expect(first.templates.length).toBeGreaterThan(0);

    const second = loadTokenData(FIXTURE_LOGS, cacheFile);
    expect(second.fromCache).toBe(true);
    expect(second.tokens.length).toBe(first.tokens.length);
    expect(second.templates.map((t) => t.name)).toEqual(first.templates.map((t) => t.name));

    const forced = loadTokenData(FIXTURE_LOGS, cacheFile, true);
    expect(forced.fromCache).toBe(false);

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("reports missing log files without failing", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ck3-empty-"));
    const result = loadTokenDataFromLogs(tmp);
    expect(result.tokens).toEqual([]);
    expect(result.missing).toHaveLength(4);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
