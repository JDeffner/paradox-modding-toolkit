/**
 * The workshop scan behind `Paradox: Add Dependency Mod`. The fixture mirrors
 * the real corpus (a metadata mod whose folder is a bare item id, a .mod mod,
 * a mod with no descriptor at all) because every one of those names a row
 * differently.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { dependencyCandidates } from "../src/dependencyScan";

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "px-workshop-"));
  const item = (id: string) => {
    const dir = path.join(root, id);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };

  const cmf = item("3385002128");
  fs.mkdirSync(path.join(cmf, ".metadata"));
  fs.writeFileSync(
    path.join(cmf, ".metadata", "metadata.json"),
    JSON.stringify({ name: "[1.13] Community Mod Framework", id: "community_mod_framework" })
  );

  fs.writeFileSync(path.join(item("3227982912"), "descriptor.mod"), 'name="Ante Bellum"\nversion="1.0"\n');
  item("3472248460"); // No descriptor: named after its folder.
  item("9999999999"); // Already indexed.
  return root;
}

describe("dependencyCandidates", () => {
  it("orders declared hits, then missing declarations, then the rest, minus what is indexed", () => {
    const root = fixture();
    const rows = dependencyCandidates({
      declared: [
        // Matched by the metadata `id`, not by the display name.
        { label: "Community Mod Framework", keys: ["community_mod_framework", ""] },
        { label: "Not Subscribed Mod", keys: ["not_subscribed"] },
      ],
      workshopRoots: [root, path.join(root, "does-not-exist")],
      exclude: [path.join(root, "9999999999") + path.sep, ""],
    });

    expect(rows.map((r) => [r.label, r.itemId, r.declared])).toEqual([
      ["[1.13] Community Mod Framework", "3385002128", true],
      ["Not Subscribed Mod", "", true],
      ["3472248460", "3472248460", false],
      ["Ante Bellum", "3227982912", false],
    ]);
    expect(rows[0].path).toBe(path.join(root, "3385002128"));
    // A declared dependency that is not installed has no folder to add.
    expect(rows[1].path).toBeNull();

    fs.rmSync(root, { recursive: true, force: true });
  });
});
