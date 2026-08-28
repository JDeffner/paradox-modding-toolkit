/**
 * Crash visibility (perf campaign §A1). A throw on the scan path used to leave
 * nothing behind: the server died (or came up with an empty index), the client
 * restarted it silently, and every LSP-backed feature stayed dead while
 * TextMate highlighting kept working — the "only syntax highlighting" reports.
 *
 * Both halves are proven against the PACKAGED bundle over the client's own
 * transport, with the fault injected through PX_FAULT_SCAN (server.ts, unset in
 * every real client):
 *   - "sync": the scan rejects buildIndex, the .catch logs it, the server LIVES;
 *   - "async": the scan throws from a timer, which is the process-killing shape,
 *     and the uncaughtException handler logs it before the exit.
 * In both cases the log line must be attributable: it carries a stack that
 * names the scan.
 */
import { afterEach, describe, expect, it } from "vitest";
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
import { statusNotification, type StatusPayload } from "@px-lsp/protocol/protocol";

const SERVER = path.join(__dirname, "..", "dist", "server.js");
const WIKIDOCS = path.join(__dirname, "..", "data", "ck3", "wikidocs");
const hasServer = fs.existsSync(SERVER);
if (!hasServer) {
  process.stderr.write(
    `\ncrashVisibility: SKIPPING, ${SERVER} is not built. Run \`pnpm run compile\` first.\n`
  );
}

function toUri(p: string): string {
  return "file:///" + p.replace(/\\/g, "/").replace(/^\//, "");
}

interface Session {
  child: ChildProcess;
  conn: MessageConnection;
  /** Everything the server said: window/logMessage plus raw stderr. */
  output: string[];
  exitCode: number | null;
  exited: boolean;
  statuses: StatusPayload[];
  /** Temp dirs to remove after the test. */
  temp: string[];
}

async function startFaultyServer(mode: string): Promise<Session> {
  const modDir = fs.mkdtempSync(path.join(os.tmpdir(), "px-crash-"));
  fs.mkdirSync(path.join(modDir, "common", "scripted_effects"), { recursive: true });
  fs.writeFileSync(
    path.join(modDir, "common", "scripted_effects", "e.txt"),
    "crash_probe_effect = {\n\tadd_gold = 1\n}\n",
    "utf8"
  );

  const child = fork(SERVER, ["--node-ipc"], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    silent: true,
    env: { ...process.env, PX_FAULT_SCAN: mode },
  });
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "px-crash-storage-"));
  const session: Session = {
    child,
    conn: null!,
    output: [],
    exitCode: null,
    exited: false,
    statuses: [],
    temp: [modDir, storageDir],
  };
  child.stderr?.on("data", (b: Buffer) => session.output.push(b.toString()));
  child.on("exit", (code) => {
    session.exited = true;
    session.exitCode = code;
  });

  const conn = createMessageConnection(new IPCMessageReader(child), new IPCMessageWriter(child));
  session.conn = conn;
  conn.onNotification("window/logMessage", (p: { message: string }) => {
    session.output.push(p.message);
  });
  conn.onNotification(statusNotification, (p: StatusPayload) => {
    session.statuses.push(p);
  });
  conn.onNotification(() => undefined);
  conn.onRequest("window/workDoneProgress/create", () => null);
  conn.listen();

  await conn.sendRequest("initialize", {
    processId: process.pid,
    rootUri: toUri(modDir),
    workspaceFolders: [{ uri: toUri(modDir), name: "crash" }],
    capabilities: {},
    initializationOptions: {
      storageDir,
      wikidocsDir: WIKIDOCS,
      settings: {
        gamePath: null, // the fault fires on the mod scan; no game needed
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
  return session;
}

/** Poll until `done` or the deadline; returns whether it happened. */
async function waitFor(done: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (done()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return done();
}

let session: Session | undefined;

afterEach(() => {
  if (session?.child && !session.child.killed) session.child.kill();
  for (const dir of session?.temp ?? []) fs.rmSync(dir, { recursive: true, force: true });
  session = undefined;
});

describe.skipIf(!hasServer)("crash visibility (§A1)", () => {
  it("a scan throw is logged with an attributable stack and the server survives", async () => {
    session = await startFaultyServer("sync");
    const s = session;
    const logged = await waitFor(() => s.output.join("\n").includes("index build failed"), 15_000);
    const text = s.output.join("\n");
    expect(logged, `no failure line in server output:\n${text}`).toBe(true);
    // Attributable: which build, which fault, and the stack frame that threw.
    expect(text).toContain("index build failed (startup)");
    expect(text).toContain("px fault injection: scan throw (PX_FAULT_SCAN=sync)");
    // The fixture configures a mod root only, which the fused scan owns.
    expect(text).toContain("scanModRootBoth");
    // The rejection is caught, so the process is still there to answer requests
    // (before §A1 this path either died or went quiet with an empty index).
    expect(s.exited).toBe(false);
    const stats = (await s.conn.sendRequest("paradox/indexStats")) as { total: number };
    expect(stats.total).toBeGreaterThanOrEqual(0);
    // The status flips out of "indexing" even though the scan died, so the
    // status bar cannot sit on "indexing…" forever.
    expect(s.statuses.some((p) => !p.indexing)).toBe(true);
  }, 30_000);

  it("an async throw during a scan is logged as FATAL before the process exits", async () => {
    session = await startFaultyServer("async");
    const s = session;
    const logged = await waitFor(() => s.output.join("\n").includes("FATAL uncaughtException"), 15_000);
    const text = s.output.join("\n");
    expect(logged, `no FATAL line in server output:\n${text}`).toBe(true);
    expect(text).toContain("px fault injection: scan throw (PX_FAULT_SCAN=async)");
    // The death itself is unchanged (the client's restart logic is the recovery
    // path); what is new is that it leaves a stack behind.
    expect(await waitFor(() => s.exited, 5_000)).toBe(true);
    expect(s.exitCode).toBe(1);
  }, 30_000);
});
