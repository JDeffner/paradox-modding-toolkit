/**
 * Filesystem-backed asset-path IntelliSense (user-reported gap): completion for
 * quoted/unquoted asset paths (`texture = "gfx/interface/icons/..."`) drilled
 * one directory segment at a time across the content roots, plus bare-filename
 * `.dds` fields whose base directory the engine fixes per context
 * (`icon = cultivation_realm_2.dds` in a trait → gfx/interface/icons/traits/).
 *
 * Roots are listed in the same shadowing order as textureHover.ts: modPath,
 * then parentPaths, then gamePath. Listing is lazy — one fs.readdirSync per root
 * per request, no upfront recursive scan.
 */
import { CompletionItemKind, type CompletionItem } from "vscode-languageserver/node";
import * as fs from "fs";
import * as path from "path";
import type { ParadoxSettings } from "@px-lsp/protocol/protocol";
import type { CompletionResult } from "./completion";

/** Top-level folders under a content root that hold referenceable assets. */
const ASSET_ROOTS = new Set(["gfx", "gui", "fonts", "sound", "music", "dlc"]);

/**
 * Bare-filename `.dds` fields and the base directory the engine resolves them
 * against, keyed by definition kind (the file's schema folder) then by key.
 * Every entry was verified against vanilla: a real file uses the bare name AND
 * the asset lives at the mapped directory (defines in
 * common/defines/graphic/00_graphics.txt, cross-checked with the assets):
 *   - trait.icon          → TRAIT_ICON_PATH        (also documented in _traits.info)
 *   - death_reason.icon   → DEATH_REASON_ICON_PATH
 *   - building.type_icon  → BUILDING_TYPE_ICON_PATH
 */
const BARE_NAME_BASE_DIRS: Record<string, Record<string, string[]>> = {
  trait: { icon: ["gfx/interface/icons/traits"] },
  death_reason: { icon: ["gfx/interface/icons/death_reason"] },
  building: { type_icon: ["gfx/interface/icons/building_types"] },
};

interface Root {
  root: string;
  label: string;
}

/** Content roots in shadowing order (mod → parents → vanilla), non-null only. */
export function assetRoots(settings: ParadoxSettings): Root[] {
  const roots: Root[] = [];
  if (settings.modPath) roots.push({ root: settings.modPath, label: "mod" });
  for (const p of settings.parentPaths ?? []) roots.push({ root: p, label: "parent" });
  if (settings.gamePath) roots.push({ root: settings.gamePath, label: "vanilla" });
  return roots;
}

/** Base dirs a bare `.dds` field resolves against, or null when the key is not mapped. */
export function bareNameBaseDirs(kind: string | null | undefined, key: string): string[] | null {
  if (!kind) return null;
  return BARE_NAME_BASE_DIRS[kind]?.[key] ?? null;
}

/**
 * The asset-path prefix being typed inside a value, or null when the value is
 * not a directory-style asset path. Matches `key = "gfx/interface/ico`
 * (quote optional — script paths are often unquoted). A path qualifies when its
 * first segment is a known asset root; a slash-free partial qualifies when it is
 * still a prefix of one (so `"g` can suggest gfx/gui), which keeps arbitrary
 * quoted strings (`name = "PdxWidget"`) out.
 */
export function assetDirContext(linePrefix: string): string | null {
  const m = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?([A-Za-z0-9_.\-/]*)$/.exec(linePrefix);
  if (!m) return null;
  const value = m[2];
  // An empty value is ambiguous (could be a bare-name field): let the value-position
  // handler decide, kick in only once a segment is being typed.
  if (value === "") return null;
  const first = value.split("/")[0].toLowerCase();
  if (value.includes("/")) {
    return ASSET_ROOTS.has(first) ? value : null;
  }
  // No slash yet: only offer when the partial can still grow into a root.
  const low = value.toLowerCase();
  for (const r of ASSET_ROOTS) if (r.startsWith(low)) return value;
  return null;
}

function startsWithFold(name: string, prefix: string): boolean {
  return name.toLowerCase().startsWith(prefix.toLowerCase());
}

/**
 * Directory-segment completion for `pathPrefix` (e.g. `gfx/interface/ico`):
 * children of the parent directory across roots, deduped by relative path in
 * shadowing order. Directories get a trailing `/` and a retrigger command so the
 * user drills down; files complete as-is. isIncomplete so the client re-queries
 * per keystroke.
 */
export function provideAssetDirCompletion(settings: ParadoxSettings, pathPrefix: string): CompletionResult {
  const slash = pathPrefix.lastIndexOf("/");
  const parentRel = slash >= 0 ? pathPrefix.slice(0, slash) : "";
  const partial = slash >= 0 ? pathPrefix.slice(slash + 1) : pathPrefix;

  const seen = new Set<string>();
  const items: CompletionItem[] = [];
  for (const { root, label } of assetRoots(settings)) {
    const dir = parentRel ? path.join(root, ...parentRel.split("/")) : root;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d of entries) {
      const name = d.name;
      if (partial && !startsWithFold(name, partial)) continue;
      const isDir = d.isDirectory();
      const relLow = `${parentRel}/${name}`.toLowerCase();
      if (seen.has(relLow)) continue;
      seen.add(relLow);
      const item: CompletionItem = {
        label: name,
        kind: isDir ? CompletionItemKind.Folder : CompletionItemKind.File,
        detail: label,
        // Directories first, then files; alphabetical within each group.
        sortText: `${isDir ? "0" : "1"}${name.toLowerCase()}`,
      };
      if (isDir) {
        item.insertText = `${name}/`;
        item.command = { command: "editor.action.triggerSuggest", title: "Suggest next segment" };
      }
      items.push(item);
    }
  }
  return { isIncomplete: true, items };
}

/**
 * `*.dds` completion for a bare-filename field: files from the mapped base dirs
 * across roots (mod-first), deduped by filename. Returns null when the key is
 * not a mapped bare-name field.
 */
export function provideBareNameCompletion(
  settings: ParadoxSettings,
  kind: string | null | undefined,
  key: string
): CompletionItem[] | null {
  const dirs = bareNameBaseDirs(kind, key);
  if (!dirs) return null;
  const seen = new Set<string>();
  const items: CompletionItem[] = [];
  for (const { root, label } of assetRoots(settings)) {
    for (const rel of dirs) {
      let entries: string[];
      try {
        entries = fs.readdirSync(path.join(root, ...rel.split("/")));
      } catch {
        continue;
      }
      for (const name of entries) {
        if (!name.toLowerCase().endsWith(".dds")) continue;
        const low = name.toLowerCase();
        if (seen.has(low)) continue;
        seen.add(low);
        items.push({
          label: name,
          kind: CompletionItemKind.File,
          detail: `${rel} (${label})`,
          sortText: name.toLowerCase(),
        });
      }
    }
  }
  return items;
}
