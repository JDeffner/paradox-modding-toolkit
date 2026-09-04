/**
 * The Coat of Arms Designer's library: a folder of plain script files the
 * designer exports designs to and imports them back from, outside any mod.
 *
 * The games have no script-export folder for coats of arms (their own designer
 * writes a screenshot), so this is the toolkit's own store, keyed by the design
 * name and holding exactly what "Copy to Clipboard" produces: one `NAME = { … }`
 * definition per file, which means a library file can also be pasted straight
 * into a mod by hand.
 *
 * No `vscode` here, so the naming and listing rules are unit-testable.
 */
import * as fs from "fs";
import * as path from "path";
import { parseCoaFile } from "@px-lsp/server/coa/coaParse";
import { BOM, isPlainScriptFileName } from "../../creators/saveTargets";
import type { LibraryItem } from "./messages";

/**
 * The file a design of this name is stored under. The designer already keeps
 * its name to `[\w.-]`, but this name reaches a file path, so the rule is
 * applied again here and a name that still cannot make a bare `.txt` file
 * (empty, or all separators) falls back rather than writing somewhere odd.
 */
export function libraryFileName(name: string): string {
  const stem = name
    .trim()
    .replace(/\.txt$/i, "")
    .replace(/[^\w.-]/g, "_")
    .replace(/^[.\s]+/, "");
  const file = `${stem}.txt`;
  return stem !== "" && isPlainScriptFileName(file) ? file : "coa.txt";
}

/** Every design in the library, by file name. An unreadable folder is empty. */
export function readLibrary(dir: string): LibraryItem[] {
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter(isPlainScriptFileName).sort();
  } catch {
    return [];
  }
  return files.map((file) => {
    const stem = file.replace(/\.txt$/i, "");
    try {
      const flag = parseCoaFile(fs.readFileSync(path.join(dir, file), "utf8"))[0] ?? null;
      return { name: flag?.name || stem, file, flag };
    } catch {
      return { name: stem, file, flag: null };
    }
  });
}

/** Whether exporting under this name would replace a file that is already there. */
export function libraryHas(dir: string, name: string): boolean {
  return fs.existsSync(path.join(dir, libraryFileName(name)));
}

/**
 * Write one design into the library, creating the folder on the way. The BOM
 * is the rule every script file the games read follows, and a library file is
 * meant to be pasteable into a mod as it stands.
 */
export function writeLibraryFile(dir: string, name: string, script: string): string {
  const file = libraryFileName(name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), `${BOM}${script.replace(/\s*$/, "")}\n`, "utf8");
  return file;
}
