/**
 * The size-triggered crash class (perf campaign §B1).
 *
 * `target.push(...source)` passes one argument per element, so it throws
 * `RangeError: Maximum call stack size exceeded` past ~125k elements (measured
 * here, node 24, default stack). The index paths spread whole files and whole
 * roots into an accumulator: the engine+vanilla scan already carries ~460k
 * definitions, and one generated mod file can carry six figures on its own, so
 * this was a crash waiting for a big enough workspace. Nothing else in the
 * suite is big enough to reach the ceiling.
 *
 * The first test asserts BOTH halves: the old expression still throws at this
 * fixture size (so the fixture proves something, and shrinking it fails here),
 * and the real scan path returns every definition. The second runs the same
 * root through the packaged server, which is the path the field reports hit.
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
import type { Definition } from "@px-lsp/protocol/types";
import { statusNotification, type StatusPayload } from "@px-lsp/protocol/protocol";
import { DefinitionIndex, scanRoot } from "../src/index/indexer";

/** Twice the measured ~125k argument ceiling, so a bigger stack cannot hide the bug. */
const DEFS = 250_000;

const SERVER = path.join(__dirname, "..", "dist", "server.js");
const WIKIDOCS = path.join(__dirname, "..", "data", "ck3", "wikidocs");
const hasServer = fs.existsSync(SERVER);
if (!hasServer) {
  process.stderr.write(
    `\nlargeRootScan: SKIPPING the forked half, ${SERVER} is not built. Run \`pnpm run compile\` first.\n`
  );
}

let root = "";
let storageDir = "";

/** One synthetic mod whose single file holds every definition. */
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "px-b1-"));
  storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "px-b1-storage-"));
  fs.writeFileSync(
    path.join(root, "descriptor.mod"),
    'version="1.0"\nname="b1_large"\nsupported_version="1.16.*"\n',
    "utf8"
  );
  const dir = path.join(root, "common", "scripted_effects");
  fs.mkdirSync(dir, { recursive: true });
  const lines: string[] = [];
  for (let i = 0; i < DEFS; i++) lines.push(`b1_effect_${i} = {\n\tadd_gold = 1\n}`);
  fs.writeFileSync(path.join(dir, "generated.txt"), lines.join("\n") + "\n", "utf8");
});

afterAll(() => {
  for (const dir of [root, storageDir]) fs.rmSync(dir, { recursive: true, force: true });
});

function toUri(p: string): string {
  return "file:///" + p.replace(/\\/g, "/").replace(/^\//, "");
}

async function waitFor(done: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (done()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return done();
}

describe("large-root scan (§B1)", () => {
  it("scans a root whose file alone exceeds the spread-argument ceiling", () => {
    const defs = scanRoot(root, "mod", { locLanguage: "english" });
    expect(defs.length).toBe(DEFS);

    // Revert guard: this IS the expression the fix replaced. If it ever stops
    // throwing, the fixture no longer proves the ceiling is gone.
    expect(() => {
      const out: Definition[] = [];
      out.push(...defs);
    }).toThrow(RangeError);

    const index = new DefinitionIndex();
    index.addAll(defs);
    expect(index.stats().total).toBe(DEFS);
    expect(index.allDefinitions().length).toBe(DEFS);
  }, 120_000);

  it.skipIf(!hasServer)(
    "the packaged server indexes it without a fatal",
    async () => {
      const child: ChildProcess = fork(SERVER, ["--node-ipc"], {
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        silent: true,
      });
      const output: string[] = [];
      let exited = false;
      child.stderr?.on("data", (b: Buffer) => output.push(b.toString()));
      child.on("exit", () => {
        exited = true;
      });
      const statuses: StatusPayload[] = [];
      const conn: MessageConnection = createMessageConnection(
        new IPCMessageReader(child),
        new IPCMessageWriter(child)
      );
      conn.onNotification("window/logMessage", (p: { message: string }) => {
        output.push(p.message);
      });
      conn.onNotification(statusNotification, (p: StatusPayload) => {
        statuses.push(p);
      });
      conn.onNotification(() => undefined);
      conn.onRequest("window/workDoneProgress/create", () => null);
      conn.listen();
      try {
        await conn.sendRequest("initialize", {
          processId: process.pid,
          rootUri: toUri(root),
          workspaceFolders: [{ uri: toUri(root), name: "b1" }],
          capabilities: {},
          initializationOptions: {
            storageDir,
            wikidocsDir: WIKIDOCS,
            settings: {
              gamePath: null, // the size is in the mod root; no game needed
              logsPath: null,
              modPath: root,
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

        const indexed = await waitFor(() => statuses.some((p) => !p.indexing), 180_000);
        // The status flips in the scan's `finally`, one turn before a rejection
        // reaches the §A1 catch: let any failure line land before reading them.
        await new Promise((r) => setTimeout(r, 500));
        const text = output.join("\n");
        expect(indexed, `never finished indexing:\n${text}`).toBe(true);
        expect(text).not.toContain("FATAL");
        expect(text).not.toContain("index build failed");
        expect(exited).toBe(false);
        const stats = (await conn.sendRequest("paradox/indexStats")) as { total: number };
        expect(stats.total).toBe(DEFS);
      } finally {
        conn.dispose();
        child.kill();
      }
    },
    240_000
  );
});
