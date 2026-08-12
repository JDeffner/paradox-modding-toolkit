/**
 * One display name for a mod folder, whichever descriptor convention it uses.
 * Every surface that names a mod (setup report, sidebar, pickers, the Project
 * view, hover origins) goes through this, so a mod is called what its author
 * called it instead of "3385002128".
 */
import * as path from "path";
import { readDescriptorName } from "./descriptorMod";
import { readMetadataName } from "./descriptorMetadata";

/**
 * The mod's display name: the launcher descriptor's `name=`, else
 * `.metadata/metadata.json`'s `name`, else the folder's own name. Never null,
 * so callers need no fallback of their own.
 */
export function readModName(dir: string): string {
  return readDescriptorName(dir) ?? readMetadataName(dir) ?? path.basename(dir);
}
