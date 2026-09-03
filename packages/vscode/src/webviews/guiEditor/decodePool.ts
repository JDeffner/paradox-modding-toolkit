/**
 * A handful of worker threads that decode textures for the whole extension.
 *
 * Shared, lazy and small: the panels come and go, decoding is the same work
 * for all of them, and more threads than this buys nothing (the jobs are
 * short and the disk is the other half of the cost). Workers are unref'd, so
 * an idle pool never holds VS Code's shutdown up.
 *
 * `decode` answers null for anything it cannot run — the bundle missing
 * (a unit test importing the cache), a worker that died — and the caller
 * decodes on its own thread instead. Slow beats broken.
 */
import * as fs from "fs";
import * as path from "path";
import { Worker } from "worker_threads";
import type { DecodeJob, DecodeReply } from "./decodeWorker";

/** Bundled beside extension.js by compile:client. */
const WORKER_FILE = path.join(__dirname, "ddsWorker.js");

const MAX_WORKERS = 4;

interface Slot {
  worker: Worker;
  busy: boolean;
  /** The job this worker is running, so a death can answer it. */
  job: number | null;
}

interface Waiting {
  job: Omit<DecodeJob, "id">;
  resolve: (size: number | null) => void;
}

let slots: Slot[] | null = null;
let available: boolean | null = null;
const queue: Waiting[] = [];
const pending = new Map<number, (size: number | null) => void>();
let nextId = 1;

function usable(): boolean {
  available ??= fs.existsSync(WORKER_FILE);
  return available;
}

function spawn(): Slot | null {
  try {
    const worker = new Worker(WORKER_FILE);
    const slot: Slot = { worker, busy: false, job: null };
    worker.on("message", (reply: DecodeReply) => {
      slot.busy = false;
      slot.job = null;
      pending.get(reply.id)?.(reply.size);
      pending.delete(reply.id);
      pump();
    });
    // A worker that dies ANSWERS its job with null rather than leaving the
    // caller awaiting a promise nobody will settle: the caller decodes on its
    // own thread instead. Both "error" and "exit" arrive for one death, so the
    // second one finds the job already answered.
    const fail = (): void => {
      slots = slots?.filter((s) => s !== slot) ?? null;
      slot.busy = false;
      if (slot.job !== null) {
        const answer = pending.get(slot.job);
        pending.delete(slot.job);
        slot.job = null;
        answer?.(null);
      }
      pump();
    };
    worker.on("error", fail);
    worker.on("exit", fail);
    worker.unref();
    return slot;
  } catch {
    available = false;
    return null;
  }
}

function pump(): void {
  if (!slots) return;
  while (queue.length > 0) {
    let slot = slots.find((s) => !s.busy);
    if (!slot && slots.length < MAX_WORKERS) {
      const fresh = spawn();
      if (fresh) {
        slots.push(fresh);
        slot = fresh;
      }
    }
    if (!slot) return;
    const next = queue.shift()!;
    const id = nextId++;
    pending.set(id, next.resolve);
    slot.busy = true;
    slot.job = id;
    slot.worker.postMessage({ id, ...next.job } satisfies DecodeJob);
  }
}

/**
 * Decode `abs` into `out` on a worker. Resolves with the bytes written, or
 * null when the decode failed or no worker could run it.
 */
export function decodeOffThread(abs: string, maxDim: number, out: string): Promise<number | null> {
  if (!usable()) return Promise.resolve(null);
  slots ??= [];
  return new Promise<number | null>((resolve) => {
    queue.push({ job: { abs, maxDim, out }, resolve });
    pump();
  });
}

/** Whether a worker bundle is there at all: the cache picks its path with this. */
export function decodePoolAvailable(): boolean {
  return usable();
}
