import { afterEach, describe, expect, it } from "vitest";
import { buildSync } from "esbuild";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { URI } from "vscode-uri";
import type { PxConfig } from "../src/config";

const bundle = buildSync({
  entryPoints: [path.join(__dirname, "../src/errorLog.ts")],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
}).outputFiles[0].text;
const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "px-logwatch-"));
  cleanup.push(() => {
    const relative = path.relative(os.tmpdir(), root);
    if (!relative.startsWith("px-logwatch-") || relative.includes(path.sep))
      throw new Error("Unsafe fixture path");
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, "logs"));
  fs.mkdirSync(path.join(root, "mod", "events"), { recursive: true });
  for (const file of ["first.txt", "second.txt"])
    fs.writeFileSync(path.join(root, "mod", "events", file), "");
  const log = path.join(root, "logs", "error.log");
  fs.writeFileSync(log, "");
  const published = new Map<string, Array<{ message: string }>>();
  const sets: string[] = [];
  const listeners = new Set<() => void>();
  class EventEmitter {
    event = (listener: () => void) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    };
    fire() {
      for (const listener of listeners) listener();
    }
    dispose() {
      listeners.clear();
    }
  }
  const vscode = {
    Uri: URI,
    EventEmitter,
    DiagnosticSeverity: { Error: 0, Warning: 1 },
    StatusBarAlignment: { Right: 2 },
    Range: class {
      start: { line: number };
      constructor(line: number) {
        this.start = { line };
      }
    },
    Diagnostic: class {
      constructor(
        public range: unknown,
        public message: string,
        public severity: number
      ) {}
    },
    languages: {
      createDiagnosticCollection: () => ({
        set(uri: URI, diagnostics: Array<{ message: string }>) {
          sets.push(uri.fsPath);
          published.set(uri.fsPath, [...diagnostics]);
        },
        clear() {
          published.clear();
        },
        dispose() {},
      }),
    },
    window: {
      createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {} }),
      showInformationMessage() {},
    },
  };
  const module = { exports: {} as typeof import("../src/errorLog") };
  const require = createRequire(import.meta.url);
  new Function("require", "module", "exports", bundle)(
    (id: string) => (id === "vscode" ? vscode : require(id)),
    module,
    module.exports
  );
  const cfg = {
    gameId: "ck3",
    modPath: path.join(root, "mod"),
    parentPaths: [],
    gamePath: null,
    logsPath: path.join(root, "logs"),
  } as unknown as PxConfig;
  const watcher = new module.exports.ErrorLogWatcher(
    () => cfg,
    () => {}
  );
  cleanup.push(() => watcher.dispose());
  const waitFor = (predicate: () => boolean) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        listeners.delete(check);
        reject(new Error("watcher did not publish"));
      }, 5000);
      const check = () => {
        if (predicate()) {
          clearTimeout(timer);
          listeners.delete(check);
          resolve();
        }
      };
      listeners.add(check);
      check();
    });
  watcher.start();
  return { log, watcher, published, sets, waitFor };
}
const line = (i: number, file = "first.txt") =>
  `[12:00:00][E][test.cpp:1]: Problem ${i} in file: events/${file} line: ${i + 1}\n`;

describe("game log watcher responsiveness", () => {
  it("drains a burst over multiple turns, deduplicates reloads and publishes only changed files", async () => {
    const f = fixture();
    const count = 10000;
    const burst = Array.from({ length: count }, (_, i) => line(i)).join("");
    fs.appendFileSync(f.log, burst);
    let intermediate = false;
    f.watcher.onDidChangeState(() => {
      if (f.watcher.problemCount > 0 && f.watcher.problemCount < count) intermediate = true;
    });
    await f.waitFor(() => f.watcher.problemCount === count);
    expect(intermediate).toBe(true);
    expect([...f.published.values()][0]).toHaveLength(count);
    f.sets.length = 0;
    // Repeated first-file entries precede the marker, so observing the marker
    // proves the whole repeated burst was consumed without republishing it.
    fs.appendFileSync(f.log, burst + line(0, "second.txt"));
    await f.waitFor(() => f.watcher.problemCount === count + 1);
    expect(f.sets.map((file) => path.basename(file))).toEqual(["second.txt"]);
    f.watcher.clear();
    expect(f.published.size).toBe(0);
    fs.appendFileSync(f.log, line(0));
    await f.waitFor(() => f.watcher.problemCount === 1);
    expect([...f.published.values()][0]).toHaveLength(1);
  });

  it("cancels catch-up work when stopped and resets duplicate tracking after truncation", async () => {
    const f = fixture();
    fs.appendFileSync(f.log, line(0));
    await f.waitFor(() => f.watcher.problemCount === 1);
    fs.writeFileSync(f.log, "");
    await f.waitFor(() => f.watcher.problemCount === 0);
    fs.appendFileSync(f.log, Array.from({ length: 10000 }, (_, i) => line(i)).join(""));
    f.watcher.onDidChangeState(() => {
      if (f.watcher.problemCount > 0) f.watcher.stop();
    });
    await f.waitFor(() => f.watcher.problemCount > 0);
    const stoppedAt = f.watcher.problemCount;
    expect(stoppedAt).toBeLessThan(10000);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(f.watcher.problemCount).toBe(stoppedAt);
  });
});
