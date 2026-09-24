import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { pathToFileURL } from "node:url";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from "vscode-jsonrpc/node";
import type { Diagnostic } from "vscode-languageserver";
import type { StatusPayload } from "@px-lsp/protocol/protocol";
import { digest, type Configuration } from "./config";
import { ToolError } from "./errors";

export class LspSession {
  private child: ChildProcessWithoutNullStreams;
  private connection: MessageConnection;
  private ready: Promise<void>;
  private died: Promise<never>;
  private stopping = false;
  private failures: string[] = [];
  private pendingDiagnostics = new Map<string, (diagnostics: Diagnostic[]) => void>();
  status: StatusPayload | null = null;
  serverVersion = "";
  logs: string[] = [];

  constructor(
    private config: Configuration,
    private signal?: AbortSignal
  ) {
    this.child = spawn(process.execPath, [path.join(__dirname, "lsp/server.js"), "--stdio"], {
      windowsHide: true,
      stdio: "pipe",
    });
    this.connection = createMessageConnection(
      new StreamMessageReader(this.child.stdout),
      new StreamMessageWriter(this.child.stdin)
    );
    this.died = new Promise<never>((_, reject) => {
      this.child.once("error", reject);
      this.child.once("exit", (code, signal) => {
        if (!this.stopping)
          reject(
            new ToolError(
              "server_exited",
              `Language server exited (${code ?? signal}). ${this.logs.slice(-4).join("\n")}`
            )
          );
      });
    });
    void this.died.catch(() => {});
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.logs.push(chunk.toString("utf8").slice(0, 2000));
      this.logs = this.logs.slice(-30);
    });
    this.connection.onNotification("window/logMessage", (message: { type: number; message: string }) => {
      this.logs.push(message.message.slice(0, 2000));
      this.logs = this.logs.slice(-30);
      if (message.type === 1) this.failures.push(message.message);
    });
    this.connection.onRequest("window/workDoneProgress/create", () => null);
    this.connection.onRequest("workspace/semanticTokens/refresh", () => null);
    this.connection.onRequest("workspace/inlayHint/refresh", () => null);
    this.ready = new Promise<void>((resolve) => {
      let indexing = false;
      this.connection.onNotification("paradox/status", (status: StatusPayload) => {
        this.status = status;
        if (status.indexing) indexing = true;
        if (indexing && !status.indexing) resolve();
      });
    });
    this.connection.onNotification(
      "textDocument/publishDiagnostics",
      (result: { uri: string; diagnostics: Diagnostic[] }) => {
        this.pendingDiagnostics.get(result.uri)?.(result.diagnostics);
        this.pendingDiagnostics.delete(result.uri);
      }
    );
    this.connection.listen();
  }
  private async bounded<T>(work: Promise<T>): Promise<T> {
    this.signal?.throwIfAborted();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new ToolError("timeout", "Language server operation timed out.")),
        this.config.timeoutMs
      );
      abort = () => reject(new ToolError("cancelled", "Operation cancelled."));
      this.signal?.addEventListener("abort", abort, { once: true });
    });
    try {
      return await Promise.race([work, this.died, limit]);
    } finally {
      clearTimeout(timer);
      if (abort) this.signal?.removeEventListener("abort", abort);
    }
  }
  async start(): Promise<void> {
    const cache = path.join(
      process.env.LOCALAPPDATA ?? process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"),
      "pxtk",
      digest(this.config.mod).slice(0, 20)
    );
    await fs.mkdir(cache, { recursive: true });
    const initialized = await this.request<{ serverInfo: { version: string } }>("initialize", {
      processId: process.pid,
      rootUri: pathToFileURL(this.config.mod).href,
      capabilities: { window: { workDoneProgress: true } },
      initializationOptions: {
        storageDir: cache,
        dataDir: path.join(__dirname, "data"),
        client: { commands: [], fileLinks: false, ownFileWatcher: true },
        settings: {
          gameId: this.config.game,
          gamePath: this.config.gamePath,
          logsPath: this.config.logsPath,
          modPath: this.config.mod,
          parentPaths: this.config.parents,
          workspaceMods: [this.config.mod],
          locLanguage: this.config.language,
          diagnosticsVanilla: false,
          diagnosticsIgnore: [],
          diagnosticsIgnorePatterns: [],
          scopeInlayHints: false,
        },
      },
    });
    this.serverVersion = initialized.serverInfo.version;
    await this.connection.sendNotification("initialized", {});
    await this.bounded(this.ready);
    await this.request("paradox/indexStats", null);
    if (this.failures.length) throw new ToolError("index_failed", this.failures.join("\n"));
  }
  request<T>(method: string, params: unknown): Promise<T> {
    this.signal?.throwIfAborted();
    return this.bounded(this.connection.sendRequest<T>(method, params));
  }
  async diagnostics(file: string, languageId: string, text: string): Promise<Diagnostic[]> {
    const uri = pathToFileURL(file).href;
    const work = new Promise<Diagnostic[]>((resolve) => this.pendingDiagnostics.set(uri, resolve));
    await this.connection.sendNotification("textDocument/didOpen", {
      textDocument: { uri, languageId, version: 1, text },
    });
    try {
      return await this.bounded(work);
    } finally {
      this.pendingDiagnostics.delete(uri);
      await this.connection.sendNotification("textDocument/didClose", { textDocument: { uri } });
    }
  }
  async withDocument<T>(
    file: string,
    languageId: string,
    text: string,
    action: (uri: string) => Promise<T>
  ): Promise<T> {
    const uri = pathToFileURL(file).href;
    await this.connection.sendNotification("textDocument/didOpen", {
      textDocument: { uri, languageId, version: 1, text },
    });
    try {
      return await action(uri);
    } finally {
      await this.connection.sendNotification("textDocument/didClose", { textDocument: { uri } });
    }
  }
  async close(): Promise<void> {
    this.stopping = true;
    const stopped = new Promise<void>((resolve) => {
      if (this.child.exitCode !== null || this.child.signalCode !== null) resolve();
      else this.child.once("exit", () => resolve());
    });
    const kill = setTimeout(() => this.child.kill(), 1000);
    try {
      await Promise.race([
        // The operation reports protocol/exit failures. Cleanup still waits
        // for the child without replacing that failure with "connection closed".
        this.connection
          .sendRequest("shutdown")
          .then(() => this.connection.sendNotification("exit"))
          .catch(() => {
            this.child.kill();
          }),
        stopped,
      ]);
      await stopped;
    } finally {
      clearTimeout(kill);
      this.connection.dispose();
      this.child.kill();
    }
  }
}
export async function withSession<T>(
  config: Configuration,
  action: (session: LspSession) => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  signal?.throwIfAborted();
  const session = new LspSession(config, signal);
  try {
    await session.start();
    return await action(session);
  } finally {
    await session.close();
  }
}
