import * as fs from "node:fs";
import * as path from "node:path";
import AdmZip from "adm-zip";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ck3Meta } from "@px-lsp/server/games/ck3/meta";
import { vic3Meta } from "@px-lsp/server/games/vic3/meta";
import { eu5Meta } from "@px-lsp/server/games/eu5/meta";
import { importLegacyZip, stageLegacyArchive } from "../src/steam/legacyZip";

let scratch: string;
beforeEach(() => {
  const base = path.resolve(".local/testing");
  fs.mkdirSync(base, { recursive: true });
  scratch = fs.mkdtempSync(path.join(base, "legacy-zip-"));
});
afterEach(() => fs.rmSync(scratch, { recursive: true, force: true }));

function archive(files: Record<string, string>, modify?: (zip: AdmZip) => void): string {
  const zip = new AdmZip();
  for (const [index, [name, text]] of Object.entries(files).entries()) {
    const temporary = `entry-${index}`;
    zip.addFile(temporary, Buffer.from(text));
    // addFile normalizes traversal away; retain the supplied name to test hostile ZIPs.
    zip.getEntry(temporary)!.entryName = name;
  }
  modify?.(zip);
  const file = path.join(scratch, "old-version.zip");
  zip.writeZip(file);
  return file;
}

it.each([ck3Meta, vic3Meta, eu5Meta])(
  "imports $id archives at the root or inside a project folder",
  async (meta) => {
    for (const prefix of ["", "old-release/mod/"]) {
      const descriptor = meta.descriptor === "mod" ? "descriptor.mod" : ".metadata/metadata.json";
      const text =
        meta.descriptor === "mod"
          ? '\uFEFFname="Old mod"\nversion="1.2"\n'
          : '\uFEFF{"name":"Old mod","version":"1.2"}';
      const file = archive({
        [`${prefix}${descriptor}`]: text,
        [`${prefix}events/old.txt`]: "\uFEFFOld content",
        "README.md": "outside wrapper",
      });
      const before = fs.readFileSync(file);
      const imported = await importLegacyZip(file, meta);
      try {
        expect(imported.version).toBe("1.2");
        expect(fs.readFileSync(path.join(imported.root, "events/old.txt"), "utf8")).toBe("\uFEFFOld content");
        const staged = path.join(scratch, `staged-${prefix ? "wrapped" : "bare"}`);
        stageLegacyArchive(imported.root, staged, meta);
        expect(fs.readFileSync(path.join(staged, descriptor), "utf8")).toBe(text);
        expect(fs.readFileSync(file)).toEqual(before);
      } finally {
        imported.dispose();
      }
      expect(fs.existsSync(imported.root)).toBe(false);
    }
  }
);

it.each([
  ["missing descriptor", { "events/test.txt": "content" }, /exactly one descriptor/],
  ["multiple mods", { "a/descriptor.mod": 'name="A"', "b/descriptor.mod": 'name="B"' }, /Found 2/],
  ["empty descriptor", { "descriptor.mod": "# no mod" }, /mod name/],
  [
    "case collision",
    { "descriptor.mod": 'name="A"', "Events/a.txt": "a", "events/b.txt": "b" },
    /conflicting paths/,
  ],
  ["reserved path", { "descriptor.mod": 'name="A"', "aux.txt": "a" }, /unsafe file path/],
  [
    "traversal",
    { "descriptor.mod": 'name="A"', "../escaped.txt": "a" },
    /invalid relative path|unsafe file path/,
  ],
  ["absolute path", { "descriptor.mod": 'name="A"', "/escaped.txt": "a" }, /absolute path|unsafe file path/],
  ["drive path", { "descriptor.mod": 'name="A"', "C:/escaped.txt": "a" }, /absolute path|unsafe file path/],
  ["alternate stream", { "descriptor.mod": 'name="A"', "events/a.txt:evil": "a" }, /unsafe file path/],
] as const)("rejects %s", async (_label, files, error) => {
  await expect(importLegacyZip(archive(files), ck3Meta)).rejects.toThrow(error);
  expect(fs.existsSync(path.join(scratch, "escaped.txt"))).toBe(false);
});

it("rejects symbolic links", async () => {
  const file = archive({ "descriptor.mod": 'name="A"', "linked.txt": "../outside" }, (zip) => {
    zip.getEntries().find((entry) => entry.entryName === "linked.txt")!.attr = (0xa1ff << 16) >>> 0;
  });
  await expect(importLegacyZip(file, ck3Meta)).rejects.toThrow(/link, special file/);
});

it("rejects damaged file data even when decompression succeeds", async () => {
  const file = archive({ "descriptor.mod": 'name="A"', "events/a.txt": "content" });
  const data = fs.readFileSync(file);
  const central = data.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  data.writeUInt32LE((data.readUInt32LE(central + 16) ^ 1) >>> 0, central + 16);
  fs.writeFileSync(file, data);
  await expect(importLegacyZip(file, ck3Meta)).rejects.toThrow(/damaged file/);
});

it("rejects truncated archives and cancellation", async () => {
  const file = archive({ "descriptor.mod": 'name="A"' });
  const signal = AbortSignal.abort();
  await expect(importLegacyZip(file, ck3Meta, signal)).rejects.toThrow(/abort/i);
  fs.writeFileSync(file, fs.readFileSync(file).subarray(0, 32));
  await expect(importLegacyZip(file, ck3Meta)).rejects.toThrow();
});

it("rejects encrypted entries and oversized descriptors", async () => {
  const file = archive({ "descriptor.mod": 'name="A"' });
  const bytes = fs.readFileSync(file);
  const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bytes.writeUInt16LE(bytes.readUInt16LE(central + 8) | 1, central + 8);
  fs.writeFileSync(file, bytes);
  await expect(importLegacyZip(file, ck3Meta)).rejects.toThrow(/encrypted/);
  await expect(
    importLegacyZip(archive({ "descriptor.mod": 'name="A"\n' + " ".repeat(1024 ** 2) }), ck3Meta)
  ).rejects.toThrow(/descriptor is larger than 1 MB/);
});

it("rejects missing saved content without creating replacement files", () => {
  const missing = path.join(scratch, "missing");
  expect(() => stageLegacyArchive(missing, path.join(scratch, "stage"), ck3Meta)).toThrow();
  expect(fs.existsSync(missing)).toBe(false);
});
