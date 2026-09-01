/**
 * POSIX `path` for the browser bundle (esbuild aliases "path" here).
 *
 * Only the surface the reachable browser code paths use is implemented, but it
 * is implemented exactly: `classifyFile` maps a file onto its schema entry with
 * `relative` + `sep`, and a subtly wrong answer there is a wrong diagnostic
 * rather than a visible failure. `test/browserPath.test.ts` pins every function
 * against node's own `path.posix`.
 *
 * There is no working directory in a browser, so `resolve` treats "/" as cwd.
 */
export const sep = "/";
export const delimiter = ":";

function clean(parts: string[], keepUp: boolean): string[] {
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part !== "..") out.push(part);
    else if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
    else if (keepUp) out.push("..");
  }
  return out;
}

export function isAbsolute(p: string): boolean {
  return p.startsWith("/");
}

export function normalize(p: string): string {
  if (p === "") return ".";
  const absolute = isAbsolute(p);
  const trailing = p.endsWith("/");
  let out = clean(p.split("/"), !absolute).join("/");
  if (out === "" && !absolute) out = ".";
  if (out !== "" && trailing) out += "/";
  return absolute ? "/" + out : out;
}

export function join(...parts: string[]): string {
  const joined = parts.filter((p) => p !== "").join("/");
  return joined === "" ? "." : normalize(joined);
}

export function resolve(...parts: string[]): string {
  let resolved = "";
  let absolute = false;
  for (let i = parts.length - 1; i >= 0 && !absolute; i--) {
    const part = parts[i];
    if (part === "") continue;
    resolved = resolved === "" ? part : `${part}/${resolved}`;
    absolute = isAbsolute(part);
  }
  return "/" + clean(resolved.split("/"), false).join("/");
}

export function relative(from: string, to: string): string {
  const a = resolve(from);
  const b = resolve(to);
  if (a === b) return "";
  const fromParts = a.split("/").filter((p) => p !== "");
  const toParts = b.split("/").filter((p) => p !== "");
  let i = 0;
  while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) i++;
  const up: string[] = [];
  for (let k = i; k < fromParts.length; k++) up.push("..");
  return [...up, ...toParts.slice(i)].join("/");
}

export function basename(p: string, ext?: string): string {
  const parts = p.split("/").filter((part) => part !== "");
  let base = parts.length === 0 ? "" : parts[parts.length - 1];
  if (ext !== undefined && ext !== base && base.endsWith(ext)) base = base.slice(0, -ext.length);
  return base;
}

export function dirname(p: string): string {
  // Ported from node's path.posix.dirname rather than derived from split/join:
  // dirname does NOT normalize, so a repeated separator has to survive
  // ("/a/b//c/d.txt" -> "/a/b//c"). The test pins this against node.
  if (p.length === 0) return ".";
  const rooted = p.charCodeAt(0) === 47;
  let end = -1;
  let matchedSlash = true;
  for (let i = p.length - 1; i >= 1; i--) {
    if (p.charCodeAt(i) === 47) {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else {
      matchedSlash = false;
    }
  }
  if (end === -1) return rooted ? "/" : ".";
  if (rooted && end === 1) return "//";
  return p.slice(0, end);
}

export function extname(p: string): string {
  const base = basename(p);
  // "." and ".." are directory names, not a dotfile with an extension; node
  // returns "" for both, and "" for a leading dot (".gitignore").
  if (base === "." || base === "..") return "";
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot);
}

export const posix = {
  sep,
  delimiter,
  isAbsolute,
  normalize,
  join,
  resolve,
  relative,
  basename,
  dirname,
  extname,
};
export default posix;
