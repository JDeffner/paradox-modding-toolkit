/**
 * Origin labels for definitions: the owning mod's display name (descriptor.mod
 * `name=`) instead of the generic "mod"/"parent" source tag, so a hover in a
 * multi-mod workspace says WHICH of the 20 open mods a definition comes from.
 *
 * No `vscode` imports: unit-tested in plain Node.
 */
import * as path from "path";
import { readModName } from "@px-lsp/protocol/modName";

/** Hover head lines stay compact: clip pathological descriptor names. */
const MAX_LABEL = 40;

function clip(name: string): string {
  return name.length > MAX_LABEL ? `${name.slice(0, MAX_LABEL - 1)}…` : name;
}

export class ModOriginResolver {
  /** Longest prefix first, so a mod nested under another root wins. */
  private roots: Array<{ root: string; prefix: string; label: string }> = [];

  /** `modRoots`: every mod root (primary mod, workspace mods, parents).
   *  Descriptor names are read once here, not per lookup. */
  setRoots(modRoots: string[]): void {
    this.roots = modRoots
      .map((root) => ({
        root,
        prefix:
          path
            .normalize(root)
            .toLowerCase()
            .replace(/[\\/]+$/, "") + path.sep,
        label: clip(readModName(root)),
      }))
      .sort((a, b) => b.prefix.length - a.prefix.length);
  }

  private entryFor(file: string): { root: string; prefix: string; label: string } | null {
    if (!file || !path.isAbsolute(file)) return null;
    const lower = path.normalize(file).toLowerCase();
    for (const r of this.roots) {
      if (lower.startsWith(r.prefix)) return r;
    }
    return null;
  }

  /** Display label for a definition's origin. Falls back to `source` when the
   *  file lies under no known mod root (vanilla, engine, synthetic defs). */
  labelFor(file: string, source: string): string {
    return this.entryFor(file)?.label ?? source;
  }

  /** The mod root (as configured) a file lives under, or null. */
  rootFor(file: string): string | null {
    return this.entryFor(file)?.root ?? null;
  }

  /** Display label for a known mod root ("Mod Alpha" for its path). */
  labelForRoot(root: string): string {
    const lower = path
      .normalize(root)
      .toLowerCase()
      .replace(/[\\/]+$/, "");
    for (const r of this.roots) {
      if (r.prefix === lower + path.sep) return r.label;
    }
    return clip(readModName(root));
  }
}
