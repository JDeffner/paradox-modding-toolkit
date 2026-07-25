/**
 * Standalone-transport smoke test (M1.5): spawn the packaged server bundle
 * with `--stdio` — the transport every non-VSCode editor (neovim, Zed, the
 * Studio) uses — and drive the bare-client flow: initialize, didOpen,
 * completion, shutdown.
 *
 * Deliberately passes NO initializationOptions, so what this test proves is
 * the server-side fallbacks a plain editor relies on:
 *  - modPath     <- first workspace folder,
 *  - wikidocsDir <- data/ck3/ next to the bundle (tokens > 500 in status),
 *  - storageDir  <- os tmpdir.
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

// PX_LSP_SERVER overrides the bundle under test — used to smoke the
// extracted release tarball with the exact same flow.
const SERVER = process.env.PX_LSP_SERVER ?? path.join(__dirname, "..", "dist", "server.js");
const hasServer = fs.existsSync(SERVER);

const EFFECTS_TXT = `# Grants a stipend.
my_stdio_effect = {
	add_gold = 5
}
`;

const EVENTS_TXT = `namespace = stdio

stdio.1 = {
	immediate = {
		my_stdio_effect = yes
	}
}
`;

function toUri(p: string): string {
  return "file:///" + p.replace(/\\/g, "/").replace(/^\//, "");
}

describe.skipIf(!hasServer)("LSP smoke over --stdio with bare-client fallbacks", () => {
  let child: ChildProcess;
  let conn: MessageConnection;
  let modDir: string;
  let eventsUri: string;
  let exited: Promise<number | null>;
  const statuses: StatusPayload[] = [];

  beforeAll(async () => {
    modDir = fs.mkdtempSync(path.join(os.tmpdir(), "ck3-stdio-smoke-"));
    const fx = (rel: string, content: string) => {
      const full = path.join(modDir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, "utf8");
      return full;
    };
    fx("common/scripted_effects/stdio_effects.txt", EFFECTS_TXT);
    const eventsFile = fx("events/stdio_events.txt", EVENTS_TXT);
    eventsUri = toUri(eventsFile);

    child = spawn(process.execPath, [SERVER, "--stdio"], { stdio: ["pipe", "pipe", "pipe"] });
    exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
    conn = createMessageConnection(
      new StreamMessageReader(child.stdout!),
      new StreamMessageWriter(child.stdin!)
    );
    conn.onNotification(statusNotification, (p: StatusPayload) => {
      statuses.push(p);
    });
    conn.onNotification(() => undefined); // swallow diagnostics / logMessage
    conn.onRequest("window/workDoneProgress/create", () => null);
    conn.listen();

    // A minimal client: workspace folder, no initializationOptions at all.
    const init = await conn.sendRequest("initialize", {
      processId: process.pid,
      rootUri: toUri(modDir),
      workspaceFolders: [{ uri: toUri(modDir), name: "stdio-smoke" }],
      capabilities: {},
    });
    expect(
      (init as { capabilities: { completionProvider: { resolveProvider: boolean } } }).capabilities
        .completionProvider.resolveProvider
    ).toBe(true);
    await conn.sendNotification("initialized", {});

    void conn.sendNotification("textDocument/didOpen", {
      textDocument: { uri: eventsUri, languageId: "paradox", version: 1, text: EVENTS_TXT },
    });

    // Wait until the fallback-derived mod index picked up the fixture definitions.
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const latest = statuses[statuses.length - 1];
      if (latest && !latest.indexing && latest.definitions >= 2) break;
      await new Promise((r) => setTimeout(r, 100));
    }
  }, 30_000);

  afterAll(() => {
    if (child && !child.killed) child.kill();
    fs.rmSync(modDir, { recursive: true, force: true });
  });

  it("indexed the workspace folder via the modPath fallback, wiki tokens via the bundle fallback", () => {
    const latest = statuses[statuses.length - 1];
    expect(latest).toBeDefined();
    expect(latest.tokens).toBeGreaterThan(500); // bundled wikidocs found next to dist/
    expect(latest.definitions).toBeGreaterThanOrEqual(2); // effect + event from the workspace folder
  });

  it("completion inside immediate offers the mod effect and engine effects", async () => {
    const result = (await conn.sendRequest("textDocument/completion", {
      textDocument: { uri: eventsUri },
      position: { line: 4, character: 2 },
    })) as { items: Array<{ label: string }> };
    expect(Array.isArray(result.items)).toBe(true);
    const labels = result.items.map((i) => i.label);
    expect(labels).toContain("my_stdio_effect");
    expect(labels).toContain("save_scope_as");
  });

  it("shuts down cleanly over stdio", async () => {
    await conn.sendRequest("shutdown");
    void conn.sendNotification("exit");
    const code = await Promise.race([exited, new Promise<null>((r) => setTimeout(() => r(null), 5000))]);
    expect(code).toBe(0);
  });
});
