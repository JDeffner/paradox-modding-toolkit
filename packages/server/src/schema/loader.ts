/**
 * Schema loading: the active game profile's bundled schema table merged with an
 * optional per-workspace overlay at `<mod>/<configDir>/schema.json`, so
 * total-conversion frameworks can teach the extension their own folders
 * without a release.
 */
import * as fs from "fs";
import * as path from "path";
import { resolveConfigDir } from "@px-lsp/protocol/configDir";
import { activeProfile } from "../games/active";
import type { GameProfile } from "../games/profile";
import type { AmbientScope, SchemaEntry, KeySpec, RefField, SchemaOverlay } from "./types";

/**
 * Per-kind structure/ambient lookup precomputed at schema load (v1.1 §B2/§B3),
 * so completion and hover do no per-request scans (perf budget ~1-2 ms).
 */
export interface StructureIndex {
  /** kind -> block name ("" = top level) -> KeySpec, for key/doc lookup. */
  keysByKindBlock: Map<string, Map<string, Map<string, KeySpec>>>;
  /** kind -> ambient scope name -> AmbientScope. */
  ambientByKind: Map<string, Map<string, AmbientScope>>;
  /** kind -> provenance label for hover ("character_interactions"). */
  source(kind: string): string | undefined;
}

export interface SchemaData {
  entries: SchemaEntry[];
  /** key -> field spec (merged). */
  refFields: Map<string, RefField>;
  /** value prefix -> candidate kinds. */
  prefixRefs: Record<string, string[]>;
  /** Precomputed structure/ambient lookup (v1.1). */
  structures: StructureIndex;
}

function buildStructureIndex(profile: GameProfile, entries: SchemaEntry[]): StructureIndex {
  const keysByKindBlock = new Map<string, Map<string, Map<string, KeySpec>>>();
  const ambientByKind = new Map<string, Map<string, AmbientScope>>();
  for (const entry of entries) {
    if (entry.structure) {
      const byBlock = new Map<string, Map<string, KeySpec>>();
      const top = new Map<string, KeySpec>();
      for (const spec of entry.structure.topLevel) top.set(spec.key, spec);
      byBlock.set("", top);
      for (const [name, specs] of Object.entries(entry.structure.blocks ?? {})) {
        const m = new Map<string, KeySpec>();
        for (const spec of specs) m.set(spec.key, spec);
        byBlock.set(name, m);
      }
      keysByKindBlock.set(entry.kind, byBlock);
    }
    if (entry.ambientScopes) {
      const m = new Map<string, AmbientScope>();
      for (const a of entry.ambientScopes) m.set(a.name, a);
      ambientByKind.set(entry.kind, m);
    }
  }
  return {
    keysByKindBlock,
    ambientByKind,
    source: (kind) => profile.structureSources[kind],
  };
}

export function loadSchema(modPath: string | string[] | null, log?: (msg: string) => void): SchemaData {
  const profile = activeProfile();
  const entries = [...profile.schema];
  const refFields = new Map<string, RefField>();
  for (const f of profile.refFields) refFields.set(f.key, f);
  const prefixRefs: Record<string, string[]> = { ...profile.prefixRefs };

  // Multi-mod workspaces: every workspace mod may carry an overlay; later
  // roots win on collisions (roots are passed in load order, mod-of-record
  // first, collisions are rare and per-path).
  const roots = modPath === null ? [] : Array.isArray(modPath) ? modPath : [modPath];
  for (const root of roots) {
    const overlayFile = path.join(resolveConfigDir(root, profile), "schema.json");
    try {
      if (!fs.existsSync(overlayFile)) continue;
      const overlay = JSON.parse(fs.readFileSync(overlayFile, "utf8")) as SchemaOverlay;
      for (const e of overlay.entries ?? []) {
        if (typeof e?.path !== "string" || typeof e?.kind !== "string") continue;
        // The overlay is mod content and e.path steers the indexer's walk
        // (scanRoot joins it under the root): a path that could climb out of
        // the mod is dropped. classifyFile guards the symmetric case already.
        if (
          path.isAbsolute(e.path) ||
          e.path.includes("\\") ||
          e.path.split("/").some((s) => s === ".." || s === "")
        ) {
          log?.(`schema overlay entry ignored (unsafe path): ${e.path}`);
          continue;
        }
        // Overlay entries replace bundled ones with the same path.
        const i = entries.findIndex((x) => x.path === e.path);
        if (i >= 0) entries[i] = e;
        else entries.push(e);
      }
      for (const f of overlay.refFields ?? []) {
        if (typeof f?.key !== "string" || !Array.isArray(f?.kinds)) continue;
        refFields.set(f.key, f);
      }
      for (const [prefix, kinds] of Object.entries(overlay.prefixRefs ?? {})) {
        if (Array.isArray(kinds)) prefixRefs[prefix] = kinds;
      }
      log?.(`schema overlay loaded from ${overlayFile}`);
    } catch (err) {
      log?.(`schema overlay ignored (${overlayFile}): ${String(err)}`);
    }
  }

  // Profile-level structure layer (a fully harvested one, as opposed to a schema
  // table that already carries curated `structure` on its entries). Applied last
  // so workspace-overlay folders of a known kind get it too; an entry that
  // already declares its own structure keeps it.
  if (profile.structures) {
    for (let i = 0; i < entries.length; i++) {
      const structure = profile.structures[entries[i].kind];
      if (structure && !entries[i].structure) entries[i] = { ...entries[i], structure };
    }
  }

  return { entries, refFields, prefixRefs, structures: buildStructureIndex(profile, entries) };
}
