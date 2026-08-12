/**
 * `Paradox: Add Dependency Mod (parent mod)`: fills `px.parentMods` from a
 * picker instead of hand-edited JSON. Submod and compatibility-patch authors
 * need the parent mod indexed, and the parent is almost always a Steam Workshop
 * folder whose name is a bare item id, so nobody can type that path from
 * memory.
 *
 * Two sources are merged (see dependencyScan.ts): the dependencies the focused
 * mod DECLARES, and every mod subscribed for this game. A declared dependency
 * that is not installed is listed too, so the picker also answers "which of my
 * dependencies am I missing?".
 */
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { sanitizeStringList } from "@px-lsp/protocol/suppression";
import { declaredDependencies, dependencyCandidates } from "./dependencyScan";
import { findSteamLibraries } from "./steamDetect";
import { metaFor } from "./meta";
import type { PxConfig } from "./config";

/** Trailing-separator-free lowercase key for path comparisons. */
function normKey(p: string): string {
  return path
    .normalize(p)
    .replace(/[\\/]+$/, "")
    .toLowerCase();
}

export async function addDependencyModCommand(cfg: PxConfig, modRoot: string | null): Promise<void> {
  const meta = metaFor(cfg.gameId);
  const workshopRoots = findSteamLibraries()
    .map((lib) => path.join(lib, "steamapps", "workshop", "content", String(meta.steamAppId)))
    .filter((p) => fs.existsSync(p));
  const candidates = dependencyCandidates({
    declared: declaredDependencies(modRoot),
    workshopRoots,
    // Everything already indexed: offering it again would only be a no-op.
    exclude: [...cfg.parentPaths, ...cfg.workspaceMods, cfg.modPath ?? "", modRoot ?? ""],
  });
  if (candidates.length === 0) {
    void vscode.window.showInformationMessage(
      "Paradox Modding Toolkit: no dependency mods to add. This mod's descriptor declares none, and every " +
        `${meta.name} workshop mod found is already indexed.`
    );
    return;
  }

  type Item = vscode.QuickPickItem & { root: string | null };
  const items: Item[] = candidates.map((c) => ({
    label: c.path === null ? `$(warning) ${c.label}` : c.label,
    description:
      c.path === null
        ? "declared dependency, not installed for this game"
        : c.declared
          ? "declared dependency"
          : c.itemId,
    detail: c.path ?? undefined,
    root: c.path,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: `Add dependency mods (px.parentMods) for ${meta.name}`,
    placeHolder:
      "Checked mods are indexed as read-only context: completion, go to definition, override checks",
  });
  if (!picked || picked.length === 0) return;

  const chosen = picked.map((i) => i.root).filter((r): r is string => r !== null);
  if (chosen.length === 0) {
    void vscode.window.showWarningMessage(
      "Paradox Modding Toolkit: those dependencies are not installed, so there is no folder to add. Subscribe to them first."
    );
    return;
  }

  // Append: the setting is a load order the user may have arranged by hand.
  const setting = vscode.workspace.getConfiguration("px");
  const existing = sanitizeStringList(setting.get("parentMods"));
  const have = new Set(existing.map(normKey));
  const added = chosen.filter((p) => !have.has(normKey(p)));
  if (added.length > 0) {
    await setting.update("parentMods", [...existing, ...added], vscode.ConfigurationTarget.Workspace);
  }
  void vscode.window.showInformationMessage(
    added.length === 0
      ? "Paradox Modding Toolkit: those mods are already listed in px.parentMods."
      : `Paradox Modding Toolkit: added ${added.length} mod(s) to px.parentMods. Indexing them now.`
  );
}
