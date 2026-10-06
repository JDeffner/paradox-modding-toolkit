import * as cp from "child_process";
import type { BridgeDone, BridgeEvent, BridgeJob } from "./jobs";

const SILENCE_MS = 5 * 60_000;
const UPLOAD_STALL_MS = 5 * 60_000;
// Steam can prepare or commit large uploads without moving a byte counter.
const PREPARATION_STALL_MS = 15 * 60_000;
const PHASES = [
  "Waiting for Steam",
  "Preparing configuration",
  "Preparing content",
  "Uploading content",
  "Uploading preview image",
  "Committing changes",
];

/** The bridge positively reports that no Workshop operation was attempted. */
export class BridgeStartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BridgeStartError";
  }
}

export class BridgeWaitError extends Error {
  readonly remoteMayHaveChanged: boolean;

  constructor(
    readonly reason: "silent" | "stalled" | "stopped",
    job: BridgeJob,
    started = true
  ) {
    const remoteMayHaveChanged = started && job.action !== "query" && job.action !== "dlc";
    const explanation =
      reason === "stopped"
        ? "Stopped waiting for Steam."
        : reason === "silent"
          ? "The Steam bridge stopped responding."
          : "The Steam bridge made no further progress.";
    super(
      explanation +
        (remoteMayHaveChanged
          ? " Steam may already have applied part or all of this operation. Refresh the Workshop item before deciding whether to try again. No upload was retried."
          : started
            ? " Refresh to try the read again."
            : " The operation was not started.")
    );
    this.name = "BridgeWaitError";
    this.remoteMayHaveChanged = remoteMayHaveChanged;
  }
}

export type BridgeProgress = (
  status: string,
  uploaded: number,
  total: number,
  submit: number,
  submits: number
) => void;

/** Process boundary kept independent of VS Code so hung native calls can be tested. */
export function runBridgeProcess(
  bridge: string,
  steamworksDir: string,
  job: BridgeJob,
  log: (message: string) => void,
  onProgress?: BridgeProgress,
  signal?: AbortSignal
): Promise<BridgeDone> {
  if (signal?.aborted) return Promise.reject(new BridgeWaitError("stopped", job, false));
  return new Promise((resolve, reject) => {
    let child: cp.ChildProcessWithoutNullStreams;
    try {
      child = cp.spawn(process.execPath, [bridge, steamworksDir], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      reject(
        new BridgeStartError(
          `cannot start the Steam bridge: ${error instanceof Error ? error.message : String(error)}`
        )
      );
      return;
    }
    let settled = false;
    let buffer = "";
    let stderr = "";
    let silence: NodeJS.Timeout | undefined;
    let stall: NodeJS.Timeout | undefined;
    let submit = 0;
    let phase = -1;
    let uploaded = 0;

    const finish = (result?: BridgeDone, error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(silence);
      clearTimeout(stall);
      signal?.removeEventListener("abort", stop);
      if (stderr.trim()) log(`steam bridge stderr: ${stderr.trim()}`);
      if (result) resolve(result);
      else reject(error);
    };
    const abandon = (reason: "silent" | "stalled" | "stopped"): void => {
      // Never wait for close: even termination of a wedged native process may fail.
      finish(undefined, new BridgeWaitError(reason, job));
      child.kill();
    };
    const stop = (): void => abandon("stopped");
    const heard = (): void => {
      clearTimeout(silence);
      silence = setTimeout(() => abandon("silent"), SILENCE_MS);
    };
    const advanced = (): void => {
      clearTimeout(stall);
      const uploading = phase === 3 || phase === 4;
      const delay = job.action === "publish" && !uploading ? PREPARATION_STALL_MS : UPLOAD_STALL_MS;
      stall = setTimeout(() => abandon("stalled"), delay);
    };
    const progress = (event: Extract<BridgeEvent, { type: "progress" }>): void => {
      if (
        job.action !== "publish" ||
        !Number.isInteger(event.submit) ||
        event.submit < 1 ||
        event.submit > job.submits.length ||
        !Number.isFinite(event.uploaded) ||
        event.uploaded < 0
      )
        return;
      const nextPhase = PHASES.indexOf(event.status);
      const nextSubmit = event.submit > submit;
      const nextStage = event.submit === submit && nextPhase > phase;
      const moreBytes = event.submit === submit && nextPhase === phase && event.uploaded > uploaded;
      if (nextSubmit || nextStage || moreBytes) {
        if (nextSubmit || nextStage) uploaded = 0;
        submit = event.submit;
        phase = nextPhase;
        uploaded = Math.max(uploaded, event.uploaded);
        advanced();
      }
      onProgress?.(event.status, event.uploaded, event.total, event.submit, event.submits);
    };

    heard();
    advanced();
    signal?.addEventListener("abort", stop, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      if (settled) return;
      heard();
      buffer += chunk.toString("utf8");
      let nl: number;
      while (!settled && (nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let event: BridgeEvent;
        try {
          event = JSON.parse(line) as BridgeEvent;
        } catch {
          log(`steam bridge: unparseable line: ${line}`);
          continue;
        }
        if (!event || typeof event !== "object") {
          log(`steam bridge: unparseable event: ${line}`);
          continue;
        }
        if (event.type === "progress") progress(event);
        else if (event.type === "done") finish(event.result);
        else if (event.type === "error")
          finish(
            undefined,
            event.operationStarted === false ? new BridgeStartError(event.message) : new Error(event.message)
          );
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (settled) return;
      heard();
      // A noisy failed native call must not grow extension-host memory forever.
      stderr = (stderr + chunk.toString("utf8")).slice(-64 * 1024);
    });
    child.on("error", (error) =>
      finish(undefined, new BridgeStartError(`cannot start the Steam bridge: ${error.message}`))
    );
    child.stdin.on("error", (error: Error) => {
      finish(undefined, new Error(`cannot send the Steam bridge job: ${error.message}`));
      child.kill();
    });
    child.on("close", (code) => {
      finish(undefined, new Error(`Steam bridge exited with code ${code ?? "?"}`));
    });
    child.stdin.end(JSON.stringify(job));
  });
}
