import { beforeAll, afterAll, describe, it, expect } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { PxtkResult } from "@px-lsp/protocol/agentTools";

const exec = promisify(execFile);
const bundle = path.resolve("packages/cli/dist/pxtk.cjs");
const scratch = path.resolve(".local/testing");
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PX_")));
let mod: string;
async function run(...args: string[]) {
  try {
    const result = await exec(process.execPath, [bundle, ...args, "--json"], {
      cwd: mod,
      env,
      timeout: 60_000,
      maxBuffer: 5 * 1024 * 1024,
    });
    return { code: 0, body: JSON.parse(result.stdout) as PxtkResult, stderr: result.stderr };
  } catch (error) {
    const result = error as { code: number; stdout: string; stderr: string };
    if (!result.stdout) throw error;
    return { code: result.code, body: JSON.parse(result.stdout) as PxtkResult, stderr: result.stderr };
  }
}
beforeAll(async () => {
  await fs.access(bundle);
  await fs.mkdir(scratch, { recursive: true });
  mod = await fs.mkdtemp(path.join(scratch, "pxtk mod ü "));
  await fs.mkdir(path.join(mod, ".px-toolkit"));
  await fs.mkdir(path.join(mod, ".metadata"));
  await fs.writeFile(path.join(mod, ".metadata/metadata.json"), JSON.stringify({ name: "pxtk fixture" }));
  await fs.mkdir(path.join(mod, "common/scripted_effects"), { recursive: true });
  await fs.writeFile(path.join(mod, "descriptor.mod"), '\uFEFFname="pxtk fixture"\n');
  await fs.writeFile(
    path.join(mod, ".px-toolkit/pxtk.json"),
    JSON.stringify({ game: "ck3", gamePath: null, logsPath: null, tigerPath: null })
  );
  await fs.writeFile(
    path.join(mod, "common/scripted_effects/probe.txt"),
    "\uFEFFpxtk_target = { }\npxtk_caller = { pxtk_target = yes }\n"
  );
});
afterAll(async () => {
  if (mod) await fs.rm(mod, { recursive: true, force: true });
});

describe("packaged pxtk entry point", () => {
  it("reports loaded knowledge and unavailable deep validation separately", async () => {
    const { code, body, stderr } = await run("status");
    expect(code).toBe(2);
    expect(body.operation).toBe("status");
    expect(body.status).toBe("incomplete");
    expect(body.sources.game).toBe("ck3");
    expect(body.sources.savedFilesOnly).toBe(true);
    expect(body.sources.documentation).toBe("bundled");
    expect(body.data.index).toMatchObject({ indexing: false });
    expect(body.data.capabilities).toMatchObject({ tigerConfigured: false, structuralValidation: true });
    expect(stderr).toBe("");
  });
  it("finds the mod definition and reads its actual source", async () => {
    const search = await run("search", "pxtk_target", "--limit", "1");
    expect(search.code).toBe(0);
    expect(search.body.data.definitions).toMatchObject({ items: [{ name: "pxtk_target" }] });
    const inspect = await run("inspect", "pxtk_target", "--kind", "scripted_effect");
    expect(inspect.code).toBe(0);
    const definitions = inspect.body.data.definitions as {
      items: Array<{ source: { context: string[]; line: number } }>;
    };
    expect(definitions.items[0].source.context.join("\n")).toContain("pxtk_target = { }");
    expect(definitions.items[0].source.line).toBe(1);
  });
  it("reports a real caller and the limits of reference coverage", async () => {
    const { code, body } = await run("impact", "pxtk_target", "--kind", "scripted_effect");
    expect(code).toBe(0);
    expect(body.data.callers).toMatchObject({ items: [{ name: "pxtk_caller", line: 2 }] });
    expect(body.data.references).toMatchObject({ items: [expect.objectContaining({ line: 2 })] });
    expect(body.data.coverage).toMatchObject({ lines: "1-based" });
  });
  it("does not call missing Tiger a clean validation run", async () => {
    const { code, body } = await run("validate");
    expect(code).toBe(2);
    expect(body.data.structural).toMatchObject({ status: "complete", files: 2 });
    expect(body.data.tiger).toMatchObject({ status: "unavailable" });
    expect(body.data.gameplayTested).toBe(false);
  });
  it("reports a structural error and sees subsequent saved edits", async () => {
    const broken = path.join(mod, "common/scripted_effects/broken.txt");
    await fs.writeFile(broken, "\uFEFFpxtk_broken = {");
    const result = await run("validate");
    expect(result.body.data.newErrors).toBeGreaterThan(0);
    await fs.unlink(broken);
    const fixed = await run("validate");
    expect(fixed.body.data.newErrors).toBe(0);
  });
  it("returns machine-readable errors for invalid arguments", async () => {
    const result = await run("search", "pxtk", "--game", "unknown");
    expect(result.code).toBe(2);
    expect(result.body).toMatchObject({ status: "error", error: { code: "game_required" } });
    expect((await run("search", "pxtk", "--limit", "0")).code).toBe(2);
  });
  it.each(["vic3", "eu5"])("loads the %s profile and reports its supported validator", async (game) => {
    const result = await run("status", "--game", game);
    expect(result.code).toBe(2);
    expect(result.body.sources.game).toBe(game);
    if (game === "eu5") expect(result.body.sources.documentation).toBe("none");
    expect(result.body.data.capabilities).toMatchObject({ knowledge: true, tigerSupported: game === "vic3" });
  });
  it("serves the same operations through an MCP client and refreshes between calls", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [bundle, "mcp"],
      cwd: mod,
      stderr: "pipe",
    });
    const client = new Client({ name: "pxtk-test", version: "1.0.0" });
    try {
      await client.connect(transport);
      const list = await client.listTools();
      expect(list.tools.map((tool) => tool.name).sort()).toEqual([
        "pxtk_create",
        "pxtk_format",
        "pxtk_image",
        "pxtk_impact",
        "pxtk_init",
        "pxtk_inspect",
        "pxtk_loc",
        "pxtk_logs",
        "pxtk_search",
        "pxtk_status",
        "pxtk_validate",
      ]);
      const status = await client.callTool({ name: "pxtk_status", arguments: {} });
      expect(status.structuredContent).toMatchObject({ status: "incomplete", operation: "status" });
      expect(status.isError).toBe(true);
      const first = await client.callTool({ name: "pxtk_search", arguments: { query: "pxtk_target" } });
      expect(first.structuredContent).toMatchObject({ status: "ok", operation: "search" });
      const file = path.join(mod, "common/scripted_effects/fresh.txt");
      await fs.writeFile(file, "\uFEFFpxtk_after_start = {}\n");
      const second = await client.callTool({
        name: "pxtk_inspect",
        arguments: { name: "pxtk_after_start", kind: "scripted_effect" },
      });
      expect(second.structuredContent).toMatchObject({ status: "ok", operation: "inspect" });
      await fs.unlink(file);
      const invalid = await client.callTool({ name: "pxtk_search", arguments: { query: "" } });
      expect(invalid.isError).toBe(true);
    } finally {
      await client.close();
    }
  });
});
