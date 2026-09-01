/**
 * `Paradox: Reduce VS Code Indexing Load`: writes `files.watcherExclude` and
 * `search.exclude` patterns for game asset trees into the WORKSPACE settings.
 * See editorExcludes.ts for why this exists and what the patterns are. The
 * write is additive (object settings merge across scopes, and the plan keeps
 * every existing workspace entry), announced, and undoable in one click.
 */
import * as vscode from "vscode";
import { planExcludes, SEARCH_EXCLUDES, WATCHER_EXCLUDES } from "./editorExcludes";

type Obj = Record<string, unknown> | undefined;

/**
 * Remove exactly `added` from an exclude setting's CURRENT workspace value.
 * Undoing by writing back a snapshot would discard whatever the user changed
 * while the toast was open; this touches only the keys the command wrote.
 * An emptied object is written as undefined so the key leaves settings.json.
 */
async function dropAdded(
  cfg: vscode.WorkspaceConfiguration,
  key: string,
  added: string[],
  target: vscode.ConfigurationTarget
): Promise<void> {
  if (added.length === 0) return;
  const current = cfg.inspect<Record<string, unknown>>(key)?.workspaceValue;
  if (!current) return;
  const rest = Object.fromEntries(Object.entries(current).filter(([k]) => !added.includes(k)));
  await cfg.update(key, Object.keys(rest).length > 0 ? rest : undefined, target);
}

export async function reduceEditorLoadCommand(): Promise<void> {
  const files = vscode.workspace.getConfiguration("files");
  const search = vscode.workspace.getConfiguration("search");
  const beforeWatcher = files.inspect<Record<string, unknown>>("watcherExclude")?.workspaceValue;
  const beforeSearch = search.inspect<Record<string, unknown>>("exclude")?.workspaceValue;
  const watcherPlan = planExcludes(files.get<Obj>("watcherExclude"), beforeWatcher, WATCHER_EXCLUDES);
  const searchPlan = planExcludes(search.get<Obj>("exclude"), beforeSearch, SEARCH_EXCLUDES);

  if (watcherPlan.value === null && searchPlan.value === null) {
    void vscode.window.showInformationMessage(
      "Paradox Modding Toolkit: game binaries are already excluded from VS Code's search and file watcher " +
        "in this workspace. Nothing to change."
    );
    return;
  }

  const target = vscode.ConfigurationTarget.Workspace;
  if (watcherPlan.value !== null) await files.update("watcherExclude", watcherPlan.value, target);
  if (searchPlan.value !== null) {
    try {
      await search.update("exclude", searchPlan.value, target);
    } catch (e) {
      // Half-applied is worse than not applied: the toast below would promise
      // a search win the user did not get. Put the watcher back, then fail.
      if (watcherPlan.value !== null) await files.update("watcherExclude", beforeWatcher, target);
      throw e;
    }
  }

  const n = watcherPlan.added.length + searchPlan.added.length;
  const choice = await vscode.window.showInformationMessage(
    `Paradox Modding Toolkit: added ${n} exclude pattern(s) to this workspace's settings. VS Code's ` +
      "search and file watcher now skip binary files (.dds, .mesh, .anim, audio, fonts), which are 62% " +
      "of a game install. Find in Files gets several times faster. Script is never excluded: the " +
      "patterns match binary extensions only, so files under gfx/, music/ or dlc/ stay searchable.",
    "Undo",
    "Open Settings"
  );
  if (choice === "Undo") {
    // The toast has no timeout, so settings can have moved on while it sat
    // open. Undo means "drop what this command added", not "restore the
    // snapshot": re-read, and keep every entry we did not write.
    await dropAdded(vscode.workspace.getConfiguration("files"), "watcherExclude", watcherPlan.added, target);
    await dropAdded(vscode.workspace.getConfiguration("search"), "exclude", searchPlan.added, target);
  } else if (choice === "Open Settings") {
    void vscode.commands.executeCommand("workbench.action.openSettings", "files.watcherExclude");
  }
}
