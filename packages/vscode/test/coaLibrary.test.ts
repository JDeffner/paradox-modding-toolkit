/**
 * The Coat of Arms Designer's library store (webviews/coaDesigner/library.ts).
 *
 * The claim worth pinning is that a design name reaches a file path: the name
 * the modder typed decides the file, so a name that would escape the folder or
 * make no file at all must not become one, and what is written back has to
 * parse as the definition it came from.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { writeFlag, type CoaFlag } from "@px-lsp/server/coa/coa";
import {
  libraryFileName,
  libraryHas,
  readLibrary,
  writeLibraryFile,
} from "../src/webviews/coaDesigner/library";

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "px-coalib-"));

const FLAG: CoaFlag = {
  name: "my_house_coa",
  pattern: "pattern_solid.dds",
  colors: [{ name: "color1", kind: "named", value: "red" }],
  layers: [],
};

describe("a library file is named after the design", () => {
  it("keeps a plain name, adds the extension once, and falls back rather than making a nameless file", () => {
    expect(libraryFileName("my_house_coa")).toBe("my_house_coa.txt");
    expect(libraryFileName("  spaced  ")).toBe("spaced.txt");
    expect(libraryFileName("my_house_coa.txt")).toBe("my_house_coa.txt");
    expect(libraryFileName("")).toBe("coa.txt");
    expect(libraryFileName(".txt")).toBe("coa.txt");
  });

  it("cannot leave the folder", () => {
    // Separators become underscores and a leading dot is dropped, so what is
    // left is a bare name inside the folder however hostile the input was.
    expect(libraryFileName("../../evil")).toBe("_.._evil.txt");
    expect(libraryFileName("sub/dir")).toBe("sub_dir.txt");
    expect(libraryFileName("C:\\windows\\system32")).toBe("C__windows_system32.txt");
    expect(libraryFileName("..")).toBe("coa.txt");
  });
});

describe("the library round-trips a design", () => {
  it("writes what Copy writes, and reads it back as the same definition", () => {
    const dir = path.join(tmp(), "coat_of_arms");
    expect(libraryHas(dir, FLAG.name)).toBe(false);
    // The folder does not exist yet: the first export creates it.
    expect(writeLibraryFile(dir, FLAG.name, writeFlag(FLAG))).toBe("my_house_coa.txt");
    expect(libraryHas(dir, FLAG.name)).toBe(true);

    const items = readLibrary(dir);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("my_house_coa");
    expect(items[0].flag).toEqual(FLAG);
    // Every script file the games read is UTF-8 with a BOM, and a library file
    // is meant to be pasteable into a mod as it stands.
    expect(fs.readFileSync(path.join(dir, items[0].file), "utf8").startsWith("﻿")).toBe(true);
  });

  it("reports a file it cannot read instead of dropping it, and lists nothing for a missing folder", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "notes.txt"), "just some prose", "utf8");
    expect(readLibrary(dir)).toEqual([{ name: "notes", file: "notes.txt", flag: null }]);
    expect(readLibrary(path.join(dir, "missing"))).toEqual([]);
  });
});
