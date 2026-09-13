import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { URI } from "vscode-uri";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from "vscode-jsonrpc/node";
import {
  configChangedNotification,
  statusNotification,
  type ParadoxSettings,
  type StatusPayload,
} from "@px-lsp/protocol/protocol";

const SERVER = path.join(__dirname, "..", "dist", "server.js");
const hasServer = fs.existsSync(SERVER);
if (!hasServer) {
  process.stderr.write("indexCacheSmoke: skipped, run `pnpm run compile` to build the server.\n");
}

interface SymbolResult {
  name: string;
  location: { uri: string };
}

describe.skipIf(!hasServer)("vanilla index cache over stdio", () => {
  let scratch: string;
  let storageDir: string;
  let modDir: string;
  let gameA: string;
  let gameB: string;
  let child: ChildProcess | undefined;
  let conn: MessageConnection;
  let exited: Promise<number | null>;
  const statuses: StatusPayload[] = [];
  const logs: string[] = [];

  function write(file: string, content: string): string {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, "utf8");
    return file;
  }

  function install(name: string): string {
    const root = path.join(scratch, name);
    write(path.join(root, "launcher/launcher-settings.json"), JSON.stringify({ rawVersion: "1.0" }));
    write(path.join(root, "game/common/scripted_effects/cache.txt"), `px_cache_${name} = {}`);
    write(path.join(root, "jomini/common/scripted_effects/cache.txt"), `px_cache_engine_${name} = {}`);
    write(
      path.join(root, "game/common/cache_fixture/cache.txt"),
      'px_cache_schema_key = { name = "px_cache_schema_named" }'
    );
    return path.join(root, "game");
  }

  function writeSchema(extraction: "top-level-key" | "named-block"): void {
    write(
      path.join(modDir, ".px-toolkit/schema.json"),
      JSON.stringify({ entries: [{ path: "common/cache_fixture", kind: "cache_fixture", extraction }] })
    );
  }

  function settings(gamePath: string): ParadoxSettings {
    return {
      gamePath,
      modPath: modDir,
      logsPath: null,
      parentPaths: [],
      locLanguage: "english",
      scopeInlayHints: false,
      diagnosticsIgnore: [],
      diagnosticsIgnorePatterns: [],
      diagnosticsVanilla: false,
    };
  }

  async function indexedSince(start: number): Promise<void> {
    await expect
      .poll(
        () => statuses.slice(start).some((status) => status.indexing) && statuses.at(-1)?.indexing === false,
        { timeout: 15_000 }
      )
      .toBe(true);
  }

  async function start(gamePath: string): Promise<void> {
    statuses.length = 0;
    logs.length = 0;
    child = spawn(process.execPath, [SERVER, "--stdio"], { stdio: ["pipe", "pipe", "pipe"] });
    exited = new Promise((resolve) => child!.once("exit", resolve));
    child.stderr!.on("data", (chunk: Buffer) => logs.push(chunk.toString()));
    conn = createMessageConnection(
      new StreamMessageReader(child.stdout!),
      new StreamMessageWriter(child.stdin!)
    );
    conn.onNotification(statusNotification, (status: StatusPayload) => {
      statuses.push(status);
    });
    conn.onNotification("window/logMessage", (message: { message: string }) => {
      logs.push(message.message);
    });
    conn.onNotification(() => undefined);
    conn.onRequest("window/workDoneProgress/create", () => null);
    conn.listen();
    await conn.sendRequest("initialize", {
      processId: process.pid,
      rootUri: URI.file(modDir).toString(),
      capabilities: {},
      initializationOptions: { storageDir, settings: settings(gamePath) },
    });
    await conn.sendNotification("initialized", {});
    await indexedSince(0);
  }

  async function stop(): Promise<void> {
    await conn.sendRequest("shutdown");
    await conn.sendNotification("exit");
    expect(await exited).toBe(0);
    conn.dispose();
    child = undefined;
  }

  async function symbols(): Promise<Array<{ name: string; uri: string }>> {
    const result = await conn.sendRequest<SymbolResult[]>("workspace/symbol", { query: "px_cache_" });
    return result
      .map(({ name, location }) => ({ name, uri: location.uri }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function expectedSymbols(gamePath: string, schemaName = "px_cache_schema_key") {
    const installName = path.basename(path.dirname(gamePath));
    return [
      {
        name: `px_cache_${installName}`,
        uri: URI.file(path.join(gamePath, "common/scripted_effects/cache.txt")).toString(),
      },
      {
        name: `px_cache_engine_${installName}`,
        uri: URI.file(path.join(gamePath, "../jomini/common/scripted_effects/cache.txt")).toString(),
      },
      { name: schemaName, uri: URI.file(path.join(gamePath, "common/cache_fixture/cache.txt")).toString() },
    ].sort((a, b) => a.name.localeCompare(b.name));
  }

  function cacheFiles(): string[] {
    return fs.readdirSync(storageDir).filter((name) => name.startsWith("vanillaIndex"));
  }

  beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "px-index-cache-smoke-"));
    storageDir = path.join(scratch, "storage");
    modDir = path.join(scratch, "mod");
    gameA = install("installation_a");
    gameB = install("installation_b");
    writeSchema("top-level-key");
  });

  afterEach(async () => {
    if (child) {
      child.kill();
      await exited;
      conn.dispose();
      child = undefined;
    }
    const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(scratch));
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Cache smoke scratch directory escaped the temporary root");
    fs.rmSync(path.resolve(scratch), { recursive: true, force: true });
  });

  it("switches equal-version installations live and reuses the correct cache after restart", async () => {
    await start(gameA);
    expect(await symbols()).toEqual(expectedSymbols(gameA));
    expect(cacheFiles()).toHaveLength(1);

    const statusStart = statuses.length;
    await conn.sendNotification(configChangedNotification, settings(gameB));
    await indexedSince(statusStart);
    expect(await symbols()).toEqual(expectedSymbols(gameB));
    expect(cacheFiles()).toHaveLength(2);
    await stop();

    await start(gameB);
    expect(await symbols()).toEqual(expectedSymbols(gameB));
    expect(logs.some((line) => line.includes("loaded vanilla index from cache:"))).toBe(true);
    expect(cacheFiles()).toHaveLength(2);
    await stop();
  }, 45_000);

  it("rescans the same installation when the effective schema changes, then reuses that schema cache", async () => {
    await start(gameB);
    expect(await symbols()).toEqual(expectedSymbols(gameB));
    expect(cacheFiles()).toHaveLength(1);
    await stop();

    writeSchema("named-block");
    await start(gameB);
    expect(await symbols()).toEqual(expectedSymbols(gameB, "px_cache_schema_named"));
    expect(logs.some((line) => line.includes("loaded vanilla index from cache:"))).toBe(false);
    expect(cacheFiles()).toHaveLength(2);
    await stop();

    await start(gameB);
    expect(await symbols()).toEqual(expectedSymbols(gameB, "px_cache_schema_named"));
    expect(logs.some((line) => line.includes("loaded vanilla index from cache:"))).toBe(true);
    expect(cacheFiles()).toHaveLength(2);
    await stop();
  }, 45_000);

  it.each(["standard", "custom"])(
    "reloads vanilla schema changes through %s file notifications",
    async (transport) => {
      await start(gameB);
      expect(await symbols()).toEqual(expectedSymbols(gameB));
      const schemaFile = path.join(modDir, ".px-toolkit/schema.json");
      const notify = async (type: number) => {
        const statusStart = statuses.length;
        if (transport === "standard") {
          await conn.sendNotification("workspace/didChangeWatchedFiles", {
            changes: [{ uri: URI.file(schemaFile).toString(), type }],
          });
        } else {
          await conn.sendNotification("paradox/modFileChanged", { fsPath: schemaFile });
        }
        await indexedSince(statusStart);
      };

      writeSchema("named-block");
      await notify(2);
      expect(await symbols()).toEqual(expectedSymbols(gameB, "px_cache_schema_named"));
      expect(cacheFiles()).toHaveLength(2);

      fs.unlinkSync(schemaFile);
      await notify(3);
      expect(await symbols()).toEqual(
        expectedSymbols(gameB).filter(({ name }) => name !== "px_cache_schema_key")
      );

      const logStart = logs.length;
      writeSchema("top-level-key");
      await notify(1);
      expect(await symbols()).toEqual(expectedSymbols(gameB));
      expect(logs.slice(logStart).some((line) => line.includes("loaded vanilla index from cache:"))).toBe(
        true
      );
      await stop();
    }
  );
});
