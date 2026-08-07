/**
 * Headless perf bench (perf campaign §A3): boot the PACKAGED server over the
 * client's own transport on a parameterised set of roots, then replay
 * open -> probe-while-indexing -> edit -> save -> semanticTokens and record
 * what the field reports complain about:
 *
 *   timeToIndexedMs   how long the workspace is only half-answered for
 *   duringIndexing    completion / semanticTokens p95 WHILE the scan runs
 *   saveRoundTripMs   Ctrl+S -> the next semanticTokens answer comes back
 *   indexHeapMb       post-GC heap in the server after indexing (--expose-gc)
 *   refreshes         semanticTokens/inlayHint refreshes the server asked for
 *
 * The two recipes are the users' own (docs/perf-campaign.md): vanilla mounted
 * 3x plus ~20 small mods, and game + AGOT + a second AGOT root. Extra roots are
 * DIRECTORY JUNCTIONS, never copies: no game or corpus file is ever written to,
 * and the scratch mod that the save loop edits is synthetic.
 *
 * Nothing here runs in the default suite; see perfBench.test.ts for the gate.
 */
import { fork, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createMessageConnection, IPCMessageReader, IPCMessageWriter } from "vscode-jsonrpc/node";
import { modFileChangedNotification, statusNotification } from "@px-lsp/protocol/protocol";
import type { ParadoxSettings, StatusPayload } from "@px-lsp/protocol/protocol";

const SERVER = path.join(__dirname, "..", "..", "dist", "server.js");
const WIKIDOCS = path.join(__dirname, "..", "..", "data", "ck3", "wikidocs");

/** Same ceiling the client gives the forked server (vscode/src/serverHeap.ts). */
function serverHeapMb(totalBytes: number): number {
  return Math.max(2048, Math.min(4096, Math.floor(totalBytes / 1024 / 1024 / 2)));
}

// ---- recipes ----------------------------------------------------------------

export interface Recipe {
  name: string;
  settings: ParadoxSettings;
  /** Synthetic mod file the save loop edits (never a real game/corpus file). */
  scratchFile: string;
  dispose(): void;
}

function junction(target: string, link: string): string {
  fs.symlinkSync(target, link, "junction");
  return link;
}

/** Remove only the links we made, then the temp tree (never follows a link). */
function disposeTemp(tmp: string, links: string[]): void {
  for (const link of links) {
    try {
      if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link);
    } catch {
      /* already gone */
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

function write(file: string, content: string): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
  return file;
}

/** A small but real mod: 4 event files, a scripted-effect file, a loc file. */
function writeSyntheticMod(root: string, id: string): string {
  write(path.join(root, "descriptor.mod"), `version="1.0"\nname="${id}"\nsupported_version="1.16.*"\n`);
  let firstEvents = "";
  for (let f = 0; f < 4; f++) {
    const lines = [`namespace = ${id}_${f}`, ""];
    for (let e = 1; e <= 25; e++) {
      lines.push(
        `${id}_${f}.${e} = {`,
        "\ttype = character_event",
        `\ttitle = ${id}_${f}.${e}.t`,
        "\timmediate = {",
        `\t\t${id}_effect_${e % 20} = yes`,
        "\t\tevery_vassal = { limit = { is_adult = yes } add_gold = 5 }",
        "\t}",
        `\toption = { name = ${id}_${f}.${e}.a }`,
        "}",
        ""
      );
    }
    const file = write(path.join(root, "events", `${id}_${f}.txt`), lines.join("\n"));
    if (f === 0) firstEvents = file;
  }
  const effects: string[] = [];
  for (let i = 0; i < 20; i++) {
    effects.push(`${id}_effect_${i} = {`, "\tadd_prestige = 10", "}", "");
  }
  write(path.join(root, "common", "scripted_effects", `${id}_effects.txt`), effects.join("\n"));
  const loc = ["﻿l_english:"];
  for (let f = 0; f < 4; f++) {
    for (let e = 1; e <= 25; e++) {
      loc.push(` ${id}_${f}.${e}.t:0 "Bench ${e}"`, ` ${id}_${f}.${e}.a:0 "OK"`);
    }
  }
  write(path.join(root, "localization", "english", `${id}_l_english.yml`), loc.join("\n"));
  return firstEvents;
}

function baseSettings(gamePath: string | null): ParadoxSettings {
  return {
    gamePath,
    logsPath: null, // bundled wiki tokens: the machine's script_docs must not move the numbers
    modPath: null,
    parentPaths: [],
    workspaceMods: [],
    locLanguage: "english",
    scopeInlayHints: false,
    diagnosticsIgnore: [],
    diagnosticsIgnorePatterns: [],
    diagnosticsVanilla: false,
    tracePerf: true,
  };
}

/** Recipe 1: the game mounted 3x as parent roots plus 20 small workspace mods. */
export function recipeMountedVanilla(gamePath: string, mods = 20): Recipe {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "px-bench-r1-"));
  const links: string[] = [];
  for (let i = 1; i <= 3; i++) links.push(junction(gamePath, path.join(tmp, `vanilla-mount-${i}`)));
  const modRoots: string[] = [];
  let scratchFile = "";
  for (let i = 0; i < mods; i++) {
    const root = path.join(tmp, `mod${i}`);
    const events = writeSyntheticMod(root, `bench${i}`);
    if (i === 0) scratchFile = events;
    modRoots.push(root);
  }
  const settings = baseSettings(gamePath);
  settings.modPath = modRoots[0];
  settings.workspaceMods = modRoots.slice(1);
  // The client puts every workspace mod into parentPaths too (config.ts).
  settings.parentPaths = [...links, ...modRoots.slice(1)];
  return {
    name: "recipe1-vanilla-x3-plus-20-mods",
    settings,
    scratchFile,
    dispose: () => disposeTemp(tmp, links),
  };
}

/** Recipe 2: game + the AGOT corpus + a second AGOT root, both edited. */
export function recipeTwoCorpora(gamePath: string, corpusPath: string): Recipe {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "px-bench-r2-"));
  const copy = junction(corpusPath, path.join(tmp, "agot-copy"));
  // The save loop must not write into the corpus, so the edited file lives in a
  // small synthetic mod alongside it — per-save cost is index-wide, not file-wide.
  const scratchRoot = path.join(tmp, "scratch-mod");
  const scratchFile = writeSyntheticMod(scratchRoot, "scratch");
  const settings = baseSettings(gamePath);
  settings.modPath = scratchRoot;
  settings.workspaceMods = [corpusPath, copy];
  settings.parentPaths = [corpusPath, copy];
  return {
    name: "recipe2-game-plus-agot-x2",
    settings,
    scratchFile,
    dispose: () => disposeTemp(tmp, [copy]),
  };
}

// ---- the driver --------------------------------------------------------------

export interface BenchMetrics {
  recipe: string;
  roots: number;
  definitions: number;
  timeToIndexedMs: number;
  /** Server heap after the build, post-GC (the child runs with --expose-gc). */
  indexHeapMb: number | null;
  indexRssMb: number | null;
  duringIndexing: { completionP95: number; tokensP95: number; worstMs: number; samples: number };
  saveRoundTripMs: { p50: number; p95: number; max: number; samples: number };
  /** semanticTokens/inlayHint refreshes the server requested, by phase. */
  refreshes: { indexing: number; perSave: number };
  /** Set when the server died during the run (the crash symptom reproducing). */
  serverExit?: { code: number | null; tail: string };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function toUri(p: string): string {
  return "file:///" + p.replace(/\\/g, "/").replace(/^\//, "");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RunOptions {
  /** Save iterations (each one is a real didChange + didSave + watcher event). */
  saves?: number;
  /** Hard stop for the indexing phase. */
  indexTimeoutMs?: number;
  onLog?: (line: string) => void;
}

export async function runRecipe(recipe: Recipe, opts: RunOptions = {}): Promise<BenchMetrics> {
  const saves = opts.saves ?? 5;
  const indexTimeoutMs = opts.indexTimeoutMs ?? 15 * 60_000;
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "px-bench-storage-"));
  const child: ChildProcess = fork(SERVER, ["--node-ipc"], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    silent: true,
    // --expose-gc makes the trace's heap number post-GC; the heap ceiling is
    // the one the real client passes.
    execArgv: ["--expose-gc", `--max-old-space-size=${serverHeapMb(os.totalmem())}`],
  });

  const logs: string[] = [];
  let exited: { code: number | null } | null = null;
  child.stderr?.on("data", (b: Buffer) => logs.push(b.toString().trimEnd()));
  child.on("exit", (code) => {
    exited = { code };
  });

  const conn = createMessageConnection(new IPCMessageReader(child), new IPCMessageWriter(child));
  const statuses: StatusPayload[] = [];
  let refreshes = 0;
  conn.onNotification("window/logMessage", (p: { message: string }) => {
    logs.push(p.message);
    opts.onLog?.(p.message);
  });
  conn.onNotification(statusNotification, (p: StatusPayload) => {
    statuses.push(p);
  });
  conn.onNotification(() => undefined);
  conn.onRequest((method: string) => {
    if (method.endsWith("/refresh")) refreshes++;
    return null;
  });
  conn.listen();

  const uri = toUri(recipe.scratchFile);
  const baseText = fs.readFileSync(recipe.scratchFile, "utf8");
  const completionPos = { line: 5, character: 2 }; // inside the first event's immediate block
  const timeRequest = async (method: string, params: unknown): Promise<number> => {
    const t0 = performance.now();
    await conn.sendRequest(method, params);
    return performance.now() - t0;
  };

  try {
    await conn.sendRequest("initialize", {
      processId: process.pid,
      rootUri: toUri(path.dirname(recipe.scratchFile)),
      workspaceFolders: [{ uri: toUri(recipe.settings.modPath!), name: "bench" }],
      capabilities: {},
      initializationOptions: {
        storageDir,
        wikidocsDir: WIKIDOCS,
        client: { hoverHtml: true, commands: [], ownFileWatcher: true },
        settings: recipe.settings,
      },
    });
    const t0 = performance.now();
    await conn.sendNotification("initialized", {});
    void conn.sendNotification("textDocument/didOpen", {
      textDocument: { uri, languageId: "paradox", version: 1, text: baseText },
    });

    // Probe the interactive path every 500ms WHILE the scan runs: this is the
    // starvation the field reports describe ("semantic highlighting never
    // arrives for new edits" while VS Code itself stays responsive).
    const completions: number[] = [];
    const tokens: number[] = [];
    const deadline = Date.now() + indexTimeoutMs;
    let indexed = false;
    while (!indexed && Date.now() < deadline && !exited) {
      completions.push(
        await timeRequest("textDocument/completion", { textDocument: { uri }, position: completionPos })
      );
      tokens.push(await timeRequest("textDocument/semanticTokens/full", { textDocument: { uri } }));
      indexed = statuses.some((s) => !s.indexing && s.definitions > 0);
      if (!indexed) await sleep(500);
    }
    const timeToIndexedMs = performance.now() - t0;
    const refreshesDuringIndexing = refreshes;

    // Ctrl+S, the way the real client drives it: an edit, then didSave AND the
    // watcher's paradox/modFileChanged for the same file.
    const saveSamples: number[] = [];
    let version = 1;
    for (let i = 0; i < saves && !exited; i++) {
      const text = `${baseText}\n# bench touch ${i}\n`;
      void conn.sendNotification("textDocument/didChange", {
        textDocument: { uri, version: ++version },
        contentChanges: [{ text }],
      });
      await sleep(400); // let the 300ms validation debounce fire, as while typing
      fs.writeFileSync(recipe.scratchFile, text, "utf8");
      const t1 = performance.now();
      void conn.sendNotification("textDocument/didSave", { textDocument: { uri }, text });
      void conn.sendNotification(modFileChangedNotification, { fsPath: recipe.scratchFile });
      await conn.sendRequest("textDocument/semanticTokens/full", { textDocument: { uri } });
      saveSamples.push(performance.now() - t1);
      await sleep(600); // let the 300ms refresh debounce land inside the sample window
    }
    const refreshesPerSave = saves > 0 ? (refreshes - refreshesDuringIndexing) / saves : 0;

    const latest = statuses[statuses.length - 1];
    const built = logs.join("\n").match(/index built: (\d+) definitions, heap (\d+) MB[^,]*, rss (\d+) MB/);

    const metrics: BenchMetrics = {
      recipe: recipe.name,
      roots:
        (recipe.settings.gamePath ? 1 : 0) +
        (recipe.settings.modPath ? 1 : 0) +
        recipe.settings.parentPaths.length,
      definitions: built ? Number(built[1]) : (latest?.definitions ?? 0),
      timeToIndexedMs: Math.round(timeToIndexedMs),
      indexHeapMb: built ? Number(built[2]) : null,
      indexRssMb: built ? Number(built[3]) : null,
      duringIndexing: {
        completionP95: Math.round(percentile(completions, 0.95)),
        tokensP95: Math.round(percentile(tokens, 0.95)),
        worstMs: Math.round(Math.max(0, ...completions, ...tokens)),
        samples: completions.length,
      },
      saveRoundTripMs: {
        p50: Math.round(percentile(saveSamples, 0.5)),
        p95: Math.round(percentile(saveSamples, 0.95)),
        max: Math.round(Math.max(0, ...saveSamples)),
        samples: saveSamples.length,
      },
      refreshes: { indexing: refreshesDuringIndexing, perSave: Number(refreshesPerSave.toFixed(1)) },
    };
    if (exited) {
      metrics.serverExit = {
        code: (exited as { code: number | null }).code,
        tail: logs.slice(-20).join("\n"),
      };
    }
    return metrics;
  } finally {
    try {
      await conn.sendRequest("shutdown");
      void conn.sendNotification("exit");
    } catch {
      /* already gone */
    }
    await sleep(200);
    if (!child.killed) child.kill();
    fs.rmSync(storageDir, { recursive: true, force: true });
  }
}

/** Machine stamp: these numbers are only comparable on comparable hardware. */
export function machineStamp(): Record<string, string | number> {
  return {
    platform: `${process.platform} ${os.release()}`,
    cpu: os.cpus()[0]?.model.trim() ?? "unknown",
    cores: os.cpus().length,
    totalMemGb: Math.round(os.totalmem() / 1024 ** 3),
    node: process.version,
  };
}
