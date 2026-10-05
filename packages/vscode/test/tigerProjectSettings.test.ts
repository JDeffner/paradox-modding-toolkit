import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { URI } from "vscode-uri";
import type { PxConfig } from "../src/config";
const host = vi.hoisted(() => ({
  published: [] as unknown[],
  errors: vi.fn(),
  spawned: vi.fn(),
  native: new Map<string, string[]>(),
}));
vi.mock("vscode", () => ({
  Uri: URI,
  Range: class {},
  Diagnostic: class {},
  DiagnosticSeverity: { Error: 0, Warning: 1 },
  StatusBarAlignment: { Left: 1 },
  workspace: {
    textDocuments: [],
    getConfiguration: (_section: string, resource: URI) => ({
      get: () => host.native.get(resource.fsPath.toLowerCase()) ?? [],
    }),
  },
  languages: {
    createDiagnosticCollection: () => ({
      set: (_uri: URI, diagnostics: unknown[]) => host.published.push(...diagnostics),
      forEach() {},
      delete() {},
      dispose() {},
    }),
  },
  window: {
    createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {} }),
    showErrorMessage: host.errors,
  },
}));
vi.mock("child_process", async () => {
  const { EventEmitter } = await import("events");
  return {
    spawn: (...args: unknown[]) => {
      host.spawned(...args);
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        kill() {},
      });
      queueMicrotask(() => {
        child.stdout.emit(
          "data",
          Buffer.from(
            JSON.stringify([
              {
                severity: "warning",
                key: "test-report",
                message: "Example report",
                locations: [{ path: "script.txt", linenr: 1 }],
              },
            ])
          )
        );
        child.emit("close", 0, null);
      });
      return child;
    },
  };
});
import { TigerRunner } from "../src/tiger/runner";

let root: string;
let runner: TigerRunner;
beforeEach(() => {
  vi.clearAllMocks();
  host.published = [];
  host.native.clear();
  const base = path.resolve(".local/testing");
  fs.mkdirSync(base, { recursive: true });
  root = fs.mkdtempSync(path.join(base, "tiger-project-"));
  fs.writeFileSync(path.join(root, "descriptor.mod"), 'name="Example"');
  fs.writeFileSync(path.join(root, "script.txt"), "");
  runner = new TigerRunner(
    () =>
      ({
        gameId: "ck3",
        modPath: root,
        parentPaths: [],
        gamePath: null,
        tigerPath: "fake-tiger",
        isCk3Workspace: true,
        diagnosticsIgnore: ["test-report"],
        diagnosticsIgnorePatterns: [],
      }) as unknown as PxConfig,
    () => {}
  );
});
afterEach(() => {
  runner.dispose();
  fs.rmSync(root, { recursive: true, force: true });
});

it("uses the selected mod's portable validation policy when both config folders exist", async () => {
  fs.mkdirSync(path.join(root, ".px-toolkit"));
  fs.writeFileSync(path.join(root, ".px-toolkit/schema.json"), "{}");
  fs.mkdirSync(path.join(root, ".ck3modding"));
  fs.writeFileSync(
    path.join(root, ".ck3modding/project.json"),
    JSON.stringify({ version: 1, gameId: "ck3", validation: { ignore: [] } })
  );
  host.native.set(root.toLowerCase(), ["test-report"]);
  runner.run(true, root);
  await vi.waitFor(() => expect(host.published).toHaveLength(1));
});

it("uses native folder settings instead of another mod's already-resolved project policy", async () => {
  runner.run(true, root);
  await vi.waitFor(() => expect(host.published).toHaveLength(1));
});

it("reports invalid current project settings before starting Tiger", () => {
  fs.mkdirSync(path.join(root, ".px-toolkit"));
  fs.writeFileSync(path.join(root, ".px-toolkit/project.json"), "broken");
  runner.run(true, root);
  expect(host.spawned).not.toHaveBeenCalled();
  expect(host.errors).toHaveBeenCalledWith(expect.stringContaining("Could not read mod validation settings"));
});
