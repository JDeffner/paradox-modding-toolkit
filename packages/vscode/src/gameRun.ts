/**
 * `paradox-game` run configurations: pressing Run/F5 on a script file starts
 * the workspace's game via Steam with the configured options. There is no
 * debug adapter behind the type - the game cannot be debugged from here - so
 * `resolveDebugConfiguration` does the launch itself and returns `undefined`,
 * which cancels the (never needed) debug session. What the type buys is the
 * standard surface: preset configurations in the Run panel dropdown, and
 * launch.json for users who want their own option sets (issue #26).
 *
 * Presets: the family-wide debug default plus the game's own verified extras
 * (`GameMeta.launchPresets`), built in gameRunPresets.ts.
 */
import * as vscode from "vscode";
import type { PxConfig } from "./config";
import { metaFor } from "./meta";
import type { ErrorLogWatcher } from "./errorLog";
import { DEBUG_ARGS, runPresets, steamRunUrl } from "./gameRunPresets";

/** Start the game via Steam with `args` and offer the error.log watcher. */
export async function launchGame(cfg: PxConfig, errorLog: ErrorLogWatcher, args: string[]): Promise<void> {
  const meta = metaFor(cfg.gameId);
  await vscode.env.openExternal(vscode.Uri.parse(steamRunUrl(meta.steamAppId, args)));
  const withArgs = args.length > 0 ? ` with ${args.join(" ")}` : " (vanilla, no options)";
  const reload = args.includes("-develop") ? " (scripts reload live)" : "";
  // One click instead of a command name to retype; hidden once already watching.
  const watch = errorLog.watching ? [] : ["Watch error.log"];
  void vscode.window
    .showInformationMessage(
      `Paradox Modding Toolkit: launching ${meta.name} via Steam${withArgs}${reload}.`,
      ...watch
    )
    .then((choice) => {
      if (choice) errorLog.toggle();
    });
}

/** The game's preset launch configurations, as run-panel entries. */
function presetConfigurations(cfg: PxConfig): vscode.DebugConfiguration[] {
  return runPresets(metaFor(cfg.gameId)).map((p) => ({
    type: "paradox-game",
    request: "launch",
    name: p.name,
    args: p.args,
  }));
}

/**
 * Register the type: presets for launch.json creation (Initial) and for the
 * Run dropdown without any launch.json (Dynamic), plus the launcher-only
 * resolver. Commands (all also in the editor-title Run dropdown, the ONE
 * launching surface): `px.launchGame` = the debug default, `px.launchMapEditor`
 * = the game's `mapeditor` preset, `px.launchWithOptions` = quick pick of
 * every preset plus a free-form option box.
 */
export function registerGameRun(
  context: vscode.ExtensionContext,
  getCfg: () => PxConfig,
  errorLog: ErrorLogWatcher
): void {
  const provideDebugConfigurations = () => presetConfigurations(getCfg());
  // Gates the Map Editor entry in the editor-title Run dropdown (menu when
  // clauses cannot read the GameProfile).
  const updateContext = () => {
    const has = metaFor(getCfg().gameId).launchPresets?.some((p) => p.id === "mapeditor") ?? false;
    void vscode.commands.executeCommand("setContext", "px.hasMapEditor", has);
  };
  updateContext();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("px.gameId")) updateContext();
    }),
    vscode.debug.registerDebugConfigurationProvider("paradox-game", { provideDebugConfigurations }),
    vscode.debug.registerDebugConfigurationProvider(
      "paradox-game",
      { provideDebugConfigurations },
      vscode.DebugConfigurationProviderTriggerKind.Dynamic
    ),
    vscode.debug.registerDebugConfigurationProvider("paradox-game", {
      resolveDebugConfiguration(_folder, config): undefined {
        // Empty config = F5 with no launch.json: the debug default.
        const args = Array.isArray(config.args) ? config.args.map(String) : DEBUG_ARGS;
        void launchGame(getCfg(), errorLog, args);
        return undefined; // launcher-only: never start a debug session
      },
    }),
    vscode.commands.registerCommand("px.launchMapEditor", () => {
      const cfg = getCfg();
      const preset = metaFor(cfg.gameId).launchPresets?.find((p) => p.id === "mapeditor");
      if (!preset) {
        void vscode.window.showInformationMessage(
          `Paradox Modding Toolkit: no verified map editor launch option for ${metaFor(cfg.gameId).name}.`
        );
        return;
      }
      void launchGame(cfg, errorLog, preset.args);
    }),
    vscode.commands.registerCommand("px.launchWithOptions", async () => {
      const cfg = getCfg();
      const meta = metaFor(cfg.gameId);
      type Pick = vscode.QuickPickItem & { args: string[] | null };
      const picks: Pick[] = [
        ...runPresets(meta).map((p) => ({ label: p.name, description: p.args.join(" "), args: p.args })),
        { label: "Custom options…", description: "type the options yourself", args: null },
      ];
      const pick = await vscode.window.showQuickPick(picks, {
        title: `Launch ${meta.name}`,
        placeHolder: "Launch options (a launch.json configuration makes a set permanent)",
      });
      if (!pick) return;
      if (pick.args) {
        void launchGame(cfg, errorLog, pick.args);
        return;
      }
      const typed = await vscode.window.showInputBox({
        title: `Launch ${meta.name} with custom options`,
        value: DEBUG_ARGS.join(" "),
        prompt: "Space-separated options; empty launches vanilla.",
      });
      if (typed === undefined) return;
      void launchGame(cfg, errorLog, typed.trim().split(/\s+/).filter(Boolean));
    })
  );
}
