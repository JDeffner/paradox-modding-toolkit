import { expect, it } from "vitest";
import { buildSync } from "esbuild";
import { createRequire } from "node:module";
import * as path from "node:path";
import { URI } from "vscode-uri";
import { encodeDds } from "@px-lsp/server/dds";

const bundle = buildSync({
  entryPoints: [path.join(__dirname, "../src/ddsEditor.ts")],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  loader: { ".css": "text" },
}).outputFiles[0].text;

async function render(bytes: Uint8Array): Promise<string> {
  const disposable = { dispose() {} };
  const vscode = {
    Uri: { joinPath: (uri: URI, ...parts: string[]) => URI.file(path.join(uri.fsPath, ...parts)) },
    Disposable: class {
      dispose() {}
    },
    ExtensionMode: { Development: 2 },
    workspace: {
      fs: { readFile: async () => bytes },
      getConfiguration: () => ({
        get: (_key: string, fallback: unknown) => fallback,
        inspect: () => undefined,
      }),
      onDidChangeConfiguration: () => disposable,
    },
  };
  const module = { exports: {} as typeof import("../src/ddsEditor") };
  const require = createRequire(import.meta.url);
  new Function("require", "module", "exports", bundle)(
    (id: string) => (id === "vscode" ? vscode : require(id)),
    module,
    module.exports
  );
  const provider = new module.exports.DdsPreviewProvider({
    extensionUri: URI.file("/extension"),
    extensionMode: 1,
    globalState: { get: () => true },
  } as unknown as import("vscode").ExtensionContext);
  const panel = {
    webview: {
      html: "",
      asWebviewUri: (uri: URI) => uri,
      onDidReceiveMessage: () => disposable,
    },
    onDidDispose() {},
  };
  await provider.resolveCustomEditor(
    await provider.openCustomDocument(URI.file("/mod/texture.dds")),
    panel as unknown as import("vscode").WebviewPanel
  );
  return panel.webview.html;
}

it.each([false, true])("renders mipmap status with image and PNG export (mipmaps: %s)", async (mips) => {
  const html = await render(encodeDds(4, 4, new Uint8Array(64), "bgra8", mips));
  expect(html).toContain(mips ? "Mipmaps: Yes (3 levels including base, declared)" : "Mipmaps: No");
  expect(html).toContain('id="img"');
  expect(html).toContain('id="savePng"');
});

it.each(["unsupported", "budget", "payload"])(
  "keeps declared metadata after %s preview failure",
  async (failure) => {
    let bytes = encodeDds(4, 4, new Uint8Array(64), "bgra8", true);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (failure === "unsupported") view.setUint32(80, 0x20000, true);
    if (failure === "budget") view.setUint32(12, 65535, true);
    if (failure === "budget") view.setUint32(16, 65535, true);
    if (failure === "payload") bytes = bytes.subarray(0, 128);
    const html = await render(bytes);
    expect(html).toContain("Mipmaps: Yes (3 levels including base, declared)");
    expect(html).toContain("Preview failed:");
    expect(html).not.toContain('id="img"');
    expect(html).not.toContain('id="savePng"');
  }
);

it("does not label invalid DDS headers as lacking mipmaps", async () => {
  const html = await render(new Uint8Array(50));
  expect(html).toContain("Invalid or truncated DDS header.");
  expect(html).toContain("Mipmaps: Unknown");
  expect(html).not.toContain("Mipmaps: No");
});
