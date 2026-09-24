import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { encodePng, decodeDds } from "@px-lsp/server/dds";
import { finishChanges } from "../src/writes";
import { resolveConfig } from "../src/config";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, link: vi.fn(actual.link) };
});

const exec = promisify(execFile);
const bundle = path.resolve("packages/cli/dist/pxtk.cjs");
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PX_")));
let mod: string;
// JSON is the public command contract; assertions below inspect its operation-specific data.
async function run(...args: string[]) {
  try {
    const { stdout } = await exec(process.execPath, [bundle, ...args, "--json"], {
      cwd: mod,
      env,
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { code: 0, body: JSON.parse(stdout) };
  } catch (error) {
    const result = error as { code: number; stdout: string };
    if (!result.stdout) throw error;
    return { code: result.code, body: JSON.parse(result.stdout) };
  }
}
beforeAll(async () => {
  await fs.mkdir(".local/testing", { recursive: true });
  mod = await fs.mkdtemp(path.resolve(".local/testing/pxtk utilities ü "));
  await fs.mkdir(path.join(mod, ".px-toolkit"));
  await fs.mkdir(path.join(mod, ".metadata"));
  await fs.writeFile(path.join(mod, ".metadata/metadata.json"), '{"name":"Utility fixture"}');
  await fs.writeFile(path.join(mod, "descriptor.mod"), '\uFEFFname="Utility fixture"\n');
  await fs.writeFile(
    path.join(mod, ".px-toolkit/pxtk.json"),
    JSON.stringify({ game: "ck3", gamePath: null, logsPath: null, tigerPath: null })
  );
});
afterAll(async () => {
  if (mod) await fs.rm(mod, { recursive: true, force: true });
});

describe("pxtk preparation commands", () => {
  it("lists profile-derived kinds and creates/appends events with paired localization", async () => {
    expect((await run("create")).body.data.supported).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "event" })])
    );
    const preview = await run("create", "event", "utility.1", "--prefix", "utility");
    expect(preview.code).toBe(0);
    expect(preview.body.data.changed).toBe(2);
    await expect(fs.access(path.join(mod, "events/utility_events.txt"))).rejects.toThrow();
    const write = await run(
      "create",
      "event",
      "utility.1",
      "--prefix",
      "utility",
      "--write",
      "--expect",
      preview.body.data.previewToken
    );
    expect(write.code).toBe(0);
    const file = path.join(mod, "events/utility_events.txt");
    const first = await fs.readFile(file, "utf8");
    expect(first.startsWith("\uFEFFnamespace = utility\n")).toBe(true);
    expect(
      await fs.readFile(path.join(mod, "localization/english/utility_events_l_english.yml"), "utf8")
    ).toContain("\uFEFFl_english:\n utility_1_t:0");
    expect((await run("create", "event", "utility.2", "--prefix", "utility", "--write")).code).toBe(0);
    expect((await fs.readFile(file, "utf8")).startsWith(first)).toBe(true);
    expect(
      (await run("create", "event", "utility.1", "--prefix", "utility", "--write")).body.error.code
    ).toBe("duplicate_definition");
  });
  it.each(["vic3", "eu5"])("uses the %s profile and its stage roots", async (game) => {
    const result = await run(
      "create",
      "scripted_effect",
      "other_effect",
      "--prefix",
      "other",
      "--game",
      game
    );
    expect(result.code).toBe(0);
    expect(result.body.data.files[0].file.startsWith(game === "eu5" ? "in_game/" : "common/")).toBe(true);
    expect((await run("create", "unknown", "x", "--game", game)).body.error.code).toBe("unsupported_kind");
    if (game === "eu5")
      expect((await run("create", "event", "other.1", "--game", game)).body.error.code).toBe(
        "unsupported_kind"
      );
  });
  it("updates localization without losing BOM, comments, versions, line endings or siblings", async () => {
    const file = path.join(mod, "localization/english/utility_events_l_english.yml");
    await fs.writeFile(
      file,
      '\uFEFFl_english:\r\n # keep this comment\r\n utility_1_t:7 "Old title" # retain\r\n utility_sibling:0 "Untouched"\r\n'
    );
    const result = await run("loc", "set", "utility_1_t", "--value", 'A "quote"\nNext', "--write");
    expect(result.code).toBe(0);
    const text = await fs.readFile(file, "utf8");
    expect(text).toBe(
      '\uFEFFl_english:\r\n # keep this comment\r\n utility_1_t:7 "A \\"quote\\"\\nNext" # retain\r\n utility_sibling:0 "Untouched"\r\n'
    );
    expect((await run("loc", "get", "utility_1_t")).body.data.entries[0].source).toBe("mod");
    expect(
      (await run("loc", "set", "utility_new", "--value", "New", "--write")).body.data.files[0].file
    ).toBe("localization/english/utility_events_l_english.yml");
    expect(
      (
        await run(
          "loc",
          "set",
          "fresh_key",
          "--value",
          "New",
          "--file",
          "localization/replace/english/test_l_english.yml",
          "--write"
        )
      ).body.error.code
    ).toBe("not_vanilla_override");
    const check = await run("loc", "check");
    expect(check.body.data.missing.total).toBeGreaterThan(0);
    expect(check.code).toBe(1);
  });
  it("rejects a stale preview and paths outside the mod", async () => {
    const preview = await run("loc", "set", "utility_1_t", "--value", "New");
    const file = path.join(mod, "localization/english/utility_events_l_english.yml");
    await fs.appendFile(file, " # concurrent edit\r\n");
    const changed = await fs.readFile(file);
    const result = await run(
      "loc",
      "set",
      "utility_1_t",
      "--value",
      "New",
      "--write",
      "--expect",
      preview.body.data.previewToken
    );
    expect(result.body.error.code).toBe("stale_preview");
    expect(await fs.readFile(file)).toEqual(changed);
    expect((await run("format", "../outside.txt", "--write")).body.error.code).toBe("outside_mod");
  });
  it("formats only indentation, preserves BOM and is idempotent", async () => {
    const file = path.join(mod, "format.txt");
    await fs.writeFile(file, "\uFEFFutility = {\r\nvalue = yes # unchanged\r\n}\r\n");
    expect((await run("format", "format.txt", "--check")).code).toBe(1);
    expect((await run("format", "format.txt", "--write")).code).toBe(0);
    expect(await fs.readFile(file, "utf8")).toBe("\uFEFFutility = {\r\n\tvalue = yes # unchanged\r\n}\r\n");
    expect((await run("format", "format.txt", "--check")).code).toBe(0);
    expect((await run("format", "format.txt", "--check", "--write")).code).toBe(2);
  });
  it("groups log records, carries multiline context, detects rotation and retains unparsed text", async () => {
    const file = path.join(mod, "error.log");
    await fs.writeFile(file, "[10:00:00][E][script.cpp:1]: Old in file: events/x.txt line: 3\n");
    expect(
      (
        await run(
          "logs",
          "checkpoint",
          "--file",
          "error.log",
          "--output",
          ".px-toolkit/log-start.json",
          "--write"
        )
      ).code
    ).toBe(0);
    await fs.appendFile(
      file,
      "[10:00:01][E][script.cpp:1]: New in file: events/x.txt line: 5\n[10:00:02][E][script.cpp:1]: New in file: events/x.txt line: 5\n[10:00:03][E][script.cpp:1]: Script system error!\n Error: Broken scope\n Script location: file: events/x.txt line: 8\n[10:00:04][engine.cpp:2]: Unknown record\npartial"
    );
    const result = await run("logs", "--file", "error.log", "--since", ".px-toolkit/log-start.json");
    expect(result.body.data.occurrences).toBe(4);
    expect(result.body.data.entries.items[0].count).toBe(2);
    expect(result.body.data.entries.items[1]).toMatchObject({
      message: "Broken scope",
      line: 8,
      parsed: true,
    });
    expect(result.body.data.entries.items[2].parsed).toBe(false);
    expect(result.body.data.pendingBytes).toBe(7);
    await fs.writeFile(file, "[10:01:00][engine.cpp:2]: Replaced\n");
    const rotated = await run("logs", "--file", "error.log", "--since", ".px-toolkit/log-start.json");
    expect(rotated.body.data.resetReason).toContain("replaced");
    expect(rotated.body.data.occurrences).toBe(1);
  });
  it("inspects and converts images, preserves alpha and source, and rejects collisions", async () => {
    const pixels = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 200;
      pixels[i + 3] = i === 0 ? 0 : 255;
    }
    const png = Buffer.from(encodePng(4, 4, pixels));
    await fs.mkdir(path.join(mod, "art"));
    await fs.writeFile(path.join(mod, "art/icon.png"), png);
    expect((await run("image", "inspect", "art/icon.png")).body.data.images.items[0]).toMatchObject({
      width: 4,
      height: 4,
      alpha: true,
    });
    const args = [
      "image",
      "convert",
      "art/icon.png",
      "--to",
      "dds",
      "--output",
      "gfx/icon.dds",
      "--dds",
      "bgra8",
    ];
    expect((await run(...args)).body.data.mode).toBe("preview");
    await expect(fs.access(path.join(mod, "gfx/icon.dds"))).rejects.toThrow();
    expect((await run(...args, "--write")).code).toBe(0);
    expect(decodeDds(await fs.readFile(path.join(mod, "gfx/icon.dds"))).pixels).toEqual(pixels);
    expect(await fs.readFile(path.join(mod, "art/icon.png"))).toEqual(png);
    expect((await run(...args, "--write")).body.error.code).toBe("output_exists");
    expect(
      (await run("image", "convert", "art/icon.png", "--to", "jpeg", "--output", "gfx/icon.jpg", "--write"))
        .body.error.code
    ).toBe("background_required");
    expect(
      (
        await run(
          "image",
          "convert",
          "art/icon.png",
          "--to",
          "jpeg",
          "--output",
          "gfx/icon.jpg",
          "--background",
          "#ffffff",
          "--write"
        )
      ).code
    ).toBe(0);
    expect(
      (
        await run(
          "image",
          "convert",
          "gfx/icon.dds",
          "--to",
          "webp",
          "--output",
          "gfx/icon.webp",
          "--width",
          "8",
          "--height",
          "8",
          "--write"
        )
      ).code
    ).toBe(0);
    expect((await run("image", "inspect", "gfx/icon.webp")).body.data.images.items[0]).toMatchObject({
      width: 8,
      height: 8,
    });
    await fs.mkdir(path.join(mod, "art/nested"));
    await fs.writeFile(path.join(mod, "art/nested/second.png"), png);
    expect(
      (await run("image", "convert", "art", "--to", "dds", "--output", "batch", "--write")).body.data.written
    ).toHaveLength(2);
    await fs.access(path.join(mod, "batch/nested/second.dds"));
    await fs.writeFile(path.join(mod, "bad.png"), "not an image");
    expect(
      (await run("image", "convert", "bad.png", "--to", "png", "--output", "bad-output.png", "--write")).code
    ).toBe(2);
    await expect(fs.access(path.join(mod, "bad-output.png"))).rejects.toThrow();
  });
  it("reports write failures without claiming completion", async () => {
    const config = await resolveConfig({ cwd: mod, env });
    const occupied = path.join(config.mod, "occupied");
    await fs.mkdir(occupied);
    await expect(
      finishChanges(config, { operation: "format", write: true }, [
        {
          file: path.join(occupied, "child.txt"),
          before: null,
          after: Buffer.from("new"),
        },
        { file: occupied, before: null, after: Buffer.from("invalid") },
      ])
    ).rejects.toThrow();
    await expect(fs.access(path.join(occupied, "child.txt"))).rejects.toThrow();
  });
  it("serves utility previews and explicit writes through MCP", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [bundle, "mcp"],
      cwd: mod,
      stderr: "pipe",
    });
    const client = new Client({ name: "utility-test", version: "1" });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.find((tool) => tool.name === "pxtk_create")?.annotations?.readOnlyHint).toBe(false);
      const preview = await client.callTool({
        name: "pxtk_create",
        arguments: { kind: "event", name: "mcputility.1", prefix: "mcputility" },
      });
      expect(preview.structuredContent).toMatchObject({
        operation: "create",
        data: { mode: "preview", changed: 2 },
      });
      const write = await client.callTool({
        name: "pxtk_create",
        arguments: { kind: "event", name: "mcputility.1", prefix: "mcputility", write: true },
      });
      expect(write.structuredContent).toMatchObject({ data: { mode: "written" } });
      const collision = await client.callTool({
        name: "pxtk_create",
        arguments: { kind: "event", name: "mcputility.1", prefix: "mcputility", write: true },
      });
      expect(collision.isError).toBe(true);
    } finally {
      await client.close();
    }
  });
  it("reports exactly which files completed when a later write fails", async () => {
    const config = await resolveConfig({ cwd: mod, env });
    const first = path.join(config.mod, "partial-first.txt");
    const second = path.join(config.mod, "partial-second.txt");
    const { link } = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const injected = vi.mocked(fs.link).mockImplementation(async (from, to) => {
      if (to === second) throw new Error("Simulated filesystem failure");
      return link(from, to);
    });
    try {
      await expect(
        finishChanges(config, { operation: "create", write: true }, [
          { file: first, before: null, after: Buffer.from("first") },
          { file: second, before: null, after: Buffer.from("second") },
        ])
      ).rejects.toThrow("Completed files: " + JSON.stringify([first]));
      expect(await fs.readFile(first, "utf8")).toBe("first");
      await expect(fs.access(second)).rejects.toThrow();
    } finally {
      injected.mockRestore();
    }
  });
  it("refuses outputs through linked directories", async () => {
    const alias = path.join(mod, "linked-gfx");
    await fs.symlink(path.join(mod, "gfx"), alias, process.platform === "win32" ? "junction" : "dir");
    try {
      const result = await run(
        "image",
        "convert",
        "art/icon.png",
        "--to",
        "png",
        "--output",
        "linked-gfx/linked.png",
        "--write"
      );
      expect(result.body.error.code).toBe("linked_destination");
      await expect(fs.access(path.join(mod, "gfx/linked.png"))).rejects.toThrow();
    } finally {
      await fs.unlink(alias);
    }
  });
  it("creates configuration exclusively for an existing mod", async () => {
    const child = path.join(mod, "another");
    await fs.mkdir(child);
    await fs.writeFile(path.join(child, "descriptor.mod"), '\uFEFFname="Another"\n');
    // Explicit mod selection keeps the parent project config from becoming the destination.
    const result = await run("init", "--mod", child, "--write");
    expect(result.code).toBe(0);
    expect(JSON.parse(await fs.readFile(path.join(child, ".px-toolkit/pxtk.json"), "utf8"))).toMatchObject({
      game: "ck3",
      mod: ".",
    });
    expect((await run("init", "--mod", child, "--write")).body.error.code).toBe("config_exists");
  });
  it("returns measured templates and labels focused validation coverage", async () => {
    expect(
      (await run("create", "scripted_effect", "utility_effect", "--prefix", "utility", "--write")).code
    ).toBe(0);
    const inspect = await run(
      "inspect",
      "utility_effect",
      "--kind",
      "scripted_effect",
      "--templates",
      "--examples"
    );
    expect(inspect.code).toBe(0);
    expect(inspect.body.data.templates.total).toBeGreaterThan(0);
    expect(inspect.body.data.examples).toHaveProperty("truncated");
    const validation = await run("validate", "format.txt");
    expect(validation.code).toBe(2);
    expect(validation.body.data.scope).toEqual({
      structural: "selected_files",
      tiger: "workspace",
      selected: ["format.txt"],
    });
    expect(validation.body.data.structural.files).toBe(1);
    expect(validation.body.data.context.selection).toBe('["format.txt"]');
  });
});
