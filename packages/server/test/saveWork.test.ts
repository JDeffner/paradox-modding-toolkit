/**
 * What one Ctrl+S costs the server, over the real wire (perf campaign §B3/§B4).
 *
 * Before this phase a single save ran the file through THREE full passes — the
 * typing debounce's validate, the didSave validate, and the watcher's rescan —
 * fired one global semanticTokens + inlayHint refresh per index change even
 * while the initial scan was still running, and re-parsed the file once per
 * watcher event (a save produces several).
 *
 * The server is forked exactly like the client forks it, with `px.trace.perf`
 * on, so the assertions read the same `perf …` timeline a user would paste
 * into an issue.
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
import { modFileChangedNotification, statusNotification } from "@px-lsp/protocol/protocol";
import type { StatusPayload } from "@px-lsp/protocol/protocol";

const SERVER = path.join(__dirname, "..", "dist", "server.js");
const WIKIDOCS = path.join(__dirname, "..", "data", "ck3", "wikidocs");
const hasServer = fs.existsSync(SERVER);

const EFFECTS_TXT = `save_base_effect = {
	add_gold = 10
}
`;

const toUri = (p: string) => "file:///" + p.replace(/\\/g, "/").replace(/^\//, "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!hasServer)("the work one save costs (§B3/§B4)", () => {
  let child: ChildProcess;
  let conn: MessageConnection;
  let modDir: string;
  let effectsFile: string;
  let effectsUri: string;
  const logs: string[] = [];
  const statuses: StatusPayload[] = [];
  /** Whether the server was still indexing when it asked for a refresh. */
  const refreshWhileIndexing: boolean[] = [];

  const since = (mark: number) => logs.slice(mark);
  const count = (mark: number, re: RegExp) => since(mark).filter((l) => re.test(l)).length;

  beforeAll(async () => {
    modDir = fs.mkdtempSync(path.join(os.tmpdir(), "px-save-"));
    effectsFile = path.join(modDir, "common", "scripted_effects", "save_effects.txt");
    fs.mkdirSync(path.dirname(effectsFile), { recursive: true });
    fs.writeFileSync(effectsFile, EFFECTS_TXT, "utf8");
    effectsUri = toUri(effectsFile);

    child = fork(SERVER, ["--node-ipc"], { stdio: ["ignore", "pipe", "pipe", "ipc"], silent: true });
    conn = createMessageConnection(new IPCMessageReader(child), new IPCMessageWriter(child));
    conn.onNotification("window/logMessage", (p: { message: string }) => {
      logs.push(p.message);
    });
    conn.onNotification(statusNotification, (p: StatusPayload) => {
      statuses.push(p);
    });
    conn.onNotification(() => undefined);
    conn.onRequest((method: string) => {
      if (method.endsWith("/refresh"))
        refreshWhileIndexing.push(statuses[statuses.length - 1]?.indexing === true);
      return null;
    });
    conn.listen();

    await conn.sendRequest("initialize", {
      processId: process.pid,
      rootUri: toUri(modDir),
      workspaceFolders: [{ uri: toUri(modDir), name: "save" }],
      capabilities: {},
      initializationOptions: {
        storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "px-save-storage-")),
        wikidocsDir: WIKIDOCS,
        client: { ownFileWatcher: true },
        settings: {
          gamePath: null, // no vanilla scan: this measures the save path, not the boot
          logsPath: null,
          modPath: modDir,
          parentPaths: [],
          workspaceMods: [],
          locLanguage: "english",
          scopeInlayHints: false,
          diagnosticsIgnore: [],
          diagnosticsIgnorePatterns: [],
          diagnosticsVanilla: false,
          tracePerf: true,
        },
      },
    });
    await conn.sendNotification("initialized", {});
    void conn.sendNotification("textDocument/didOpen", {
      textDocument: { uri: effectsUri, languageId: "paradox", version: 1, text: EFFECTS_TXT },
    });
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const latest = statuses[statuses.length - 1];
      if (latest && !latest.indexing && latest.definitions >= 1) break;
      await sleep(50);
    }
    expect(statuses[statuses.length - 1]?.indexing).toBe(false);
  }, 30_000);

  afterAll(async () => {
    try {
      await conn.sendRequest("shutdown");
      void conn.sendNotification("exit");
    } catch {
      /* already gone */
    }
    await sleep(100);
    child?.kill();
    fs.rmSync(modDir, { recursive: true, force: true });
  });

  it("never fires a global refresh while the index is still building (§B4)", () => {
    // The refresh makes every visible editor re-request full-document tokens
    // and every server-backed view re-walk the index, which during a scan lands
    // behind an already-saturated event loop.
    expect(refreshWhileIndexing).not.toContain(true);
    // ...and the build's own final refresh did arrive.
    expect(refreshWhileIndexing.length).toBeGreaterThanOrEqual(1);
  });

  it("parses the saved file once, however many watcher events it produces (§B3)", async () => {
    const text = `${EFFECTS_TXT}\nsave_added_effect = {\n\tadd_prestige = 1\n}\n`;
    void conn.sendNotification("textDocument/didChange", {
      textDocument: { uri: effectsUri, version: 2 },
      contentChanges: [{ text }],
    });
    await sleep(450); // the typing debounce (300ms) validates here, as while typing
    fs.writeFileSync(effectsFile, text, "utf8");

    const mark = logs.length;
    void conn.sendNotification("textDocument/didSave", { textDocument: { uri: effectsUri } });
    // One save, several watcher events: the write, its metadata update, and one
    // per watcher root that contains the file.
    for (let i = 0; i < 3; i++)
      void conn.sendNotification(modFileChangedNotification, { fsPath: effectsFile });

    // Freshness guard: a request touching the index must see the save even
    // though the 150ms debounce has not fired yet.
    const symbols = (await conn.sendRequest("workspace/symbol", { query: "save_added_effect" })) as Array<{
      name: string;
    }>;
    expect(symbols.map((s) => s.name)).toContain("save_added_effect");

    await sleep(400);
    expect(count(mark, /perf rescan .*parse\+extract/), since(mark).join("\n")).toBe(1);
    // The typing debounce already validated this exact version against this
    // exact index, so the save does not redo it.
    expect(count(mark, /perf validate /), since(mark).join("\n")).toBe(0);
    expect(count(mark, /already validated/)).toBe(1);
  });

  it("skips the rescan when the watcher reports unchanged bytes (§B3)", async () => {
    const mark = logs.length;
    void conn.sendNotification(modFileChangedNotification, { fsPath: effectsFile });
    await sleep(400);
    expect(count(mark, /perf rescan .*unchanged bytes, skipped/)).toBe(1);
    expect(count(mark, /perf rescan .*parse\+extract/)).toBe(0);
  });
});
