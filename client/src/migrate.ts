/**
 * Deprecation pointer. This extension continues as the Paradox Modding Toolkit
 * (JDeffner.px-toolkit); everything here exists to move the people who still
 * have the old id installed, since they never re-read the Marketplace listing.
 *
 * The nudge fires once per install and then stays quiet — a modder mid-session
 * gets told, not nagged. `ck3.openParadoxToolkit` is the permanent way back to
 * the listing after that one notification is gone.
 */
import * as vscode from "vscode";

export const NEW_EXTENSION_ID = "JDeffner.px-toolkit";

const NUDGED_KEY = "ck3.migrationNudged";

const MIGRATION_NOTES_URL =
  "https://github.com/JDeffner/paradox-modding-toolkit/blob/main/docs/release-notes-0.3.0.md";

/**
 * Opens the new extension's details page inside VS Code. `extension.open` is
 * the built-in that renders it in an editor tab; the search fallback covers
 * hosts that do not register it (older VS Code, some forks).
 */
export async function openParadoxToolkit(): Promise<void> {
  try {
    await vscode.commands.executeCommand("extension.open", NEW_EXTENSION_ID);
  } catch {
    try {
      await vscode.commands.executeCommand("workbench.extensions.search", `@id:${NEW_EXTENSION_ID}`);
    } catch {
      void vscode.env.openExternal(
        vscode.Uri.parse(`https://marketplace.visualstudio.com/items?itemName=${NEW_EXTENSION_ID}`)
      );
    }
  }
}

/** Returns true when a notification was shown, so callers can avoid stacking their own. */
export function maybeNudgeMigration(context: vscode.ExtensionContext): boolean {
  if (context.globalState.get<boolean>(NUDGED_KEY)) return false;

  // Already moved over: record the nudge as spent instead of spending it.
  if (vscode.extensions.getExtension(NEW_EXTENSION_ID)) {
    void context.globalState.update(NUDGED_KEY, true);
    return false;
  }

  void context.globalState.update(NUDGED_KEY, true);

  const install = "Install Paradox Modding Toolkit";
  const whatChanged = "What changed?";
  void vscode.window
    .showInformationMessage(
      "The CK3 Modding Toolkit has moved: it continues as the Paradox Modding Toolkit " +
        "(CK3, Victoria 3, EU5) and this extension no longer gets updates. " +
        "Command palette: “CK3: Switch to the Paradox Modding Toolkit”.",
      install,
      whatChanged,
      "Later"
    )
    .then((choice) => {
      if (choice === install) void openParadoxToolkit();
      else if (choice === whatChanged) void vscode.env.openExternal(vscode.Uri.parse(MIGRATION_NOTES_URL));
    });

  return true;
}
