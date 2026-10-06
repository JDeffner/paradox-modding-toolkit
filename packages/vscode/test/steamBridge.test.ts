import { buildSync } from "esbuild";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BridgeEvent } from "../src/steam/jobs";

let scratch: string;
let bridge: string;

beforeAll(() => {
  const root = path.resolve(".local/testing");
  fs.mkdirSync(root, { recursive: true });
  scratch = fs.mkdtempSync(path.join(root, "workshop74-bridge-"));
  bridge = path.join(scratch, "bridge.cjs");
  buildSync({
    entryPoints: ["packages/vscode/src/steam/bridge.ts"],
    bundle: true,
    platform: "node",
    outfile: bridge,
  });
});
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

function query(dependencyRead: string): { status: number | null; events: BridgeEvent[] } {
  const mock = path.join(scratch, "mock.cjs");
  fs.writeFileSync(
    mock,
    `
exports.init = () => ({ workshop: {
  getItem: async () => ({
    fileId: 123n, title: "Existing item", description: "Keep me", visibility: 2,
    tags: [], previewUrl: null, timeCreated: 1, timeUpdated: 2, banned: false,
    votesUp: 1, votesDown: 0, statistics: {}, children: [456n], additionalPreviews: []
  }),
  getAppDependencies: async () => { ${dependencyRead} }
}});
`
  );
  const result = spawnSync(process.execPath, [bridge, mock], {
    input: JSON.stringify({ action: "query", appId: 1, itemId: "123" }),
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    events: result.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as BridgeEvent),
  };
}

describe("bundled Steam bridge dependency reads", () => {
  it("preserves an actual empty dependency list as a successful query", () => {
    const result = query("return [];");
    expect(result.status).toBe(0);
    expect(result.events).toEqual([
      expect.objectContaining({
        type: "done",
        result: expect.objectContaining({
          action: "query",
          item: expect.objectContaining({ appDependencies: [], children: ["456"], title: "Existing item" }),
        }),
      }),
    ]);
  });

  it("retains the dependency failure cause and never reports a successful empty snapshot", () => {
    const result = query('throw new Error("GetAppDependencies failed: network unavailable");');
    expect(result.status).toBe(1);
    expect(result.events).toEqual([
      {
        type: "error",
        message: "reading the Workshop item failed: GetAppDependencies failed: network unavailable",
        operationStarted: true,
      },
    ]);
  });

  it.each(["module", "init", "content"])(
    "reports %s setup failure before any remote operation",
    (failure) => {
      const mock = path.join(scratch, "setup.cjs");
      fs.writeFileSync(mock, 'exports.init = () => { throw new Error("Steam unavailable"); };');
      const modulePath = failure === "module" ? path.join(scratch, "missing.cjs") : mock;
      const job =
        failure === "content"
          ? {
              action: "publish",
              appId: 1,
              itemId: "123",
              submits: [{ contentPath: path.join(scratch, "missing-content") }],
            }
          : { action: "create", appId: 1 };
      const result = spawnSync(process.execPath, [bridge, modulePath], {
        input: JSON.stringify(job),
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
      });
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout.trim())).toMatchObject({ type: "error", operationStarted: false });
    }
  );

  it("can refresh successfully after a dependency read failed", () => {
    expect(query('throw new Error("temporary failure");').status).toBe(1);
    const refreshed = query("return [789];");
    expect(refreshed.status).toBe(0);
    expect(refreshed.events[0]).toMatchObject({ type: "done", result: { item: { appDependencies: [789] } } });
  });
});
