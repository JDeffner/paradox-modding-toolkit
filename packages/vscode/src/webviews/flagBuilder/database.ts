/**
 * What the flag builder knows about a game: the coat-of-arms textures, the
 * named colors and the flag definitions, read from the game folder and the
 * workspace mods in load order (later roots override earlier ones by name,
 * which is the game's own last-in-wins rule for `common/`).
 *
 * EU5 keeps its content under stage folders (`in_game/`, ...) at each root;
 * the meta's `stageRoots` list drives that, so this module has no game in it.
 * No vscode imports: plain fs so it is testable.
 */
import * as fs from "fs";
import * as path from "path";
import type { CoaFlag, Rgb } from "@px-lsp/server/coa/coa";
import { parseCoaFile, parseNamedColors } from "@px-lsp/server/coa/coaParse";
import type { FlagDatabase, FlagEntry, TextureKind } from "./messages";

export interface FlagRoot {
  /** "game" or the mod folder's name. */
  label: string;
  path: string;
}

const KINDS: TextureKind[] = ["patterns", "colored_emblems", "textured_emblems"];
const TEXTURE_EXT = /\.(dds|tga|png)$/i;

function listDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** Every `<root>/<stage>` folder that exists, for each root in order. */
function stageDirs(roots: FlagRoot[], stages: string[]): { label: string; dir: string }[] {
  const out: { label: string; dir: string }[] = [];
  for (const root of roots) {
    for (const stage of stages) {
      const dir = path.join(root.path, stage);
      if (fs.existsSync(dir)) out.push({ label: root.label, dir });
    }
  }
  return out;
}

export function buildFlagDatabase(
  gameName: string,
  roots: FlagRoot[],
  stages: string[] | undefined,
  gameMissing: boolean
): FlagDatabase {
  const textures: Record<TextureKind, Set<string>> = {
    patterns: new Set(),
    colored_emblems: new Set(),
    textured_emblems: new Set(),
  };
  const namedColors: Record<string, Rgb> = {};
  const flags: FlagEntry[] = [];
  const definitions: Record<string, CoaFlag> = {};

  for (const { label, dir } of stageDirs(roots, stages ?? [""])) {
    for (const kind of KINDS) {
      for (const f of listDir(path.join(dir, "gfx", "coat_of_arms", kind))) {
        if (TEXTURE_EXT.test(f)) textures[kind].add(f);
      }
    }
    const colorsDir = path.join(dir, "common", "named_colors");
    for (const f of listDir(colorsDir)
      .filter((f) => f.endsWith(".txt"))
      .sort()) {
      const text = readText(path.join(colorsDir, f));
      if (text) Object.assign(namedColors, parseNamedColors(text));
    }
    const coaDir = path.join(dir, "common", "coat_of_arms", "coat_of_arms");
    for (const f of listDir(coaDir)
      .filter((f) => f.endsWith(".txt"))
      .sort()) {
      const text = readText(path.join(coaDir, f));
      if (!text) continue;
      for (const flag of parseCoaFile(text)) {
        definitions[flag.name] = flag;
        const i = flags.findIndex((e) => e.name === flag.name);
        const entry = { name: flag.name, source: label, file: f };
        if (i >= 0) flags[i] = entry;
        else flags.push(entry);
      }
    }
  }

  const sorted = (s: Set<string>): string[] => [...s].sort((a, b) => a.localeCompare(b));
  return {
    gameName,
    textures: {
      patterns: sorted(textures.patterns),
      colored_emblems: sorted(textures.colored_emblems),
      textured_emblems: sorted(textures.textured_emblems),
    },
    namedColors,
    flags: flags.sort((a, b) => a.name.localeCompare(b.name)),
    definitions,
    gameMissing,
  };
}

/** Absolute path of `<kind>/<file>`: the last root (and stage) that has it wins. */
export function locateTexture(
  roots: FlagRoot[],
  stages: string[] | undefined,
  kind: TextureKind,
  file: string
): string | null {
  // No traversal: the app only ever asks for names the database listed, but a
  // key is still text from a webview — that covers the kind segment too (the
  // caller's cast does not check it).
  if (!KINDS.includes(kind)) return null;
  if (file.includes("/") || file.includes("\\") || file.includes("..")) return null;
  const dirs = stageDirs(roots, stages ?? [""]);
  for (let i = dirs.length - 1; i >= 0; i--) {
    const abs = path.join(dirs[i].dir, "gfx", "coat_of_arms", kind, file);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}
