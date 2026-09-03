/**
 * The decode worker (bundled to dist/ddsWorker.js, one per pool slot).
 *
 * It decodes ONE texture per message and writes the PNG itself, so neither the
 * decode nor the write ever runs on the extension host thread: opening a
 * panel over a big mod asks for hundreds of textures at once, and every
 * millisecond of that used to be a millisecond VS Code could not draw in.
 *
 * The reply carries only the byte size, because the cache's bookkeeping
 * (keys, budget, eviction) stays on the host where there is one of it.
 */
import * as fs from "fs";
import { parentPort } from "worker_threads";
import { convertImage } from "./decodeImage";

export interface DecodeJob {
  id: number;
  abs: string;
  maxDim: number;
  /** Where the PNG goes; the host has already made the folder. */
  out: string;
}

export interface DecodeReply {
  id: number;
  /** Bytes written, or null when nothing could be decoded. */
  size: number | null;
}

parentPort?.on("message", (job: DecodeJob) => {
  let size: number | null = null;
  const png = convertImage(job.abs, job.maxDim);
  if (png) {
    try {
      fs.writeFileSync(job.out, png);
      size = png.byteLength;
    } catch {
      size = null;
    }
  }
  parentPort?.postMessage({ id: job.id, size } satisfies DecodeReply);
});
