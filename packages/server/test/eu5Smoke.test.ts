/**
 * Europa Universalis V profile smoke test: spawn the packaged server bundle
 * over --stdio with `settings.gameId = "eu5"` against a fixture EU5 mod
 * (.metadata descriptor, everything under the in_game/ load-stage root,
 * a BOM'd file whose definitions carry `REPLACE:` entry-mode prefixes) and
 * prove the preview bar end-to-end: indexing, completion, definition and
 * structural diagnostics under the EU5 profile — with the eu5-script
 * diagnostic source, and no CK3 wiki-token fallback (EU5 bundles none).
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

const METADATA_JSON = JSON.stringify(
  {
    name: "EU5 Smoke Mod",
    id: "eu5-smoke",
    version: "1",
    supported_game_version: "1.3.*",
    short_description: "fixture",
    tags: [],
    relationships: [],
  },
  null,
  2
);

// Leading BOM plus a REPLACE:-prefixed definition — exactly how real EU5 mods
// override a vanilla database entry (the MEIOU corpus does both at once).
const EFFECTS_TXT = `﻿my_eu5_effect = {
	set_variable = eu5_smoke_var
}

REPLACE:vanilla_eu5_effect = {
	set_variable = eu5_smoke_other
}
`;

const EVENTS_TXT = `namespace = eu5smoke

eu5smoke.1 = {
	immediate = {
		my_eu5_effect = yes
		vanilla_eu5_effect = yes
	}
}
`;

const LOC_YML = `﻿l_english:
 eu5smoke.1.t:0 "Smoke Event"
 eu5smoke.1.desc:0 "Smoke description"
`;

const BROKEN_TXT = `broken_effect = {
	set_variable = x
`;

function toUri(p: string): string {
  return "file:///" + p.replace(/\\/g, "/").replace(/^\//, "");
}

describe.skipIf(!hasServer)("EU5 profile smoke over --stdio (gameId = eu5)", () => {
  let child: ChildProcess;
  let conn: MessageConnection;
  let modDir: string;
  let eventsUri: string;
  let brokenUri: string;
  let exited: Promise<number | null>;
  const statuses: StatusPayload[] = [];
  const diagnostics = new Map<string, Array<{ source?: string; code?: string }>>();

  beforeAll(async () => {
    modDir = fs.mkdtempSync(path.join(os.tmpdir(), "eu5-smoke-"));
    const fx = (rel: string, content: string) => {
      const full = path.join(modDir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, "utf8");
      return full;
    };
    fx(".metadata/metadata.json", METADATA_JSON);
    fx("in_game/common/scripted_effects/fx.txt", EFFECTS_TXT);
    fx("in_game/localization/english/fixture_l_english.yml", LOC_YML);
    const eventsFile = fx("in_game/events/smoke_events.txt", EVENTS_TXT);
    const brokenFile = fx("in_game/common/scripted_effects/broken.txt", BROKEN_TXT);
    eventsUri = toUri(eventsFile);
    brokenUri = toUri(brokenFile);

    child = spawn(process.execPath, [SERVER, "--stdio"], { stdio: ["pipe", "pipe", "pipe"] });
    exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
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
      workspaceFolders: [{ uri: toUri(modDir), name: "eu5-smoke" }],
      capabilities: {},
      initializationOptions: { settings: { gameId: "eu5" } },
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

  it("indexes the in_game/ schema folders (effects, event, loc keys)", () => {
    const latest = statuses[statuses.length - 1];
    expect(latest).toBeDefined();
    // 2 effects + broken_effect + event + 2 loc keys (+ implicit variable defs).
    expect(latest.definitions).toBeGreaterThan(0);
    expect(latest.definitions).toBeGreaterThanOrEqual(4);
  });

  it("bundles no wiki-token fallback for EU5 (cut line)", () => {
    const latest = statuses[statuses.length - 1];
    expect(latest.tokens).toBe(0);
    expect(latest.tokensFromScriptDocs).toBe(false);
  });

  it("completion offers both the plain and the REPLACE:-prefixed effect, stripped", async () => {
    const result = (await conn.sendRequest("textDocument/completion", {
      textDocument: { uri: eventsUri },
      position: { line: 4, character: 2 },
    })) as { items: Array<{ label: string }> };
    const labels = result.items.map((i) => i.label);
    expect(labels).toContain("my_eu5_effect");
    // The entry mode is stripped before indexing: the bare name is offered and
    // the prefixed spelling never leaks into completion.
    expect(labels).toContain("vanilla_eu5_effect");
    expect(labels).not.toContain("REPLACE:vanilla_eu5_effect");
  });

  it("definition jumps from the call site to the scripted effect", async () => {
    const result = (await conn.sendRequest("textDocument/definition", {
      textDocument: { uri: eventsUri },
      position: { line: 4, character: 5 },
    })) as Array<{ uri: string }>;
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].uri.toLowerCase()).toContain("fx.txt");
  });

  it("definition resolves a call to the REPLACE:-declared effect by its bare name", async () => {
    const result = (await conn.sendRequest("textDocument/definition", {
      textDocument: { uri: eventsUri },
      position: { line: 5, character: 5 },
    })) as Array<{ uri: string }>;
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].uri.toLowerCase()).toContain("fx.txt");
  });

  it("reports structural diagnostics with the eu5-script source", () => {
    const reported = diagnostics.get(brokenUri) ?? [];
    const unclosed = reported.find((d) => d.code === "unclosed-brace");
    expect(unclosed).toBeDefined();
    expect(unclosed?.source).toBe("eu5-script");
  });

  it("shuts down cleanly", async () => {
    await conn.sendRequest("shutdown");
    void conn.sendNotification("exit");
    const code = await Promise.race([exited, new Promise<null>((r) => setTimeout(() => r(null), 5000))]);
    expect(code).toBe(0);
  });
});
