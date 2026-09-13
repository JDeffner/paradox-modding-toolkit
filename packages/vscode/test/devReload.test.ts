import { describe, expect, it, vi } from "vitest";
import { buildSync } from "esbuild";
import { runInNewContext } from "node:vm";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type * as vscode from "vscode";
import type { Integration } from "@webview-dev/helper";

type Bridge = typeof import("../src/webviews/devReload");

function setup(liveBuild: boolean, mode = 2, trusted = true, remoteName?: string) {
  const registrations: Array<{
    panel: vscode.WebviewPanel;
    options: Parameters<Integration["registerPanel"]>[1];
  }> = [];
  class Disposable {
    constructor(private readonly close: () => void) {}
    dispose() {
      this.close();
    }
  }
  const uri = (fsPath: string): vscode.Uri =>
    ({
      fsPath,
      scheme: "file",
      toString: () => `file://${fsPath}`,
    }) as vscode.Uri;
  const registerBuild = vi.fn(() => new Disposable(() => undefined));
  const connect = vi.fn(async () => ({
    registerBuild,
    registerPanel(panel: vscode.WebviewPanel, options: Parameters<Integration["registerPanel"]>[1]) {
      const item = { panel, options };
      registrations.push(item);
      const disposed = panel.onDidDispose(() => registrations.splice(registrations.indexOf(item), 1));
      return disposed;
    },
  }));
  const watch = vi.fn(() => ({ close: vi.fn() }));
  const code = buildSync({
    entryPoints: [path.join(__dirname, "../src/webviews/devReload.ts")],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    external: ["vscode", "@webview-dev/helper"],
    define: { __WEBVIEW_DEV__: String(liveBuild) },
    supported: { "dynamic-import": false },
  }).outputFiles[0].text;
  const module = { exports: {} };
  runInNewContext(code, {
    module,
    exports: module.exports,
    setTimeout,
    clearTimeout,
    require(id: string) {
      if (id === "crypto") return crypto;
      if (id === "fs") return { existsSync: () => true, watch, statSync: () => ({ mtimeMs: 100 }) };
      if (id === "@webview-dev/helper") return { connectDevtools: connect };
      if (id === "vscode")
        return {
          Disposable,
          ExtensionMode: { Development: 2 },
          Uri: {
            file: uri,
            joinPath: (root: vscode.Uri, ...parts: string[]) => uri(path.join(root.fsPath, ...parts)),
          },
          workspace: { isTrusted: trusted, getConfiguration: () => ({ get: () => "" }) },
          env: { remoteName },
        };
      throw new Error(`Unexpected import: ${id}`);
    },
  });
  const context = {
    extensionUri: uri(path.resolve("packages/vscode")),
    extensionMode: mode,
    subscriptions: [],
  } as unknown as vscode.ExtensionContext;
  const panel = () => {
    const close = new Set<() => void>();
    return {
      title: "DDS",
      viewType: "px.ddsPreview",
      visible: true,
      webview: { asWebviewUri: (value: vscode.Uri) => value },
      onDidDispose: (fn: () => void) => {
        close.add(fn);
        return new Disposable(() => close.delete(fn));
      },
      dispose: () => {
        for (const fn of close) fn();
        close.clear();
      },
    } as unknown as vscode.WebviewPanel;
  };
  return {
    bridge: module.exports as Bridge,
    context,
    panel,
    registrations,
    registerBuild,
    connect,
    watch,
    code,
  };
}

describe("Live Webview bridge", () => {
  it("registers one build with independent panels and fresh revision URLs", async () => {
    const s = setup(true);
    await s.bridge.initializeWebviewDevelopment(s.context, vi.fn());
    const panels = [s.panel(), s.panel()];
    const sources = panels.map(() => s.bridge.webviewSource(s.context));
    const rendered: string[] = [];
    panels.forEach((panel, index) =>
      s.bridge.watchBundle(sources[index], "ddsPreview", panel, () => {
        rendered.push(s.bridge.bundleUri(panel.webview, sources[index], "ddsPreview"));
      })
    );
    expect(s.registerBuild).toHaveBeenCalledExactlyOnceWith(
      "ddsPreview",
      s.context.extensionUri,
      ".webview-dev/ddsPreview.json"
    );
    expect(s.registrations[0].options.instanceId).not.toBe(s.registrations[1].options.instanceId);
    await s.registrations[0].options.reload('opaque &"/revision');
    expect(rendered).toHaveLength(1);
    expect(rendered[0]).toContain("?v=opaque%20%26%22%2Frevision");
    expect(s.bridge.bundleUri(panels[1].webview, sources[1], "ddsPreview")).not.toBe(rendered[0]);
    expect(s.watch).not.toHaveBeenCalled();
    panels[0].dispose();
    expect(s.registrations).toHaveLength(1);
    await s.registrations[0].options.reload("next");
    expect(rendered[1]).toContain("?v=next");
  });

  it.each([
    [1, true, undefined],
    [3, true, undefined],
    [2, false, undefined],
    [2, true, "ssh-remote"],
  ])(
    "does not connect or fall back to file watching outside local trusted Development (%s, %s, %s)",
    async (mode, trusted, remote) => {
      const s = setup(true, mode as number, trusted as boolean, remote as string | undefined);
      await s.bridge.initializeWebviewDevelopment(s.context, vi.fn());
      s.bridge.watchBundle(s.bridge.webviewSource(s.context), "ddsPreview", s.panel(), vi.fn());
      expect(s.connect).not.toHaveBeenCalled();
      expect(s.watch).not.toHaveBeenCalled();
    }
  );

  it("keeps production free of the unpublished helper and watchers", async () => {
    const s = setup(false, 1);
    await s.bridge.initializeWebviewDevelopment(s.context, vi.fn());
    const source = s.bridge.webviewSource(s.context);
    s.bridge.watchBundle(source, "ddsPreview", s.panel(), vi.fn());
    expect(s.code).not.toContain('require("@webview-dev/helper")');
    expect(s.connect).not.toHaveBeenCalled();
    expect(s.watch).not.toHaveBeenCalled();
    expect(s.bridge.bundleUri(s.panel().webview, source, "ddsPreview")).not.toContain("?v=");
  });
});
