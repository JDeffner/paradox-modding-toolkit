/**
 * An empty `fs` for the browser bundle (esbuild aliases "fs" here).
 *
 * The browser service never reads from disk: its token tables arrive as baked
 * JSON and `loadSchema(null)` takes no filesystem path. This module exists so
 * the ~26 modules that do `import * as fs from "fs"` still link, and so that
 * anything which slips onto a disk-backed path fails the way a missing file
 * fails on node rather than throwing "fs.readFileSync is not a function".
 */
function enoent(op: string, target: string): NodeJS.ErrnoException {
  const err = new Error(`ENOENT: no such file or directory, ${op} '${target}'`) as NodeJS.ErrnoException;
  err.code = "ENOENT";
  err.errno = -2;
  err.syscall = op;
  err.path = target;
  return err;
}

export function existsSync(_target: unknown): boolean {
  return false;
}

export function readFileSync(target: unknown, _options?: unknown): never {
  throw enoent("open", String(target));
}

export function readdirSync(target: unknown, _options?: unknown): never {
  throw enoent("scandir", String(target));
}

export function statSync(target: unknown, _options?: unknown): never {
  throw enoent("stat", String(target));
}

export function lstatSync(target: unknown, _options?: unknown): never {
  throw enoent("lstat", String(target));
}

export function realpathSync(target: unknown): never {
  throw enoent("realpath", String(target));
}

/** Writers are no-ops: nothing in the browser build has a disk to persist to. */
export function mkdirSync(_target: unknown, _options?: unknown): undefined {
  return undefined;
}

export function writeFileSync(_target: unknown, _data?: unknown, _options?: unknown): void {}

export function appendFileSync(_target: unknown, _data?: unknown, _options?: unknown): void {}

export function rmSync(_target: unknown, _options?: unknown): void {}

export function unlinkSync(_target: unknown): void {}

export const promises = {
  readFile: (target: unknown): Promise<never> => Promise.reject(enoent("open", String(target))),
  readdir: (target: unknown): Promise<never> => Promise.reject(enoent("scandir", String(target))),
  stat: (target: unknown): Promise<never> => Promise.reject(enoent("stat", String(target))),
  writeFile: (): Promise<void> => Promise.resolve(),
  mkdir: (): Promise<undefined> => Promise.resolve(undefined),
};

export default {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  lstatSync,
  realpathSync,
  mkdirSync,
  writeFileSync,
  appendFileSync,
  rmSync,
  unlinkSync,
  promises,
};
