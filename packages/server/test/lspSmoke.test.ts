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
  guiLayoutRequest,
  guiTreeRequest,
  guiWidgetEditRequest,
  scopeAtRequest,
  statusNotification,
  type ScopeAtResult,
  type StatusPayload,
} from "@px-lsp/protocol/protocol";

const SERVER = path.join(__dirname, "..", "dist", "server.js");
const WIKIDOCS = path.join(__dirname, "..", "data", "ck3", "wikidocs");
const hasServer = fs.existsSync(SERVER);
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

const GUI_TXT = `widget = {
	name = "smoke_root"
	flowcontainer = {
		name = "inner"
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
  " smoke.1.desc:0 \"Hi [ROOT.Char.Custom2('SmokeCustom', scope:host)]\"\n";

function toUri(p: string): string {
  return "file:///" + p.replace(/\\/g, "/").replace(/^\//, "");
}

describe.skipIf(!hasServer)("LSP smoke over node IPC (the client's transport)", () => {
  let child: ChildProcess;
  let conn: MessageConnection;
  let modDir: string;
  let parentDir: string;
  let eventsFile: string;
  let eventsUri: string;
  let locFile: string;
  let locUri: string;
  let initResult: { serverInfo?: { name: string; version: string } };
  const statuses: StatusPayload[] = [];

  beforeAll(async () => {
    modDir = fs.mkdtempSync(path.join(os.tmpdir(), "ck3-smoke-"));
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ck3-smoke-parent-"));
    const fxIn = (root: string, rel: string, content: string) => {
      const full = path.join(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, "utf8");
      return full;
    };
    const fx = (rel: string, content: string) => fxIn(modDir, rel, content);
    fxIn(parentDir, "common/scripted_effects/parent_effects.txt", PARENT_EFFECTS_TXT);
    fxIn(parentDir, "events/parent_events.txt", PARENT_EVENTS_TXT);
    fx("common/scripted_effects/smoke_effects.txt", EFFECTS_TXT);
    eventsFile = fx("events/smoke_events.txt", EVENTS_TXT);
    fx("common/customizable_localization/smoke_cloc.txt", CLOC_TXT);
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
      capabilities: {},
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
          parentPaths: [parentDir],
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

  it("completion offers the parent-mod effect", async () => {
    const result = (await conn.sendRequest("textDocument/completion", {
      textDocument: { uri: eventsUri },
      position: { line: 6, character: 2 },
    })) as { items: Array<{ label: string }> };
    expect(result.items.map((i) => i.label)).toContain("my_parent_effect");
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

  it("hoverHtml without commands: sanitized spans, references footer as plain text", async () => {
    const hover = (await conn.sendRequest("textDocument/hover", {
      textDocument: { uri: eventsUri },
      position: { line: 6, character: 4 },
    })) as { contents: { value: string } } | null;
    expect(hover).not.toBeNull();
    const md = hover!.contents.value;
    expect(md).toContain("my_smoke_effect");
    expect(md).toContain("<span"); // client.hoverHtml
    expect(md).toMatch(/\d+ reference/);
    expect(md).not.toContain("command:"); // client.commands is empty
  });
});
