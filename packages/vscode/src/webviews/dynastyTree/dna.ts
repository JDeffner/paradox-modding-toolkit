import * as path from "path";
import { listFiles } from "@px-lsp/protocol/fsWalk";
import { parseScript } from "@px-lsp/server/parser";

/** common/dna_data/_dna_data.info defines the portrait_info and DNA-string
 * alternatives. Game-generated common/bookmark_portraits and saved .ck3ruler
 * portrait_info blocks use the same direct genes/type shape for persistent DNA. */
export function gameDnaCopy(
  text: string,
  female: boolean
): { text: string; format: "persistent" | "string" } | null {
  const parsed = parseScript(text);
  if (parsed.errors.length) return null;
  const outer = parsed.root.statements[0];
  if (outer?.kind !== "assignment" || outer.value?.kind !== "block") return null;
  const fields = outer.value.statements;
  const portrait = fields.find((s) => s.kind === "assignment" && s.key.text === "portrait_info");
  if (portrait?.kind === "assignment" && portrait.value?.kind === "block") {
    const block = portrait.value;
    if (
      !block.statements.some(
        (s) => s.kind === "assignment" && s.key.text === "genes" && s.value?.kind === "block"
      )
    )
      return null;
    const type = block.statements.find((s) => s.kind === "assignment" && s.key.text === "type");
    let body = text.slice(block.range.start, block.range.end);
    const sex = female ? "female" : "male";
    if (type?.kind === "assignment" && type.value?.kind === "scalar") {
      const start = type.value.range.start - block.range.start;
      const end = type.value.range.end - block.range.start;
      body = body.slice(0, start) + sex + body.slice(end);
    } else {
      body = `{\n\ttype=${sex}\n${body.slice(1)}`;
    }
    return { text: `${outer.key.text}=${body}`, format: "persistent" };
  }
  const dna = fields.find((s) => s.kind === "assignment" && s.key.text === "dna");
  return dna?.kind === "assignment" && dna.value?.kind === "scalar" && dna.value.text
    ? { text: dna.value.text, format: "string" }
    : null;
}

/** Roots are in load order, base first. Later files and definitions win.
 * Same-path overrides hide the entire earlier file, even keys they omit. */
export function dnaFiles(roots: string[], folder: string, openFiles: string[] = []): string[] {
  const effective = new Map<string, { file: string; order: number }>();
  for (const [order, root] of roots.filter((r, i) => roots.lastIndexOf(r) === i).entries()) {
    const dir = path.join(root, folder);
    const files = new Set(listFiles(dir, ".txt"));
    for (const file of openFiles) {
      const rel = path.relative(dir, file);
      if (rel && !rel.startsWith("..") && !path.isAbsolute(rel) && file.toLowerCase().endsWith(".txt")) {
        files.add(file);
      }
    }
    for (const file of [...files].sort()) {
      const relative = path.relative(dir, file).replace(/\\/g, "/");
      effective.set(process.platform === "win32" ? relative.toLowerCase() : relative, { file, order });
    }
  }
  return [...effective.values()]
    .sort((a, b) => b.order - a.order || (a.file < b.file ? 1 : a.file > b.file ? -1 : 0))
    .map(({ file }) => file);
}
