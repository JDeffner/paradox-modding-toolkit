/**
 * `game/data_binding/*.txt` macros: `macro = { description = "…" definition =
 * "IsZero(Value)" replace_with = "…" }`. These are callable inside `[ … ]`
 * data-function expressions, so they promote into the DataTypesData knowledge
 * as global functions (with their signature args and description).
 *
 * A promotion source only: a macro never overwrites a real dump/wiki global of
 * the same name. Harvested from game (+ mod `data_binding/` if present) at
 * startup. No `vscode` imports.
 */
import * as fs from "fs";
import * as path from "path";
import { parseScript } from "../parser";
import { listFiles } from "@px-lsp/protocol/fsWalk";
import type { DataTypesData } from "./dataTypes";

/** Split a `Name(a,b)` signature into its function name and argument names. */
function parseSignature(definition: string): { name: string; args: string[] } | null {
  const paren = definition.indexOf("(");
  if (paren < 0) {
    const name = definition.trim();
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? { name, args: [] } : null;
  }
  const name = definition.slice(0, paren).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return null;
  const close = definition.lastIndexOf(")");
  const argText = definition.slice(paren + 1, close >= 0 ? close : undefined);
  const args = argText
    .split(",")
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
  return { name, args };
}

/**
 * Harvest `data_binding/` under each root and add the macros into `into` as
 * global functions (add-if-absent). Returns the number of macros added.
 */
export function loadDataBindingMacros(roots: string[], into: DataTypesData): number {
  let added = 0;
  for (const root of roots) {
    for (const file of listFiles(path.join(root, "data_binding"), ".txt").sort()) {
      let text: string;
      try {
        text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
      } catch {
        continue;
      }
      const { root: parsed } = parseScript(text);
      for (const stmt of parsed.statements) {
        if (stmt.kind !== "assignment" || stmt.key.text.toLowerCase() !== "macro") continue;
        if (stmt.value?.kind !== "block") continue;
        let definition: string | null = null;
        let description = "";
        let replaceWith = "";
        for (const inner of stmt.value.statements) {
          if (inner.kind !== "assignment" || inner.value?.kind !== "scalar") continue;
          const key = inner.key.text.toLowerCase();
          if (key === "definition") definition = inner.value.text;
          else if (key === "description") description = inner.value.text;
          else if (key === "replace_with") replaceWith = inner.value.text;
        }
        if (!definition) continue;
        const sig = parseSignature(definition);
        if (!sig || into.globals.has(sig.name)) continue; // real global wins
        const descParts: string[] = [];
        if (description) descParts.push(description);
        if (replaceWith) descParts.push("Expands to `" + replaceWith + "`.");
        into.globals.set(sig.name, {
          ret: null,
          args: sig.args.length > 0 ? sig.args : null,
          kind: "function",
          src: "macro",
          ...(descParts.length > 0 ? { desc: descParts.join("\n\n") } : {}),
        });
        into.count++;
        added++;
      }
    }
  }
  return added;
}
