import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { openPromise } from "yauzl";
import type { GameMeta } from "@px-lsp/server/games/profile";
import { parseDescriptor } from "@px-lsp/protocol/descriptorMod";
import { METADATA_REL_PATH } from "@px-lsp/protocol/descriptorMetadata";
import { pxIgnoreFilter } from "./pxignore";

export interface LegacyZip {
  root: string;
  name: string;
  version: string | null;
  dispose(): void;
}

/** Revalidate saved content before any remote item is created. Never use live files as a fallback. */
export function stageLegacyArchive(root: string, staging: string, meta: GameMeta): void {
  archivedModVersion(root, meta);
  const keep = pxIgnoreFilter(root);
  fs.cpSync(root, staging, {
    recursive: true,
    filter(source) {
      const stat = fs.lstatSync(source);
      if (stat.isSymbolicLink()) throw new Error("Legacy mod content must not contain links.");
      return source === root || keep(path.relative(root, source), stat.isDirectory());
    },
  });
}

// Bound disk usage as well as memory. Large archives stream one entry at a time.
const MAX_BYTES = 20 * 1024 ** 3;
const MAX_ENTRIES = 200_000;
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});

/** Validate the selected game's descriptor without importing listing metadata or an old Steam ID. */
export function archivedModVersion(root: string, meta: GameMeta): string | null {
  const relative = meta.descriptor === "mod" ? "descriptor.mod" : METADATA_REL_PATH;
  const file = path.join(root, relative);
  if (fs.lstatSync(root).isSymbolicLink() || fs.lstatSync(file).isSymbolicLink())
    throw new Error("Legacy mod content must not contain links.");
  if (fs.statSync(file).size > 1024 ** 2)
    throw new Error(
      "The ZIP's mod descriptor is larger than 1 MB. Check that it contains a valid mod descriptor."
    );
  const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  if (meta.descriptor === "mod") {
    const entries = parseDescriptor(text);
    const value = (key: string) =>
      entries
        .find((entry) => entry.key === key)
        ?.value.replace(/^"|"$/g, "")
        .trim();
    if (!value("name")) throw new Error("The ZIP's descriptor.mod must contain a mod name.");
    return value("version") || null;
  }
  const metadata = JSON.parse(text) as Record<string, unknown> | null;
  if (!metadata || typeof metadata.name !== "string" || !metadata.name.trim())
    throw new Error("The ZIP's .metadata/metadata.json must contain a mod name.");
  return typeof metadata.version === "string" ? metadata.version : null;
}

/** Extract into an owned temporary directory. Never write through paths supplied by the archive. */
export async function importLegacyZip(
  file: string,
  meta: GameMeta,
  signal?: AbortSignal
): Promise<LegacyZip> {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "px-legacy-zip-"));
  const dispose = () => fs.rmSync(temporary, { recursive: true, force: true });
  try {
    const before = fs.statSync(file);
    const zip = await openPromise(file, { autoClose: false });
    try {
      if (zip.entryCount > MAX_ENTRIES) throw new Error("The ZIP contains more than 200,000 entries.");
      let total = 0;
      const paths = new Map<string, { spelling: string; directory: boolean; explicit: boolean }>();
      const descriptors: string[] = [];
      const descriptor = meta.descriptor === "mod" ? "descriptor.mod" : METADATA_REL_PATH.replace(/\\/g, "/");
      for await (const entry of zip.eachEntry()) {
        signal?.throwIfAborted();
        const directory = entry.fileName.endsWith("/");
        const name = directory ? entry.fileName.slice(0, -1) : entry.fileName;
        const parts = name.split("/");
        if (
          parts.some(
            (part) =>
              !part ||
              part === "." ||
              part === ".." ||
              /[<>:"\\|?*]/.test(part) ||
              Array.from(part).some((character) => character.charCodeAt(0) < 32) ||
              /[. ]$/.test(part) ||
              /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
          )
        )
          throw new Error(`The ZIP contains an unsafe file path: ${entry.fileName}`);
        const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
        if ((mode && mode !== (directory ? 0x4000 : 0x8000)) || entry.isEncrypted())
          throw new Error(`The ZIP contains a link, special file or encrypted entry: ${entry.fileName}`);
        // Check implied parent directories too, including case collisions on Windows.
        for (let i = 1; i <= parts.length; i++) {
          const spelling = parts.slice(0, i).join("/");
          const key = spelling.toLowerCase();
          const isDirectory = i < parts.length || directory;
          const explicit = i === parts.length;
          const previous = paths.get(key);
          if (
            previous &&
            (previous.spelling !== spelling ||
              previous.directory !== isDirectory ||
              (previous.explicit && explicit))
          )
            throw new Error(`The ZIP contains conflicting paths: ${entry.fileName}`);
          paths.set(key, { spelling, directory: isDirectory, explicit: explicit || !!previous?.explicit });
        }
        total += entry.uncompressedSize;
        if (!Number.isSafeInteger(total) || total > MAX_BYTES)
          throw new Error("The ZIP expands to more than 20 GB. Use a separate legacy project for this mod.");
        const destination = path.join(temporary, ...parts);
        if (directory) {
          fs.mkdirSync(destination, { recursive: true });
          continue;
        }
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        let crc = 0xffffffff;
        const checksum = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            for (const byte of chunk) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
            callback(null, chunk);
          },
          flush(callback) {
            callback(
              (crc ^ 0xffffffff) >>> 0 === entry.crc32
                ? null
                : new Error(`The ZIP contains a damaged file: ${name}`)
            );
          },
        });
        await pipeline(
          await zip.openReadStreamPromise(entry),
          checksum,
          fs.createWriteStream(destination, { flags: "wx" }),
          { signal }
        );
        if (name === descriptor || name.endsWith(`/${descriptor}`)) descriptors.push(name);
      }
      if (descriptors.length !== 1)
        throw new Error(
          `The ZIP must contain exactly one ${descriptor} for ${meta.name}. Found ${descriptors.length}. Choose an archive containing one mod.`
        );
      const root = path.join(temporary, descriptors[0].slice(0, -descriptor.length));
      const version = archivedModVersion(root, meta);
      const after = fs.statSync(file);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
        throw new Error("The ZIP changed during import. Choose it again.");
      return { root, version, name: path.basename(file), dispose };
    } finally {
      zip.close();
    }
  } catch (error) {
    dispose();
    throw error;
  }
}
