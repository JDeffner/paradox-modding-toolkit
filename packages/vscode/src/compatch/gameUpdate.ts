import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Entry } from "./core";
import { parseScript } from "@px-lsp/server/parser";

const normalized = (text: string) => text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");

/** Merge one identity into its real mod file, preserving every other definition and header. */
export async function mergeEventUpdate(base: string, next: string, mod: string, id: string) {
  const parse = (text: string) => {
    const parsed = parseScript(text);
    if (parsed.errors.length) throw new Error("Fix script parse errors before merging an event.");
    const events = parsed.root.statements.filter(
      (s) => s.kind === "assignment" && s.value?.kind === "block" && s.key.text.includes(".")
    );
    const matches = events.filter((s) => s.kind === "assignment" && s.key.text === id);
    if (matches.length !== 1) throw new Error("Choose an event with exactly one definition in each source.");
    const site = matches[0];
    const context = parsed.root.statements
      .filter((s) => !events.includes(s))
      .map((s) => normalized(text.slice(s.range.start, s.range.end)))
      .join("\n");
    return { site, text: text.slice(site.range.start, site.range.end), context };
  };
  const oldEvent = parse(base),
    newEvent = parse(next),
    modEvent = parse(mod);
  if (oldEvent.context !== newEvent.context)
    throw new Error(
      "Game file namespaces, constants or helpers changed. Review the full source files before merging this event."
    );
  const merged = await mergeGameUpdate(oldEvent.text, newEvent.text, modEvent.text);
  return {
    text: mod.slice(0, modEvent.site.range.start) + merged.text + mod.slice(modEvent.site.range.end),
    conflicts: merged.conflicts,
  };
}

/** File and semantic identities are filtered independently, preserving moved event/key matches. */
export function needsGameUpdate(entry: Entry): boolean {
  const { A: mod, B: next, base } = entry.sites;
  if (!mod.length || !base.length) return false;
  if (mod.length > 1 || next.length > 1 || base.length > 1) return true;
  if (!next.length) return true;
  return (
    normalized(base[0].text) !== normalized(next[0].text) &&
    normalized(mod[0].text) !== normalized(next[0].text)
  );
}

export function gameUpdateStatus(entry: Entry): string {
  const { A: mod, B: next, base } = entry.sites;
  if ([mod, next, base].some((sites) => sites.length > 1)) return "Multiple definitions";
  if (!next.length) return entry.kind === "file" ? "Missing at old path: review" : "Removed upstream: review";
  if (!base.length) return "No old-game base";
  if (mod.length && normalized(mod[0].text) === normalized(base[0].text)) return "Game changes only";
  return "Game and mod changed";
}

/** Git supplies the line merge; no source file is passed to a mutating process. */
export async function mergeGameUpdate(
  base: string,
  next: string,
  mod: string
): Promise<{ text: string; conflicts: boolean }> {
  const oldText = normalized(base),
    newText = normalized(next),
    modText = normalized(mod);
  const restore = (text: string) =>
    (mod.startsWith("\uFEFF") ? "\uFEFF" : "") + (mod.includes("\r\n") ? text.replace(/\n/g, "\r\n") : text);
  if (modText === oldText || modText === newText) return { text: restore(newText), conflicts: false };
  if (newText === oldText) return { text: mod, conflicts: false };
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "px-compatch-merge-"));
  if (
    path.dirname(scratch) !== path.resolve(os.tmpdir()) ||
    !path.basename(scratch).startsWith("px-compatch-merge-")
  )
    throw new Error("Unexpected merge scratch directory");
  try {
    const files = ["mod", "vanilla", "new-game"].map((name) => path.join(scratch, name));
    await Promise.all(files.map((file, i) => fs.writeFile(file, [modText, oldText, newText][i], "utf8")));
    return await new Promise((resolve, reject) => {
      execFile(
        "git",
        [
          "merge-file",
          "--stdout",
          "--diff3",
          "-L",
          "Mod",
          "-L",
          "Old Game Version",
          "-L",
          "New Game Version",
          ...files,
        ],
        { encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: 30_000 },
        (error, stdout, stderr) => {
          // merge-file returns the conflict count (capped at 127), errors are negative/255.
          if (error && !(typeof error.code === "number" && error.code > 0 && error.code <= 127)) {
            reject(new Error(`Could not merge with Git: ${stderr || error.message}`));
            return;
          }
          resolve({ text: restore(stdout), conflicts: !!error });
        }
      );
    });
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
}
