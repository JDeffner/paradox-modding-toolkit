/**
 * Minimal `os` for the browser bundle (esbuild aliases "os" here). Only
 * server.ts reads it, for a scratch directory the browser build never uses.
 */
export function tmpdir(): string {
  return "/tmp";
}

export function homedir(): string {
  return "/";
}

export const EOL = "\n";

export function platform(): string {
  return "browser";
}

export default { tmpdir, homedir, EOL, platform };
