/**
 * paradox/locCoverage: per-language localization health for the mod —
 * referenced-but-missing keys, defined-but-orphaned keys, and untranslated
 * keys (value identical to the source language). Feeds the coverage tree and
 * the translation workflow.
 */
import type { LocCoverage, LocIssue } from "@px-lsp/protocol/protocol";
import type { SchemaEntry } from "../schema/types";
import type { ServerData } from "../serverData";

const ISSUE_CAP = 500;

export interface LocEntrySite {
  key: string;
  value: string;
  file: string;
  line: number;
}

export type LocLanguages = Map<string, Map<string, LocEntrySite>>;

const yieldNow = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

export async function computeLocCoverage(
  data: ServerData,
  byLang: LocLanguages,
  sourceLanguage: string,
  schemaEntries: SchemaEntry[],
  inFocus: (file: string) => boolean = () => true
): Promise<LocCoverage[]> {
  if (byLang.size === 0) return [];

  // Keys this mod's script uses (recorded loc references), plus schema-required
  // keys — both restricted to the focus mod's own files in multi-mod workspaces.
  const referenced = new Map<string, { file: string; line: number }>();
  let visited = 0;
  for (const ref of data.refIndex.all()) {
    if (++visited % 1024 === 0) await yieldNow();
    if (!ref.kinds.includes("loc_key")) continue;
    if (!inFocus(ref.file)) continue;
    if (!referenced.has(ref.name)) referenced.set(ref.name, { file: ref.file, line: ref.line });
  }
  const requiredByKind = new Map<string, string[]>();
  for (const e of schemaEntries) {
    if (e.requiredLoc && e.requiredLoc.length > 0) requiredByKind.set(e.kind, e.requiredLoc);
  }
  for (const def of data.index.all()) {
    if (++visited % 1024 === 0) await yieldNow();
    if (def.source !== "mod" || !inFocus(def.file)) continue;
    const patterns = requiredByKind.get(def.kind);
    if (!patterns) continue;
    for (const p of patterns) {
      const key = p.replace(/\$/g, def.name);
      if (!referenced.has(key)) referenced.set(key, { file: def.file, line: def.line });
    }
  }

  /** Key defined outside this mod (vanilla, parents, other workspace mods, in
   * the configured language index)? Then it's an override/covered. */
  const inheritedLoc = (key: string): boolean =>
    data.index.lookupAll(key).some((d) => d.kind === "loc_key" && (d.source !== "mod" || !inFocus(d.file)));

  const source = byLang.get(sourceLanguage) ?? new Map<string, LocEntrySite>();
  const result: LocCoverage[] = [];

  for (const [language, entries] of [...byLang.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const missing: LocIssue[] = [];
    for (const [key, site] of referenced) {
      if (++visited % 1024 === 0) await yieldNow();
      if (entries.has(key)) continue;
      if (inheritedLoc(key)) continue;
      if (missing.length >= ISSUE_CAP) break;
      missing.push({ key, file: site.file, line: site.line });
    }

    const orphaned: LocIssue[] = [];
    for (const [key, site] of entries) {
      if (++visited % 1024 === 0) await yieldNow();
      if (referenced.has(key)) continue;
      if (inheritedLoc(key)) continue; // overriding vanilla text is intentional
      if (data.refIndex.lookup(key).length > 0) continue; // referenced under a non-loc kind
      if (orphaned.length >= ISSUE_CAP) break;
      orphaned.push({ key, file: site.file, line: site.line });
    }

    const untranslated: LocIssue[] = [];
    if (language !== sourceLanguage) {
      for (const [key, site] of entries) {
        if (++visited % 1024 === 0) await yieldNow();
        const src = source.get(key);
        if (!src) continue;
        // Untranslated = still the source text verbatim, OR a blank value
        // (the translation scaffold blanks values so nothing fake ships).
        const isCopy = src.value === site.value && site.value.trim() !== "";
        const isBlank = site.value.trim() === "";
        if (!isCopy && !isBlank) continue;
        if (untranslated.length >= ISSUE_CAP) break;
        untranslated.push({ key, file: site.file, line: site.line, value: src.value });
      }
    }

    missing.sort((a, b) => a.key.localeCompare(b.key));
    orphaned.sort((a, b) => a.key.localeCompare(b.key));
    untranslated.sort((a, b) => a.key.localeCompare(b.key));
    result.push({ language, defined: entries.size, missing, orphaned, untranslated });
  }
  return result;
}
