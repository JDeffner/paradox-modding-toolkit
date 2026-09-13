/**
 * Explicit live development builds delegate successful-build signals and
 * panel scheduling to Live Webview. Each panel renders fresh HTML and its
 * existing boot messages recover the state that its host already owns.
 * HTML generators and their imported CSS remain host code and need restart.
 *
 * Normal builds have no helper dependency. Existing F5 sessions and the
 * installed-test px.dev.webviewSource override retain their raw bundle watch.
 */
import * as fs from "fs";
import * as vscode from "vscode";
import { randomUUID } from "crypto";
import type { Integration } from "@webview-dev/helper";

declare const __WEBVIEW_DEV__: boolean;

interface LiveDevelopment {
  integration: Integration;
  root: vscode.Uri;
  builds: Set<string>;
}
const liveContexts = new WeakMap<vscode.ExtensionContext, LiveDevelopment>();

/** Await before registering commands so even the first panel can join the companion. */
export async function initializeWebviewDevelopment(
  context: vscode.ExtensionContext,
  report: (message: string) => void
): Promise<void> {
  // Keep the import inside the compile-time branch so esbuild removes it
  // without requiring minification or resolving the development-only package.
  if (typeof __WEBVIEW_DEV__ !== "undefined" && __WEBVIEW_DEV__) {
    if (
      context.extensionMode !== vscode.ExtensionMode.Development ||
      !vscode.workspace.isTrusted ||
      vscode.env.remoteName
    )
      return;
    try {
      const { connectDevtools } = await import("@webview-dev/helper");
      const integration = await connectDevtools(context, { enabled: true, report });
      liveContexts.set(context, { integration, root: context.extensionUri, builds: new Set() });
      context.subscriptions.push(new vscode.Disposable(() => liveContexts.delete(context)));
    } catch (error) {
      report(`Live Webview: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export interface WebviewSource {
  /** The folder the app bundles load from; put it in localResourceRoots. */
  root: vscode.Uri;
  watch: boolean;
  live?: LiveDevelopment;
  revision?: string;
}

export function webviewSource(context: vscode.ExtensionContext): WebviewSource {
  // An explicit live build uses only successful-build signals, never raw writes
  // or the installed-test bundle override. Missing companions remain inert.
  if (typeof __WEBVIEW_DEV__ !== "undefined" && __WEBVIEW_DEV__) {
    return {
      root: vscode.Uri.joinPath(context.extensionUri, "dist", "webview"),
      watch: false,
      live: liveContexts.get(context),
      revision: randomUUID(),
    };
  }
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
  if (source.revision) return `${uri}?v=${encodeURIComponent(source.revision)}`;
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
export function watchBundle(
  source: WebviewSource,
  name: string,
  panel: vscode.WebviewPanel,
  reload: () => void
): vscode.Disposable {
  if (source.live) {
    const { integration, root, builds } = source.live;
    if (!builds.has(name)) {
      integration.registerBuild(name, root, `.webview-dev/${name}.json`);
      builds.add(name);
    }
    return integration.registerPanel(panel, {
      instanceId: `${name}:${randomUUID()}`,
      viewType: panel.viewType,
      label: panel.title,
      buildId: name,
      reload: (revision) => {
        source.revision = revision;
        reload();
      },
    });
  }
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
