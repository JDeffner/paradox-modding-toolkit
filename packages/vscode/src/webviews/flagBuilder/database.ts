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
import {
  parseAtDefaults,
  parseColorLists,
  parseDesignerCatalog,
  parseDesignerPalette,
  parseDesignerTemplates,
  type DesignerEntry,
} from "@px-lsp/server/coa/coaDesigner";
import type {
  DesignerCatalog,
  DesignerFrame,
  DesignerLayout,
  FlagDatabase,
  FlagEntry,
  TextureKind,
} from "./messages";

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
  gameMissing: boolean,
  /** Also read the game's own Coat of Arms designer files (the designer panel). */
  withDesigner = false
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
    ...(withDesigner ? { designer: buildDesignerCatalog(roots, stages, namedColors) } : {}),
  };
}

// ---------------------------------------------------------------------------
// The game's own Coat of Arms designer
// ---------------------------------------------------------------------------

/** The catalog files, relative to a root's stage folder. */
const DESIGNER_FILES = {
  patterns: "gfx/coat_of_arms/patterns/50_coa_designer_patterns.txt",
  emblems: "gfx/coat_of_arms/colored_emblems/50_coa_designer_emblems.txt",
  palette: "gfx/coat_of_arms/color_palettes/50_coa_designer_palettes.txt",
  layouts: "gfx/coat_of_arms/emblem_layouts/50_coa_designer_emblem_layouts.txt",
  templates: "common/coat_of_arms/coat_of_arms/99_coa_designer_templates.txt",
  colorLists: "common/coat_of_arms/template_lists/color_lists.txt",
} as const;

const FRAMES_DIR = ["gfx", "interface", "coat_of_arms", "frames"];
/** The title frame is the one pair that sits above frames/ (gui/shared/coat_of_arms.gui). */
const TITLE_FRAME = { texture: "title_86.dds", mask: "title_mask.dds" };
/** The frames a modder reaches for first, ahead of the numbered house series. */
const FRAME_ORDER = ["title", "dynasty", "house"];
// "Optional, will assume maximum number of colors if missing" (both catalog
// headers). A pattern's placeholders are red/yellow/white and an emblem's
// red/green/blue, three either way (coa.ts PATTERN_/EMBLEM_SOURCE_COLORS).
const MAX_PATTERN_COLORS = 3;
const MAX_EMBLEM_COLORS = 3;

/** True when the game folder holds the files the designer is built on. */
export function hasDesignerFiles(roots: FlagRoot[], stages: string[] | undefined): boolean {
  return stageDirs(roots, stages ?? [""]).some((d) =>
    fs.existsSync(path.join(d.dir, ...DESIGNER_FILES.patterns.split("/")))
  );
}

/** The last root that has `rel`, so a mod's catalog overrides the game's. */
function lastText(dirs: { dir: string }[], rel: string): string | null {
  for (let i = dirs.length - 1; i >= 0; i--) {
    const text = readText(path.join(dirs[i].dir, ...rel.split("/")));
    if (text !== null) return text;
  }
  return null;
}

/**
 * The designer's own vocabulary. Each catalog file is read whole from the last
 * root that ships it: the game replaces these lists rather than merging them
 * (a mod that adds an emblem copies the file and appends), so last-in-wins is
 * both the game's rule for `common/` and the only reading that keeps the file
 * order the designer displays in.
 */
function buildDesignerCatalog(
  roots: FlagRoot[],
  stages: string[] | undefined,
  namedColors: Record<string, Rgb>
): DesignerCatalog {
  const dirs = stageDirs(roots, stages ?? [""]);
  const patternText = lastText(dirs, DESIGNER_FILES.patterns) ?? "";
  const emblemText = lastText(dirs, DESIGNER_FILES.emblems) ?? "";
  const layoutText = lastText(dirs, DESIGNER_FILES.layouts) ?? "";
  const visible = (entries: DesignerEntry[]): DesignerEntry[] => entries.filter((e) => e.visible);

  const patterns = visible(parseDesignerCatalog(patternText, MAX_PATTERN_COLORS));
  const allEmblems = parseDesignerCatalog(emblemText, MAX_EMBLEM_COLORS);
  const emblems = visible(allEmblems);
  const categories: string[] = [];
  for (const e of emblems) if (e.category && !categories.includes(e.category)) categories.push(e.category);

  const palette = parseDesignerPalette(lastText(dirs, DESIGNER_FILES.palette) ?? "")
    .map((name) => ({ name, rgb: namedColors[name] }))
    .filter((c): c is { name: string; rgb: Rgb } => c.rgb !== undefined);

  const layouts: DesignerLayout[] = parseCoaFile(layoutText).map((flag) => ({ name: flag.name, flag }));
  const colorLists = parseColorLists(lastText(dirs, DESIGNER_FILES.colorLists) ?? "");
  const templates = parseDesignerTemplates(lastText(dirs, DESIGNER_FILES.templates) ?? "", colorLists);

  return {
    patterns,
    emblems,
    categories,
    palette,
    layouts,
    layoutDefaults: parseAtDefaults(layoutText),
    template: templates[0] ?? null,
    frames: designerFrames(dirs),
    emptyEmblem: allEmblems.find((e) => e.colors === 0)?.file ?? "",
  };
}

/** Title-case a frame id for its menu row: `house_frame_02` -> `House Frame 02`. */
function frameLabel(id: string): string {
  return id
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Every frame the preview can wear: a `<id>.dds` in the frames folder that has
 * a `<id>_mask.dds` beside it, plus the title pair one folder up. Both halves
 * are needed, because the game masks the arms with one and draws the other
 * over them (gui/shared/coat_of_arms.gui).
 */
function designerFrames(dirs: { dir: string }[]): DesignerFrame[] {
  const ids = new Set<string>();
  for (const { dir } of dirs) {
    const frames = path.join(dir, ...FRAMES_DIR);
    const files = new Set(listDir(frames));
    for (const f of files) {
      if (!f.endsWith(".dds") || f.endsWith("_mask.dds")) continue;
      if (files.has(`${f.slice(0, -4)}_mask.dds`)) ids.add(f.slice(0, -4));
    }
    const top = path.join(dir, ...FRAMES_DIR.slice(0, -1));
    if (fs.existsSync(path.join(top, TITLE_FRAME.texture)) && fs.existsSync(path.join(top, TITLE_FRAME.mask)))
      ids.add("title");
  }
  const rank = (id: string): number => {
    const i = FRAME_ORDER.indexOf(id);
    return i < 0 ? FRAME_ORDER.length : i;
  };
  return [...ids]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((id) => ({ id, label: frameLabel(id) }));
}

/** The `<id>.dds` / `<id>_mask.dds` pair of a frame, last root wins; null when absent. */
export function locateDesignerFrame(
  roots: FlagRoot[],
  stages: string[] | undefined,
  id: string,
  mask: boolean
): string | null {
  // The id comes from a webview: only the shape designerFrames produces.
  if (!/^[\w-]+$/.test(id)) return null;
  const dirs = stageDirs(roots, stages ?? [""]);
  for (let i = dirs.length - 1; i >= 0; i--) {
    const abs =
      id === "title"
        ? path.join(dirs[i].dir, ...FRAMES_DIR.slice(0, -1), mask ? TITLE_FRAME.mask : TITLE_FRAME.texture)
        : path.join(dirs[i].dir, ...FRAMES_DIR, `${id}${mask ? "_mask" : ""}.dds`);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
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
