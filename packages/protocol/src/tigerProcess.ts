import { spawn, type ChildProcess } from "node:child_process";
import { parseTigerJson, type TigerReport } from "./tigerParser";

export interface TigerRun {
  child: ChildProcess;
  result: Promise<{ reports: TigerReport[]; stdout: string; stderr: string; exitCode: number }>;
}

/** One bounded process contract for editor and headless validation. */
export function startTiger(
  binary: string,
  args: string[],
  options: { cwd?: string; signal?: AbortSignal; timeoutMs?: number; maxBytes?: number } = {}
): TigerRun {
  const child = spawn(binary, args, { cwd: options.cwd, windowsHide: true, signal: options.signal });
  const result = new Promise<{ reports: TigerReport[]; stdout: string; stderr: string; exitCode: number }>(
    (resolve, reject) => {
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let bytes = 0;
      let failure: Error | undefined;
      const timer = setTimeout(() => {
        failure = new Error("Tiger validation timed out.");
        child.kill();
      }, options.timeoutMs ?? 300_000);
      const collect = (chunks: Buffer[]) => (chunk: Buffer) => {
        if (failure) return;
        bytes += chunk.length;
        if (bytes > (options.maxBytes ?? 256 * 1024 * 1024)) {
          failure = new Error("Tiger output exceeded the size limit.");
          child.kill();
        } else chunks.push(chunk);
      };
      child.stdout?.on("data", collect(stdout));
      child.stderr?.on("data", collect(stderr));
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        const out = Buffer.concat(stdout).toString("utf8");
        const err = Buffer.concat(stderr).toString("utf8");
        if (failure) return reject(failure);
        if (signal || options.signal?.aborted) return reject(new Error("Tiger validation cancelled."));
        if (code !== 0 && code !== 1)
          return reject(new Error(`Tiger exited with code ${code}. ${err.slice(0, 1000)}`));
        const reports = parseTigerJson(out, { strict: true });
        if (reports === null)
          return reject(
            new Error(`Tiger returned an unreadable or incomplete JSON report. ${err.slice(0, 1000)}`)
          );
        resolve({ reports, stdout: out, stderr: err, exitCode: code });
      });
    }
  );
  return { child, result };
}
