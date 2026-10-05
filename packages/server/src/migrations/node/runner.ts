import { Worker } from "node:worker_threads";
import type { MigrationAnswers, MigrationByteRequest, MigrationManifest } from "@px-lsp/protocol/migration";
import type { MigrationSnapshot, PreparedMigration } from "../sdk";
import { assertMigrationSnapshotLimits } from "../engine";
import type { inspectMigration } from "../engine";

export interface RecipeSelection {
  id?: string;
  localPath?: string;
  /** Explicitly trusted artifact revision. Every subsequent run must match. */
  codeHash?: string;
}

export interface MigrationWorkerRequest {
  action: "catalog" | "load" | "discover" | "inspect" | "prepare";
  gameId: string;
  selection?: RecipeSelection;
  snapshot?: MigrationSnapshot;
  answers?: MigrationAnswers;
}

export type MigrationWorkerResponse =
  | { kind: "catalog"; manifests: MigrationManifest[] }
  | { kind: "loaded"; manifests: MigrationManifest[]; codeHash: string }
  | { kind: "inspected"; result: Awaited<ReturnType<typeof inspectMigration>> }
  | { kind: "discovered"; selected: MigrationByteRequest[] }
  | { kind: "prepared"; plan: PreparedMigration };

/** Workers provide cancellation and crash isolation. Local author code remains trusted code. */
export function runMigrationWorker(
  workerPath: string,
  request: MigrationWorkerRequest,
  signal?: AbortSignal,
  timeoutMs = 30_000
): Promise<MigrationWorkerResponse> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Migration cancelled."));
    try {
      if (request.snapshot) assertMigrationSnapshotLimits(request.snapshot);
    } catch (error) {
      reject(error);
      return;
    }
    const worker = new Worker(workerPath, { workerData: request });
    let settled = false;
    const finish = (error?: Error, response?: MigrationWorkerResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      void worker.terminate();
      if (error) reject(error);
      else resolve(response!);
    };
    const cancel = () => finish(new Error("Migration cancelled."));
    const timer = setTimeout(
      () => finish(new Error("Recipe exceeded its 30 second execution limit.")),
      timeoutMs
    );
    signal?.addEventListener("abort", cancel, { once: true });
    worker.once("error", (error) => finish(error instanceof Error ? error : new Error(String(error))));
    worker.once("exit", (code) =>
      finish(new Error(`Recipe worker exited before returning a result (${code}).`))
    );
    worker.once("message", (message: { result?: MigrationWorkerResponse; error?: string }) => {
      if (message.error) finish(new Error(message.error));
      else if (message.result) finish(undefined, message.result);
      else finish(new Error("Recipe worker returned an invalid result."));
    });
  });
}
