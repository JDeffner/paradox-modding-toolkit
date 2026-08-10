/**
 * paradox/overrides: mod definitions that shadow vanilla or parent-mod content,
 * annotated with the folder's load rule — script folders are last-in-or-same
 * ("LIOS", the mod wins), GUI is first-in-only ("FIOS", vanilla wins unless
 * the mod replaces the whole file at the same relative path). This is
 * database_conflicts.log brought into the editor, before launch.
 *
 * Multi-mod workspaces: definitions of OTHER workspace mods count as shadowed
 * sites too (labeled with their mod's name); between two enabled mods the
 * launcher's load order decides, which we cannot know — the note says so.
 */
import type { OverrideInfo } from "@px-lsp/protocol/protocol";
import type { ServerData } from "../serverData";

const CAP = 2000;

/** Kinds whose files load first-in-only. */
const FIOS_KINDS = new Set(["gui_type"]);

function relUnder(root: string, file: string): string | null {
  const lower = file.toLowerCase().replace(/\\/g, "/");
  const rootLower = root.toLowerCase().replace(/\\/g, "/").replace(/\/+$/, "");
  return lower.startsWith(rootLower + "/") ? lower.slice(rootLower.length + 1) : null;
}

export function computeOverrides(
  data: ServerData,
  gamePath: string | null,
  inFocus: (file: string) => boolean = () => true
): OverrideInfo[] {
  const out: OverrideInfo[] = [];
  const seen = new Set<string>();

  for (const def of data.index.allDefinitions()) {
    if (def.source !== "mod" || !inFocus(def.file)) continue;
    const ownRoot = data.modRootOf(def.file);
    const dedupe = `${ownRoot ?? ""}:${def.kind}:${def.name}`;
    if (seen.has(dedupe)) continue;
    const shadowed = data.index
      .lookupAll(def.name)
      .filter(
        (d) => d.kind === def.kind && d !== def && (d.source !== "mod" || data.modRootOf(d.file) !== ownRoot)
      );
    if (shadowed.length === 0) continue;
    seen.add(dedupe);

    const rule = FIOS_KINDS.has(def.kind) ? "FIOS" : "LIOS";
    let winner: "mod" | "other" = rule === "LIOS" ? "mod" : "other";
    let note: string | undefined;
    if (rule === "FIOS") {
      // Whole-file replacement at the same relative path still wins.
      const modRel = ownRoot ? relUnder(ownRoot, def.file) : null;
      const replacesFile =
        modRel !== null && gamePath !== null && shadowed.some((s) => relUnder(gamePath, s.file) === modRel);
      if (replacesFile) {
        winner = "mod";
        note = "whole-file replacement (same relative path)";
      } else {
        note = "GUI loads first-in-only: the vanilla definition wins unless the mod replaces the whole file";
      }
    } else if (shadowed.some((s) => s.source === "mod")) {
      note = "another enabled mod defines this too; the launcher load order decides which wins";
    }

    out.push({
      name: def.name,
      kind: def.kind,
      mod: { source: "mod", label: data.originLabel(def), file: def.file, line: def.line },
      shadowed: shadowed.map((s) => ({
        source:
          s.source === "mod"
            ? ("mod" as const)
            : s.source === "parent"
              ? ("parent" as const)
              : ("vanilla" as const),
        label: data.originLabel(s),
        file: s.file,
        line: s.line,
      })),
      rule,
      winner,
      note,
    });
    if (out.length >= CAP) break;
  }

  out.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  return out;
}
