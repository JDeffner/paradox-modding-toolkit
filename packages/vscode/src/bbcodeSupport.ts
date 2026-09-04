/**
 * BBCode as a first-class editing experience for the Workshop listing files:
 * tag completion in `.bbcode` documents and a live side-by-side preview
 * (px.openBBCodePreview) that renders the same way the Workshop panel's
 * preview does - both share webviews/workshop/bbcode.ts and its styles.
 *
 * Plus Markdown in two shapes. "Edit as Markdown" opens the SAME file as
 * Markdown through the `pxmd` file system below: the editor shows the BBCode
 * converted, a save converts it back and writes the .bbcode, and no second
 * file appears. The two conversion commands write a real file for a listing
 * that should switch format (steam/workshopFiles.ts `descriptionFile` reads
 * `.md` first).
 */
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { bbcodeToMarkdown, markdownToBBCode } from "./steam/bbcodeMarkdown";
import { bbcodeToHtml } from "./webviews/workshop/bbcode";
import { BBPREV_CSS } from "./webviews/workshop/bbcodeCss";
import { makeNonce } from "./webviews/nonce";
import { tabIcon } from "./webviews/tabIcons";
import uiCss from "./webviews/shared/ui.css";

interface TagCompletion {
  label: string;
  snippet: string;
  detail: string;
}

/** The tag set Steam's Workshop renders, as insertable pairs. */
const TAG_COMPLETIONS: TagCompletion[] = [
  { label: "h1", snippet: "h1]$1[/h1]$0", detail: "Heading 1" },
  { label: "h2", snippet: "h2]$1[/h2]$0", detail: "Heading 2" },
  { label: "h3", snippet: "h3]$1[/h3]$0", detail: "Heading 3" },
  { label: "b", snippet: "b]$1[/b]$0", detail: "Bold" },
  { label: "i", snippet: "i]$1[/i]$0", detail: "Italic" },
  { label: "u", snippet: "u]$1[/u]$0", detail: "Underline" },
  { label: "strike", snippet: "strike]$1[/strike]$0", detail: "Strikethrough" },
  { label: "spoiler", snippet: "spoiler]$1[/spoiler]$0", detail: "Spoiler (hover to reveal)" },
  { label: "url", snippet: "url=$1]$2[/url]$0", detail: "Link: [url=https://…]text[/url]" },
  { label: "img", snippet: "img]$1[/img]$0", detail: "Image by URL" },
  { label: "list", snippet: "list]\n[*] $1\n[/list]$0", detail: "Bullet list" },
  { label: "olist", snippet: "olist]\n[*] $1\n[/olist]$0", detail: "Numbered list" },
  { label: "*", snippet: "*] $0", detail: "List item" },
  { label: "quote", snippet: "quote=$1]$2[/quote]$0", detail: "Quote with author" },
  { label: "code", snippet: "code]\n$1\n[/code]$0", detail: "Code block (monospace, literal)" },
  { label: "noparse", snippet: "noparse]$1[/noparse]$0", detail: "Literal text, tags not parsed" },
  { label: "hr", snippet: "hr][/hr]$0", detail: "Horizontal rule" },
  {
    label: "table",
    snippet: "table]\n[tr]\n[th]$1[/th]\n[/tr]\n[tr]\n[td]$2[/td]\n[/tr]\n[/table]$0",
    detail: "Table",
  },
  { label: "tr", snippet: "tr]\n[td]$1[/td]\n[/tr]$0", detail: "Table row" },
  { label: "th", snippet: "th]$1[/th]$0", detail: "Table header cell" },
  { label: "td", snippet: "td]$1[/td]$0", detail: "Table cell" },
  {
    label: "previewyoutube",
    snippet: "previewyoutube=$1;full][/previewyoutube]$0",
    detail: "Embedded YouTube video (video id)",
  },
];

/** Tags worth offering as a bare closer after `[/`. */
const CLOSABLE = [
  "b",
  "i",
  "u",
  "strike",
  "spoiler",
  "url",
  "list",
  "olist",
  "quote",
  "code",
  "noparse",
  "table",
  "tr",
  "th",
  "td",
  "h1",
  "h2",
  "h3",
];

const completionProvider: vscode.CompletionItemProvider = {
  provideCompletionItems(document, position) {
    const line = document.lineAt(position.line).text.slice(0, position.character);
    const m = /\[(\/?)([a-zA-Z0-9*]*)$/.exec(line);
    if (!m) return undefined;
    // Replace from just after the `[` (and `/`), so `[h` completes cleanly.
    const start = position.translate(0, -m[2].length);
    const range = new vscode.Range(start, position);
    if (m[1] === "/") {
      return CLOSABLE.map((tag, i) => {
        const item = new vscode.CompletionItem(`/${tag}`, vscode.CompletionItemKind.Property);
        item.insertText = `${tag}]`;
        item.range = range;
        item.filterText = tag;
        item.sortText = String(i).padStart(2, "0");
        return item;
      });
    }
    return TAG_COMPLETIONS.map((t, i) => {
      const item = new vscode.CompletionItem(t.label, vscode.CompletionItemKind.Snippet);
      item.detail = t.detail;
      item.insertText = new vscode.SnippetString(t.snippet);
      item.range = range;
      item.sortText = String(i).padStart(2, "0");
      return item;
    });
  },
};

/**
 * The singleton preview panel, markdown-preview style: follows edits live.
 * `sideBySide` false opens it in the ACTIVE column (the md "Open Preview"
 * that visually replaces the source); true opens Beside, keeping focus.
 */
class BBCodePreview {
  private static instance: BBCodePreview | undefined;
  private panel: vscode.WebviewPanel;
  private uri: vscode.Uri;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  static show(context: vscode.ExtensionContext, editor: vscode.TextEditor, sideBySide: boolean): void {
    const existing = BBCodePreview.instance;
    if (existing) {
      existing.retarget(editor.document);
      existing.panel.reveal(sideBySide ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active, sideBySide);
      return;
    }
    BBCodePreview.instance = new BBCodePreview(context, editor, sideBySide);
  }

  /** The preview's source, back in a text editor (the title-bar button). */
  static showSource(): void {
    const p = BBCodePreview.instance;
    if (!p) return;
    void vscode.window.showTextDocument(p.uri, {
      viewColumn: p.panel.viewColumn ?? vscode.ViewColumn.Active,
      preview: false,
    });
  }

  private constructor(_context: vscode.ExtensionContext, editor: vscode.TextEditor, sideBySide: boolean) {
    this.uri = editor.document.uri;
    this.panel = vscode.window.createWebviewPanel(
      "px.bbcodePreview",
      previewTitle(editor.document),
      {
        viewColumn: sideBySide ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active,
        preserveFocus: sideBySide,
      },
      { enableScripts: true, retainContextWhenHidden: true }
    );
    this.panel.iconPath = tabIcon("bbcode-preview");
    this.panel.webview.html = shellHtml();
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() === this.uri.toString()) this.queueUpdate(e.document);
      }),
      // Like the markdown preview, follow whichever .bbcode file is active.
      vscode.window.onDidChangeActiveTextEditor((ed) => {
        if (ed && isBBCode(ed.document)) this.retarget(ed.document);
      })
    );
    this.panel.onDidDispose(() => {
      clearTimeout(this.timer);
      for (const d of this.disposables.splice(0)) d.dispose();
      BBCodePreview.instance = undefined;
    });
    this.update(editor.document);
  }

  private retarget(document: vscode.TextDocument): void {
    this.uri = document.uri;
    this.panel.title = previewTitle(document);
    this.update(document);
  }

  private queueUpdate(document: vscode.TextDocument): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.update(document), 150);
  }

  private update(document: vscode.TextDocument): void {
    void this.panel.webview.postMessage({ type: "render", html: bbcodeToHtml(document.getText()) });
  }
}

function previewTitle(document: vscode.TextDocument): string {
  return `Preview ${document.uri.path.split("/").pop() ?? "BBCode"}`;
}

/**
 * A static shell that swaps content by message: replacing the whole html on
 * every keystroke would reset the reader's scroll position.
 */
function shellHtml(): string {
  const nonce = makeNonce();
  const csp = [
    `default-src 'none'`,
    `img-src https: data:`,
    `style-src 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>BBCode Preview</title>
<style>
${uiCss}
${BBPREV_CSS}
  body { padding: 0; }
  #page { max-width: 760px; margin: 0 auto; padding: 14px 16px 40px; }
  #page .bbprev { border: none; background: none; padding: 0; }
</style>
</head>
<body>
<div id="page"><div id="content" class="bbprev"></div></div>
<script nonce="${nonce}">
window.addEventListener("message", (ev) => {
  const m = ev.data;
  if (m && m.type === "render") document.getElementById("content").innerHTML = m.html;
});
</script>
</body>
</html>`;
}

/**
 * A .bbcode file, whichever language id the editor gave it: another
 * extension that claims the extension would otherwise hide every button.
 */
function isBBCode(document: vscode.TextDocument): boolean {
  return document.languageId === "bbcode" || document.uri.path.toLowerCase().endsWith(".bbcode");
}

// ---------------------------------------------------------------------------
// The same file as Markdown: pxmd:/<path>.bbcode.md
// ---------------------------------------------------------------------------

const MIRROR_SCHEME = "pxmd";

/** The Markdown face of a .bbcode file. The .md suffix is what makes it Markdown. */
function mirrorUri(file: vscode.Uri): vscode.Uri {
  return file.with({ scheme: MIRROR_SCHEME, path: file.path + ".md" });
}

/** The .bbcode file behind a mirror uri. */
function sourceUri(mirror: vscode.Uri): vscode.Uri {
  return mirror.with({ scheme: "file", path: mirror.path.replace(/\.md$/, "") });
}

/**
 * Reads a .bbcode file as Markdown and writes Markdown back as BBCode. The
 * open .bbcode editor, if any, is the source of truth for a read (unsaved
 * edits included); a write goes through the workspace so that editor
 * follows the save rather than reporting the file changed under it.
 */
class MarkdownMirror implements vscode.FileSystemProvider {
  private readonly emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.emitter.event;

  watch(uri: vscode.Uri): vscode.Disposable {
    const source = sourceUri(uri);
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(source, "*"));
    const changed = (): void => this.emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    const onDoc = vscode.workspace.onDidSaveTextDocument((d) => {
      if (d.uri.toString() === source.toString()) changed();
    });
    return vscode.Disposable.from(watcher, watcher.onDidChange(changed), onDoc);
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const real = await vscode.workspace.fs.stat(sourceUri(uri));
    return { ...real, type: vscode.FileType.File, size: (await this.readFile(uri)).byteLength };
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const source = sourceUri(uri);
    const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === source.toString());
    const text = open
      ? open.getText()
      : Buffer.from(await vscode.workspace.fs.readFile(source)).toString("utf8");
    return Buffer.from(bbcodeToMarkdown(text), "utf8");
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
    const source = sourceUri(uri);
    const bbcode = markdownToBBCode(Buffer.from(content).toString("utf8"));
    const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === source.toString());
    if (open) {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(source, new vscode.Range(0, 0, open.lineCount, 0), bbcode);
      await vscode.workspace.applyEdit(edit);
      await open.save();
    } else {
      await vscode.workspace.fs.writeFile(source, Buffer.from(bbcode, "utf8"));
    }
    this.emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  readDirectory(): [string, vscode.FileType][] {
    return [];
  }
  createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions();
  }
  delete(): void {
    throw vscode.FileSystemError.NoPermissions();
  }
  rename(): void {
    throw vscode.FileSystemError.NoPermissions();
  }
}

/** "Edit as Markdown": the active .bbcode file, as Markdown, beside it. */
async function editAsMarkdown(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isBBCode(editor.document) || editor.document.uri.scheme !== "file") {
    void vscode.window.showInformationMessage(
      "Paradox Modding Toolkit: open a saved .bbcode file to edit it as Markdown."
    );
    return;
  }
  const doc = await vscode.workspace.openTextDocument(mirrorUri(editor.document.uri));
  await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false });
}

/** From the Markdown face back to the .bbcode file it edits. */
async function backToBBCode(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== MIRROR_SCHEME) return;
  await vscode.window.showTextDocument(sourceUri(editor.document.uri), { preview: false });
}

function openPreview(context: vscode.ExtensionContext, sideBySide: boolean): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isBBCode(editor.document)) {
    void vscode.window.showInformationMessage("Paradox Modding Toolkit: open a .bbcode file to preview it.");
    return;
  }
  BBCodePreview.show(context, editor, sideBySide);
}

/**
 * Convert the active document to the other format, next to it, and open it
 * beside. The old file is left alone: `descriptionFile` reads `.md` first, so
 * writing the `.md` is what switches a listing over, and deleting the
 * `.bbcode` is the modder's call.
 */
async function convertActive(to: "md" | "bbcode"): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const isFrom =
    editor && (to === "md" ? isBBCode(editor.document) : editor.document.languageId === "markdown");
  // A file on disk, since the converted copy is written next to it: an
  // untitled buffer has no folder to be next to.
  if (!editor || !isFrom || editor.document.uri.scheme !== "file") {
    void vscode.window.showInformationMessage(
      `Paradox Modding Toolkit: open a saved ${to === "md" ? ".bbcode" : "Markdown"} file to convert it.`
    );
    return;
  }
  const source = editor.document.uri.fsPath;
  const target = source.slice(0, source.length - path.extname(source).length) + `.${to}`;
  if (fs.existsSync(target)) {
    const answer = await vscode.window.showWarningMessage(
      `${path.basename(target)} already exists. Overwrite it?`,
      "Overwrite",
      "Cancel"
    );
    if (answer !== "Overwrite") return;
  }
  const text = editor.document.getText();
  fs.writeFileSync(target, to === "md" ? bbcodeToMarkdown(text) : markdownToBBCode(text), "utf8");
  await vscode.window.showTextDocument(vscode.Uri.file(target), {
    viewColumn: vscode.ViewColumn.Beside,
    preview: false,
  });
  const listing = path.basename(source).toLowerCase() === `description.${to === "md" ? "bbcode" : "md"}`;
  void vscode.window.showInformationMessage(
    !listing
      ? `Wrote ${path.basename(target)}.`
      : to === "md"
        ? "description.md is now what the Workshop listing reads. Delete description.bbcode once you are happy with it."
        : "Wrote description.bbcode, but the listing still reads description.md first. Delete the .md to go back to BBCode."
  );
}

export function registerBBCodeSupport(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider("bbcode", completionProvider, "[", "/"),
    vscode.commands.registerCommand("px.openBBCodePreview", () => openPreview(context, false)),
    vscode.commands.registerCommand("px.openBBCodePreviewSide", () => openPreview(context, true)),
    vscode.commands.registerCommand("px.openBBCodeSource", () => BBCodePreview.showSource()),
    vscode.commands.registerCommand("px.convertBBCodeToMarkdown", () => convertActive("md")),
    vscode.commands.registerCommand("px.convertMarkdownToBBCode", () => convertActive("bbcode")),
    vscode.workspace.registerFileSystemProvider(MIRROR_SCHEME, new MarkdownMirror(), {
      isCaseSensitive: false,
    }),
    vscode.commands.registerCommand("px.editBBCodeAsMarkdown", editAsMarkdown),
    vscode.commands.registerCommand("px.backToBBCode", backToBBCode)
  );
}
