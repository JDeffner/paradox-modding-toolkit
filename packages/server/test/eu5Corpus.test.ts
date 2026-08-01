/**
 * EU5 mod-corpus smoke over --stdio. Gated on the configured EU5 corpusPath
 * (env `PX_EU5_MOD_CORPUS`, or dev-paths.json `games.eu5.modCorpus`; see
 * scripts/devPaths.ts) AND on dist/server.js existing — skipped when either is
 * missing. Points the server at a real third-party EU5 mod and asserts it
 * survives the tree: no crash, a real definition yield, and (when the corpus
 * uses them) `REPLACE:`-prefixed database entries indexed under their bare
 * names.
 *
 * Run (Git Bash):
 *   PX_EU5_MOD_CORPUS='<path to an EU5 mod>' npx vitest run test/eu5Corpus.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from "vscode-jsonrpc/node";
import { statusNotification, type StatusPayload } from "@px-lsp/protocol/protocol";
import { devPath } from "../../../scripts/devPaths";

const SERVER = process.env.PX_LSP_SERVER ?? path.join(__dirname, "..", "dist", "server.js");
const CORPUS = devPath("corpusPath", "eu5");
const run = CORPUS && fs.existsSync(SERVER) && fs.existsSync(CORPUS);

function toUri(p: string): string {
  return "file:///" + p.replace(/\\/g, "/").replace(/^\//, "");
}

/** First `MODE:name = {` definition key found under the corpus's common/ trees. */
function findEntryModeDefinition(root: string): string | null {
  const stack = [root];
  const re =
    /^﻿?(?:REPLACE|INJECT|TRY_INJECT|TRY_REPLACE|INJECT_OR_CREATE|REPLACE_OR_CREATE):([a-z0-9_]+)\s*=/im;
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.name.toLowerCase().endsWith(".txt") && full.includes(`${path.sep}common${path.sep}`)) {
        const m = re.exec(fs.readFileSync(full, "utf8"));
        if (m) return m[1];
      }
    }
  }
  return null;
}

describe.skipIf(!run)("EU5 mod corpus over --stdio", () => {
  let child: ChildProcess;
  let conn: MessageConnection;
  let exited: Promise<number | null>;
  const statuses: StatusPayload[] = [];

  beforeAll(async () => {
    child = spawn(process.execPath, [SERVER, "--stdio"], { stdio: ["pipe", "pipe", "pipe"] });
    exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
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
      rootUri: toUri(CORPUS!),
      workspaceFolders: [{ uri: toUri(CORPUS!), name: "eu5-corpus" }],
      capabilities: {},
      initializationOptions: { settings: { gameId: "eu5" } },
    });
    await conn.sendNotification("initialized", {});

    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const latest = statuses[statuses.length - 1];
      if (latest && !latest.indexing && latest.definitions > 0) break;
      await new Promise((r) => setTimeout(r, 200));
    }
  }, 150_000);

  afterAll(() => {
    if (child && !child.killed) child.kill();
  });

  it("indexes the corpus without crashing", () => {
    expect(child.exitCode).toBeNull();
    const latest = statuses[statuses.length - 1];
    expect(latest).toBeDefined();
    console.log(`\n[eu5-corpus] definitions: ${latest.definitions}, tokens: ${latest.tokens}`);
    expect(latest.definitions).toBeGreaterThan(100);
  });

  it("indexes entry-mode-prefixed definitions under their bare names", async () => {
    const name = findEntryModeDefinition(CORPUS!);
    if (!name) return; // corpus does not use entry modes — nothing to prove.
    const symbols = (await conn.sendRequest("workspace/symbol", { query: name })) as Array<{
      name: string;
    }>;
    console.log(`[eu5-corpus] entry-mode sample: ${name} -> ${symbols.length} symbol(s)`);
    expect(symbols.some((s) => s.name === name)).toBe(true);
  }, 30_000);

  it("shuts down cleanly", async () => {
    await conn.sendRequest("shutdown");
    void conn.sendNotification("exit");
    const code = await Promise.race([exited, new Promise<null>((r) => setTimeout(() => r(null), 5000))]);
    expect(code).toBe(0);
  });
});
