import * as path from "path";
import { URI } from "vscode-uri";

/** Compare an indexed path with a client's absolute path or file URI. */
export function matchesSourceFile(indexed: string, requested: string): boolean {
  const normalize = (value: string): string | null => {
    try {
      const file = /^file:/i.test(value) ? URI.parse(value).fsPath : value;
      if (!path.isAbsolute(file)) return null;
      const normalized = path.normalize(file);
      return path.sep === "\\" ? normalized.toLowerCase() : normalized;
    } catch {
      return null;
    }
  };
  const requestedPath = normalize(requested);
  return requestedPath !== null && requestedPath === normalize(indexed);
}
