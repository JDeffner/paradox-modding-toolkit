/**
 * Reader for the newer Paradox mod descriptor convention:
 * `<mod>/.metadata/metadata.json` (newer titles) instead of the launcher
 * `.mod` file. Fail-soft: any read/parse problem yields null.
 */
import * as fs from "fs";
import * as path from "path";

/** The mod's display name from `<dir>/.metadata/metadata.json`, or null. */
export function readMetadataName(dir: string): string | null {
  try {
    const file = path.join(dir, ".metadata", "metadata.json");
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { name?: unknown };
    return typeof parsed.name === "string" && parsed.name.trim() !== "" ? parsed.name : null;
  } catch {
    return null;
  }
}

/** True when `dir` carries a metadata-style descriptor. */
export function hasMetadataDescriptor(dir: string): boolean {
  try {
    return fs.existsSync(path.join(dir, ".metadata", "metadata.json"));
  } catch {
    return false;
  }
}
