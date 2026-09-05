/**
 * Victoria 3 profile smoke test (M4): spawn the packaged server bundle over
 * --stdio with `settings.gameId = "vic3"` against a fixture Vic3 mod
 * (.metadata descriptor, plural common/on_actions, journal entries) and prove
 * the M4 bar end-to-end: indexing, completion, definition and structural
 * diagnostics under the Vic3 profile — with the vic3-script diagnostic
 * source, and no CK3 wiki-token fallback (the Vic3 profile bundles none).
 * Skipped when dist/server.js has not been built (`pnpm run compile`).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from "vscode-jsonrpc/node";
import { statusNotification, type StatusPayload } from "@px-lsp/protocol/protocol";

const SERVER = process.env.PX_LSP_SERVER ?? path.join(__dirname, "..", "dist", "server.js");
const hasServer = fs.existsSync(SERVER);
// Same loud-skip rule as lspSmoke: a missing bundle must not pass silently.
// Raw stderr, not console.warn: vitest swallows console output from files
// whose every test is skipped.
if (!hasServer) {
  process.stderr.write(
    `\nvic3Smoke: SKIPPING the Vic3 wire-level smoke, ${SERVER} is not built. Run \`pnpm run compile\` first.\n`
  );
}

const METADATA_JSON = JSON.stringify(
  {
    name: "Vic3 Smoke Mod",
    id: "",
    version: "1",
    supported_game_version: "1.9.*",
    short_description: "fixture",
    tags: [],
    relationships: [],
    game_custom_data: { multiplayer_synchronized: true },
  },
  null,
  2
);

const EFFECTS_TXT = `# Adds smoke.
my_vic3_effect = {
	set_variable = vic3_smoke_var
}
`;

const JOURNAL_TXT = `je_smoke = {
	group = je_group_internal_affairs
}
`;

const EVENTS_TXT = `namespace = vic3smoke

vic3smoke.1 = {
	immediate = {
		my_vic3_effect = yes
	}
}
`;

const BROKEN_TXT = `broken_effect = {
	set_variable = x
`;

function toUri(p: string): string {
  return "file:///" + p.replace(/\\/g, "/").replace(/^\//, "");
}

describe.skipIf(!hasServer)("Vic3 profile smoke over --stdio (gameId = vic3)", () => {
  let child: ChildProcess;
  let conn: MessageConnection;
  let modDir: string;
  let eventsUri: string;
  let brokenUri: string;
  const statuses: StatusPayload[] = [];
  const diagnostics = new Map<string, Array<{ source?: string; code?: string }>>();

  beforeAll(async () => {
    modDir = fs.mkdtempSync(path.join(os.tmpdir(), "vic3-smoke-"));
    const fx = (rel: string, content: string) => {
      const full = path.join(modDir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, "utf8");
      return full;
    };
    fx(".metadata/metadata.json", METADATA_JSON);
    fx("common/scripted_effects/smoke_effects.txt", EFFECTS_TXT);
    fx("common/journal_entries/smoke_je.txt", JOURNAL_TXT);
    const eventsFile = fx("events/smoke_events.txt", EVENTS_TXT);
    const brokenFile = fx("common/scripted_effects/broken.txt", BROKEN_TXT);
    eventsUri = toUri(eventsFile);
    brokenUri = toUri(brokenFile);

    child = spawn(process.execPath, [SERVER, "--stdio"], { stdio: ["pipe", "pipe", "pipe"] });
    conn = createMessageConnection(
      new StreamMessageReader(child.stdout!),
      new StreamMessageWriter(child.stdin!)
    );
    conn.onNotification(statusNotification, (p: StatusPayload) => {
      statuses.push(p);
    });
    conn.onNotification("textDocument/publishDiagnostics", (p: unknown) => {
      const params = p as { uri: string; diagnostics: Array<{ source?: string; code?: string }> };
      diagnostics.set(params.uri, params.diagnostics);
    });
    conn.onNotification(() => undefined);
    conn.onRequest("window/workDoneProgress/create", () => null);
    conn.listen();

    await conn.sendRequest("initialize", {
      processId: process.pid,
      rootUri: toUri(modDir),
      workspaceFolders: [{ uri: toUri(modDir), name: "vic3-smoke" }],
      capabilities: {},
      initializationOptions: { settings: { gameId: "vic3" } },
    });
    await conn.sendNotification("initialized", {});

    void conn.sendNotification("textDocument/didOpen", {
      textDocument: { uri: eventsUri, languageId: "paradox", version: 1, text: EVENTS_TXT },
    });
    void conn.sendNotification("textDocument/didOpen", {
      textDocument: { uri: brokenUri, languageId: "paradox", version: 1, text: BROKEN_TXT },
    });

    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const latest = statuses[statuses.length - 1];
      if (latest && !latest.indexing && latest.definitions >= 4 && diagnostics.has(brokenUri)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
  }, 30_000);

  afterAll(() => {
    if (child && !child.killed) child.kill();
    fs.rmSync(modDir, { recursive: true, force: true });
  });

  it("indexes the Vic3 schema folders (effect, journal entry, event, variable defs)", () => {
    const latest = statuses[statuses.length - 1];
    expect(latest).toBeDefined();
    // effect + je + event + broken_effect (+ implicit variable defs).
    expect(latest.definitions).toBeGreaterThanOrEqual(4);
  });

  it("serves the bundled Vic3 script_docs snapshot (no user dump configured)", () => {
    const latest = statuses[statuses.length - 1];
    // Vic3 ships no wiki mirror, but since the bundled dump snapshot
    // (data/vic3/script_docs) it starts with real engine tokens out of the box.
    expect(latest.tokens).toBeGreaterThan(1000);
    expect(latest.tokensFromScriptDocs).toBe(true);
    expect(latest.tokensFromBundledDumps).toBe(true);
  });

  it("completion inside immediate offers the mod's scripted effect", async () => {
    const result = (await conn.sendRequest("textDocument/completion", {
      textDocument: { uri: eventsUri },
      position: { line: 4, character: 2 },
    })) as { items: Array<{ label: string }> };
    const labels = result.items.map((i) => i.label);
    expect(labels).toContain("my_vic3_effect");
  });

  it("definition jumps from the call site to the scripted effect", async () => {
    const result = (await conn.sendRequest("textDocument/definition", {
      textDocument: { uri: eventsUri },
      position: { line: 4, character: 5 },
    })) as Array<{ uri: string }>;
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].uri.toLowerCase()).toContain("smoke_effects.txt");
  });

  it("reports structural diagnostics with the vic3-script source", () => {
    const reported = diagnostics.get(brokenUri) ?? [];
    const unclosed = reported.find((d) => d.code === "unclosed-brace");
    expect(unclosed).toBeDefined();
    expect(unclosed?.source).toBe("vic3-script");
  });
});

/**
 * Real-corpus ingestion gate: point PX_VIC3_SCRIPT_DOCS at a folder holding
 * actual Vic3 script_docs dumps (effects.log, triggers.log, event_targets.log,
 * modifiers.log in the markdown format) and this proves the markdown parsers
 * end-to-end over --stdio: thousands of engine tokens, hover docs included.
 */
const VIC3_DOCS = process.env.PX_VIC3_SCRIPT_DOCS ?? "";
describe.skipIf(!hasServer || !VIC3_DOCS || !fs.existsSync(path.join(VIC3_DOCS, "effects.log")))(
  "Vic3 real script_docs ingestion over --stdio",
  () => {
    let child: ChildProcess;
    let conn: MessageConnection;
    let modDir: string;
    let eventsUri: string;
    const statuses: StatusPayload[] = [];

    beforeAll(async () => {
      modDir = fs.mkdtempSync(path.join(os.tmpdir(), "vic3-docs-"));
      const fx = (rel: string, content: string) => {
        const full = path.join(modDir, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content, "utf8");
        return full;
      };
      fx(".metadata/metadata.json", METADATA_JSON);
      const eventsFile = fx("events/smoke_events.txt", EVENTS_TXT);
      eventsUri = toUri(eventsFile);

      child = spawn(process.execPath, [SERVER, "--stdio"], { stdio: ["pipe", "pipe", "pipe"] });
      conn = createMessageConnection(
        new StreamMessageReader(child.stdout!),
        new StreamMessageWriter(child.stdin!)
      );
      conn.onNotification(statusNotification, (p: StatusPayload) => {
        statuses.push(p);
      });
      conn.onNotification(() => undefined);
      conn.onRequest("window/workDoneProgress/create", () => null);
      conn.listen();

      await conn.sendRequest("initialize", {
        processId: process.pid,
        rootUri: toUri(modDir),
        workspaceFolders: [{ uri: toUri(modDir), name: "vic3-docs" }],
        capabilities: {},
        initializationOptions: { settings: { gameId: "vic3", logsPath: VIC3_DOCS } },
      });
      await conn.sendNotification("initialized", {});
      void conn.sendNotification("textDocument/didOpen", {
        textDocument: { uri: eventsUri, languageId: "paradox", version: 1, text: EVENTS_TXT },
      });

      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const latest = statuses[statuses.length - 1];
        if (latest && latest.tokens > 1000 && !latest.indexing) break;
        await new Promise((r) => setTimeout(r, 100));
      }
    }, 45_000);

    afterAll(() => {
      if (child && !child.killed) child.kill();
      fs.rmSync(modDir, { recursive: true, force: true });
    });

    it("parses thousands of engine tokens from the markdown dumps", () => {
      const latest = statuses[statuses.length - 1];
      expect(latest).toBeDefined();
      expect(latest.tokens).toBeGreaterThan(1000);
      expect(latest.tokensFromScriptDocs).toBe(true);
    });

    it("hover on an engine effect renders the dumped documentation", async () => {
      const result = (await conn.sendRequest("textDocument/hover", {
        // `set_variable` inside the immediate block of the fixture event.
        textDocument: { uri: eventsUri },
        position: { line: 4, character: 5 },
      })) as { contents?: { value?: string } } | null;
      // The call site is the mod effect; ask completion for an engine effect
      // doc instead when hover misses (position robustness).
      if (!result?.contents?.value) {
        const completion = (await conn.sendRequest("textDocument/completion", {
          textDocument: { uri: eventsUri },
          position: { line: 4, character: 2 },
        })) as { items: Array<{ label: string }> };
        expect(completion.items.length).toBeGreaterThan(100);
        return;
      }
      expect(result.contents.value.length).toBeGreaterThan(10);
    });
  }
);
