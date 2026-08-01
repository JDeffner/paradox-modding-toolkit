/**
 * initializationOptions.dataDir (PROTOCOL.md §Initialization): the root that
 * CONTAINS the per-game bundled data folders. Forks the packaged bundle over
 * node IPC like the real client and points it at a synthetic data layout, so
 * what is proven is the wire path, not a unit-level helper:
 *  - wiki tokens AND freqs load from <dataDir>/<gameId>/,
 *  - a gameId change re-derives BOTH under dataDir,
 *  - the deprecated wikidocsDir still wins, and now moves the wiki mirror
 *    ALONE (freqs stay on the dataDir root instead of following its parent).
 * Skipped when dist/server.js has not been built (`pnpm run compile`).
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
  configChangedNotification,
  statusNotification,
  type ParadoxSettings,
  type StatusPayload,
} from "@px-lsp/protocol/protocol";

const SERVER = path.join(__dirname, "..", "dist", "server.js");
const hasServer = fs.existsSync(SERVER);

// Deliberately tiny and unmistakable: the real bundled ck3 wikidocs carry
// thousands of tokens, so an exact status.tokens count tells the fixture and
// the bundle apart with no ambiguity.
const CK3_EFFECTS = ["px_fx_alpha", "px_fx_beta", "px_fx_gamma"];
const VIC3_EFFECTS = ["px_fx_delta", "px_fx_epsilon"];
const ALT_EFFECTS = ["px_fx_omega"];
/** Count high enough that freqBucket() saturates at the hottest bucket "00". */
const HOT = 1_000_000;
const HOTTEST = "00";
const COLDEST = "99";

const EVENTS_TXT = `namespace = fixture

fixture.1 = {
	immediate = {

	}
}
`;
/** The blank line inside `immediate` above: an effect block, empty prefix. */
const CURSOR = { line: 4, character: 2 };

function toUri(p: string): string {
  return "file:///" + p.replace(/\\/g, "/").replace(/^\//, "");
}

/** Minimal Effects_list.md in the wiki mirror's table shape. */
function effectsMd(names: string[]): string {
  return [
    "| Name | Description | Example | Supported Scopes | Supported Targets |",
    "| --- | --- | --- | --- | --- |",
    ...names.map((n) => `| ${n} | Fixture effect ${n}. | ${n} = yes | all | none |`),
    "",
  ].join("\n");
}

function writeGameData(root: string, gameId: string, effects: string[], hot: string[]): void {
  const dir = path.join(root, gameId);
  fs.mkdirSync(path.join(dir, "wikidocs"), { recursive: true });
  fs.writeFileSync(path.join(dir, "wikidocs", "Effects_list.md"), effectsMd(effects), "utf8");
  if (hot.length === 0) return;
  const tokens = Object.fromEntries(hot.map((n) => [n, HOT]));
  fs.writeFileSync(path.join(dir, "freqs.json"), JSON.stringify({ contexts: {}, tokens }), "utf8");
}

function settingsFor(gameId: string, modDir: string): ParadoxSettings {
  return {
    gameId,
    gamePath: null,
    logsPath: null,
    modPath: modDir,
    parentPaths: [],
    workspaceMods: [],
    locLanguage: "english",
    scopeInlayHints: false,
    diagnosticsIgnore: [],
    diagnosticsIgnorePatterns: [],
    diagnosticsVanilla: false,
  };
}

interface Session {
  child: ChildProcess;
  conn: MessageConnection;
  statuses: StatusPayload[];
}

const sessions: Session[] = [];

async function start(modDir: string, initOptions: Record<string, unknown>): Promise<Session> {
  const child = fork(SERVER, ["--node-ipc"], { stdio: ["ignore", "pipe", "pipe", "ipc"], silent: true });
  const conn = createMessageConnection(new IPCMessageReader(child), new IPCMessageWriter(child));
  const statuses: StatusPayload[] = [];
  conn.onNotification(statusNotification, (p: StatusPayload) => {
    statuses.push(p);
  });
  conn.onNotification(() => undefined); // swallow diagnostics / logMessage
  conn.onRequest("window/workDoneProgress/create", () => null);
  conn.listen();
  await conn.sendRequest("initialize", {
    processId: process.pid,
    rootUri: toUri(modDir),
    workspaceFolders: [{ uri: toUri(modDir), name: "data-dir-smoke" }],
    capabilities: {},
    initializationOptions: {
      storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "px-datadir-storage-")),
      settings: settingsFor("ck3", modDir),
      ...initOptions,
    },
  });
  await conn.sendNotification("initialized", {});
  const session = { child, conn, statuses };
  sessions.push(session);
  return session;
}

async function settledWith(session: Session, tokens: number): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (session.statuses.some((s) => !s.indexing && s.tokens === tokens)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  const seen = session.statuses.map((s) => s.tokens).join(",");
  throw new Error(`no settled status with ${tokens} tokens (saw: ${seen})`);
}

/** label -> the two-digit frequency bucket of its sortText ("<T><FF><S><label>"). */
async function effectBuckets(session: Session, uri: string): Promise<Map<string, string>> {
  const result = (await session.conn.sendRequest("textDocument/completion", {
    textDocument: { uri },
    position: CURSOR,
  })) as { items: Array<{ label: string; sortText?: string }> };
  return new Map(result.items.map((i) => [i.label, (i.sortText ?? "").slice(1, 3)]));
}

describe.skipIf(!hasServer)("initializationOptions.dataDir", () => {
  let dataRoot: string;
  let altRoot: string;
  let modDir: string;
  let ck3: Map<string, string>;
  let vic3: Map<string, string>;
  let alt: Map<string, string>;
  let ck3Tokens: number;
  let vic3Tokens: number;
  let altTokens: number;

  beforeAll(async () => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "px-datadir-"));
    altRoot = fs.mkdtempSync(path.join(os.tmpdir(), "px-datadir-alt-"));
    modDir = fs.mkdtempSync(path.join(os.tmpdir(), "px-datadir-mod-"));
    // px_fx_omega lives in the ALT wiki mirror but is counted HERE: proof that
    // freqs follow dataDir and not the wikidocsDir override's parent.
    writeGameData(dataRoot, "ck3", CK3_EFFECTS, ["px_fx_alpha", "px_fx_omega"]);
    writeGameData(dataRoot, "vic3", VIC3_EFFECTS, ["px_fx_delta"]);
    writeGameData(altRoot, "ck3", ALT_EFFECTS, []);

    const eventsFile = path.join(modDir, "events", "fixture_events.txt");
    fs.mkdirSync(path.dirname(eventsFile), { recursive: true });
    fs.writeFileSync(eventsFile, EVENTS_TXT, "utf8");
    const eventsUri = toUri(eventsFile);

    const withDataDir = await start(modDir, { dataDir: dataRoot });
    void withDataDir.conn.sendNotification("textDocument/didOpen", {
      textDocument: { uri: eventsUri, languageId: "paradox", version: 1, text: EVENTS_TXT },
    });
    await settledWith(withDataDir, CK3_EFFECTS.length);
    ck3Tokens = CK3_EFFECTS.length;
    ck3 = await effectBuckets(withDataDir, eventsUri);

    await withDataDir.conn.sendNotification(configChangedNotification, settingsFor("vic3", modDir));
    await settledWith(withDataDir, VIC3_EFFECTS.length);
    vic3Tokens = VIC3_EFFECTS.length;
    vic3 = await effectBuckets(withDataDir, eventsUri);

    const bothOverrides = await start(modDir, {
      dataDir: dataRoot,
      wikidocsDir: path.join(altRoot, "ck3", "wikidocs"),
    });
    void bothOverrides.conn.sendNotification("textDocument/didOpen", {
      textDocument: { uri: eventsUri, languageId: "paradox", version: 1, text: EVENTS_TXT },
    });
    await settledWith(bothOverrides, ALT_EFFECTS.length);
    altTokens = ALT_EFFECTS.length;
    alt = await effectBuckets(bothOverrides, eventsUri);
  }, 90_000);

  afterAll(() => {
    for (const s of sessions) if (!s.child.killed) s.child.kill();
    for (const dir of [dataRoot, altRoot, modDir]) {
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loads wiki tokens from <dataDir>/<gameId>/wikidocs", () => {
    expect(ck3Tokens).toBe(3); // exactly the fixture mirror, not the bundled one
    for (const name of CK3_EFFECTS) expect(ck3.has(name)).toBe(true);
  });

  it("loads freqs from <dataDir>/<gameId>/freqs.json", () => {
    expect(ck3.get("px_fx_alpha")).toBe(HOTTEST); // counted in the fixture table
    expect(ck3.get("px_fx_beta")).toBe(COLDEST); // absent from it
  });

  it("re-derives wikidocs and freqs under dataDir when the game changes", () => {
    expect(vic3Tokens).toBe(2);
    expect(vic3.has("px_fx_alpha")).toBe(false);
    expect(vic3.has("px_fx_delta")).toBe(true);
    expect(vic3.get("px_fx_delta")).toBe(HOTTEST);
    expect(vic3.get("px_fx_epsilon")).toBe(COLDEST);
  });

  it("keeps wikidocsDir winning for the wiki mirror alone, freqs staying on dataDir", () => {
    expect(altTokens).toBe(1);
    expect(alt.has("px_fx_omega")).toBe(true);
    expect(alt.has("px_fx_alpha")).toBe(false);
    // Under the old parent-of-wikidocsDir derivation this would be COLDEST:
    // altRoot/ck3 ships no freqs.json.
    expect(alt.get("px_fx_omega")).toBe(HOTTEST);
  });
});
