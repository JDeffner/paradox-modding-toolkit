/**
 * The Wiki panel (px.openWiki): the hub for the toolkit's reference
 * knowledge. Its front page is a set of cards, one per destination: the
 * other reference views (Examples Wiki, Format Docs, Credits) and the pages
 * the wiki holds itself (Image Guidelines, Diagnostics, Mod Report).
 *
 * Articles are files the repo already keeps - the image guidelines shipped
 * in media/, the per-diagnostic explanations copied into dist/diagnostics by
 * scripts/copy-docs.mjs - so nothing here is a second copy of text that
 * lives somewhere else. The mod report is built on demand by the same
 * builder the px.modReport command uses.
 *
 * The host does the things the app cannot: read those files, build the
 * report, and run a command for the cards that lead to other views.
 */
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { GameMeta } from "@px-lsp/server/games/profile";
import { hasFormatDocs } from "../../meta";
import { wikiHtml } from "./html";
import type { AppToHost, HostToApp, WikiArticle, WikiHubEntry } from "./messages";
import { makeNonce } from "../nonce";
import { tabIcon } from "../tabIcons";
import { bundleUri, watchBundle, webviewSource } from "../devReload";

/** The article the Image Guidelines command opens the hub at. */
export const IMAGE_GUIDELINES_ARTICLE = "image-guidelines";

/** What the host needs from the extension beyond the files it reads itself. */
export interface WikiDeps {
  /** The mod report as markdown, for the focused mod. */
  modReport: () => Promise<string>;
}

export class WikiPanel {
  private static instance: WikiPanel | undefined;
  private static readonly viewType = "px.wiki";

  private readonly panel: vscode.WebviewPanel;
  private readonly context: vscode.ExtensionContext;
  private meta: GameMeta;
  private deps: WikiDeps;
  private select: string | null;
  private disposables: vscode.Disposable[] = [];
  private disposed = false;

  private constructor(
    context: vscode.ExtensionContext,
    meta: GameMeta,
    deps: WikiDeps,
    select: string | null
  ) {
    this.context = context;
    this.meta = meta;
    this.deps = deps;
    this.select = select;
    const source = webviewSource(context);
    this.panel = vscode.window.createWebviewPanel(WikiPanel.viewType, "Wiki", vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [source.root],
    });
    this.panel.iconPath = tabIcon("wiki");
    const render = (): void => {
      const nonce = makeNonce();
      this.panel.webview.html = wikiHtml({
        scriptSrc: bundleUri(this.panel.webview, source, "wiki"),
        nonce,
        csp: [
          `default-src 'none'`,
          `img-src ${this.panel.webview.cspSource} data:`,
          `style-src 'unsafe-inline'`,
          `script-src 'nonce-${nonce}'`,
          `font-src ${this.panel.webview.cspSource}`,
        ].join("; "),
      });
    };
    render();
    // The rebooted app sends "ready" and the content answer follows.
    this.disposables.push(watchBundle(source, "wiki", render));
    this.panel.webview.onDidReceiveMessage(
      (msg: AppToHost) => void this.onMessage(msg),
      undefined,
      this.disposables
    );
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  /** Opens the hub, at `select` when a page id is given. */
  static show(
    context: vscode.ExtensionContext,
    meta: GameMeta,
    deps: WikiDeps,
    select: string | null = null
  ): void {
    const existing = WikiPanel.instance;
    if (existing) {
      existing.meta = meta;
      existing.deps = deps;
      existing.panel.reveal(vscode.ViewColumn.Active);
      if (select) existing.post({ type: "select", id: select });
      return;
    }
    WikiPanel.instance = new WikiPanel(context, meta, deps, select);
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
          hub: hub(this.meta),
          articles: readArticles(this.context),
          select: this.select,
        });
        this.select = null;
        break;
      case "run":
        await vscode.commands.executeCommand(msg.command);
        break;
      case "modReport": {
        let markdown: string;
        try {
          markdown = await this.deps.modReport();
        } catch (e) {
          markdown = `# Mod Report\n\nThe report could not be built: ${e instanceof Error ? e.message : String(e)}`;
        }
        this.post({ type: "modReport", markdown });
        break;
      }
    }
  }
}

/** The front-page cards, in reading order, labelled for the active game. */
function hub(meta: GameMeta): WikiHubEntry[] {
  return [
    {
      label: "Examples Wiki",
      icon: "bookOpen",
      tip: "Search every trigger, effect and datafunction, with real examples out of the game's files.",
      target: { command: "px.showExamplesWiki" },
    },
    // Only CK3 ships _*.info docs; the other games get no docs card.
    ...(hasFormatDocs(meta.id)
      ? [
          {
            label: "Format Docs",
            icon: "fileText" as const,
            tip: "The game's own format docs for the file you are editing.",
            target: { command: "px.openInfoDocs" },
          },
        ]
      : []),
    {
      label: "Image Guidelines",
      icon: "image",
      tip: "The sizes, formats and file names the game expects for previews, portraits and coats of arms.",
      target: { page: IMAGE_GUIDELINES_ARTICLE },
    },
    {
      label: "Diagnostics",
      icon: "alert",
      tip: "One page per problem code the toolkit reports: what it means, why the game fails, how to fix it.",
      target: { page: "diagnostics" },
    },
    {
      label: "Mod Report",
      icon: "activity",
      tip: "Content counts, problems, localization coverage and overrides of the focused mod, built now.",
      target: { page: "mod-report" },
    },
    {
      label: "Credits",
      icon: "heart",
      tip: "Every project the toolkit builds on, with links.",
      target: { command: "px.openCredits" },
    },
  ];
}

/** `**Severity:** Error · **Source:** ...` opens every diagnostic page. */
function severity(markdown: string): string | undefined {
  return /\*\*Severity:\*\*\s*([A-Za-z/]+)/.exec(markdown)?.[1];
}

/** The first sentence under "## What breaks", for the Diagnostics index. */
function summary(markdown: string): string | undefined {
  const body = /## What breaks\s*\n([\s\S]*?)(?:\n\s*\n|$)/.exec(markdown)?.[1];
  if (!body) return undefined;
  const text = body.replace(/\s+/g, " ").trim();
  return /^(.*?[.!?])(\s|$)/.exec(text)?.[1] ?? text;
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
  // repo's index page: the Diagnostics page is that index here, so it is skipped.
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
      summary: summary(markdown),
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
