/**
 * Reader and writer for the newer Paradox mod descriptor convention:
 * `<mod>/.metadata/metadata.json` (newer titles) instead of the launcher
 * `.mod` file. Fail-soft on read: any read/parse problem yields null.
 *
 * The field set is copied from three real workshop mods (2026-08-12: name, id,
 * version, supported_game_version, tags, relationships, game_custom_data;
 * `game_id` appears in one of the three and is left out here because the other
 * two load without it). The relationship shape is the one the Community Mod
 * Framework documents for the mods that depend on it.
 */
import * as fs from "fs";
import * as path from "path";

/** Mod-root-relative path of the descriptor, forward slashes. */
export const METADATA_REL_PATH = ".metadata/metadata.json";

/** One entry of `relationships`: a link to another mod. */
export interface MetadataRelationship {
  /** "dependency", "incompatible_with", "load_before", "load_after". */
  rel_type: string;
  /** The other mod's `id` field (NOT its Workshop number). */
  id: string;
  /** Shown when the other mod is not on disk. */
  display_name?: string;
  /** Only "mod" is supported by the launcher today. */
  resource_type: string;
  /** Version of the other mod, `*` for any. */
  version?: string;
}

/** The fields of a mod's metadata.json this toolkit reads or writes. */
export interface ModMetadata {
  name?: string;
  id?: string;
  version?: string;
  supported_game_version?: string;
  short_description?: string;
  tags?: string[];
  relationships?: MetadataRelationship[];
  game_custom_data?: { multiplayer_synchronized?: boolean; replace_paths?: string[] };
}

/** The parsed `<dir>/.metadata/metadata.json`, or null when absent/unreadable. */
export function readMetadata(dir: string): ModMetadata | null {
  try {
    const file = path.join(dir, ".metadata", "metadata.json");
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8")) as ModMetadata;
  } catch {
    return null;
  }
}

/** The mod's display name from `<dir>/.metadata/metadata.json`, or null. */
export function readMetadataName(dir: string): string | null {
  const name = readMetadata(dir)?.name;
  return typeof name === "string" && name.trim() !== "" ? name : null;
}

/** True when `dir` carries a metadata-style descriptor. */
export function hasMetadataDescriptor(dir: string): boolean {
  try {
    return fs.existsSync(path.join(dir, ".metadata", "metadata.json"));
  } catch {
    return false;
  }
}

export interface MetadataScaffold {
  name: string;
  /** Stable identifier other mods point their relationships at. */
  id: string;
  /** The mod's own version, not the game's. */
  version?: string;
  /** Game version the mod is for, `*` when unknown. */
  supportedGameVersion: string;
  shortDescription?: string;
  tags?: string[];
  relationships?: MetadataRelationship[];
  /** Vanilla folders the mod unloads wholesale (total conversions). */
  replacePaths?: string[];
}

/** A launcher-correct starter metadata.json, in the corpus's field order. */
export function scaffoldMetadata(opts: MetadataScaffold): string {
  const body: ModMetadata = {
    name: opts.name,
    id: opts.id,
    version: opts.version ?? "0.1.0",
    supported_game_version: opts.supportedGameVersion,
    ...(opts.shortDescription ? { short_description: opts.shortDescription } : {}),
    tags: opts.tags ?? [],
    relationships: opts.relationships ?? [],
    game_custom_data: {
      multiplayer_synchronized: true,
      ...(opts.replacePaths && opts.replacePaths.length > 0 ? { replace_paths: opts.replacePaths } : {}),
    },
  };
  return JSON.stringify(body, null, 2) + "\n";
}
