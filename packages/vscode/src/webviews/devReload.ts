/**
 * Where a panel's app bundle loads from, and the dev auto-reload behind it.
 *
 * Normally the bundle is the installed extension's own dist/webview copy and
 * nothing is watched. Two development situations relax that:
 *
 * - The F5 Extension Development Host: extensionUri IS the repo checkout, so
 *   the normal path already serves fresh builds; only the watch is added
 *   (extensionMode === Development, never true for an installed vsix).
 * - An installed test vsix (pnpm run package:test): its dist/webview copy
 *   never changes, so the px.dev.webviewSource setting redirects bundle
 *   loading to a repo checkout's dist/webview and watches that.
 *
 * Either way the loop is: `pnpm run watch:webviews` rebuilds a bundle on
 * save, the watcher fires, the panel re-sets its html, the app boots and
 * requests its state, and the host pushes it back. The host owns the state
 * (the same contract that survives close/reopen), which is why a reload
 * lands where the user was.
 */
import * as fs from "fs";
import * as vscode from "vscode";

export interface WebviewSource {
  /** The folder the app bundles load from; put it in localResourceRoots. */
  root: vscode.Uri;
  watch: boolean;
}

export function webviewSource(context: vscode.ExtensionContext): WebviewSource {
  const configured = vscode.workspace.getConfiguration("px").get<string>("dev.webviewSource", "");
  if (configured && fs.existsSync(configured)) return { root: vscode.Uri.file(configured), watch: true };
  return {
    root: vscode.Uri.joinPath(context.extensionUri, "dist", "webview"),
    watch: context.extensionMode === vscode.ExtensionMode.Development,
  };
}

/**
 * The bundle's webview URI, cache-busted by mtime while watching so the
 * reloaded page cannot be served a stale script.
 */
export function bundleUri(webview: vscode.Webview, source: WebviewSource, name: string): string {
  const file = vscode.Uri.joinPath(source.root, `${name}.js`);
  const uri = webview.asWebviewUri(file).toString();
  if (!source.watch) return uri;
  let stamp = "0";
  try {
    stamp = String(Math.round(fs.statSync(file.fsPath).mtimeMs));
  } catch {
    /* not built yet; the panel will show its load error */
  }
  return `${uri}?v=${stamp}`;
}

/**
 * Call `reload` (debounced) whenever the named bundle is rebuilt. Returns a
 * no-op disposable when not in a watching mode, so panels can register it
 * unconditionally.
 */
export function watchBundle(source: WebviewSource, name: string, reload: () => void): vscode.Disposable {
  if (!source.watch) return new vscode.Disposable(() => undefined);
  const file = `${name}.js`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const watcher = fs.watch(source.root.fsPath, (_event, changed) => {
      if (changed !== file) return;
      clearTimeout(timer);
      // esbuild writes the file in one go, but a write still surfaces as a
      // burst of events; collapse the burst into one reload.
      timer = setTimeout(reload, 200);
    });
    return new vscode.Disposable(() => {
      clearTimeout(timer);
      watcher.close();
    });
  } catch {
    return new vscode.Disposable(() => undefined);
  }
}
