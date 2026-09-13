/**
 * DDS preview: a read-only custom editor for *.dds so clicking a texture shows
 * the image instead of VS Code's "binary or unsupported encoding" notice.
 * Decoding runs in the extension host with the same pure-TS decoder the hover
 * previews use (DXT1/3/5, BC7, uncompressed); the webview only displays.
 *
 * The chrome is px-ui (webviews/shared/ui.css): top bar with the file's facts
 * and clipboard/export actions, viewer tools floating bottom-left like the GUI
 * editor's stage tools.
 */
import * as vscode from "vscode";
import { decodeDds, ddsFormatInfo, encodePng } from "@px-lsp/server/dds";
import { makeNonce } from "./webviews/nonce";
import { ddsPreviewHtml } from "./webviews/ddsPreview/html";
import { bundleUri, watchBundle, webviewSource } from "./webviews/devReload";
import { readTexturePreviewBackground } from "@px-lsp/protocol/texturePreview";
import type { AppToHost } from "./webviews/ddsPreview/messages";

const BACKGROUND_SETTING = "texturePreview.background";

class DdsDocument implements vscode.CustomDocument {
  constructor(
    public readonly uri: vscode.Uri,
    public readonly bytes: Uint8Array
  ) {}
  dispose(): void {
    /* nothing to release */
  }
}

export class DdsPreviewProvider implements vscode.CustomReadonlyEditorProvider<DdsDocument> {
  static readonly viewType = "px.ddsPreview";
  private static readonly promptKey = "px.ddsPreviewPromptShown";

  constructor(private readonly context: vscode.ExtensionContext) {}

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      DdsPreviewProvider.viewType,
      new DdsPreviewProvider(context),
      { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true }
    );
  }

  /**
   * One-time choice on the very first .dds open: keep this preview as the
   * default editor for .dds, or hand the extension back to VS Code's default
   * (via workbench.editorAssociations, which the user can change any time).
   */
  private async maybePromptForDefault(): Promise<void> {
    if (this.context.globalState.get<boolean>(DdsPreviewProvider.promptKey)) return;
    await this.context.globalState.update(DdsPreviewProvider.promptKey, true);
    const keep = "Keep DDS preview";
    const builtin = "Use VS Code default";
    const answer = await vscode.window.showInformationMessage(
      "The Paradox Modding Toolkit now previews .dds textures. Keep it as the default editor for .dds files?",
      keep,
      builtin
    );
    if (answer === builtin) {
      const config = vscode.workspace.getConfiguration();
      const assoc = { ...(config.get<Record<string, string>>("workbench.editorAssociations") ?? {}) };
      assoc["*.dds"] = "default";
      await config.update("workbench.editorAssociations", assoc, vscode.ConfigurationTarget.Global);
      void vscode.window.showInformationMessage(
        "Paradox Modding Toolkit: .dds files will use the VS Code default editor. Right-click a .dds → 'Open With…' to preview one anyway, or edit workbench.editorAssociations to undo."
      );
    }
  }

  async openCustomDocument(uri: vscode.Uri): Promise<DdsDocument> {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return new DdsDocument(uri, bytes);
  }

  async resolveCustomEditor(document: DdsDocument, panel: vscode.WebviewPanel): Promise<void> {
    void this.maybePromptForDefault();
    const source = webviewSource(this.context);
    panel.webview.options = { enableScripts: true, localResourceRoots: [source.root] };
    const name = document.uri.path.split("/").pop() ?? "texture.dds";
    const info = ddsFormatInfo(document.bytes);
    let png: Uint8Array | null = null;
    let dataUri: string | null = null;
    let error: string | null = null;
    let meta = "";
    if (!info) {
      error = "Not a DDS file (bad magic).";
    } else {
      meta = `${info.width}×${info.height} · ${info.format} · ${formatBytes(document.bytes.length)}`;
      try {
        const img = decodeDds(document.bytes);
        png = encodePng(img.width, img.height, img.pixels);
        dataUri = `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
      } catch (err) {
        error = `Preview failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    const render = (): void => {
      panel.webview.html = ddsPreviewHtml({
        name,
        meta,
        dataUri,
        error,
        nonce: makeNonce(),
        scriptSrc: bundleUri(panel.webview, source, "ddsPreview"),
      });
    };

    const sendBackground = () => {
      const value = readTexturePreviewBackground(
        vscode.workspace.getConfiguration("px").get(BACKGROUND_SETTING)
      );
      return panel.webview.postMessage({
        type: "background",
        value: value === "checkerboard" ? "default" : value,
      });
    };
    const backgroundChanges = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(`px.${BACKGROUND_SETTING}`)) void sendBackground();
    });
    const messages = panel.webview.onDidReceiveMessage(async (msg: AppToHost) => {
      try {
        switch (msg?.type) {
          case "ready":
            await sendBackground();
            break;
          case "background":
            await vscode.workspace
              .getConfiguration("px")
              .update(
                BACKGROUND_SETTING,
                readTexturePreviewBackground(msg.value),
                vscode.workspace.workspaceFolders?.length
                  ? vscode.ConfigurationTarget.Workspace
                  : vscode.ConfigurationTarget.Global
              );
            break;
          case "copyPath":
            await vscode.env.clipboard.writeText(scriptPath(document.uri.fsPath));
            break;
          case "copyName":
            await vscode.env.clipboard.writeText(name);
            break;
          case "reveal":
            await vscode.commands.executeCommand("revealFileInOS", document.uri);
            break;
          case "savePng": {
            if (!png) return;
            const target = await vscode.window.showSaveDialog({
              defaultUri: document.uri.with({ path: document.uri.path.replace(/\.dds$/i, ".png") }),
              filters: { "PNG image": ["png"] },
            });
            if (target) await vscode.workspace.fs.writeFile(target, png);
            break;
          }
        }
      } catch (err) {
        void vscode.window.showErrorMessage(
          `DDS preview: ${msg?.type ?? "action"} failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    });
    const watcher = watchBundle(source, "ddsPreview", panel, render);
    panel.onDidDispose(() => {
      messages.dispose();
      backgroundChanges.dispose();
      watcher.dispose();
    });
    render();
  }
}

/**
 * The path as script references it: from the gfx/ root, forward slashes
 * (`gfx/interface/icons/traits/reveler.dds`). Falls back to the full path for
 * a texture outside any gfx/ folder.
 */
function scriptPath(fsPath: string): string {
  const m = /(?:^|[\\/])(gfx[\\/].+)$/i.exec(fsPath);
  return m ? m[1].replace(/\\/g, "/") : fsPath;
}

function formatBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`;
}
