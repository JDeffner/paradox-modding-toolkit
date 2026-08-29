/**
 * The browser language service (src/browser/), end to end against the real
 * bundled CK3 data.
 *
 * These tests run on node, so they prove the ASSEMBLY is right, not that the
 * bundle is browser-clean: the shims are aliased in at bundle time and cannot
 * be exercised from here. What they do pin is that a service built with no
 * filesystem, no workspace scan and no LSP connection still answers with the
 * real token tables, and that the pieces which quietly break when reassembled
 * (the uri+version parse cache, same-file definitions) actually work.
 */
import { describe, expect, it, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { DiagnosticSeverity, type Diagnostic } from "vscode-languageserver/node";
import { createBrowserLanguageService } from "../src/browser";
import { BROWSER_DATA_VERSION, type BakedDocs, type BakedToken, type BakedTokens } from "../src/browser/data";
import { loadTokenDataFromLogs, parseOnActionsLog } from "../src/data/docsParser";
import { loadWikiTokens, mergeWikiTokens } from "../src/data/wikiDocs";

const DATA = path.resolve(__dirname, "..", "data", "ck3");

let tokens: BakedTokens;
let docs: BakedDocs;
let freqs: unknown;

beforeAll(() => {
  // The same bake scripts/bake-browser-data.ts does, in memory. Keeping it here
  // rather than reading dist/ means the suite does not depend on a build step.
  const logs = path.join(DATA, "script_docs");
  const loaded = loadTokenDataFromLogs(logs);
  const merged = mergeWikiTokens(loaded.tokens, loadWikiTokens(path.join(DATA, "wikidocs")));
  const hot: BakedToken[] = [];
  const prose: Array<[string, string]> = [];
  for (const t of merged) {
    const entry: BakedToken = { name: t.name, kind: t.kind, scopes: t.scopes };
    if (t.traits) entry.traits = t.traits;
    hot.push(entry);
    prose.push([t.doc ?? "", t.usage ?? ""]);
  }
  const onActionScopes: Record<string, string> = {};
  for (const [name, scope] of parseOnActionsLog(logs)) onActionScopes[name] = scope;

  tokens = {
    version: BROWSER_DATA_VERSION,
    gameId: "ck3",
    source: "test",
    tokens: hot,
    templates: loaded.templates,
    onActionScopes,
  };
  docs = { version: BROWSER_DATA_VERSION, gameId: "ck3", prose };
  freqs = JSON.parse(fs.readFileSync(path.join(DATA, "freqs.json"), "utf8"));
});

function service(withDocs = true) {
  return createBrowserLanguageService({
    tokens,
    docs: withDocs ? docs : undefined,
    freqs,
  });
}

const EVENT = `namespace = tutorial

tutorial.0001 = {
\ttype = character_event
\ttitle = tutorial.0001.t
\tdesc = tutorial.0001.desc
\ttheme = family

\ttrigger = {
\t\tis_ruler = yes
\t}

\timmediate = {
\t\tadd_gold = 100
\t}

\toption = {
\t\tname = tutorial.0001.a
\t}
}
`;

describe("browser language service", () => {
  it("loads the real token tables without touching a workspace", () => {
    const svc = service();
    expect(svc.capabilities.completion).toBe(true);
    expect(svc.capabilities.hoverDocs).toBe(true);
    // Stated plainly rather than implied: there is no index behind this build.
    expect(svc.capabilities.workspaceIndex).toBe(false);
    expect(svc.capabilities.referenceDiagnostics).toBe(false);
  });

  it("classifies a document by its mod-relative folder", () => {
    const svc = service();
    expect(svc.openDocument("events/tutorial.txt", EVENT).kind).toBe("event");
    expect(svc.openDocument("common/scripted_effects/00_x.txt", "").kind).toBe("scripted_effect");
    // A folder outside the schema is reported as such, not silently treated
    // as an event file.
    expect(svc.openDocument("not_a_game_folder/x.txt", "").kind).toBe(null);
  });

  it("reports no diagnostics for a well-formed event", () => {
    const doc = service().openDocument("events/tutorial.txt", EVENT);
    expect(doc.diagnostics()).toEqual([]);
  });

  it("reports an unbalanced brace", () => {
    const doc = service().openDocument("events/tutorial.txt", "a = {\n\tb = 1\n");
    const errors = doc.diagnostics().filter((d) => d.severity === DiagnosticSeverity.Error);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("reports the plural on_actions folder trap", () => {
    // The silent-failure class this project exists for: CK3 reads
    // common/on_action/, so the plural folder is ignored with no error.
    const doc = service().openDocument("common/on_actions/00_x.txt", "on_death = {}\n");
    const codes = doc.diagnostics().map((d) => d.code);
    expect(codes).toContain("wrong-on-action-folder");
  });

  it("completes triggers inside a trigger block", () => {
    const doc = service().openDocument("events/tutorial.txt", EVENT);
    const items = doc.completions(EVENT.indexOf("is_ruler = yes") + "is_r".length);
    expect(items.map((i) => i.label)).toContain("is_ruler");
  });

  it("completes effects inside an immediate block", () => {
    const doc = service().openDocument("events/tutorial.txt", EVENT);
    const items = doc.completions(EVENT.indexOf("add_gold = 100") + "add_g".length);
    expect(items.map((i) => i.label)).toContain("add_gold");
  });

  it("hovers an effect with the prose from the logs", () => {
    const doc = service().openDocument("events/tutorial.txt", EVENT);
    const hover = doc.hover(EVENT.indexOf("add_gold") + 2);
    expect(hover).not.toBeNull();
    const text = JSON.stringify(hover?.contents);
    expect(text).toContain("add_gold");
    expect(text.toLowerCase()).toContain("adds gold");
  });

  it("still hovers before the prose payload arrives, then improves", () => {
    const svc = service(false);
    expect(svc.capabilities.hoverDocs).toBe(false);
    const doc = svc.openDocument("events/tutorial.txt", EVENT);
    const before = JSON.stringify(doc.hover(EVENT.indexOf("add_gold") + 2)?.contents);
    expect(before).toContain("add_gold");
    expect(before.toLowerCase()).not.toContain("adds gold");

    svc.attachDocs(docs);
    expect(svc.capabilities.hoverDocs).toBe(true);
    const after = JSON.stringify(
      svc.openDocument("events/tutorial.txt", EVENT).hover(EVENT.indexOf("add_gold") + 2)?.contents
    );
    expect(after.toLowerCase()).toContain("adds gold");
  });

  it("infers the scope at a position", () => {
    const doc = service().openDocument("events/tutorial.txt", EVENT);
    const result = doc.scopeAt(EVENT.indexOf("add_gold") + 2);
    expect(result.scopes).toContain("character");
  });

  it("resolves a definition declared in the same document", () => {
    // The one part of the definition index a browser can honestly fill.
    const text = "my_test_effect = {\n\tadd_gold = 100\n}\n";
    const doc = service().openDocument("common/scripted_effects/00_x.txt", text);
    const hover = doc.hover(2);
    expect(JSON.stringify(hover?.contents)).toContain("my_test_effect");
  });

  it("re-parses after an edit instead of serving the stale parse", () => {
    // The parse cache is keyed by uri + version. AGENTS.md records this biting
    // twice; if update() failed to bump the version the second read would still
    // report the first text's error.
    const doc = service().openDocument("events/tutorial.txt", "a = {\n");
    expect(doc.diagnostics().length).toBeGreaterThan(0);
    doc.update("a = { b = 1 }\n");
    expect(doc.diagnostics()).toEqual([]);
    doc.update("a = {\n");
    expect(doc.diagnostics().length).toBeGreaterThan(0);
    doc.dispose();
  });

  it("refuses a payload baked by a different version", () => {
    expect(() =>
      createBrowserLanguageService({ tokens: { ...tokens, version: BROWSER_DATA_VERSION + 1 } })
    ).toThrow(/bake:browser/);
  });

  it("refuses a gameId that disagrees with the token payload", () => {
    // Otherwise the vic3 schema and profile would answer over CK3 token
    // tables: every answer plausible, none of them right.
    expect(() => createBrowserLanguageService({ gameId: "vic3", tokens })).toThrow(/does not match/);
    expect(() => createBrowserLanguageService({ gameId: "ck3", tokens })).not.toThrow();
  });

  it("refuses docs baked for another game, at construction and at attachDocs", () => {
    // The prose is aligned with the token table BY INDEX, so a foreign payload
    // does not fail to match — it silently attaches the wrong text everywhere.
    const foreign: BakedDocs = { ...docs, gameId: "vic3" };
    expect(() => createBrowserLanguageService({ tokens, docs: foreign })).toThrow(/index-aligned/);
    expect(() => service(false).attachDocs(foreign)).toThrow(/index-aligned/);
  });

  it("keeps its own game when a second service for another game exists", () => {
    // The profile is process-wide and feature code reads it at call time, so
    // creating the vic3 service used to switch the ck3 service's game under it.
    const ck3 = createBrowserLanguageService({ tokens, docs, freqs });
    const ck3Doc = ck3.openDocument("events/tutorial.txt", "a = {\n");

    const vic3 = createBrowserLanguageService({
      tokens: {
        version: BROWSER_DATA_VERSION,
        gameId: "vic3",
        source: "test",
        tokens: [],
        templates: [],
        onActionScopes: {},
      },
    });
    const vic3Doc = vic3.openDocument("events/x.txt", "a = {\n");

    const message = (ds: Diagnostic[]) => ds.map((d) => JSON.stringify(d.message)).join(" ");
    expect(message(vic3Doc.diagnostics())).toContain("Vic3");
    // The one that matters: the older service, asked after the newer one exists.
    expect(message(ck3Doc.diagnostics())).toContain("CK3");
    expect(message(ck3Doc.diagnostics())).not.toContain("Vic3");
    // And completion still reaches the CK3 tables the service was built with.
    expect(
      ck3
        .openDocument("events/tutorial.txt", EVENT)
        .completions(EVENT.indexOf("add_gold") + 5)
        .map((i) => i.label)
    ).toContain("add_gold");
  });

  it("survives a freqs payload whose tables are null", () => {
    // `typeof null === "object"`, so a null table used to land in FreqData and
    // completion threw on the first `freqs.tokens[name]` lookup.
    const svc = createBrowserLanguageService({ tokens, docs, freqs: { contexts: null, tokens: null } });
    const doc = svc.openDocument("events/tutorial.txt", EVENT);
    expect(doc.completions(EVENT.indexOf("add_gold = 100") + 5).map((i) => i.label)).toContain("add_gold");
  });
});
