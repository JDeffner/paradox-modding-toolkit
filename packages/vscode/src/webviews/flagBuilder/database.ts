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
const CULTURES_DIR = ["common", "culture", "cultures"];
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
    frames: designerFrames(dirs, frameUsage(readCultures(dirs).values())),
    emptyEmblem: allEmblems.find((e) => e.colors === 0)?.file ?? "",
  };
}

/**
 * The frame one culture wears, from `common/culture/cultures`. `house` is
 * `house_coa_frame` and `dynasty` is `dynasty_coa_frame` (`_cultures.info`:
 * "CoA frame for houses of this culture"); a culture that states neither is on
 * the engine's own default frame.
 */
export interface CultureFrames {
  heritage: string;
  house?: string;
  dynasty?: string;
}

/** What the cultures say about one frame: which gui widget draws it, and for whom. */
export interface FrameUse {
  /** The gui type the frame is drawn by, which decides how big the arms are. */
  family: "house" | "dynasty";
  /** Heritage ids, most cultures first, ties by id. */
  heritages: string[];
}

/**
 * The cultures of every root, later roots overriding by id (the game's
 * last-in-wins rule for `common/`). Only the keys the frame picker needs are
 * read, and only at the culture's own level, so a `heritage` inside a nested
 * block cannot be mistaken for the culture's.
 */
export function readCultures(dirs: { dir: string }[]): Map<string, CultureFrames> {
  const out = new Map<string, CultureFrames>();
  for (const { dir } of dirs) {
    const folder = path.join(dir, ...CULTURES_DIR);
    for (const f of listDir(folder)
      .filter((f) => f.endsWith(".txt"))
      .sort()) {
      const text = readText(path.join(folder, f));
      if (text) for (const [id, culture] of parseCultureFrames(text)) out.set(id, culture);
    }
  }
  return out;
}

/** `culture_id = { heritage = … house_coa_frame = … }`, brace depth counted. */
function parseCultureFrames(text: string): [string, CultureFrames][] {
  const out: [string, CultureFrames][] = [];
  let depth = 0;
  let id: string | null = null;
  let culture: CultureFrames | null = null;
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "");
    if (depth === 0) {
      const open = /^([A-Za-z0-9_]+)\s*=\s*\{/.exec(line);
      id = open ? open[1] : null;
      culture = open ? { heritage: "" } : null;
    } else if (depth === 1 && culture) {
      const pair = /^\s*(heritage|house_coa_frame|dynasty_coa_frame)\s*=\s*([A-Za-z0-9_]+)/.exec(line);
      if (pair?.[1] === "heritage") culture.heritage = pair[2];
      else if (pair?.[1] === "house_coa_frame") culture.house = pair[2];
      else if (pair?.[1] === "dynasty_coa_frame") culture.dynasty = pair[2];
    }
    for (const ch of line) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    if (depth <= 0) {
      if (id && culture) out.push([id, culture]);
      depth = 0;
      id = null;
      culture = null;
    }
  }
  return out;
}

/** Which cultures wear each frame, keyed by frame id. */
export function frameUsage(cultures: Iterable<CultureFrames>): Map<string, FrameUse> {
  const counts = new Map<string, { family: "house" | "dynasty"; heritages: Map<string, number> }>();
  for (const culture of cultures) {
    for (const [family, frame] of [
      ["house", culture.house],
      ["dynasty", culture.dynasty],
    ] as const) {
      if (!frame || !culture.heritage) continue;
      const use = counts.get(frame) ?? { family, heritages: new Map<string, number>() };
      use.heritages.set(culture.heritage, (use.heritages.get(culture.heritage) ?? 0) + 1);
      counts.set(frame, use);
    }
  }
  const out = new Map<string, FrameUse>();
  for (const [frame, use] of counts) {
    const heritages = [...use.heritages]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([heritage]) => heritage);
    out.set(frame, { family: use.family, heritages });
  }
  return out;
}

/** How many heritages a frame's label names before it says "and more". */
const LABEL_HERITAGES = 3;

/**
 * A frame's menu row: `house_frame_02` -> `House Frame 02`, plus the heritages
 * that wear it once their names are known (`House Frame 02 (South Slavic,
 * Caucasian, Albanian, …)`). The game names no frame, so the heritages of the
 * cultures that state it are the only words it has.
 */
export function frameLabel(id: string, heritageNames: string[] = []): string {
  const name = id
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  if (!heritageNames.length) return name;
  const shown = heritageNames.slice(0, LABEL_HERITAGES);
  if (heritageNames.length > LABEL_HERITAGES) shown.push("…");
  return `${name} (${shown.join(", ")})`;
}

/**
 * Every frame the preview can wear: a `<id>.dds` in the frames folder that has
 * a `<id>_mask.dds` beside it, plus the title pair one folder up. Both halves
 * are needed, because the game masks the arms with one and draws the other
 * over them (gui/shared/coat_of_arms.gui).
 */
function designerFrames(dirs: { dir: string }[], usage: Map<string, FrameUse>): DesignerFrame[] {
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
    .map((id) => {
      const use = usage.get(id);
      return {
        id,
        label: frameLabel(id),
        ...(use ? { family: use.family, heritages: use.heritages } : {}),
      };
    });
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
