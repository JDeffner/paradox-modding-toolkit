import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { isWithin, type Configuration } from "./config";
import { LOG_FILES } from "@px-lsp/protocol/constants";
import { resolveConfigDir } from "@px-lsp/protocol/configDir";
import { detectGameVersion } from "@px-lsp/server/index/indexer";
import { ToolError } from "./errors";

const ignored = new Set([".git", ".px-toolkit", ".local", "node_modules"]);
export function languageFor(file: string): string | null {
  switch (path.extname(file).toLowerCase()) {
    case ".txt":
    case ".asset":
    case ".mod":
      return "paradox";
    case ".gui":
      return "paradox-gui";
    case ".yml":
      return "paradox-loc";
    default:
      return null;
  }
}
export async function contentFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        // Indexing or validating a symlinked subtree can escape the selected workspace.
        throw new ToolError("linked_content", `Use an ordinary file or directory for mod content: ${file}`);
      }
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && languageFor(file)) out.push(file);
    }
  }
  await walk(root);
  return out.sort();
}
/** Exact editable-input fingerprint; disk writes during a query invalidate its result. */
export async function fingerprint(root: string): Promise<string> {
  const hash = createHash("sha256");
  for (const file of await contentFiles(root)) {
    const bytes = await fs.readFile(file);
    hash.update(JSON.stringify([path.relative(root, file), bytes.length]));
    hash.update(bytes);
  }
  const metadata = path.join(root, ".metadata/metadata.json");
  try {
    hash.update(await fs.readFile(metadata));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return hash.digest("hex");
}
/** Inputs that must stay fixed while comparing edits to a baseline. */
export async function referenceFingerprint(config: Configuration): Promise<string> {
  const hash = createHash("sha256");
  hash.update(
    JSON.stringify([
      config.game,
      config.gamePath,
      config.gamePath ? detectGameVersion(config.gamePath) : null,
      config.logsPath,
      config.parents,
      config.language,
      config.tigerPath,
    ])
  );
  const configDir = resolveConfigDir(config.mod, config.meta);
  const files = new Set([
    path.join(configDir, "schema.json"),
    path.join(configDir, "playset.json"),
    ...(config.configFile ? [config.configFile] : []),
    ...(config.tigerConfig ? [config.tigerConfig] : []),
    ...(config.meta.tiger
      ? [path.join(configDir, config.meta.tiger.confName), path.join(config.mod, config.meta.tiger.confName)]
      : []),
  ]);
  if (config.logsPath) {
    for (const { file } of LOG_FILES) files.add(path.join(config.logsPath, file));
    files.add(path.join(config.logsPath, "on_actions.log"));
    for (const dir of new Set([config.logsPath, path.resolve(config.logsPath, "../logs")])) {
      files.add(path.join(dir, "data_types.log"));
      try {
        for (const name of await fs.readdir(dir)) {
          if (/^data_type.*\.txt$/i.test(name)) files.add(path.join(dir, name));
        }
        const subdir = path.join(dir, "data_types");
        try {
          for (const name of await fs.readdir(subdir)) files.add(path.join(subdir, name));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
  for (const file of [...files].sort()) {
    hash.update(JSON.stringify(file));
    try {
      const bytes = await fs.readFile(file);
      hash.update(JSON.stringify(bytes.length));
      hash.update(bytes);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      hash.update("missing");
    }
  }
  for (const parent of config.parents) hash.update(await fingerprint(parent));
  return hash.digest("hex");
}
export async function readSource(
  file: string,
  line: number,
  roots: string[]
): Promise<{ file: string; line: number; contextStart: number; context: string[] }> {
  const real = await fs.realpath(file);
  if (!roots.some((root) => isWithin(root, real)))
    throw new ToolError("outside_sources", "The indexed definition is outside the configured source roots.");
  const lines = (await fs.readFile(real, "utf8")).replace(/^\uFEFF/, "").split(/\r?\n/);
  const start = Math.max(0, line - 2);
  return {
    file: real,
    line: line + 1,
    contextStart: start + 1,
    context: lines.slice(start, line + 16).map((text) => text.slice(0, 500)),
  };
}
