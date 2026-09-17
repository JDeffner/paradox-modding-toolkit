/** Real file/timer benchmark with a stub VS Code diagnostic sink.
 * node packages/vscode/test/perf/profileErrorLog.mjs <output.json> [source-root]
 * Measures host processing, excluding VS Code IPC, rendering and other extensions.
 */
import { buildSync } from "esbuild";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import assert from "node:assert/strict";
import { URI } from "vscode-uri";

const output = process.argv[2];
if (!output) throw new Error("Pass an output JSON path");
const source = path.resolve(process.argv[3] ?? ".");
const bundle = buildSync({
  entryPoints: [path.join(source, "packages/vscode/src/errorLog.ts")],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
}).outputFiles[0].text;
const require = createRequire(import.meta.url);
const results = [];
for (const count of [5000, 10000, 20000]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "px-perf-log-"));
  fs.mkdirSync(path.join(root, "logs"));
  fs.mkdirSync(path.join(root, "mod/events"), { recursive: true });
  fs.writeFileSync(path.join(root, "mod/events/probe.txt"), "");
  const file = path.join(root, "logs/error.log");
  fs.writeFileSync(file, "");
  let sets = 0;
  const vscode = {
    Uri: URI,
    EventEmitter: class {
      event = () => ({ dispose() {} });
      fire() {}
      dispose() {}
    },
    DiagnosticSeverity: { Error: 0, Warning: 1 },
    StatusBarAlignment: { Right: 2 },
    Range: class {
      constructor(line) {
        this.start = { line };
      }
    },
    Diagnostic: class {
      constructor(range, message, severity) {
        Object.assign(this, { range, message, severity });
      }
    },
    languages: {
      createDiagnosticCollection: () => ({
        set() {
          sets++;
        },
        clear() {},
        dispose() {},
      }),
    },
    window: {
      createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {} }),
      showInformationMessage() {},
    },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", bundle)(
    (id) => (id === "vscode" ? vscode : require(id)),
    module,
    module.exports
  );
  const watcher = new module.exports.ErrorLogWatcher(
    () => ({
      gameId: "ck3",
      modPath: path.join(root, "mod"),
      logsPath: path.join(root, "logs"),
      parentPaths: [],
      gamePath: null,
    }),
    () => {}
  );
  let heartbeat;
  try {
    watcher.start();
    const burst = Array.from(
      { length: count },
      (_, i) => `[12:00:00][E][test.cpp:1]: Problem ${i} in file: events/probe.txt line: ${i + 1}\n`
    ).join("");
    fs.appendFileSync(file, burst);
    let maxTurnMs = 0;
    let maxHeartbeatDelayMs = 0;
    let firstPoll;
    const originalPoll = watcher.poll.bind(watcher);
    watcher.poll = () => {
      const start = performance.now();
      firstPoll ??= start;
      originalPoll();
      maxTurnMs = Math.max(maxTurnMs, performance.now() - start);
    };
    let last = performance.now();
    heartbeat = setInterval(() => {
      const now = performance.now();
      maxHeartbeatDelayMs = Math.max(maxHeartbeatDelayMs, now - last - 10);
      last = now;
    }, 10);
    const deadline = Date.now() + 30000;
    while (watcher.problemCount < count) {
      if (Date.now() > deadline) throw new Error("Watcher did not drain burst");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    results.push({
      count,
      bytes: Buffer.byteLength(burst),
      drainMs: Math.round(performance.now() - firstPoll),
      maxTurnMs: Math.round(maxTurnMs),
      maxHeartbeatDelayMs: Math.round(maxHeartbeatDelayMs),
      publications: sets,
      diagnostics: watcher.problemCount,
    });
  } finally {
    clearInterval(heartbeat);
    watcher.dispose();
    const relative = path.relative(os.tmpdir(), root);
    assert(relative.startsWith("px-perf-log-") && !relative.includes(path.sep), "Unsafe cleanup path");
    fs.rmSync(root, { recursive: true, force: true });
  }
}
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, JSON.stringify({ node: process.version, results }, null, 2));
console.log(JSON.stringify(results, null, 2));
