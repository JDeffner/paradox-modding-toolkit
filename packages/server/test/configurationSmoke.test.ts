/** Real stdio lifecycle coverage for settings and on-disk workspace configuration. */
import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { URI } from "vscode-uri";
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from "vscode-jsonrpc/node";
import {
  configChangedNotification,
  configurationSection,
  indexStatsRequest,
  modFileChangedNotification,
  progressNotification,
  type ParadoxSettings,
  type ProgressPayload,
} from "@px-lsp/protocol/protocol";
import { allProfiles } from "../src/games/registry";
import { indexConfigWatchPatterns } from "@px-lsp/protocol/configDir";

const SERVER = process.env.PX_LSP_SERVER ?? path.join(__dirname, "..", "dist", "server.js");
const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "px-configuration-"));
  cleanup.push(() => {
    const resolved = path.resolve(dir);
    const relative = path.relative(path.resolve(os.tmpdir()), resolved);
    if (
      !relative ||
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      !path.basename(resolved).startsWith("px-configuration-")
    ) {
      throw new Error(`Refusing to remove a fixture outside the temporary directory: ${resolved}`);
    }
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const write = (relative: string, text: string) => {
    const file = path.join(dir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, "utf8");
    return file;
  };
  const mod = path.join(dir, "mod");
  write("mod/common/scripted_effects/first.txt", "px_cfg_first = {}\n");
  const second = path.join(dir, "second");
  write("second/common/scripted_effects/second.txt", "px_cfg_second = {}\n");
  const parent = path.join(dir, "parent");
  write("parent/common/scripted_effects/parent.txt", "px_cfg_parent = {}\n");
  return { dir, mod, second, parent, write };
}

async function client(
  f: ReturnType<typeof fixture>,
  options: {
    settings?: Partial<ParadoxSettings>;
    capabilities?: object;
    pull?: (request: { items: Array<{ section: string; scopeUri?: string }> }) => unknown;
  } = {}
) {
  const child = spawn(process.execPath, [SERVER, "--stdio"], { stdio: ["pipe", "pipe", "pipe"] });
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const conn = createMessageConnection(
    new StreamMessageReader(child.stdout),
    new StreamMessageWriter(child.stdin)
  );
  cleanup.push(async () => {
    conn.dispose();
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("server did not exit during cleanup")), 5000);
      void exited.then(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  });
  let builds = 0;
  let starts = 0;
  let pulls = 0;
  const registrations: Array<{
    method: string;
    registerOptions: { watchers?: Array<{ globPattern: string }> };
  }> = [];
  const listeners = new Set<() => void>();
  const signal = () => listeners.forEach((listener) => listener());
  const wait = (predicate: () => boolean) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        listeners.delete(check);
        reject(new Error("server lifecycle notification timed out"));
      }, 15_000);
      const check = () => {
        if (!predicate()) return;
        clearTimeout(timer);
        listeners.delete(check);
        resolve();
      };
      listeners.add(check);
      check();
    });
  conn.onNotification(progressNotification, (p: ProgressPayload) => {
    if (p.phase === "index") {
      if (p.state === "start") starts++;
      else builds++;
    }
    signal();
  });
  conn.onNotification(() => undefined);
  conn.onRequest("window/workDoneProgress/create", () => null);
  conn.onRequest("client/registerCapability", (p: { registrations: typeof registrations }) => {
    registrations.push(...p.registrations);
    signal();
    return null;
  });
  conn.onRequest("workspace/configuration", (p) => {
    pulls++;
    signal();
    return options.pull?.(p) ?? [null];
  });
  conn.listen();
  await conn.sendRequest("initialize", {
    processId: process.pid,
    rootUri: URI.file(f.mod).toString(),
    workspaceFolders: [{ uri: URI.file(f.mod).toString(), name: "fixture" }],
    capabilities: options.capabilities ?? {},
    initializationOptions: {
      storageDir: f.write("storage/.keep", "").replace(/[/\\]\.keep$/, ""),
      dataDir: f.dir,
      settings: { gameId: "ck3", ...options.settings },
    },
  });
  await conn.sendNotification("initialized", {});
  return {
    conn,
    registrations,
    wait,
    get builds() {
      return builds;
    },
    get starts() {
      return starts;
    },
    get pulls() {
      return pulls;
    },
    built: (count = builds + 1) => wait(() => builds >= count),
    symbols: async () =>
      ((await conn.sendRequest("workspace/symbol", { query: "px_cfg_" })) as Array<{ name: string }>)
        .map((symbol) => symbol.name)
        .sort(),
    patch: (settings: unknown) =>
      conn.sendNotification("workspace/didChangeConfiguration", {
        settings: { [configurationSection]: settings },
      }),
    barrier: () => conn.sendRequest(indexStatsRequest),
  };
}

describe.skipIf(!fs.existsSync(SERVER))("configuration over stdio", () => {
  it("retains inferred unopened roots, replaces explicit roots and applies patch versus replacement semantics", async () => {
    const f = fixture();
    const c = await client(f);
    await c.built(1);
    expect(await c.symbols()).toEqual(["px_cfg_first"]);
    expect(c.pulls).toBe(0);
    expect(c.registrations).toEqual([]);

    await c.conn.sendNotification(configChangedNotification, { gameId: "ck3", locLanguage: "german" });
    await c.built(2);
    expect(await c.symbols()).toEqual(["px_cfg_first"]);
    await c.patch({ parentPaths: [f.parent] });
    await c.built(3);
    expect(await c.symbols()).toEqual(["px_cfg_first", "px_cfg_parent"]);

    const starts = c.starts;
    await c.patch({ hoverDetail: "compact", completionMode: "names" });
    await c.barrier();
    expect(c.starts).toBe(starts);
    expect(await c.symbols()).toEqual(["px_cfg_first", "px_cfg_parent"]);

    // Full custom replacement drops parentPaths and resets omitted display fields.
    await c.conn.sendNotification(configChangedNotification, { modPath: f.second });
    await c.built(4);
    expect(await c.symbols()).toEqual(["px_cfg_second"]);
    await c.patch({ modPath: null, workspaceMods: [f.parent] });
    await c.built(5);
    expect(await c.symbols()).toEqual(["px_cfg_parent"]);
    await c.patch({ workspaceMods: [] });
    await c.built(6);
    expect(await c.symbols()).toEqual(["px_cfg_first"]);

    await c.patch({ modPath: f.second, workspaceMods: [f.parent] });
    await c.built(7);
    expect(await c.symbols()).toEqual(["px_cfg_parent", "px_cfg_second"]);
    await c.patch({ workspaceMods: [] });
    await c.built(8);
    expect(await c.symbols()).toEqual(["px_cfg_second"]);
    const beforeInvalid = c.starts;
    for (const settings of [
      null,
      [],
      { modPath: 7 },
      { parentPaths: null },
      { gameId: null },
      { scopeInlayHints: null },
      { calendar: { epoch: -1 } },
    ]) {
      await c.patch(settings);
    }
    await c.conn.sendNotification(configChangedNotification, { modPath: 7 });
    await c.conn.sendNotification("workspace/didChangeConfiguration", {
      settings: { px: { modPath: f.mod } },
    });
    await c.conn.sendNotification("workspace/didChangeConfiguration", { settings: null });
    await c.barrier();
    expect(c.starts).toBe(beforeInvalid);
    expect(await c.symbols()).toEqual(["px_cfg_second"]);
  });

  it("clears a configured calendar through a standard partial update without rebuilding", async () => {
    const f = fixture();
    const c = await client(f, { settings: { calendar: { epoch: 4000, after: "AD", before: "BC" } } });
    await c.built(1);
    const uri = URI.file(path.join(f.mod, "history/date.txt")).toString();
    await c.conn.sendNotification("textDocument/didOpen", {
      textDocument: { uri, version: 1, languageId: "paradox", text: "birth = 3000.1.1" },
    });
    const hover = () =>
      c.conn.sendRequest<{ contents: { value: string } } | null>("textDocument/hover", {
        textDocument: { uri },
        position: { line: 0, character: 10 },
      });
    expect((await hover())?.contents.value).toContain("BC");
    await c.patch({ calendar: null });
    expect(await hover()).toBeNull();
    expect(c.starts).toBe(1);
  });

  it("uses equivalent custom and standard settings without an extra rebuild", async () => {
    const f = fixture();
    const c = await client(f);
    await c.built(1);
    const settings = { gameId: "ck3", parentPaths: [f.parent], locLanguage: "german" };
    await c.patch(settings);
    await c.built(2);
    expect(await c.symbols()).toEqual(["px_cfg_first", "px_cfg_parent"]);
    await c.conn.sendNotification(configChangedNotification, settings);
    await c.barrier();
    expect(c.starts).toBe(2);
    expect(await c.symbols()).toEqual(["px_cfg_first", "px_cfg_parent"]);
  });

  it("pulls pxLsp before the first build and ignores a late response after newer configuration", async () => {
    const f = fixture();
    const replies: Array<(value: unknown) => void> = [];
    const requests: Array<{ items: Array<{ section: string; scopeUri?: string }> }> = [];
    const c = await client(f, {
      capabilities: {
        workspace: { configuration: true, didChangeConfiguration: { dynamicRegistration: true } },
      },
      pull: (request) => {
        requests.push(request);
        return new Promise((resolve) => replies.push(resolve));
      },
    });
    await c.wait(() => c.pulls === 1);
    expect(c.starts).toBe(0);
    expect(requests[0].items).toEqual([
      { section: configurationSection, scopeUri: URI.file(f.mod).toString() },
    ]);
    replies[0]([{ parentPaths: [f.parent] }]);
    await c.built(1);
    expect(await c.symbols()).toEqual(["px_cfg_first", "px_cfg_parent"]);
    await c.wait(() => c.registrations.length === 1);
    expect(c.registrations[0].method).toBe("workspace/didChangeConfiguration");

    await c.conn.sendNotification("workspace/didChangeConfiguration", { settings: null });
    await c.wait(() => c.pulls === 2);
    await c.patch({ modPath: f.second });
    await c.built(2);
    replies[1]([{ modPath: f.mod, parentPaths: [] }]);
    await c.barrier();
    expect(await c.symbols()).toEqual(["px_cfg_parent", "px_cfg_second"]);

    await c.conn.sendNotification("workspace/didChangeConfiguration", { settings: {} });
    await c.wait(() => c.pulls === 3);
    await c.conn.sendNotification(configChangedNotification, { modPath: f.parent });
    await c.built(3);
    replies[2]([{ modPath: f.mod }]);
    await c.barrier();
    expect(await c.symbols()).toEqual(["px_cfg_parent"]);

    await c.conn.sendNotification("workspace/didChangeConfiguration", { settings: null });
    await c.wait(() => c.pulls === 4);
    await c.conn.sendNotification("workspace/didChangeConfiguration", { settings: null });
    await c.wait(() => c.pulls === 5);
    replies[4]([{ modPath: f.second }]);
    await c.built(4);
    replies[3]([{ modPath: f.mod }]);
    await c.barrier();
    expect(await c.symbols()).toEqual(["px_cfg_second"]);
  });

  it.each(["absent", "failed"])(
    "keeps initialization settings after an %s configuration pull without dynamic registration",
    async (result) => {
      const f = fixture();
      const c = await client(f, {
        settings: { modPath: f.second },
        capabilities: { workspace: { configuration: true } },
        pull: () => {
          if (result === "failed") throw new Error("unavailable");
          return [null];
        },
      });
      await c.built(1);
      expect(c.pulls).toBe(1);
      expect(c.registrations).toEqual([]);
      expect(await c.symbols()).toEqual(["px_cfg_second"]);
    }
  );

  it("republishes open-document diagnostics when playset localization appears and disappears", async () => {
    const f = fixture();
    // The trait fixture and its required localization follow CK3_SCHEMA's _traits.info-derived entry.
    const entry = allProfiles()
      .find((profile) => profile.id === "ck3")!
      .schema.find((entry) => entry.kind === "trait")!;
    const name = "px_cfg_trait";
    const key = entry.requiredLoc![0].replace("$", name);
    const text = `${name} = { category = personality martial = 2 }`;
    const file = f.write(`mod/${entry.path}/trait.txt`, "\uFEFF" + text);
    f.write(
      "parent/localization/english/traits_l_english.yml",
      `\uFEFFl_english:\n ${key}:0 "Fixture trait"\n`
    );
    const c = await client(f);
    await c.built(1);
    const uri = URI.file(file).toString();
    const published: Array<Array<{ code?: string | number }>> = [];
    c.conn.onNotification(
      "textDocument/publishDiagnostics",
      (params: { uri: string; diagnostics: Array<{ code?: string | number }> }) => {
        if (params.uri === uri) published.push(params.diagnostics);
      }
    );
    await c.conn.sendNotification("textDocument/didOpen", {
      textDocument: { uri, version: 1, languageId: "paradox", text },
    });
    await c.barrier();
    expect(published.at(-1)?.map((diagnostic) => diagnostic.code)).toContain("missing-required-loc");

    const playset = f.write("mod/.px-toolkit/playset.json", JSON.stringify({ parents: [f.parent] }));
    let before = published.length;
    await c.conn.sendNotification(modFileChangedNotification, { fsPath: playset });
    await c.built(2);
    await c.barrier();
    expect(published.length).toBeGreaterThan(before);
    expect(published.at(-1)?.map((diagnostic) => diagnostic.code)).not.toContain("missing-required-loc");

    before = published.length;
    fs.unlinkSync(playset);
    await c.conn.sendNotification(modFileChangedNotification, { fsPath: playset });
    await c.built(3);
    await c.barrier();
    expect(published.length).toBeGreaterThan(before);
    expect(published.at(-1)?.map((diagnostic) => diagnostic.code)).toContain("missing-required-loc");
  });

  it("refreshes dependency data-binding macros when the playset changes", async () => {
    const f = fixture();
    f.write(
      "parent/data_binding/macros.txt",
      `macro = {
      definition = "PxCfgParentMacro(Value)"
      replace_with = "EqualTo_int32(Value, '(int32)0')"
    }`
    );
    const c = await client(f);
    await c.built(1);
    const uri = URI.file(path.join(f.mod, "localization/english/macro_l_english.yml")).toString();
    const text = 'l_english:\n macro_label:0 "[PxCfgParentMac"';
    await c.conn.sendNotification("textDocument/didOpen", {
      textDocument: { uri, version: 1, languageId: "paradox-loc", text },
    });
    const macros = async () => {
      const result = await c.conn.sendRequest<{ items: Array<{ label: string }> }>(
        "textDocument/completion",
        { textDocument: { uri }, position: { line: 1, character: text.split("\n")[1].length - 1 } }
      );
      return result.items.map((item) => item.label);
    };
    expect(await macros()).not.toContain("PxCfgParentMacro");
    const playset = f.write("mod/.px-toolkit/playset.json", JSON.stringify({ parents: [f.parent] }));
    await c.conn.sendNotification(modFileChangedNotification, { fsPath: playset });
    await c.built(2);
    expect(await macros()).toContain("PxCfgParentMacro");
    fs.unlinkSync(playset);
    await c.conn.sendNotification(modFileChangedNotification, { fsPath: playset });
    await c.built(3);
    expect(await macros()).not.toContain("PxCfgParentMacro");
  });

  for (const profile of allProfiles()) {
    for (const transport of ["standard", "custom"] as const) {
      it(`${profile.id}: reloads schema/playset create, edit and delete through ${transport} watching`, async () => {
        const f = fixture();
        const c = await client(f, {
          settings: { gameId: profile.id },
          capabilities: { workspace: { didChangeWatchedFiles: { dynamicRegistration: true } } },
        });
        await c.built(1);
        await c.patch({ hoverDetail: "compact" });
        await c.barrier();
        expect(c.starts).toBe(1);
        await c.wait(() => c.registrations.length > 0);
        const patterns = c.registrations.flatMap(
          (registration) => registration.registerOptions.watchers?.map((watcher) => watcher.globPattern) ?? []
        );
        expect(patterns).toEqual(expect.arrayContaining(indexConfigWatchPatterns(profile)));
        const entry = profile.schema.find((entry) => entry.kind === "scripted_effect")!;
        expect(entry).toBeDefined();
        f.write("mod/common/px_cfg_custom/one.txt", "px_cfg_custom = {}\n");
        f.write("mod/common/px_cfg_other/two.txt", "px_cfg_other = {}\n");
        const notify = async (files: string[], type: number) => {
          if (transport === "standard")
            await c.conn.sendNotification("workspace/didChangeWatchedFiles", {
              changes: files.map((file) => ({ uri: URI.file(file).toString(), type })),
            });
          else
            for (const fsPath of files) await c.conn.sendNotification(modFileChangedNotification, { fsPath });
        };
        const names = [profile.configDirName, profile.legacyConfigDirName].filter(
          (name): name is string => !!name
        );
        for (const dirName of names) {
          const schema = f.write(
            `mod/${dirName}/schema.json`,
            JSON.stringify({ entries: [{ ...entry, path: "common/px_cfg_custom" }] })
          );
          const playset = f.write(`mod/${dirName}/playset.json`, JSON.stringify({ parents: [f.parent] }));
          const before = c.builds;
          await notify([schema, playset], 1);
          // Both transports can report the same save; the pair must still cause one build.
          await c.conn.sendNotification(modFileChangedNotification, { fsPath: schema });
          await c.conn.sendNotification("workspace/didChangeWatchedFiles", {
            changes: [{ uri: URI.file(playset).toString(), type: 2 }],
          });
          await c.built(before + 1);
          expect(c.starts).toBe(before + 1);
          expect(await c.symbols()).toEqual(["px_cfg_custom", "px_cfg_first", "px_cfg_parent"]);
          fs.writeFileSync(schema, JSON.stringify({ entries: [{ ...entry, path: "common/px_cfg_other" }] }));
          fs.writeFileSync(playset, JSON.stringify({ parents: [f.second] }));
          await notify([schema, playset], 2);
          await c.built(before + 2);
          expect(await c.symbols()).toEqual(["px_cfg_first", "px_cfg_other", "px_cfg_second"]);
          fs.unlinkSync(schema);
          fs.unlinkSync(playset);
          await notify([schema, playset], 3);
          await c.built(before + 3);
          expect(await c.symbols()).toEqual(["px_cfg_first"]);
          fs.rmdirSync(path.dirname(schema));
        }
      }, 30_000);
    }
  }
});
