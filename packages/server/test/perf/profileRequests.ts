/**
 * CPU-profile the REQUEST path on a real large workspace (perf round 2).
 *
 * The §A3 bench proves the workspace is slow; it does not say which function
 * is. This driver boots the packaged server under --cpu-prof against real
 * roots, lets the scan finish UNINTERRUPTED (so the scan's own cost is not
 * confounded by starved requests), then measures, in order:
 *
 *   cold      the first completion after an index change  (cache miss)
 *   warm      the same request again                      (cache hit)
 *   afterSave a completion right after a save             (cache invalidated)
 *
 * and writes a .cpuprofile for the whole session.
 *
 * Usage (from the repo root, after `pnpm run compile`):
 *   node --experimental-strip-types packages/server/test/perf/profileRequests.ts <outDir> [--agot-x2]
 */
import { fork, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createMessageConnection, IPCMessageReader, IPCMessageWriter } from "vscode-jsonrpc/node";

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SERVER = path.join(HERE, "..", "..", "dist", "server.js");
const WIKIDOCS = path.join(HERE, "..", "..", "data", "ck3", "wikidocs");
const devPaths = JSON.parse(
  fs.readFileSync(path.join(HERE, "..", "..", "..", "..", "dev-paths.json"), "utf8")
);

const outDir = process.argv[2] ?? path.join(os.tmpdir(), "px-profile");
const twice = process.argv.includes("--agot-x2");
fs.mkdirSync(outDir, { recursive: true });

const GAME: string = devPaths.gamePath;
const CORPUS: string = devPaths.corpusPath;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const toUri = (p: string) => "file:///" + p.replace(/\\/g, "/").replace(/^\//, "");

function write(file: string, content: string): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
  return file;
}

// A small synthetic mod holds the edited file: the corpus is never written to.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "px-prof-"));
const scratchRoot = path.join(tmp, "scratch-mod");
write(path.join(scratchRoot, "descriptor.mod"), 'version="1.0"\nname="prof"\nsupported_version="1.16.*"\n');
const scratchFile = write(
  path.join(scratchRoot, "events", "prof_events.txt"),
  [
    "namespace = prof",
    "",
    "prof.1 = {",
    "\ttype = character_event",
    "\ttitle = prof.1.t",
    "\timmediate = {",
    "\t\tadd_gold = 5",
    "\t}",
    "}",
    "",
  ].join("\n")
);

const links: string[] = [];
const workspaceMods = [CORPUS];
if (twice) {
  const copy = path.join(tmp, "agot-copy");
  fs.symlinkSync(CORPUS, copy, "junction");
  links.push(copy);
  workspaceMods.push(copy);
}

const settings = {
  gamePath: GAME,
  logsPath: null,
  modPath: scratchRoot,
  parentPaths: [...workspaceMods],
  workspaceMods,
  locLanguage: "english",
  scopeInlayHints: false,
  diagnosticsIgnore: [],
  diagnosticsIgnorePatterns: [],
  diagnosticsVanilla: false,
  tracePerf: true,
};

const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "px-prof-storage-"));
const child: ChildProcess = fork(SERVER, ["--node-ipc"], {
  stdio: ["ignore", "pipe", "pipe", "ipc"],
  silent: true,
  execArgv: [
    "--expose-gc",
    "--max-old-space-size=4096",
    "--cpu-prof",
    "--cpu-prof-dir",
    outDir,
    "--cpu-prof-name",
    "server.cpuprofile",
  ],
});

const logs: string[] = [];
child.stderr?.on("data", (b: Buffer) => logs.push(b.toString().trimEnd()));

const conn = createMessageConnection(new IPCMessageReader(child), new IPCMessageWriter(child));
let indexed = false;
const perfLines: string[] = [];
conn.onNotification("window/logMessage", (p: { message: string }) => {
  logs.push(p.message);
  if (p.message.startsWith("perf ") || p.message.includes("indexed ")) perfLines.push(p.message);
});
conn.onNotification("paradox/status", (p: { indexing: boolean; definitions: number }) => {
  if (!p.indexing && p.definitions > 0) indexed = true;
});
conn.onNotification(() => undefined);
conn.onRequest(() => null);
conn.listen();

const uri = toUri(scratchFile);
const baseText = fs.readFileSync(scratchFile, "utf8");
const completionPos = { line: 6, character: 3 }; // inside immediate = { }

async function timed(label: string, method: string, params: unknown): Promise<number> {
  const t0 = performance.now();
  const res: any = await conn.sendRequest(method, params);
  const ms = performance.now() - t0;
  const count = Array.isArray(res) ? res.length : (res?.items?.length ?? -1);
  console.log(`  ${label.padEnd(34)} ${String(Math.round(ms)).padStart(8)} ms   items=${count}`);
  return ms;
}

const results: Record<string, number> = {};

await conn.sendRequest("initialize", {
  processId: process.pid,
  rootUri: toUri(scratchRoot),
  workspaceFolders: [{ uri: toUri(scratchRoot), name: "prof" }],
  capabilities: {},
  initializationOptions: {
    storageDir,
    wikidocsDir: WIKIDOCS,
    client: { hoverHtml: true, commands: [], ownFileWatcher: true },
    settings,
  },
});
const tScan = performance.now();
await conn.sendNotification("initialized", {});
void conn.sendNotification("textDocument/didOpen", {
  textDocument: { uri, languageId: "paradox", version: 1, text: baseText },
});

console.log(`waiting for the index (roots: game + ${workspaceMods.length} corpus mount(s))…`);
while (!indexed) await sleep(250); // NO probing: the scan runs uninterrupted
results.timeToIndexedCleanMs = Math.round(performance.now() - tScan);
console.log(`index built, uninterrupted: ${results.timeToIndexedCleanMs} ms\n`);

console.log("request timings:");
results.completionCold = await timed("completion (cold cache)", "textDocument/completion", {
  textDocument: { uri },
  position: completionPos,
});
results.completionWarm = await timed("completion (warm cache)", "textDocument/completion", {
  textDocument: { uri },
  position: completionPos,
});
results.semanticTokens = await timed("semanticTokens/full", "textDocument/semanticTokens/full", {
  textDocument: { uri },
});
results.hover = await timed("hover", "textDocument/hover", {
  textDocument: { uri },
  position: { line: 6, character: 5 },
});
results.documentSymbol = await timed("documentSymbol", "textDocument/documentSymbol", {
  textDocument: { uri },
});

// A save invalidates the index revision — the cache-miss path a user hits on
// EVERY Ctrl+S, which is what "it goes white again after I type" describes.
const text = `${baseText}\n# profile touch\n`;
fs.writeFileSync(scratchFile, text, "utf8");
void conn.sendNotification("textDocument/didChange", {
  textDocument: { uri, version: 2 },
  contentChanges: [{ text }],
});
void conn.sendNotification("textDocument/didSave", { textDocument: { uri }, text });
void conn.sendNotification("paradox/modFileChanged", { fsPath: scratchFile });
await sleep(1200);
results.completionAfterSave = await timed("completion (after save)", "textDocument/completion", {
  textDocument: { uri },
  position: completionPos,
});
results.tokensAfterSave = await timed("semanticTokens (after save)", "textDocument/semanticTokens/full", {
  textDocument: { uri },
});

fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 2));
fs.writeFileSync(path.join(outDir, "server.log"), logs.join("\n"));
console.log(`\nwrote ${outDir}/results.json and server.log`);

try {
  await conn.sendRequest("shutdown");
  void conn.sendNotification("exit");
} catch {
  /* already gone */
}
await sleep(2500); // let --cpu-prof flush
if (!child.killed) child.kill();
for (const l of links) {
  try {
    fs.unlinkSync(l);
  } catch {
    /* gone */
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
fs.rmSync(storageDir, { recursive: true, force: true });
process.exit(0);
