/**
 * Manifest guard for the four script language ids.
 *
 * The per-game ids (`paradox-ck3` and friends) are the same language with a
 * different icon and label, and every one of them is invisible to break: a
 * `when` clause that still compares to bare `paradox`, a missing grammar or a
 * missing snippets entry costs a feature in one game only, silently, with no
 * error anywhere. Each check below is one of those failure modes.
 *
 * The language clauses use the regex form `editorLangId =~ /^paradox(-(ck3|
 * vic3|eu5))?$/`. The four-way OR (`editorLangId == paradox || editorLangId ==
 * paradox-ck3 || ...`) is the documented fallback if `=~` ever misbehaves on
 * these context keys, so the clause check accepts either form.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { ck3Meta } from "@px-lsp/server/games/ck3/meta";
import { vic3Meta } from "@px-lsp/server/games/vic3/meta";
import { eu5Meta } from "@px-lsp/server/games/eu5/meta";
import { PARADOX_SCRIPT_LANGS } from "../src/langIds";

interface Manifest {
  contributes: {
    languages: Array<{ id: string; aliases?: string[]; icon?: { light: string; dark: string } }>;
    grammars: Array<{ language?: string; scopeName: string; path: string }>;
    snippets: Array<{ language: string; path: string }>;
    configurationDefaults: Record<string, unknown>;
  };
}

const PKG_ROOT = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8")) as Manifest;
const c = manifest.contributes;

/** The languages we serve that are NOT the script language (server-side rule). */
const NON_SCRIPT = ["paradox-loc", "paradox-gui", "paradox-mod", "paradox-info"];

/** Every `when` / `enablement` string anywhere under `contributes`. */
function clauses(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(clauses);
  if (node && typeof node === "object") {
    return Object.entries(node).flatMap(([key, value]) =>
      (key === "when" || key === "enablement") && typeof value === "string" ? [value] : clauses(value)
    );
  }
  return [];
}

/** `editorLangId == x`, `resourceLangId =~ /re/` — value kept verbatim. */
const LANG_TEST = /\b(?:editorLangId|resourceLangId)\s*(==|=~)\s*(\/(?:[^/\\]|\\.)+\/[a-z]*|[\w.-]+)/g;

/** Which of the four script ids a clause lets through, by either form. */
function admitted(clause: string): Set<string> {
  const out = new Set<string>();
  for (const [, op, value] of clause.matchAll(LANG_TEST)) {
    if (op === "==") {
      out.add(value);
      continue;
    }
    const body = value.slice(1, value.lastIndexOf("/"));
    const flags = value.slice(value.lastIndexOf("/") + 1);
    const re = new RegExp(body, flags);
    for (const id of PARADOX_SCRIPT_LANGS) if (re.test(id)) out.add(id);
  }
  return out;
}

describe("manifest language clauses", () => {
  it("admits every script id wherever it mentions the script language", () => {
    const broken = clauses(c).filter((clause) => {
      const ids = admitted(clause);
      // Only clauses that talk about the script language at all: a clause
      // testing `paradox-gui` or `paradox-info` is none of our business.
      if (!ids.has("paradox")) return false;
      return PARADOX_SCRIPT_LANGS.some((id) => !ids.has(id));
    });
    expect(broken).toEqual([]);
  });
});

describe("manifest script languages", () => {
  it("declares exactly PARADOX_SCRIPT_LANGS", () => {
    const declared = c.languages
      .map((l) => l.id)
      .filter((id) => id.startsWith("paradox") && !NON_SCRIPT.includes(id));
    expect(declared.sort()).toEqual([...PARADOX_SCRIPT_LANGS].sort());
  });

  it("gives every script id an icon, a grammar, snippets and editor defaults", () => {
    for (const id of PARADOX_SCRIPT_LANGS) {
      const lang = c.languages.find((l) => l.id === id);
      expect(lang?.icon, id).toBeDefined();
      for (const file of [lang!.icon!.light, lang!.icon!.dark]) {
        expect(fs.existsSync(path.join(PKG_ROOT, file)), file).toBe(true);
      }
      const grammar = c.grammars.find((g) => g.language === id);
      expect(grammar, id).toBeDefined();
      expect(fs.existsSync(path.join(PKG_ROOT, grammar!.path)), grammar!.path).toBe(true);
      const snippets = c.snippets.filter((s) => s.language === id);
      expect(snippets.length, id).toBeGreaterThan(0);
      for (const s of snippets) {
        expect(fs.existsSync(path.join(PKG_ROOT, s.path)), s.path).toBe(true);
      }
      expect(c.configurationDefaults[`[${id}]`], id).toBeDefined();
    }
  });

  it("gives every grammar its own scopeName", () => {
    const scopes = c.grammars.map((g) => g.scopeName);
    expect(new Set(scopes).size).toBe(scopes.length);
  });

  it("labels the per-game ids with the game names the server owns", () => {
    for (const meta of [ck3Meta, vic3Meta, eu5Meta]) {
      const lang = c.languages.find((l) => l.id === `paradox-${meta.id}`);
      expect(lang?.aliases?.[0], meta.id).toBe(`Paradox Script (${meta.name})`);
    }
  });
});
