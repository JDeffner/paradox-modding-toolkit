/**
 * A "Simulate" CodeLens over every event declaration: the simulator was
 * reachable from the command palette and the editor context menu only, which
 * is to say it was reachable by the people who already knew it existed.
 *
 * The event set comes from the server's own document symbols (the outline it
 * already builds from the CST, where an event is `SymbolKind.Event`), never
 * from a client-side regex over the text — one definition of "this is an
 * event", and it is the indexer's.
 *
 * The editor's global `editor.codeLens` toggle turns this off with every other
 * lens: VS Code stops calling registered providers, so there is nothing of our
 * own to check.
 */
import * as vscode from "vscode";
import { PARADOX_SCRIPT_LANGS } from "./langIds";

class SimulateEventLensProvider implements vscode.CodeLensProvider {
  constructor(private readonly enabled: () => boolean) {}

  async provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[]> {
    // Same gate as the command's own menus (px.isCk3Workspace): a lens that
    // offered a command its menus hide would be the one ungated entry point.
    if (!this.enabled()) return [];
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      "vscode.executeDocumentSymbolProvider",
      document.uri
    );
    if (token.isCancellationRequested || !Array.isArray(symbols)) return [];
    const lenses: vscode.CodeLens[] = [];
    for (const symbol of symbols) {
      // Top level only: an option or an immediate block is not a fireable event.
      if (symbol.kind !== vscode.SymbolKind.Event) continue;
      lenses.push(
        new vscode.CodeLens(symbol.selectionRange, {
          title: "$(play) Simulate",
          tooltip: `Walk through ${symbol.name} in the event simulator`,
          command: "px.simulateEvent",
          arguments: [symbol.name],
        })
      );
    }
    return lenses;
  }
}

/** Register the lens for script documents; disposed with the extension. */
export function registerSimulateEventLens(enabled: () => boolean): vscode.Disposable {
  return vscode.languages.registerCodeLensProvider(
    PARADOX_SCRIPT_LANGS.map((language) => ({ language, scheme: "file" })),
    new SimulateEventLensProvider(enabled)
  );
}
