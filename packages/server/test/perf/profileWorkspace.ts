/**
 * Profile the server against a REAL VS Code multi-root workspace (perf round 3).
 *
 * Round 2's driver (`profileRequests.ts`) hardcodes game + corpus. The field
 * reports that drive this round are `.code-workspace` files holding a game
 * install and several Workshop mods, with `px.excludedMods` and `px.parentMods`
 * deliberately EMPTY: every root is a full first-class root. This driver takes
 * such a file and reproduces the settings `packages/vscode/src/config.ts` would
 * derive from it, so the numbers describe what the user actually runs.
 *
 * Measures, in order: time to indexed (uninterrupted, so the scan's own cost is
 * not confounded by starved requests), peak and post-scan RSS, post-GC heap, and
 * the interactive requests round 2 left baselines for.
 *
 * Usage (from the repo root, after `pnpm run compile`):
 *   node --experimental-strip-types packages/server/test/perf/profileWorkspace.ts <workspace.code-workspace> [outDir] [--cpu-prof]
 */
import { fork, spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createMessageConnection, IPCMessageReader, IPCMessageWriter } from "vscode-jsonrpc/node";

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SERVER = path.join(HERE, "..", "..", "dist", "server.js");
const WIKIDOCS = path.join(HERE, "..", "..", "data", "ck3", "wikidocs");

const wsFile = process.argv[2];
if (!wsFile) {
  console.error("usage: profileWorkspace.ts <workspace.code-workspace> [outDir] [--cpu-prof]");
  process.exit(2);
}
const outDir = process.argv[3]?.startsWith("--")
  ? path.join(os.tmpdir(), "px-ws-profile")
  : (process.argv[3] ?? path.join(os.tmpdir(), "px-ws-profile"));
const cpuProf = process.argv.includes("--cpu-prof");
fs.mkdirSync(outDir, { recursive: true });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const toUri = (p: string) => "file:///" + p.replace(/\\/g, "/").replace(/^\//, "");

function write(file: string, content: string): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
  return file;
}

// ---- workspace -> settings --------------------------------------------------

/** A game install, not a mod: the shape `config.ts#looksLikeGameDir` probes for. */
function looksLikeGameDir(p: string): boolean {
  return (
    fs.existsSync(path.join(p, "common")) &&
    fs.existsSync(path.join(p, "events")) &&
    !fs.existsSync(path.join(p, "descriptor.mod"))
  );
}

// JSONC: `.code-workspace` files allow comments and trailing commas.
const raw = fs
  .readFileSync(wsFile, "utf8")
  .replace(/^﻿/, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1")
  .replace(/,(\s*[}\]])/g, "$1");
const ws = JSON.parse(raw) as { folders: Array<{ path: string }>; settings?: Record<string, unknown> };
const wsDir = path.dirname(path.resolve(wsFile));
const folders = ws.folders.map((f) => (path.isAbsolute(f.path) ? f.path : path.resolve(wsDir, f.path)));

const gamePath = folders.find(looksLikeGameDir) ?? null;
const modRoots = folders.filter((f) => f !== gamePath);

const excluded = (ws.settings?.["px.excludedMods"] as string[] | undefined) ?? [];
const declaredParents = (ws.settings?.["px.parentMods"] as string[] | undefined) ?? [];
if (excluded.length > 0 || declaredParents.length > 0) {
  console.warn(
    `NOTE: this workspace sets px.excludedMods=${excluded.length} px.parentMods=${declaredParents.length}; ` +
      "the round-3 baseline assumes both are empty."
  );
}

// The save loop must never write into a real mod, so the edited file lives in a
// synthetic scratch mod that takes modPath. Every real mod root then sits in
// workspaceMods, which is the same total work: config.ts makes modPath a
// reference-indexed root too, so moving one root between the two slots does not
// change how many roots get the mod treatment.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "px-ws-"));
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

const settings = {
  gamePath,
  logsPath: null,
  modPath: scratchRoot,
  parentPaths: [...modRoots],
  workspaceMods: [...modRoots],
  locLanguage: "english",
  scopeInlayHints: false,
  diagnosticsIgnore: [],
  diagnosticsIgnorePatterns: [],
  diagnosticsVanilla: false,
  tracePerf: true,
};

console.log(`workspace: ${path.basename(wsFile)}`);
console.log(`  game        ${gamePath ?? "(none)"}`);
console.log(`  mod roots   ${modRoots.length}`);
for (const m of modRoots) console.log(`              ${path.basename(m)}`);
console.log("");

// ---- boot -------------------------------------------------------------------

const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "px-ws-storage-"));
const execArgv = ["--expose-gc", "--max-old-space-size=4096"];
if (cpuProf) execArgv.push("--cpu-prof", "--cpu-prof-dir", outDir, "--cpu-prof-name", "server.cpuprofile");

const child: ChildProcess = fork(SERVER, ["--node-ipc"], {
  stdio: ["ignore", "pipe", "pipe", "ipc"],
  silent: true,
  execArgv,
  // Match what extension.ts gives the shipped server, so a run measures the
  // real configuration. `UV_THREADPOOL_SIZE=N node …profileWorkspace.ts`
  // still overrides it, which is how the 4-against-16 cold A/B was taken.
  env: { ...process.env, UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE || "16" },
});

/**
 * Sample the server's working set from outside it. `process.memoryUsage()` in
 * the server reports only at index-built time; the peak during the scan is the
 * number that decides whether a workspace fits in a 4 GB heap ceiling.
 */
function sampleRss(pid: number): { stop(): { peakMb: number; samples: number } } {
  const seen: number[] = [];
  const ps = spawn(
    "powershell",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `while ($true) { $p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p -eq $null) { break }; Write-Output $p.WorkingSet64; Start-Sleep -Milliseconds 400 }`,
    ],
    { stdio: ["ignore", "pipe", "ignore"] }
  );
  ps.stdout.on("data", (b: Buffer) => {
    for (const line of b.toString().split(/\r?\n/)) {
      const n = Number(line.trim());
      if (Number.isFinite(n) && n > 0) seen.push(n);
    }
  });
  return {
    stop() {
      ps.kill();
      return { peakMb: seen.length ? Math.round(Math.max(...seen) / 1048576) : -1, samples: seen.length };
    },
  };
}

const rss = child.pid ? sampleRss(child.pid) : null;

const logs: string[] = [];
child.stderr?.on("data", (b: Buffer) => logs.push(b.toString().trimEnd()));

const conn = createMessageConnection(new IPCMessageReader(child), new IPCMessageWriter(child));
let indexed = false;
let definitions = 0;
conn.onNotification("window/logMessage", (p: { message: string }) => {
  logs.push(p.message);
});
conn.onNotification("paradox/status", (p: { indexing: boolean; definitions: number }) => {
  if (!p.indexing && p.definitions > 0) {
    indexed = true;
    definitions = p.definitions;
  }
});
conn.onNotification(() => undefined);
conn.onRequest(() => null);
conn.listen();

const uri = toUri(scratchFile);
const baseText = fs.readFileSync(scratchFile, "utf8");
const completionPos = { line: 6, character: 3 }; // inside immediate = { }
const results: Record<string, number | string> = {};

async function timed(label: string, method: string, params: unknown): Promise<number> {
  const t0 = performance.now();
  const res: unknown = await conn.sendRequest(method, params);
  const ms = performance.now() - t0;
  const count = Array.isArray(res)
    ? res.length
    : ((res as { items?: unknown[] } | null)?.items?.length ?? -1);
  console.log(`  ${label.padEnd(34)} ${String(Math.round(ms)).padStart(8)} ms   items=${count}`);
  return Math.round(ms);
}

await conn.sendRequest("initialize", {
  processId: process.pid,
  rootUri: toUri(scratchRoot),
  workspaceFolders: folders.map((f) => ({ uri: toUri(f), name: path.basename(f) })),
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

console.log(`waiting for the index (${folders.length} roots)…`);
while (!indexed) await sleep(250); // NO probing: the scan runs uninterrupted
results.timeToIndexedMs = Math.round(performance.now() - tScan);
results.definitions = definitions;
console.log(`index built, uninterrupted: ${results.timeToIndexedMs} ms, ${definitions} definitions\n`);

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

// A save invalidates the index revision: the cache-miss path a user hits on
// EVERY Ctrl+S, and the row that decided how round 2 felt.
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

// The server logs `index built: … heap N MB (post-gc), rss N MB` under tracePerf.
const built = logs.find((l) => l.includes("index built:")) ?? "";
results.heapMb = Number(/heap (\d+) MB/.exec(built)?.[1] ?? -1);
results.rssAtBuildMb = Number(/rss (\d+) MB/.exec(built)?.[1] ?? -1);
results.internedIdentifiers = Number(/(\d+) shared identifiers/.exec(built)?.[1] ?? -1);
const peak = rss?.stop();
results.peakRssMb = peak?.peakMb ?? -1;
results.rssSamples = peak?.samples ?? 0;

console.log("");
console.log(`  definitions            ${results.definitions}`);
console.log(`  shared identifiers     ${results.internedIdentifiers}`);
console.log(`  heap after index       ${results.heapMb} MB (post-gc)`);
console.log(`  rss  after index       ${results.rssAtBuildMb} MB`);
console.log(`  rss  peak (sampled)    ${results.peakRssMb} MB over ${results.rssSamples} samples`);

fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 2));
fs.writeFileSync(path.join(outDir, "server.log"), logs.join("\n"));
console.log(`\nwrote ${outDir}/results.json and server.log`);

try {
  await conn.sendRequest("shutdown");
  void conn.sendNotification("exit");
} catch {
  /* already gone */
}
await sleep(cpuProf ? 2500 : 300); // let --cpu-prof flush
if (!child.killed) child.kill();
fs.rmSync(tmp, { recursive: true, force: true });
fs.rmSync(storageDir, { recursive: true, force: true });
process.exit(0);
