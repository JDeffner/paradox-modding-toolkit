/**
 * End-to-end LSP smoke test: fork the PACKAGED server bundle (dist/server.js)
 * over node IPC exactly like the VS Code client does (TransportKind.ipc →
 * --node-ipc), drive the real protocol — initialize with ParadoxInitOptions,
 * didOpen, completion + resolve, hover, definition, semantic tokens, the
 * paradox/scopeAt and paradox/guiTree requests — and assert sane answers.
 *
 * This is the closest headless stand-in for a live VS Code pass: it exercises
 * the exact client↔server wiring (bundle, transport, init options, custom
 * notifications) that unit tests bypass. Skipped when dist/server.js has not
 * been built (`npm run compile`).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fork, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  createMessageConnection,
  IPCMessageReader,
  IPCMessageWriter,
  type MessageConnection,
} from "vscode-jsonrpc/node";
import {
  dependenciesRequest,
  exampleWikiRequest,
  exampleWikiEntryRequest,
  type ExampleWikiDetail,
  type ExampleWikiIndex,
  guiDependenciesRequest,
  guiLayoutRequest,
  guiSourceEditRequest,
  guiTreeRequest,
  guiVocabularyRequest,
  guiWidgetEditRequest,
  guiWidgetInfoRequest,
  scopeAtRequest,
  statusNotification,
  type DependenciesResult,
  type GuiDependenciesResult,
  type GuiSourceEditResult,
  type GuiTextEdit,
  type GuiWidgetInfo,
  type ScopeAtResult,
  type StatusPayload,
} from "@px-lsp/protocol/protocol";

/** Apply a guiSourceEdit batch the way a host would: end-first, same text. */
function applyEdits(text: string, edits: GuiTextEdit[]): string {
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    text = text.slice(0, edit.start) + edit.newText + text.slice(edit.end);
  }
  return text;
}

const SERVER = path.join(__dirname, "..", "dist", "server.js");
const WIKIDOCS = path.join(__dirname, "..", "data", "ck3", "wikidocs");
const hasServer = fs.existsSync(SERVER);
// A silent skip here makes a "full suite green" omit the entire wire-level
// smoke, so the skip announces itself. Raw stderr, not console.warn: vitest
// swallows console output from files whose every test is skipped.
if (!hasServer) {
  process.stderr.write(
    `\nlspSmoke: SKIPPING every wire-level smoke test, ${SERVER} is not built. Run \`pnpm run compile\` first.\n`
  );
}
// Read from disk, not imported: this must catch a bundle whose inlined version
// drifted from the manifest the package publishes.
const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")).version;

const EFFECTS_TXT = `# Gives gold to the character.
my_smoke_effect = {
	add_gold = 10
}
`;

const EVENTS_TXT = `namespace = smoke

smoke.1 = {
	type = character_event
	title = smoke.1.t
	immediate = {
		my_smoke_effect = yes
		my_parent_effect = yes
	}
	option = {
		name = smoke.1.a
	}
}

smoke.2 = {
	type = character_event
	immediate = {
		save_scope_as = smoke_actor
		capital_province = {
			change_development_level = 1
		}
		trigger_event = smoke.1
	}
}

# Can the character pay the toll?
scripted_trigger smoke_can_pay_trigger = {
	gold >= 5
}

smoke.3 = {
	type = character_event
	trigger = {
		smoke_can_pay_trigger = yes
		has_variable = smoke_toll
	}
	immediate = {
		set_variable = { name = smoke_toll value = 5 }
	}
}
`;

// Parent-mod fixture (submod workflow): indexed via settings.parentPaths.
const PARENT_EFFECTS_TXT = `# Parent framework effect.
my_parent_effect = {
	add_prestige = 5
}
`;

// The parent is ALSO a workspace mod here (multi-mod workspace): its own
// references must be indexed, so find-references spans both mods.
const PARENT_EVENTS_TXT = `namespace = psmoke

psmoke.1 = {
	immediate = {
		my_smoke_effect = yes
	}
}
`;

// Dependency-parent fixture: a read-only parent that is NOT a workspace mod,
// so it only reaches the harvests through settings.parentPaths.
const DEP_MACRO_TXT = `macro = {
	description = "Smoke macro from a dependency parent."
	definition = "PxSmokeParentMacro(Value)"
	replace_with = "EqualTo_int32(Value, '(int32)0')"
}
`;

const GUI_TXT = `widget = {
	name = "smoke_root"
	flowcontainer = {
		name = "inner"
	}
}
`;

// The one door .gui has into script, plus the loc keys a panel names: the
// subject of paradox/guiDependencies and of `dependencies` with `guiUses`.
const SGUI_TXT = `smoke_open_gui = {
	scope = character
	effect = {
		trigger_event = smoke.1
		smoke_gui_effect = yes
	}
}
`;

// Its own file, and its own effect: the chain hop must be visible on the wire
// without changing my_smoke_effect's reference count, which other smokes pin.
const GUI_EFFECT_TXT = `smoke_gui_effect = {
	trigger_event = smoke.2
}
`;

const GUI_PANEL_TXT = `window = {
	name = "smoke_panel"
	widget = {
		name = "smoke_open_button"
		onclick = "[GetScriptedGui('smoke_open_gui').Execute(GuiScope.SetRoot(GetPlayer.MakeScope).End)]"
		text = "smoke.1.t"
		tooltip = "smoke_absent_tip"
	}
}
`;

const CLOC_TXT = `SmokeCustom = {
	type = character
	text = {
		localization_key = smoke_custom_a
	}
}
`;

const LOC_YML =
  "﻿l_english:\n" +
  ' smoke.1.t:0 "Smoke"\n' +
  ' smoke.1.a:0 "OK"\n' +
  " smoke.1.desc:0 \"Hi [ROOT.Char.Custom2('SmokeCustom', scope:host)]\"\n" +
  ' smoke.1.macro:0 "[PxSmokeParentMac"\n';

function toUri(p: string): string {
  return "file:///" + p.replace(/\\/g, "/").replace(/^\//, "");
}

describe.skipIf(!hasServer)("LSP smoke over node IPC (the client's transport)", () => {
  let child: ChildProcess;
  let conn: MessageConnection;
  let modDir: string;
  let parentDir: string;
  let depDir: string;
  let eventsFile: string;
  let eventsUri: string;
  let locFile: string;
  let locUri: string;
  let guiPanelFile: string;
  let initResult: { serverInfo?: { name: string; version: string } };
  const statuses: StatusPayload[] = [];

  beforeAll(async () => {
    modDir = fs.mkdtempSync(path.join(os.tmpdir(), "ck3-smoke-"));
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ck3-smoke-parent-"));
    depDir = fs.mkdtempSync(path.join(os.tmpdir(), "ck3-smoke-dep-"));
    const fxIn = (root: string, rel: string, content: string) => {
      const full = path.join(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, "utf8");
      return full;
    };
    const fx = (rel: string, content: string) => fxIn(modDir, rel, content);
    fxIn(parentDir, "common/scripted_effects/parent_effects.txt", PARENT_EFFECTS_TXT);
    fxIn(parentDir, "events/parent_events.txt", PARENT_EVENTS_TXT);
    fxIn(depDir, "data_binding/px_smoke_macros.txt", DEP_MACRO_TXT);
    fx("common/scripted_effects/smoke_effects.txt", EFFECTS_TXT);
    eventsFile = fx("events/smoke_events.txt", EVENTS_TXT);
    fx("common/customizable_localization/smoke_cloc.txt", CLOC_TXT);
    fx("common/scripted_guis/smoke_sguis.txt", SGUI_TXT);
    fx("common/scripted_effects/smoke_gui_effects.txt", GUI_EFFECT_TXT);
    guiPanelFile = fx("gui/smoke_panel.gui", GUI_PANEL_TXT);
    locFile = fx("localization/english/smoke_l_english.yml", LOC_YML);
    eventsUri = toUri(eventsFile);
    locUri = toUri(locFile);

    child = fork(SERVER, ["--node-ipc"], { stdio: ["ignore", "pipe", "pipe", "ipc"], silent: true });
    conn = createMessageConnection(new IPCMessageReader(child), new IPCMessageWriter(child));
    conn.onNotification(statusNotification, (p: StatusPayload) => {
      statuses.push(p);
    });
    conn.onNotification(() => undefined); // swallow diagnostics etc.
    conn.onRequest("window/workDoneProgress/create", () => null);
    conn.listen();

    const init = await conn.sendRequest("initialize", {
      processId: process.pid,
      rootUri: toUri(modDir),
      workspaceFolders: [{ uri: toUri(modDir), name: "smoke" }],
      // The real thing the VSCode client sends: snippetSupport is a STANDARD
      // LSP capability, so the server must read it from here and not from the
      // paradox initializationOptions.
      capabilities: {
        textDocument: { completion: { completionItem: { snippetSupport: true } } },
      },
      initializationOptions: {
        storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "ck3-smoke-storage-")),
        wikidocsDir: WIKIDOCS,
        // This suite simulates the VSCode client, which registers the px.*
        // commands and renders rich hover markup (PROTOCOL.md §Initialization).
        clientCommands: true,
        settings: {
          gamePath: null, // vanilla scan skipped: keep the smoke fast
          logsPath: null,
          modPath: modDir,
          parentPaths: [parentDir, depDir],
          workspaceMods: [parentDir],
          locLanguage: "english",
          scopeInlayHints: false,
          diagnosticsIgnore: [],
          diagnosticsIgnorePatterns: [],
          diagnosticsVanilla: false,
        },
      },
    });
    initResult = init as typeof initResult;
    expect(
      (init as { capabilities: { completionProvider: { resolveProvider: boolean } } }).capabilities
        .completionProvider.resolveProvider
    ).toBe(true);
    await conn.sendNotification("initialized", {});

    void conn.sendNotification("textDocument/didOpen", {
      textDocument: { uri: eventsUri, languageId: "paradox", version: 1, text: EVENTS_TXT },
    });

    // Wait until the mod and parent-mod indexes picked up the fixture definitions.
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const latest = statuses[statuses.length - 1];
      if (latest && !latest.indexing && latest.definitions >= 5) break;
      await new Promise((r) => setTimeout(r, 100));
    }
  }, 30_000);

  afterAll(async () => {
    try {
      await conn.sendRequest("shutdown");
      void conn.sendNotification("exit");
    } catch {
      /* server may already be gone */
    }
    await new Promise((r) => setTimeout(r, 200));
    if (child && !child.killed) child.kill();
    fs.rmSync(modDir, { recursive: true, force: true });
    fs.rmSync(parentDir, { recursive: true, force: true });
    fs.rmSync(depDir, { recursive: true, force: true });
  });

  it("initialize announces serverInfo (PROTOCOL.md §Initialization)", () => {
    expect(initResult.serverInfo).toEqual({ name: "px-lsp", version: PKG_VERSION });
  });

  it("reported status and indexed the fixture mod and parent mod", () => {
    const latest = statuses[statuses.length - 1];
    expect(latest).toBeDefined();
    expect(latest.tokens).toBeGreaterThan(500); // bundled wiki tokens loaded
    expect(latest.definitions).toBeGreaterThanOrEqual(5); // 2 effects + event + 2 loc keys
  });

  it("completion inside immediate: CompletionList with the mod effect and engine effects", async () => {
    // Position: inside the immediate block (line 5 = "\t\tmy_smoke_effect = yes"; use start of line 6 area).
    const result = (await conn.sendRequest("textDocument/completion", {
      textDocument: { uri: eventsUri },
      position: { line: 6, character: 2 },
    })) as {
      isIncomplete: boolean;
      items: Array<{ label: string; documentation?: unknown; data?: unknown }>;
    };
    expect(Array.isArray(result.items)).toBe(true);
    const labels = result.items.map((i) => i.label);
    expect(labels).toContain("my_smoke_effect");
    expect(labels).toContain("save_scope_as");
    expect(labels).not.toContain("has_trait"); // trigger, not valid in an effect block

    // Lazy docs: inline documentation absent, resolve fills it from the PdxDoc comment.
    const item = result.items.find((i) => i.label === "my_smoke_effect")!;
    expect(item.documentation).toBeUndefined();
    const resolved = (await conn.sendRequest("completionItem/resolve", item)) as {
      documentation?: { value?: string } | string;
    };
    const doc =
      typeof resolved.documentation === "string" ? resolved.documentation : resolved.documentation?.value;
    expect(doc).toContain("Gives gold");
  });

  // The VSCode path takes its capabilities from the real client, while every
  // module-level test takes them from the all-on module default: a regression
  // that silenced snippets or hover links for VSCode would be invisible there.
  // This is the tripwire.
  it("VSCode path: completion still carries snippets, hover still carries file links", async () => {
    const uri = toUri(path.join(modDir, "events", "smoke_snippets.txt"));
    const text = "namespace = snip\n\nsnip.1 = {\n\ttype = character_event\n\timmediate = {\n\t\t\n\t}\n}\n";
    void conn.sendNotification("textDocument/didOpen", {
      textDocument: { uri, languageId: "paradox", version: 1, text },
    });
    const result = (await conn.sendRequest("textDocument/completion", {
      textDocument: { uri },
      position: { line: 5, character: 2 },
    })) as { items: Array<{ label: string; insertText?: string; insertTextFormat?: number }> };
    const effect = result.items.find((i) => i.label === "my_smoke_effect")!;
    expect(effect.insertText).toBe("my_smoke_effect = ${1|yes,no|}");
    expect(effect.insertTextFormat).toBe(2); // InsertTextFormat.Snippet

    const hover = (await conn.sendRequest("textDocument/hover", {
      textDocument: { uri: eventsUri },
      position: { line: 6, character: 4 },
    })) as { contents: { value: string } };
    expect(hover.contents.value).toContain("](file:");
  });

  it("hover on the scripted effect shows its card with a references link", async () => {
    // "my_smoke_effect" on line 6, character 4.
    const hover = (await conn.sendRequest("textDocument/hover", {
      textDocument: { uri: eventsUri },
      position: { line: 6, character: 4 },
    })) as { contents: { value: string } } | null;
    expect(hover).not.toBeNull();
    expect(hover!.contents.value).toContain("my_smoke_effect");
    expect(hover!.contents.value).toContain("Gives gold");
    // Call sites in both workspace mods count, and the count links to the
    // references view via the trusted command.
    expect(hover!.contents.value).toContain("2 references");
    expect(hover!.contents.value).toContain("command:px.showReferences");
  });

  it("F12 in a loc value jumps from Custom2('X') to the custom loc definition", async () => {
    void conn.sendNotification("textDocument/didOpen", {
      textDocument: { uri: locUri, languageId: "paradox-loc", version: 1, text: LOC_YML },
    });
    const line = 3; // the smoke.1.desc line
    const character = LOC_YML.split("\n")[line].indexOf("SmokeCustom") + 3;
    const defs = (await conn.sendRequest("textDocument/definition", {
      textDocument: { uri: locUri },
      position: { line, character },
    })) as Array<{ uri: string; range: { start: { line: number } } }>;
    expect(defs.length).toBeGreaterThan(0);
    expect(defs[0].uri).toContain("smoke_cloc.txt");
    expect(defs[0].range.start.line).toBe(0);
  });

  it("go-to-definition jumps to the scripted effect", async () => {
    const defs = (await conn.sendRequest("textDocument/definition", {
      textDocument: { uri: eventsUri },
      position: { line: 6, character: 4 },
    })) as Array<{ uri: string; range: { start: { line: number } } }>;
    expect(defs.length).toBeGreaterThan(0);
    expect(defs[0].uri).toContain("smoke_effects.txt");
    expect(defs[0].range.start.line).toBe(1);
  });

  it("go-to-definition resolves an effect defined in the parent mod", async () => {
    // "my_parent_effect" on line 7.
    const defs = (await conn.sendRequest("textDocument/definition", {
      textDocument: { uri: eventsUri },
      position: { line: 7, character: 4 },
    })) as Array<{ uri: string; range: { start: { line: number } } }>;
    expect(defs.length).toBeGreaterThan(0);
    expect(defs[0].uri).toContain("parent_effects.txt");
    expect(defs[0].range.start.line).toBe(1);
  });

  it("navigates an inline scripted_trigger declared in the same event file (#5)", async () => {
    // "smoke_can_pay_trigger = yes" call site on line 33; declaration on line 26.
    const defs = (await conn.sendRequest("textDocument/definition", {
      textDocument: { uri: eventsUri },
      position: { line: 33, character: 4 },
    })) as Array<{ uri: string; range: { start: { line: number } } }>;
    expect(defs.length).toBeGreaterThan(0);
    expect(defs[0].uri).toContain("smoke_events.txt");
    expect(defs[0].range.start.line).toBe(26);

    const hover = (await conn.sendRequest("textDocument/hover", {
      textDocument: { uri: eventsUri },
      position: { line: 33, character: 4 },
    })) as { contents: { value: string } } | null;
    expect(hover).not.toBeNull();
    expect(hover!.contents.value).toContain("smoke_can_pay_trigger");
    expect(hover!.contents.value).toContain("pay the toll");

    // Find-references from the declaration line reaches the call site.
    const refs = (await conn.sendRequest("textDocument/references", {
      textDocument: { uri: eventsUri },
      position: { line: 26, character: 20 },
      context: { includeDeclaration: false },
    })) as Array<{ uri: string; range: { start: { line: number } } }>;
    expect(refs.some((r) => r.uri.includes("smoke_events.txt") && r.range.start.line === 33)).toBe(true);
  });

  it("completion offers the parent-mod effect", async () => {
    const result = (await conn.sendRequest("textDocument/completion", {
      textDocument: { uri: eventsUri },
      position: { line: 6, character: 2 },
    })) as { items: Array<{ label: string }> };
    expect(result.items.map((i) => i.label)).toContain("my_parent_effect");
  });

  // The dependency parent is not a workspace mod, so this passes only while
  // the macro harvest carries the parent layer between game and mod.
  it("completion offers a data_binding macro from a dependency parent", async () => {
    void conn.sendNotification("textDocument/didOpen", {
      textDocument: { uri: locUri, languageId: "paradox-loc", version: 1, text: LOC_YML },
    });
    const line = 4; // the smoke.1.macro line
    const result = (await conn.sendRequest("textDocument/completion", {
      textDocument: { uri: locUri },
      // Cursor right after the "PxSmokeParentMac" prefix, inside the [ … ].
      position: { line, character: LOC_YML.split("\n")[line].indexOf('Mac"') + 3 },
    })) as { items: Array<{ label: string }> };
    expect(result.items.map((i) => i.label)).toContain("PxSmokeParentMacro");
  });

  it("find-references spans every workspace mod", async () => {
    // "my_smoke_effect" on line 6: used in the mod's own event AND in the
    // second workspace mod's event.
    const refs = (await conn.sendRequest("textDocument/references", {
      textDocument: { uri: eventsUri },
      position: { line: 6, character: 4 },
      context: { includeDeclaration: false },
    })) as Array<{ uri: string }>;
    expect(refs.some((r) => r.uri.includes("smoke_events.txt"))).toBe(true);
    expect(refs.some((r) => r.uri.includes("parent_events.txt"))).toBe(true);
  });

  it("semantic tokens cover the document", async () => {
    const tokens = (await conn.sendRequest("textDocument/semanticTokens/full", {
      textDocument: { uri: eventsUri },
    })) as { data: number[] };
    expect(tokens.data.length).toBeGreaterThan(0);
  });

  it("documentColor + colorPresentation round-trip over the wire (issue #11)", async () => {
    expect((initResult as { capabilities: { colorProvider?: boolean } }).capabilities.colorProvider).toBe(
      true
    );
    const uri = "file:///smoke-colors.txt";
    void conn.sendNotification("textDocument/didOpen", {
      textDocument: { uri, languageId: "paradox", version: 1, text: "color = hsv { 0.6 0.5 0.7 }\n" },
    });
    const colors = (await conn.sendRequest("textDocument/documentColor", {
      textDocument: { uri },
    })) as Array<{
      range: unknown;
      color: { red: number; green: number; blue: number; alpha: number };
    }>;
    expect(colors).toHaveLength(1);
    expect(Math.round(colors[0].color.blue * 255)).toBe(179);
    const presentations = (await conn.sendRequest("textDocument/colorPresentation", {
      textDocument: { uri },
      color: colors[0].color,
      range: colors[0].range,
    })) as Array<{ label: string }>;
    // The author's notation leads; the other formats follow.
    expect(presentations[0].label).toBe("hsv { 0.6 0.5 0.7 }");
    expect(presentations.map((p) => p.label)).toContain("rgb { 89 125 179 }");
  });

  it("paradox/eventDetail answers with loc, options and refs", async () => {
    const detail = (await conn.sendRequest("paradox/eventDetail", { id: "smoke.1" })) as {
      id: string;
      title?: { key: string; text?: string };
      options: Array<{ name?: { key: string } }>;
      refs: Array<{ kind: string; name: string }>;
      endLine: number;
    } | null;
    expect(detail).not.toBeNull();
    expect(detail!.title?.key).toBe("smoke.1.t");
    expect(detail!.title?.text).toBe("Smoke");
    expect(detail!.options).toHaveLength(1);
    expect(detail!.options[0].name?.key).toBe("smoke.1.a");
    expect(detail!.refs.some((r) => r.kind === "scripted_effect" && r.name === "my_smoke_effect")).toBe(true);
  });

  it("paradox/eventDetail carries rendered blocks and step-into targets", async () => {
    const detail = (await conn.sendRequest("paradox/eventDetail", { id: "smoke.2" })) as {
      sections: Array<{
        name: string;
        lines: Array<{ depth: number; text: string; line: number }>;
        totalLines: number;
        targets: Array<{ via: string; name: string; kind: string; defLine?: number }>;
      }>;
    } | null;
    const immediate = detail!.sections.find((s) => s.name === "immediate")!;
    expect(immediate.totalLines).toBe(immediate.lines.length);
    expect(immediate.lines.map((l) => `${l.depth}:${l.text}`)).toContain("1:change_development_level = 1");
    expect(immediate.targets).toHaveLength(1);
    expect(immediate.targets[0]).toMatchObject({
      via: "trigger_event",
      name: "smoke.1",
      kind: "event",
      file: eventsFile,
      defLine: 2,
    });
  });

  it("paradox/eventGraph carries the query-box catalog, not just the selected nodes", async () => {
    const graph = (await conn.sendRequest("paradox/eventGraph", { root: "smoke.1" })) as {
      nodes: Array<{ id: string }>;
      suggestions?: { ids: string[]; namespaces: string[] };
    };
    // The root selects one chain; the catalog still lists the mod's vocabulary.
    expect(graph.suggestions?.ids).toContain("smoke.1");
    expect(graph.suggestions?.ids).toContain("smoke.2");
    expect(graph.suggestions?.namespaces).toContain("smoke");
    expect(graph.suggestions?.namespaces).toContain("psmoke");
  });

  it("paradox/exampleWiki answers the searchable catalog", async () => {
    const index = (await conn.sendRequest(exampleWikiRequest, null)) as ExampleWikiIndex;
    expect(index.entries.length).toBeGreaterThan(50);
    expect(index.entries.some((e) => e.kind === "trigger")).toBe(true);
    expect(index.entries.some((e) => e.kind === "effect")).toBe(true);
    // Rows are ordered by how often the game itself writes the name.
    expect(index.entries[0].count).toBeGreaterThan(0);
    expect(index.sources.join(" ")).toContain("Set the game folder");
  });

  it("paradox/exampleWikiEntry round-trips one catalog row and refuses an unknown name", async () => {
    const index = (await conn.sendRequest(exampleWikiRequest, null)) as ExampleWikiIndex;
    const row = index.entries.find((e) => e.kind === "effect");
    expect(row).toBeDefined();
    const detail = (await conn.sendRequest(exampleWikiEntryRequest, {
      name: row!.name,
      kind: row!.kind,
    })) as ExampleWikiDetail;
    expect(detail.name).toBe(row!.name);
    expect(detail.kind).toBe("effect");
    expect(detail.provenance).not.toBe("");
    // No game folder in this run, so the sites are honestly empty and say why.
    expect(detail.examples).toEqual([]);
    expect(detail.examplesNote).toContain("game folder");
    const missing = await conn.sendRequest(exampleWikiEntryRequest, {
      name: "px_no_such_name_at_all",
      kind: "effect",
    });
    expect(missing).toBeNull();
  });

  it("paradox/exampleWiki carries the mod's own variables, with inline context", async () => {
    const index = (await conn.sendRequest(exampleWikiRequest, null)) as ExampleWikiIndex;
    const row = index.entries.find((e) => e.name === "smoke_toll" && e.kind === "variable");
    expect(row).toBeDefined();
    const detail = (await conn.sendRequest(exampleWikiEntryRequest, {
      name: "smoke_toll",
      kind: "variable",
    })) as ExampleWikiDetail;
    // Set once in smoke.3's immediate, read once in its trigger.
    expect(detail.valueType).toBe("value");
    expect(detail.containers).toEqual(["smoke.3"]);
    const set = detail.examples.find((e) => e.label === "set");
    expect(set?.text).toBe("set_variable = { name = smoke_toll value = 5 }");
    expect(set?.context?.length).toBeGreaterThan(1);
    expect(set?.contextStart).toBeLessThanOrEqual(set!.line);
    expect(detail.examples.some((e) => e.label === "read")).toBe(true);
  });

  it("paradox/dependencies resolves a definition's dependents and dependencies", async () => {
    const result = (await conn.sendRequest("paradox/dependencies", { name: "smoke.1" })) as {
      def: { name: string; kind: string } | null;
      dependents: Array<{ kind: string; items: Array<{ name: string }> }>;
      dependencies: Array<{ kind: string; items: Array<{ name: string }> }>;
    };
    expect(result.def).toMatchObject({ name: "smoke.1", kind: "event" });
    // smoke.1's immediate calls the mod and parent scripted effects.
    const effects = result.dependencies.find((g) => g.kind === "scripted_effect");
    expect(effects).toBeDefined();
    expect(effects!.items.map((i) => i.name).sort()).toContain("my_smoke_effect");
  });

  it("paradox/scopeAt reports the chain and the file's saved scopes", async () => {
    // Line 19 sits inside smoke.2's `capital_province = { … }` block, two
    // levels below the event's declared character root.
    const result = (await conn.sendRequest(scopeAtRequest, {
      uri: eventsUri,
      position: { line: 19, character: 4 },
    })) as ScopeAtResult | null;
    expect(result).not.toBeNull();
    expect(result!.scopes).toEqual(["province"]);
    expect(result!.chain[0]).toEqual({ scopes: ["character"] });
    expect(result!.chain[result!.chain.length - 1]).toEqual({
      entryKeyword: "capital_province",
      scopes: ["province"],
    });
    expect(result!.savedScopes).toContainEqual({ name: "smoke_actor", scopes: ["character"] });
  });

  it("paradox/scopeAt answers null for a document that is not open script", async () => {
    const result = await conn.sendRequest(scopeAtRequest, {
      uri: toUri(path.join(modDir, "events", "not_open.txt")),
      position: { line: 0, character: 0 },
    });
    expect(result).toBeNull();
  });

  it("paradox/guiTree answers for gui text", async () => {
    const tree = (await conn.sendRequest(guiTreeRequest, {
      uri: "file:///smoke.gui",
      text: GUI_TXT,
    })) as { nodes: Array<{ key: string; name?: string; children: unknown[] }>; count: number };
    expect(tree.count).toBe(2);
    expect(tree.nodes[0].key).toBe("widget");
    expect(tree.nodes[0].name).toBe("smoke_root");
  });

  it("paradox/guiLayout lays out gui text with measured rects", async () => {
    const result = (await conn.sendRequest(guiLayoutRequest, {
      uri: "file:///smoke.gui",
      text: `widget = {
	name = "smoke_root"
	size = { 200 100 }
	background = { texture = "gfx/interface/colors/white.dds" color = { 0.2 0.2 0.2 1 } }
	hbox = {
		icon = { size = { 40 40 } texture = "gfx/interface/colors/white.dds" }
	}
}`,
    })) as import("@px-lsp/protocol/protocol").GuiLayoutResult;
    expect(result.nodeCount).toBe(3);
    expect(result.nodes[0].rect).toEqual({ x: 0, y: 0, w: 200, h: 100 });
    expect(result.nodes[0].line).toBe(0);
    // hbox fills the widget; the lone icon centers via space-around.
    expect(result.nodes[0].children[0].rect).toEqual({ x: 0, y: 0, w: 200, h: 100 });
    expect(result.nodes[0].children[0].children[0].rect).toEqual({ x: 80, y: 30, w: 40, h: 40 });
    expect(result.textures).toEqual(["gfx/interface/colors/white.dds"]);
  });

  it("paradox/guiSourceEdit applies a property batch and refuses a box child's position", async () => {
    const text =
      'widget = {\n\tname = "smoke_root"\n\tvbox = {\n\t\tname = "smoke_box"\n\t\twidget = {\n\t\t\tname = "smoke_child"\n\t\t}\n\t}\n}\n';
    const set = (await conn.sendRequest(guiSourceEditRequest, {
      uri: "file:///smoke.gui",
      text,
      op: {
        kind: "setProperties",
        line: 0,
        properties: [
          { key: "size", value: "{ 320 200 }" },
          { key: "alpha", value: "0.5" },
        ],
      },
    })) as GuiSourceEditResult;
    expect(set.refused).toBeUndefined();
    const applied = applyEdits(text, set.edits!);
    expect(applied).toContain("\tsize = { 320 200 }\n\talpha = 0.5\n}\n");
    expect(applied).toContain('\t\t\tname = "smoke_child"\n'); // untouched

    // The vbox owns its child's slot, so the drag is refused WITH a reason
    // rather than writing a property the game drops.
    const refused = (await conn.sendRequest(guiSourceEditRequest, {
      uri: "file:///smoke.gui",
      text,
      op: { kind: "setProperties", line: 4, properties: [{ key: "position", value: "{ 5 5 }" }] },
    })) as GuiSourceEditResult;
    expect(refused.edits).toBeUndefined();
    expect(refused.refused).toContain("places its children itself");
  });

  it("paradox/guiVocabulary answers with harvested widget names and their properties", async () => {
    const text = 'widget = {\n\tname = "smoke_vocab_root"\n\ticon = { size = { 20 20 } }\n}\n';
    const result = (await conn.sendRequest(guiVocabularyRequest, {
      uri: "file:///smoke_vocab.gui",
      text,
    })) as import("@px-lsp/protocol/protocol").GuiVocabularyResult;

    // The harvest reaches the wire: names ranked by vanilla usage, capped, with
    // the real count beside them.
    expect(result.entries.length).toBeGreaterThan(10);
    expect(result.entries.every((e) => e.name.length > 0)).toBe(true);
    expect(result.total).toBeGreaterThanOrEqual(result.entries.length);

    // The property half, scoped to the two types this document names: an
    // inspector completing `texture` on an icon is completing a harvested name.
    expect(Object.keys(result.properties!).sort()).toEqual(["icon", "widget"]);
    expect(result.properties!.icon).toContain("texture");
    expect(result.commonProperties!.length).toBeGreaterThan(10);
  });

  it("open -> guiLayout -> guiSourceEdit: a drag commits base + delta and the layout moves by it", async () => {
    // The GUI editor's whole write path over the wire, on an ANCHORED widget:
    // the one shape where the rect and the `position` disagree, so a host that
    // committed the canvas coordinate instead of base + delta fails here.
    const uri = "file:///smoke_editor.gui";
    const text =
      'widget = {\n\tname = "smoke_editor_frame"\n\tsize = { 300 200 }\n\twidget = {\n\t\tname = "smoke_editor_child"\n\t\tparentanchor = bottom|right\n\t\tposition = { -30 -30 }\n\t\tsize = { 20 20 }\n\t}\n}\n';
    void conn.sendNotification("textDocument/didOpen", {
      textDocument: { uri, languageId: "paradox-gui", version: 1, text },
    });

    const before = (await conn.sendRequest(guiLayoutRequest, {
      uri,
      text,
    })) as import("@px-lsp/protocol/protocol").GuiLayoutResult;
    const child = before.nodes[0].children[0];
    expect(child.rect).toEqual({ x: 250, y: 150, w: 20, h: 20 });
    expect(child.srcPosition).toEqual([-30, -30]);
    expect(child.editable).toBe(true);

    // Dragged 10 right and 5 down: source position plus the delta.
    const result = (await conn.sendRequest(guiSourceEditRequest, {
      uri,
      text,
      op: {
        kind: "setProperties",
        line: child.line!,
        properties: [{ key: "position", value: "{ -20 -25 }" }],
      },
    })) as GuiSourceEditResult;
    expect(result.refused).toBeUndefined();

    const applied = applyEdits(text, result.edits!);
    expect(applied).toBe(text.replace("position = { -30 -30 }", "position = { -20 -25 }"));

    const after = (await conn.sendRequest(guiLayoutRequest, {
      uri,
      text: applied,
    })) as import("@px-lsp/protocol/protocol").GuiLayoutResult;
    expect(after.nodes[0].children[0].rect).toEqual({ x: 260, y: 155, w: 20, h: 20 });
  });

  it("paradox/guiSourceEdit round-trips a block through blockText and insertRaw", async () => {
    const text =
      'window = {\n\tname = "smoke_paste_root"\n\t# the child\n\twidget = {\n\t\tname = "smoke_copy_me"\n\t}\n}\n';
    const copied = (await conn.sendRequest(guiSourceEditRequest, {
      uri: "file:///smoke.gui",
      text,
      op: { kind: "blockText", line: 3 },
    })) as GuiSourceEditResult;
    expect(copied.blockText).toBe('\t# the child\n\twidget = {\n\t\tname = "smoke_copy_me"\n\t}\n');

    const pasted = (await conn.sendRequest(guiSourceEditRequest, {
      uri: "file:///smoke.gui",
      text,
      op: { kind: "insertRaw", line: 0, fragment: copied.blockText! },
    })) as GuiSourceEditResult;
    expect(applyEdits(text, pasted.edits!)).toBe(text.replace(/\}\n$/, copied.blockText! + "}\n"));
  });

  it("paradox/guiSourceEdit answers a BATCH as one edit set with a verdict per op", async () => {
    // What a multi-selection drag sends: several ops against one text, one
    // edit set back, one undo step on the host's side. The box child's move is
    // refused on its own and the two free widgets still move.
    const text =
      "window = {\n" +
      '\tname = "smoke_batch_root"\n' +
      "\tsize = { 400 300 }\n" +
      '\twidget = { name = "smoke_free_a" position = { 0 0 } size = { 10 10 } }\n' +
      '\twidget = { name = "smoke_free_b" position = { 40 40 } size = { 10 10 } }\n' +
      "\tvbox = {\n" +
      '\t\twidget = { name = "smoke_boxed" position = { 5 5 } size = { 10 10 } }\n' +
      "\t}\n" +
      "}\n";
    const move = (line: number, value: string) => ({
      kind: "setProperties" as const,
      line,
      properties: [{ key: "position", value }],
    });
    const batch = (await conn.sendRequest(guiSourceEditRequest, {
      uri: "file:///smoke_batch.gui",
      text,
      ops: [move(3, "{ 5 5 }"), move(6, "{ 9 9 }"), move(4, "{ 45 45 }")],
    })) as GuiSourceEditResult;
    expect(batch.refused).toBeUndefined();
    expect(batch.results).toHaveLength(3);
    expect(batch.results![1].refused).toContain("places its children itself");
    expect(batch.results![1].edits).toEqual([]);
    expect(applyEdits(text, batch.edits!)).toBe(
      text
        .replace("position = { 0 0 }", "position = { 5 5 }")
        .replace("position = { 40 40 }", "position = { 45 45 }")
    );

    // One shape or the other: a request carrying both cannot say which it meant.
    const both = (await conn.sendRequest(guiSourceEditRequest, {
      uri: "file:///smoke_batch.gui",
      text,
      op: move(3, "{ 1 1 }"),
      ops: [move(3, "{ 2 2 }")],
    })) as GuiSourceEditResult | null;
    expect(both).toBeNull();
  });

  it("paradox/guiWidgetInfo reports a widget's properties with their origins", async () => {
    const text =
      'types PxSmokeTypes {\n\ttype px_smoke_card = widget { size = { 100 50 } }\n}\n\npx_smoke_card = {\n\tname = "smoke_card"\n\tposition = { 10 10 }\n}\n';
    const info = (await conn.sendRequest(guiWidgetInfoRequest, {
      uri: "file:///smoke.gui",
      text,
      line: 4,
    })) as import("@px-lsp/protocol/protocol").GuiWidgetInfo | null;
    expect(info).not.toBeNull();
    expect(info!.name).toBe("smoke_card");
    expect(info!.typeChain).toEqual(["widget"]);
    const size = info!.properties.find((p) => p.key === "size")!;
    expect(size.value).toBe("{ 100 50 }");
    expect(size.origin).toEqual([{ kind: "type", name: "px_smoke_card" }]);
    expect(info!.properties.find((p) => p.key === "position")!.origin).toEqual([]);

    // A line spliced in from elsewhere has no widget of its own here.
    expect(
      await conn.sendRequest(guiWidgetInfoRequest, { uri: "file:///smoke.gui", text, line: 3 })
    ).toBeNull();
  });

  it("paradox/guiLayout reports stage timings and the conditional-visibility checks", async () => {
    const text =
      'vbox = {\n\twidget = { name = "a" size = { 40 30 } }\n' +
      '\twidget = { name = "b" size = { 40 30 } visible = "[GetPlayer.IsAI]" }\n}\n';
    const shown = (await conn.sendRequest(guiLayoutRequest, {
      uri: "file:///smoke_vis.gui",
      text,
    })) as import("@px-lsp/protocol/protocol").GuiLayoutResult;
    expect(shown.visibilityChecks).toEqual([{ key: "[GetPlayer.IsAI]", count: 1, hidden: false }]);
    expect(shown.nodes[0].children[1].rect.h).toBe(30);
    for (const ms of [
      shown.timings.parseMs,
      shown.timings.defsMs,
      shown.timings.layoutMs,
      shown.timings.totalMs,
    ]) {
      expect(Number.isFinite(ms)).toBe(true);
      expect(ms).toBeGreaterThanOrEqual(0);
    }

    const hidden = (await conn.sendRequest(guiLayoutRequest, {
      uri: "file:///smoke_vis.gui",
      text,
      visibility: { mode: "evaluate", checks: { "[GetPlayer.IsAI]": false } },
    })) as import("@px-lsp/protocol/protocol").GuiLayoutResult;
    expect(hidden.nodes[0].children[1].rect.h).toBe(0);
    expect(hidden.visibilityChecks[0].hidden).toBe(true);
  });

  it("paradox/guiWidgetInfo answers the placement question only when asked", async () => {
    const text =
      'widget = {\n\tname = "smoke_frame"\n\tsize = { 300 200 }\n\twidget = {\n\t\tname = "smoke_anchored"\n' +
      "\t\tparentanchor = bottom|right\n\t\tposition = { -30 -30 }\n\t\tsize = { 20 20 }\n\t}\n}\n";
    const plain = (await conn.sendRequest(guiWidgetInfoRequest, {
      uri: "file:///smoke_place.gui",
      text,
      line: 3,
    })) as GuiWidgetInfo;
    expect(plain.placement).toBeUndefined();
    expect(plain.textures).toEqual([]);

    const explained = (await conn.sendRequest(guiWidgetInfoRequest, {
      uri: "file:///smoke_place.gui",
      text,
      line: 3,
      placement: true,
    })) as GuiWidgetInfo;
    const placement = explained.placement!;
    expect(placement.rect).toEqual({ x: 250, y: 150, w: 20, h: 20 });
    expect(placement.terms.map((t) => t.kind)).toEqual([
      "parentOrigin",
      "parentanchor",
      "widgetanchor",
      "position",
    ]);
    expect(placement.terms.reduce((n, t) => n + t.dx, 0)).toBe(placement.rect.x);
  });

  it("paradox/guiWidgetInfo names the value a local property overrides", async () => {
    const text =
      "template SmokeDeco { alpha = 0.25 }\n" + "widget = {\n\tusing = SmokeDeco\n\talpha = 0.9\n}\n";
    const info = (await conn.sendRequest(guiWidgetInfoRequest, {
      uri: "file:///smoke_override.gui",
      text,
      line: 1,
    })) as GuiWidgetInfo;
    const alpha = info.properties.find((p) => p.key === "alpha")!;
    expect(alpha.value).toBe("0.9");
    expect(alpha.overrides).toEqual([{ value: "0.25", origin: [{ kind: "template", name: "SmokeDeco" }] }]);
  });

  it("paradox/guiDependencies walks the widget's scripted_gui and loc keys", async () => {
    const result = (await conn.sendRequest(guiDependenciesRequest, {
      uri: toUri(guiPanelFile),
      text: GUI_PANEL_TXT,
      line: 2,
    })) as GuiDependenciesResult;
    expect(result.widget).toEqual({ key: "widget", name: "smoke_open_button", line: 2 });
    const [row] = result.scriptedGuis;
    expect(row.name).toBe("smoke_open_gui");
    expect(row.line).toBe(0);
    // The mod's own gui tree fed the store, so the count is tree-wide.
    expect(row.uses).toBe(1);
    // `trigger_event = smoke.1` sits in the scripted_gui's own effect block;
    // smoke.2 is one scripted-effect hop past it.
    expect(row.chains).toEqual([
      expect.objectContaining({ name: "smoke.1", kind: "event", via: [] }),
      expect.objectContaining({ name: "smoke.2", kind: "event", via: ["smoke_gui_effect"] }),
    ]);
    expect(result.locKeys).toEqual([
      expect.objectContaining({ key: "smoke.1.t", prop: "text", missing: false }),
      expect.objectContaining({ key: "smoke_absent_tip", prop: "tooltip", missing: true }),
    ]);
  });

  it("paradox/dependencies carries the reverse gui path only when guiUses is asked for", async () => {
    const plain = (await conn.sendRequest(dependenciesRequest, {
      name: "smoke.1",
      kind: "event",
    })) as DependenciesResult;
    expect(plain.guiUses).toBeUndefined();

    const withGui = (await conn.sendRequest(dependenciesRequest, {
      name: "smoke.1",
      kind: "event",
      guiUses: true,
    })) as DependenciesResult;
    expect(withGui.guiUses).toEqual([
      { file: guiPanelFile, line: 4, scriptedGui: "smoke_open_gui", via: [] },
    ]);
  });

  it("paradox/guiWidgetEdit produces an applicable position edit", async () => {
    const text = `widget = {\n\ticon = {\n\t\tposition = { 30 20 }\n\t\tsize = { 40 40 }\n\t}\n}`;
    const edit = (await conn.sendRequest(guiWidgetEditRequest, {
      uri: "file:///smoke.gui",
      text,
      line: 1,
      property: "position",
      values: [55, -5],
    })) as { start: number; end: number; newText: string } | null;
    expect(edit).not.toBeNull();
    const applied = text.slice(0, edit!.start) + edit!.newText + text.slice(edit!.end);
    expect(applied).toContain("position = { 55 -5 }");
    expect(applied).toContain("size = { 40 40 }");
  });
});

/**
 * The capability object (initializationOptions.client, PROTOCOL.md
 * §Initialization) over the same wire. It declares hover HTML WITHOUT any
 * command: a combination the deprecated `clientCommands: true` boolean above
 * cannot express, so this proves the capabilities are read and gated
 * independently rather than as one "is this VSCode" switch.
 */
describe.skipIf(!hasServer)("LSP smoke: client capability object", () => {
  let child: ChildProcess;
  let conn: MessageConnection;
  let modDir: string;
  let eventsUri: string;
  const statuses: StatusPayload[] = [];

  beforeAll(async () => {
    modDir = fs.mkdtempSync(path.join(os.tmpdir(), "ck3-smoke-caps-"));
    const fx = (rel: string, content: string) => {
      const full = path.join(modDir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, "utf8");
      return full;
    };
    fx("common/scripted_effects/smoke_effects.txt", EFFECTS_TXT);
    eventsUri = toUri(fx("events/smoke_events.txt", EVENTS_TXT));

    child = fork(SERVER, ["--node-ipc"], { stdio: ["ignore", "pipe", "pipe", "ipc"], silent: true });
    conn = createMessageConnection(new IPCMessageReader(child), new IPCMessageWriter(child));
    conn.onNotification(statusNotification, (p: StatusPayload) => {
      statuses.push(p);
    });
    conn.onNotification(() => undefined);
    conn.onRequest("window/workDoneProgress/create", () => null);
    conn.listen();

    await conn.sendRequest("initialize", {
      processId: process.pid,
      rootUri: toUri(modDir),
      workspaceFolders: [{ uri: toUri(modDir), name: "caps" }],
      capabilities: {},
      initializationOptions: {
        storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "ck3-smoke-caps-storage-")),
        wikidocsDir: WIKIDOCS,
        client: { hoverHtml: true, commands: [] },
        settings: {
          gamePath: null,
          logsPath: null,
          modPath: modDir,
          parentPaths: [],
          locLanguage: "english",
          scopeInlayHints: false,
          diagnosticsIgnore: [],
          diagnosticsIgnorePatterns: [],
          diagnosticsVanilla: false,
        },
      },
    });
    await conn.sendNotification("initialized", {});
    void conn.sendNotification("textDocument/didOpen", {
      textDocument: { uri: eventsUri, languageId: "paradox", version: 1, text: EVENTS_TXT },
    });

    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const latest = statuses[statuses.length - 1];
      if (latest && !latest.indexing && latest.definitions >= 2) break;
      await new Promise((r) => setTimeout(r, 100));
    }
  }, 30_000);

  afterAll(async () => {
    try {
      await conn.sendRequest("shutdown");
      void conn.sendNotification("exit");
    } catch {
      /* server may already be gone */
    }
    await new Promise((r) => setTimeout(r, 200));
    if (child && !child.killed) child.kill();
    fs.rmSync(modDir, { recursive: true, force: true });
  });

  it("hoverHtml without commands or fileLinks: spans stay, dead links and counts go", async () => {
    const hover = (await conn.sendRequest("textDocument/hover", {
      textDocument: { uri: eventsUri },
      position: { line: 6, character: 4 },
    })) as { contents: { value: string } } | null;
    expect(hover).not.toBeNull();
    const md = hover!.contents.value;
    expect(md).toContain("my_smoke_effect");
    expect(md).toContain("<span"); // client.hoverHtml
    expect(md).not.toContain("command:"); // client.commands is empty
    // A count nobody can click, and a link nobody can follow, both drop; the
    // provenance stays as a readable label.
    expect(md).not.toMatch(/reference/);
    expect(md).not.toContain("](file:");
    expect(md).toContain("smoke_effects.txt:2");
  });

  it("no snippetSupport declared: completion never ships `${`", async () => {
    const uri = toUri(path.join(modDir, "events", "caps_snippets.txt"));
    const text = "namespace = caps\n\ncaps.1 = {\n\ttype = character_event\n\timmediate = {\n\t\t\n\t}\n}\n";
    void conn.sendNotification("textDocument/didOpen", {
      textDocument: { uri, languageId: "paradox", version: 1, text },
    });
    const result = (await conn.sendRequest("textDocument/completion", {
      textDocument: { uri },
      position: { line: 5, character: 2 },
    })) as { items: Array<{ label: string; insertText?: string; insertTextFormat?: number }> };
    expect(result.items.find((i) => i.label === "my_smoke_effect")!.insertText).toBe("my_smoke_effect = yes");
    for (const item of result.items) {
      expect(item.insertTextFormat, item.label).toBeUndefined();
      expect(item.insertText ?? "", item.label).not.toContain("${");
    }
  });
});
