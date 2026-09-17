/**
 * Real LSP coverage requests alongside a 20 ms status probe. All writes stay
 * in a generated mod; --corpus adds a real mod read-only. See PERFORMANCE.md.
 * node packages/server/test/perf/profileLocalization.mjs <output-dir>
 *   [--server <bundle>] [--corpus <mod-root>]
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { createMessageConnection, IPCMessageReader, IPCMessageWriter } from "vscode-jsonrpc/node";

const flag = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? undefined : process.argv[at + 1];
};
const here = path.dirname(fileURLToPath(import.meta.url));
const server = path.resolve(flag("server") ?? path.join(here, "../../dist/server.js"));
const output = path.resolve(process.argv[2]);
const corpus = flag("corpus");
const gameId = "ck3";
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "px-loc-perf-"));
const mod = path.join(scratch, "mod");
const target = corpus ? path.resolve(corpus) : mod;
fs.mkdirSync(output, { recursive: true });
const write = (relative, text) => {
  const file = path.join(mod, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
  return file;
};
write("descriptor.mod", 'name="Localization performance fixture"\n');
const script = write(`events/probe.txt`, "\uFEFFnamespace = probe\nprobe.1 = { title = probe_0_0 }\n");
let changedLoc;
for (const language of ["english", "french", "german"]) {
  for (let file = 0; file < 30; file++) {
    const lines = Array.from(
      { length: 2000 },
      (_, key) => ` probe_${file}_${key}:0 "${key % 3 === 0 ? "Shared" : language} text ${file} ${key}"`
    );
    const written = write(
      `localization/${language}/probe_${file}_l_${language}.yml`,
      `\uFEFFl_${language}:\n${lines.join("\n")}\n`
    );
    if (language === "french" && file === 0) changedLoc = written;
  }
}
const child = fork(server, ["--node-ipc"], {
  stdio: ["ignore", "pipe", "pipe", "ipc"],
  execArgv: ["--expose-gc", "--max-old-space-size=4096"],
  env: { ...process.env, UV_THREADPOOL_SIZE: "16" },
});
const conn = createMessageConnection(new IPCMessageReader(child), new IPCMessageWriter(child));
const logs = [];
child.stderr.on("data", (chunk) => logs.push(String(chunk)));
conn.onNotification("window/logMessage", ({ message }) => logs.push(message));
let finishIndex;
const indexed = new Promise((resolve) => {
  finishIndex = resolve;
});
conn.onNotification("paradox/progress", (p) => {
  if (p.phase === "index" && p.state === "done") finishIndex();
});
conn.onNotification(() => undefined);
conn.onRequest(() => null);
conn.listen();
const timeout = setTimeout(() => {
  child.kill();
}, 300_000);
const metrics = [];
async function coverage(label) {
  let stopped = false;
  const delays = [];
  const probe = (async () => {
    while (!stopped) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (stopped) break;
      const start = performance.now();
      await conn.sendRequest("paradox/indexStats");
      delays.push(performance.now() - start);
    }
  })();
  const start = performance.now();
  let result;
  try {
    result = await conn.sendRequest("paradox/locCoverage", { modRoot: target });
  } finally {
    stopped = true;
  }
  const ms = performance.now() - start;
  await probe;
  const normalized = JSON.stringify(result).replaceAll(JSON.stringify(target).slice(1, -1), "<mod>");
  const row = {
    label,
    ms: Math.round(ms),
    probeCount: delays.length,
    maxProbeMs: Math.round(Math.max(0, ...delays)),
    entries: result.reduce((n, language) => n + language.defined, 0),
    hash: createHash("sha256").update(normalized).digest("hex"),
  };
  metrics.push(row);
  console.log(JSON.stringify(row));
}
try {
  const uri = pathToFileURL(mod).href;
  const started = performance.now();
  await conn.sendRequest("initialize", {
    processId: process.pid,
    rootUri: uri,
    workspaceFolders: [mod, ...(corpus ? [target] : [])].map((root) => ({
      uri: pathToFileURL(root).href,
      name: path.basename(root),
    })),
    capabilities: {},
    initializationOptions: {
      storageDir: path.join(scratch, "storage"),
      client: { ownFileWatcher: true },
      settings: {
        gameId,
        modPath: mod,
        gamePath: null,
        logsPath: null,
        parentPaths: [],
        workspaceMods: corpus ? [target] : [],
        locLanguage: "english",
        tracePerf: true,
      },
    },
  });
  await conn.sendNotification("initialized", {});
  await indexed;
  console.log(`indexed in ${Math.round(performance.now() - started)}ms`);
  await coverage("first coverage");
  await coverage("unchanged coverage");
  fs.appendFileSync(script, "# saved edit\n");
  await conn.sendNotification("paradox/modFileChanged", { fsPath: script });
  await new Promise((resolve) => setTimeout(resolve, 700));
  await coverage("after script save");
  if (!corpus) {
    fs.appendFileSync(changedLoc, ' added_translation:0 "Nouveau"\n');
    await conn.sendNotification("paradox/modFileChanged", { fsPath: changedLoc });
    await new Promise((resolve) => setTimeout(resolve, 700));
    await coverage("after French save");
    await coverage("unchanged after French save");
  }
  fs.writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify(
      {
        node: process.version,
        cpu: os.cpus()[0].model,
        ramGB: Math.round(os.totalmem() / 2 ** 30),
        gameId,
        workload: corpus
          ? "read-only corpus plus generated mod"
          : "180000 entries, 90 files, three languages",
        metrics,
      },
      null,
      2
    ) + "\n"
  );
  await conn.sendRequest("shutdown");
  await conn.sendNotification("exit");
} finally {
  clearTimeout(timeout);
  conn.dispose();
  child.kill();
  fs.writeFileSync(path.join(output, "server.log"), logs.join("\n"));
  const relative = path.relative(os.tmpdir(), scratch);
  assert(relative.startsWith("px-loc-perf-") && !relative.includes(path.sep), "Unsafe fixture path");
  fs.rmSync(scratch, { recursive: true, force: true });
}
