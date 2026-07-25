import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  cleanCell,
  loadWikiTokens,
  mergeWikiTokens,
  parseWikiEffects,
  parseWikiEventTargets,
  parseWikiTriggers,
} from "../src/data/wikiDocs";
import type { TokenData } from "@px-lsp/protocol/types";

// Tests run against the real bundled files so they verify what actually ships.
const WIKIDOCS = path.join(__dirname, "..", "data", "ck3", "wikidocs");

describe("cleanCell", () => {
  it("strips code tags, decodes entities and keeps <br> as line breaks", () => {
    expect(cleanCell('<code style="white-space: pre">a = { x }<br>b = &lt;triggers&gt;</code>')).toBe(
      "a = { x }\nb = <triggers>"
    );
    expect(cleanCell("`add_gold = X`")).toBe("add_gold = X");
    expect(cleanCell("**Name**")).toBe("Name");
    expect(cleanCell("[Triggers](Triggers.md)")).toBe("Triggers");
  });
});

describe("parseWikiEffects on the bundled Effects_list.md", () => {
  const tokens = parseWikiEffects(fs.readFileSync(path.join(WIKIDOCS, "Effects_list.md"), "utf8"));

  it("finds several hundred effects", () => {
    expect(tokens.length).toBeGreaterThan(400);
    expect(tokens.every((t) => t.kind === "effect")).toBe(true);
  });

  it("spot-check: add_house_modifier has doc, usage example and scopes", () => {
    const t = tokens.find((x) => x.name === "add_house_modifier")!;
    expect(t.doc).toContain("modifier to a house");
    expect(t.usage).toContain("add_house_modifier = name");
    expect(t.scopes).toContain("dynasty house");
  });

  it("does not emit header rows or prose as tokens", () => {
    expect(tokens.find((t) => t.name === "Name")).toBeUndefined();
  });
});

describe("parseWikiTriggers on the bundled Triggers_list.md", () => {
  const tokens = parseWikiTriggers(fs.readFileSync(path.join(WIKIDOCS, "Triggers_list.md"), "utf8"));

  it("finds several hundred triggers", () => {
    expect(tokens.length).toBeGreaterThan(400);
    expect(tokens.every((t) => t.kind === "trigger")).toBe(true);
  });

  it("spot-check: all_court_artifact_slots", () => {
    const t = tokens.find((x) => x.name === "all_court_artifact_slots")!;
    expect(t.doc).toContain("court artifact slots");
    expect(t.scopes).toContain("character");
  });
});

describe("parseWikiEventTargets on the bundled Scopes_list.md", () => {
  const tokens = parseWikiEventTargets(fs.readFileSync(path.join(WIKIDOCS, "Scopes_list.md"), "utf8"));

  it("finds event targets with input scope from the section heading", () => {
    expect(tokens.length).toBeGreaterThan(50);
    const t = tokens.find((x) => x.name === "culture_head")!;
    expect(t.kind).toBe("event_target");
    expect(t.scopes).toContain("input: culture");
    expect(t.scopes).toContain("output: character");
  });
});

describe("loadWikiTokens", () => {
  it("loads all three bundled files and skips missing dirs gracefully", () => {
    expect(loadWikiTokens(WIKIDOCS).length).toBeGreaterThan(900);
    expect(loadWikiTokens(path.join(WIKIDOCS, "nope"))).toEqual([]);
  });
});

describe("mergeWikiTokens", () => {
  const scriptDocs: TokenData[] = [
    { name: "add_gold", kind: "effect", doc: "authoritative doc", scopes: ["character"] },
    { name: "empty_doc", kind: "effect", doc: "", scopes: [] },
  ];
  const wiki: TokenData[] = [
    { name: "add_gold", kind: "effect", doc: "wiki doc", scopes: ["character"], usage: "add_gold = X" },
    { name: "empty_doc", kind: "effect", doc: "wiki fills this", scopes: [] },
    { name: "wiki_only_effect", kind: "effect", doc: "only on the wiki", scopes: [] },
    { name: "add_gold", kind: "trigger", doc: "same name, other kind", scopes: [] },
  ];

  it("keeps script_docs authoritative but adds wiki examples", () => {
    const merged = mergeWikiTokens(scriptDocs, wiki);
    const addGold = merged.find((t) => t.name === "add_gold" && t.kind === "effect")!;
    expect(addGold.doc).toBe("authoritative doc");
    expect(addGold.usage).toContain("add_gold = X");
  });

  it("fills empty docs and adds wiki-only tokens with a provenance note", () => {
    const merged = mergeWikiTokens(scriptDocs, wiki);
    expect(merged.find((t) => t.name === "empty_doc")!.doc).toBe("wiki fills this");
    const wikiOnly = merged.find((t) => t.name === "wiki_only_effect")!;
    expect(wikiOnly.traits).toContain("CK3 wiki");
  });

  it("treats kind as part of identity", () => {
    const merged = mergeWikiTokens(scriptDocs, wiki);
    expect(merged.filter((t) => t.name === "add_gold")).toHaveLength(2);
  });

  it("with no script_docs at all, wiki provides the full baseline", () => {
    const merged = mergeWikiTokens([], wiki);
    expect(merged).toHaveLength(4);
  });
});
