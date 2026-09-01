/**
 * The Wiki panel (px.openWiki): the discoverable home for the toolkit's
 * reference knowledge. Articles are files the repo already keeps - the image
 * guidelines shipped in media/, the per-diagnostic explanations copied into
 * dist/diagnostics by scripts/copy-docs.mjs - so nothing here is a second copy
 * of text that lives somewhere else.
 *
 * The host does the two things the app cannot: read those files, and run a
 * command for the launcher rows that lead to the other reference views.
 */
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { GameMeta } from "@px-lsp/server/games/profile";
import { hasFormatDocs } from "../../meta";
import { wikiHtml } from "./html";
import type { AppToHost, HostToApp, WikiArticle, WikiLauncher } from "./messages";
import { makeNonce } from "../nonce";
import { tabIcon } from "../tabIcons";

/** The article the Image Guidelines command opens the hub at. */
export const IMAGE_GUIDELINES_ARTICLE = "image-guidelines";

export class WikiPanel {
  private static instance: WikiPanel | undefined;
  private static readonly viewType = "px.wiki";

  private readonly panel: vscode.WebviewPanel;
  private readonly context: vscode.ExtensionContext;
  private meta: GameMeta;
  private select: string | null;
  private disposables: vscode.Disposable[] = [];
  private disposed = false;

  private constructor(context: vscode.ExtensionContext, meta: GameMeta, select: string | null) {
    this.context = context;
    this.meta = meta;
    this.select = select;
    this.panel = vscode.window.createWebviewPanel(WikiPanel.viewType, "Wiki", vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist", "webview")],
    });
    this.panel.iconPath = tabIcon("wiki");
    const nonce = makeNonce();
    this.panel.webview.html = wikiHtml({
      scriptSrc: this.panel.webview
        .asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "wiki.js"))
        .toString(),
      nonce,
      csp: [
        `default-src 'none'`,
        `img-src ${this.panel.webview.cspSource} data:`,
        `style-src 'unsafe-inline'`,
        `script-src 'nonce-${nonce}'`,
        `font-src ${this.panel.webview.cspSource}`,
      ].join("; "),
    });
    this.panel.webview.onDidReceiveMessage(
      (msg: AppToHost) => void this.onMessage(msg),
      undefined,
      this.disposables
    );
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  /** Opens the hub, at `select` when an article id is given. */
  static show(context: vscode.ExtensionContext, meta: GameMeta, select: string | null = null): void {
    const existing = WikiPanel.instance;
    if (existing) {
      existing.meta = meta;
      existing.panel.reveal(vscode.ViewColumn.Active);
      if (select) existing.post({ type: "select", id: select });
      return;
    }
    WikiPanel.instance = new WikiPanel(context, meta, select);
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    WikiPanel.instance = undefined;
    for (const d of this.disposables.splice(0)) d.dispose();
    this.panel.dispose();
  }

  private post(msg: HostToApp): void {
    if (this.disposed) return;
    void this.panel.webview.postMessage(msg);
  }

  private async onMessage(msg: AppToHost): Promise<void> {
    switch (msg.type) {
      case "ready":
        this.post({
          type: "content",
          launchers: launchers(this.meta),
          articles: readArticles(this.context),
          select: this.select,
        });
        this.select = null;
        break;
      case "run":
        await vscode.commands.executeCommand(msg.command);
        break;
    }
  }
}

/** The reference views the hub points at, labelled for the active game. */
function launchers(meta: GameMeta): WikiLauncher[] {
  return [
    {
      label: "Examples Wiki",
      command: "px.showExamplesWiki",
      icon: "bookOpen",
      tip: "Search every trigger, effect, event target, modifier and datafunction the toolkit knows, with what it does and where the game itself uses it.",
    },
    // Only CK3 ships _*.info docs; elsewhere the same command opens the
    // vanilla files of the folder plus a search on the game's modding wiki.
    hasFormatDocs(meta.id)
      ? {
          label: "Format Docs",
          command: "px.openInfoDocs",
          icon: "fileText",
          tip: "The game's own _*.info format documentation for the file you are editing.",
        }
      : {
          label: "Vanilla Examples & Wiki",
          command: "px.openInfoDocs",
          icon: "fileText",
          tip: "The vanilla files of the folder you are editing, and a search on the game's modding wiki.",
        },
  ];
}

/** `**Severity:** Error · **Source:** ...` opens every diagnostic page. */
function severity(markdown: string): string | undefined {
  return /\*\*Severity:\*\*\s*([A-Za-z/]+)/.exec(markdown)?.[1];
}

function readArticles(context: vscode.ExtensionContext): WikiArticle[] {
  const articles: WikiArticle[] = [];
  const guidelines = read(context.asAbsolutePath("media/image-guidelines.md"));
  if (guidelines) {
    articles.push({
      id: IMAGE_GUIDELINES_ARTICLE,
      title: "Image Guidelines",
      section: "Art & assets",
      markdown: guidelines,
    });
  }

  // Copied from docs/diagnostics by scripts/copy-docs.mjs. README.md is the
  // repo's index page: the sidebar is that index here, so it is skipped.
  const dir = context.asAbsolutePath("dist/diagnostics");
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".md") && n !== "README.md");
  } catch {
    names = [];
  }
  for (const name of names.sort()) {
    const markdown = read(path.join(dir, name));
    if (!markdown) continue;
    articles.push({
      id: name.slice(0, -3),
      title: name.slice(0, -3),
      section: "Diagnostics",
      badge: severity(markdown),
      markdown,
    });
  }
  return articles;
}

function read(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}
