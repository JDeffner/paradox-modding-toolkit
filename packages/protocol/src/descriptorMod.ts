/**
 * Knowledge table + validator for Paradox launcher `.mod` descriptor files
 * (`descriptor.mod` inside the mod folder, `<name>.mod` next to it).
 *
 * The key set and tag list come from the official launcher docs
 * (the Mod_structure page on the official wiki) cross-checked against 86 real .mod
 * files (launcher-generated + Workshop). No vscode imports: unit-testable.
 */
import * as fs from "fs";
import * as path from "path";

export interface DescriptorField {
  key: string;
  /** Launcher refuses/misbehaves without it. */
  required: boolean;
  /** May appear multiple times (replace_path). */
  repeatable: boolean;
  /** Only meaningful in the outer `<name>.mod` file, ignored in descriptor.mod. */
  outerOnly: boolean;
  /** One-line label shown next to the completion item. */
  summary: string;
  /** Markdown: what the value means and what to put in. */
  doc: string;
  /** VS Code snippet inserted on completion (placeholder = example value). */
  snippet: string;
}

export const DESCRIPTOR_FIELDS: DescriptorField[] = [
  {
    key: "name",
    required: true,
    repeatable: false,
    outerOnly: false,
    summary: "Display name in the launcher and on Steam Workshop",
    doc:
      "The name players see in the launcher's mod list and on the Workshop page. " +
      "Needs at least 3 characters for a Workshop upload.\n\n" +
      '```\nname="My Mod"\n```',
    snippet: 'name="${1:My Mod}"',
  },
  {
    key: "version",
    required: true,
    repeatable: false,
    outerOnly: false,
    summary: "Your mod's own version number (NOT the game version)",
    doc:
      "Free-form version string shown in the launcher. Bump it when you release " +
      "an update so players can tell versions apart. This is about your mod, " +
      "not the game - the game version goes in `supported_version`.\n\n" +
      '```\nversion="0.1.0"\n```',
    snippet: 'version="${1:0.1.0}"',
  },
  {
    key: "supported_version",
    required: true,
    repeatable: false,
    outerOnly: false,
    summary: "Newest game version the mod works with",
    doc:
      "The launcher compares this against the installed game and marks the mod " +
      "out of date when the game is newer. A `*` wildcard keeps the mod valid " +
      "for every hotfix of a patch.\n\n" +
      '```\nsupported_version="1.19.*"\n```',
    snippet: 'supported_version="${1:1.19.*}"',
  },
  {
    key: "tags",
    required: false,
    repeatable: false,
    outerOnly: false,
    summary: "Launcher / Workshop category tags (one quoted tag per line)",
    doc:
      "Categories players can filter by in the launcher and on the Workshop. " +
      "Pick from the launcher's list (completion inside the block offers all of " +
      "them); a Workshop upload needs at least one.\n\n" +
      '```\ntags={\n\t"Gameplay"\n\t"Events"\n}\n```',
    snippet: 'tags={\n\t"${1:Gameplay}"\n}',
  },
  {
    key: "path",
    required: false,
    repeatable: false,
    outerOnly: true,
    summary: "Where the mod folder is - outer <name>.mod file only",
    doc:
      "Tells the launcher where the mod's files live. Absolute or relative to " +
      "the game's user directory, forward slashes only.\n\n" +
      "**Leave this line out of `descriptor.mod`** - it is ignored there, and a " +
      "copied absolute path breaks when the mod is shared.\n\n" +
      '```\npath="mod/my_mod"\n```',
    snippet: 'path="${1:mod/my_mod}"',
  },
  {
    key: "remote_file_id",
    required: false,
    repeatable: false,
    outerOnly: false,
    summary: "Steam Workshop item ID (set automatically on first upload)",
    doc:
      "Links the local mod to its Workshop page so updates go to the same item. " +
      "The launcher fills this in when you first upload - you only ever set it " +
      "by hand to reconnect a mod to an existing Workshop item. Digits only.\n\n" +
      '```\nremote_file_id="2962333032"\n```',
    snippet: 'remote_file_id="${1:123456789}"',
  },
  {
    key: "picture",
    required: false,
    repeatable: false,
    outerOnly: false,
    summary: "Launcher thumbnail image (file inside the mod folder)",
    doc:
      "Image shown next to the mod in the launcher. Steam Workshop ignores it " +
      "and always uses `thumbnail.png` in the mod root instead (1:1, max 1 MB).\n\n" +
      '```\npicture="thumbnail.png"\n```',
    snippet: 'picture="${1:thumbnail.png}"',
  },
  {
    key: "replace_path",
    required: false,
    repeatable: true,
    outerOnly: false,
    summary: "Unload an entire vanilla folder (repeat per folder)",
    doc:
      "The game skips every vanilla file under this folder, so only your mod's " +
      "version of it exists. One line per folder, forward slashes, relative to " +
      "the game root. Used by total conversions to drop vanilla history, " +
      "titles, cultures etc. wholesale - do not use it for ordinary overrides.\n\n" +
      '```\nreplace_path="history/characters"\nreplace_path="common/landed_titles"\n```',
    snippet: 'replace_path="${1:history/characters}"',
  },
  {
    key: "dependencies",
    required: false,
    repeatable: false,
    outerOnly: false,
    summary: "Mods that must load BEFORE this one",
    doc:
      "The launcher sorts every listed mod above this one in the load order. " +
      "Use the exact `name` of the other mod, one quoted name per line. Mostly " +
      "for submods and compatibility patches.\n\n" +
      '```\ndependencies={\n\t"A Game of Thrones"\n}\n```',
    snippet: 'dependencies={\n\t"${1:Name of the parent mod}"\n}',
  },
];

export const DESCRIPTOR_FIELD_MAP: ReadonlyMap<string, DescriptorField> = new Map(
  DESCRIPTOR_FIELDS.map((f) => [f.key, f])
);

/** The launcher's fixed tag categories (Mod_structure wiki page, launcher UI). */
export const LAUNCHER_TAGS: string[] = [
  "Alternative History",
  "Balance",
  "Bookmarks",
  "Character Focuses",
  "Character Interactions",
  "Culture",
  "Decisions",
  "Events",
  "Fixes",
  "Gameplay",
  "Graphics",
  "Historical",
  "Map",
  "Portraits",
  "Religion",
  "Schemes",
  "Sound",
  "Total Conversion",
  "Translation",
  "Utilities",
  "Warfare",
];

// ---- parsing -------------------------------------------------------------------

export interface DescriptorEntry {
  key: string;
  /** 0-based line of the key. */
  line: number;
  /** Column range of the key on its line. */
  startCol: number;
  endCol: number;
  /** Raw text right of `=` (trimmed, quotes kept), "" when the value is a block. */
  value: string;
}

/**
 * Line-based parse of the flat key=value format. Only top-level keys are
 * entries; lines inside a `{ }` block (tags, dependencies) are skipped.
 */
export function parseDescriptor(text: string): DescriptorEntry[] {
  const entries: DescriptorEntry[] = [];
  let depth = 0;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const noComment = line.replace(/#.*$/, "");
    if (depth === 0) {
      // Tolerate a UTF-8 BOM on the first line.
      const m = /^(\uFEFF?\s*)([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(noComment);
      if (m) {
        const startCol = m[1].length;
        entries.push({
          key: m[2],
          line: i,
          startCol,
          endCol: startCol + m[2].length,
          value: m[3].trim().startsWith("{") ? "" : m[3].trim(),
        });
      }
    }
    for (const ch of noComment) {
      if (ch === "{") depth++;
      else if (ch === "}") depth = Math.max(0, depth - 1);
    }
  }
  return entries;
}

// ---- validation ------------------------------------------------------------------

export interface DescriptorIssue {
  code:
    | "descriptor-missing-field"
    | "descriptor-unknown-key"
    | "descriptor-duplicate-key"
    | "descriptor-path-ignored";
  severity: "error" | "warning";
  line: number;
  startCol: number;
  endCol: number;
  message: string;
}

/**
 * Structural checks on a .mod file. Everything here is certain: the key set is
 * closed (launcher docs) and required-ness is the launcher's own behavior.
 */
export function validateDescriptor(text: string, opts: { isDescriptorFile: boolean }): DescriptorIssue[] {
  const issues: DescriptorIssue[] = [];
  const entries = parseDescriptor(text);
  const seen = new Map<string, DescriptorEntry>();

  for (const e of entries) {
    const field = DESCRIPTOR_FIELD_MAP.get(e.key);
    const at = { line: e.line, startCol: e.startCol, endCol: e.endCol };
    if (!field) {
      issues.push({
        code: "descriptor-unknown-key",
        severity: "warning",
        ...at,
        message: `'${e.key}' is not a .mod descriptor key; the launcher ignores it.`,
      });
      continue;
    }
    if (seen.has(e.key) && !field.repeatable) {
      issues.push({
        code: "descriptor-duplicate-key",
        severity: "warning",
        ...at,
        message: `'${e.key}' appears more than once; only the last value counts.`,
      });
    }
    seen.set(e.key, e);
    if (e.key === "path" && opts.isDescriptorFile) {
      issues.push({
        code: "descriptor-path-ignored",
        severity: "warning",
        ...at,
        message:
          "path= belongs in the outer <name>.mod file; inside descriptor.mod the launcher ignores it, " +
          "and a machine-specific path leaks when the mod is shared.",
      });
    }
  }

  for (const field of DESCRIPTOR_FIELDS) {
    if (!field.required || seen.has(field.key)) continue;
    // supported_version: the launcher still lists the mod, it just cannot
    // check compatibility - a warning, not an error.
    const isHard = field.key !== "supported_version";
    issues.push({
      code: "descriptor-missing-field",
      severity: isHard ? "error" : "warning",
      line: 0,
      startCol: 0,
      endCol: 200,
      message: isHard
        ? `Missing ${field.key}= - the launcher needs it to list the mod.`
        : "Missing supported_version= - the launcher cannot tell which game version the mod is for.",
    });
  }

  return issues;
}

/**
 * The mod's display name from `<dir>/descriptor.mod` (`name="..."`), or null
 * when the file or field is missing/unreadable. Lets UI surfaces say WHICH mod
 * something comes from ("Community Flavor Pack") instead of a generic "mod".
 */
export function readDescriptorName(dir: string): string | null {
  let text: string;
  try {
    text = fs.readFileSync(path.join(dir, "descriptor.mod"), "utf8");
  } catch {
    return null;
  }
  const entry = parseDescriptor(text).find((e) => e.key === "name");
  if (!entry) return null;
  const value = entry.value.replace(/^"([^]*)"$/, "$1").trim();
  return value === "" ? null : value;
}

/** "1.19.0.6" -> "1.19.*" (the wildcard form that survives hotfixes). */
export function wildcardVersion(raw: string): string | null {
  const m = /^(\d+)\.(\d+)/.exec(raw.trim());
  return m ? `${m[1]}.${m[2]}.*` : null;
}

/** A launcher-correct starter descriptor.mod. */
export function scaffoldDescriptor(modName: string, supportedVersion: string): string {
  return [
    'version="0.1.0"',
    "tags={",
    '\t"Gameplay"',
    "}",
    `name="${modName.replace(/"/g, "'")}"`,
    `supported_version="${supportedVersion}"`,
    "",
  ].join("\n");
}
