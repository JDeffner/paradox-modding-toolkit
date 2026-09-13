import { describe, expect, it } from "vitest";
import { buildSync } from "esbuild";
import { createRequire } from "node:module";
import * as path from "node:path";
import { inflateSync } from "node:zlib";
import { URI } from "vscode-uri";
import { encodeDds } from "@px-lsp/server/dds";
import type { AppToHost, HostToApp } from "../src/webviews/ddsPreview/messages";

const bundle = buildSync({
  entryPoints: [path.join(__dirname, "../src/ddsEditor.ts")],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  loader: { ".css": "text" },
}).outputFiles[0].text;

describe("DDS editor shared background", () => {
  it("writes one workspace preference, updates open editors, and exports original transparency", async () => {
    let background: unknown = undefined;
    const listeners = new Set<(event: { affectsConfiguration: (key: string) => boolean }) => void>();
    const writes: Array<{ key: string; value: unknown; target: number }> = [];
    let exported: Uint8Array | undefined;
    const errors: string[] = [];
    const dds = encodeDds(1, 1, new Uint8Array([0, 0, 0, 0]), "bgra8");
    class Disposable {
      constructor(public dispose: () => void) {}
    }
    const vscode = {
      Uri: {
        file: URI.file,
        joinPath: (uri: URI, ...parts: string[]) => URI.file(path.join(uri.fsPath, ...parts)),
      },
      Disposable,
      ExtensionMode: { Development: 2 },
      ConfigurationTarget: { Global: 1, Workspace: 2 },
      workspace: {
        workspaceFolders: [{ uri: URI.file("/mod") }],
        getConfiguration: () => ({
          get: (key: string, fallback?: unknown) =>
            key === "texturePreview.background" ? background : fallback,
          update: async (key: string, value: unknown, target: number) => {
            writes.push({ key, value, target });
            background = value;
            for (const listener of listeners)
              listener({ affectsConfiguration: (name) => name === `px.${key}` });
          },
        }),
        onDidChangeConfiguration: (
          listener: (event: { affectsConfiguration: (key: string) => boolean }) => void
        ) => {
          listeners.add(listener);
          return new Disposable(() => listeners.delete(listener));
        },
        fs: {
          readFile: async () => dds,
          writeFile: async (_uri: URI, bytes: Uint8Array) => {
            exported = bytes;
          },
        },
      },
      window: {
        showErrorMessage: (message: string) => errors.push(message),
        showSaveDialog: async () => URI.file("/out.png"),
      },
    };
    const module = { exports: {} as typeof import("../src/ddsEditor") };
    const require = createRequire(import.meta.url);
    new Function("require", "module", "exports", bundle)(
      (id: string) => (id === "vscode" ? vscode : require(id)),
      module,
      module.exports
    );
    const context = {
      extensionUri: URI.file("/extension"),
      extensionMode: 1,
      globalState: { get: () => true },
      workspaceState: {
        update: () => {
          throw new Error("Background must not be stored per editor or asset");
        },
      },
    } as unknown as import("vscode").ExtensionContext;
    const provider = new module.exports.DdsPreviewProvider(context);
    const document = await provider.openCustomDocument(URI.file("/mod/image.dds"));
    const open = async () => {
      let receive!: (message: AppToHost) => Promise<void>;
      let dispose!: () => void;
      const posted: HostToApp[] = [];
      const panel = {
        webview: {
          options: {},
          html: "",
          asWebviewUri: (uri: URI) => uri,
          postMessage: async (message: HostToApp) => {
            posted.push(message);
            return true;
          },
          onDidReceiveMessage: (callback: typeof receive) => {
            receive = callback;
            return new Disposable(() => {});
          },
        },
        onDidDispose: (callback: () => void) => {
          dispose = callback;
        },
      };
      await provider.resolveCustomEditor(document, panel as unknown as import("vscode").WebviewPanel);
      await receive({ type: "ready" });
      return { receive, posted, dispose };
    };
    const first = await open();
    const second = await open();
    expect(first.posted.at(-1)).toEqual({ type: "background", value: "default" });
    await first.receive({ type: "background", value: "#ABCDEF" });
    expect(writes).toEqual([{ key: "texturePreview.background", value: "#abcdef", target: 2 }]);
    for (const editor of [first, second])
      expect(editor.posted.at(-1)).toEqual({ type: "background", value: "#abcdef" });
    const reopened = await open();
    expect(reopened.posted.at(-1)).toEqual({ type: "background", value: "#abcdef" });
    await second.receive({ type: "background", value: "default" });
    expect(background).toBe("checkerboard");
    await first.receive({ type: "savePng" });
    const png = Buffer.from(exported!);
    const idat = png.indexOf("IDAT");
    const raw = inflateSync(png.subarray(idat + 4, idat + 4 + png.readUInt32BE(idat - 4)));
    expect([...raw.subarray(1, 5)]).toEqual([0, 0, 0, 0]);
    expect(errors).toEqual([]);
    for (const editor of [first, second, reopened]) editor.dispose();
    expect(listeners.size).toBe(0);
  });
});
