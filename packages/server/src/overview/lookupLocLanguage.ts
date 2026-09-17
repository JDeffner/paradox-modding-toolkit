import * as fs from "fs";
import * as path from "path";
import { iterFiles } from "@px-lsp/protocol/fsWalk";
import { detectLocFileLanguage } from "@px-lsp/protocol/translationCore";
import type { LocEntryInfo } from "@px-lsp/protocol/protocol";
import { parseLoc } from "../parser";

export interface LocalizationRoot {
  path: string;
  source: LocEntryInfo["source"];
}

/** Explicit-language lookup outside the configured-language index. Never changes that index. */
export async function lookupLocLanguage(
  key: string,
  language: string,
  roots: LocalizationRoot[],
  folders: string[],
  openFiles: ReadonlyMap<string, string> = new Map()
): Promise<LocEntryInfo[]> {
  if (!/^[a-z_]+$/.test(language)) return [];
  const normalize = (file: string) =>
    process.platform === "win32" ? path.resolve(file).toLowerCase() : path.resolve(file);
  const open = new Map([...openFiles].map(([file, text]) => [normalize(file), text]));
  for (const source of ["mod", "parent", "vanilla"] as const) {
    const result: LocEntryInfo[] = [];
    const seen = new Set<string>();
    for (const root of roots.filter((root) => root.source === source)) {
      for (const folder of folders) {
        const directory = path.join(root.path, folder);
        const files = new Set<string>();
        for (const file of iterFiles(directory, ".yml")) {
          if (file === null) await new Promise<void>((resolve) => setImmediate(resolve));
          else if (detectLocFileLanguage(file) === language) files.add(file);
        }
        for (const file of openFiles.keys()) {
          const relative = path.relative(directory, file);
          if (
            relative !== ".." &&
            !relative.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(relative) &&
            detectLocFileLanguage(file) === language
          )
            files.add(file);
        }
        for (const file of files) {
          const normalized = normalize(file);
          if (seen.has(normalized)) continue;
          seen.add(normalized);
          try {
            const text = open.get(normalized) ?? (await fs.promises.readFile(file, "utf8"));
            if (!text.includes(key)) continue;
            const parsed = parseLoc(text);
            if (parsed.language !== language) continue;
            for (const entry of parsed.entries)
              if (entry.key === key) result.push({ file, line: entry.line, source, value: entry.value });
          } catch {
            // A removed or unreadable file cannot supply an editable entry.
          }
        }
      }
    }
    if (result.length) return result;
  }
  return [];
}
