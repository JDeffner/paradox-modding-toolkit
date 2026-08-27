/**
 * The guard for the mistake this feature shipped with first: exclude patterns
 * written as DIRECTORIES (a glob over the whole gfx tree) hide real script from search and, worse,
 * suppress the watcher events that re-index a file on save. CK3 maps seven
 * schema folders under gfx/, and a real workspace holds hundreds of script
 * files under gfx/, music/ and dlc/.
 *
 * So: every pattern must be extension-scoped, and no pattern may match a file
 * in any schema folder of any supported game, or a .txt/.yml/.gui/.mod at all.
 */
import { describe, expect, it } from "vitest";
import { SEARCH_EXCLUDES, WATCHER_EXCLUDES, BINARY_EXTS } from "../src/editorExcludes";
import { CK3_SCHEMA } from "@px-lsp/server/games/ck3/schema";
import { VIC3_SCHEMA } from "@px-lsp/server/games/vic3/schema";

const ALL = [...new Set([...WATCHER_EXCLUDES, ...SEARCH_EXCLUDES])];

/** Our patterns are all extension globs; this reads the extension back. */
const extOf = (pattern: string): string | null => {
  const m = /^\*\*\/\*\.([A-Za-z0-9]+)$/.exec(pattern);
  return m ? m[1].toLowerCase() : null;
};

describe("editor exclude patterns are safe", () => {
  it("are all extension patterns, never directory patterns", () => {
    for (const p of ALL) {
      expect(extOf(p), `${p} is not an extension pattern`).not.toBeNull();
    }
  });

  it("never exclude an extension the toolkit indexes", () => {
    const indexed = new Set(["txt", "yml", "gui", "mod", "info", "csv", "json", "asset"]);
    for (const p of ALL) {
      expect(indexed.has(extOf(p)!), `${p} would hide indexed content`).toBe(false);
    }
  });

  it("never exclude an extension any schema entry maps", () => {
    const schemaExts = new Set(
      [...CK3_SCHEMA, ...VIC3_SCHEMA].map((e) => (e.ext ?? ".txt").replace(/^\./, "").toLowerCase())
    );
    for (const ext of BINARY_EXTS) {
      expect(schemaExts.has(ext), `.${ext} is a schema-mapped extension`).toBe(false);
    }
  });

  it("cannot match a script file living under an asset directory (the shipped bug)", () => {
    // Paths that a directory-shaped exclude WOULD have swallowed. Under an
    // extension-only scheme every one of them stays visible.
    const scriptUnderAssets = [
      "gfx/portraits/portrait_modifiers/00_portrait_modifiers.txt",
      "gfx/court_scene/character_roles/00_roles.txt",
      "gfx/interface/illustrations/scripted_illustrations/00_illustrations.txt",
      "music/00_music.txt",
      "dlc/dlc001/common/traits/00_traits.txt",
      "map_data/geographical_region.txt",
    ];
    for (const file of scriptUnderAssets) {
      for (const p of ALL) {
        expect(file.endsWith(`.${extOf(p)}`), `${p} would hide ${file}`).toBe(false);
      }
    }
  });
});
