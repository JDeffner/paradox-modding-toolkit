/**
 * The Wiki panel (px.openWiki): the hub for the toolkit's reference
 * knowledge. Its front page is a set of cards, one per destination: the
 * other reference views (Examples Wiki, Credits) and the pages
 * the wiki holds itself (Image Guidelines, Diagnostics, Mod Report, Modding
 * Tools).
 *
 * The sidebar carries a game switch, so a user can read another game's pages
 * without changing the workspace: articles that name a game (Modding Guides,
 * Modding Tools)
 * show only for the selected one, and the switch starts on the workspace's
 * game.
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
import { creditsPage } from "../credits/credits";
import { GAME_METAS } from "../../gameDetect";
import { MODDING_TOOLS, moddingToolsPage } from "./moddingTools";
import { moddingGuidesPage } from "./moddingGuides";
import { LAUNCH_OPTIONS_ARTICLE, readLaunchOptions } from "./launchOptions";
import { wikiHtml } from "./html";
import { contributionUrl } from "./contribution";
import { parseWikiState } from "./navigation";
import { parseExampleWikiTarget } from "../exampleWiki/panel";
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
  /** Resolved game data directory, using the current settings or install detection. */
  gamePath: (meta: GameMeta) => string | null;
}

export class WikiPanel {
  private static instance: WikiPanel | undefined;
  private static readonly viewType = "px.wiki";
  private static readonly stateKey = "px.wiki.readingState";

  private readonly panel: vscode.WebviewPanel;
  private readonly context: vscode.ExtensionContext;
  private deps: WikiDeps;
  private game: string;
  private select: string | null;
  private disposables: vscode.Disposable[] = [];
  private disposed = false;
  private ready = false;
  private reportGeneration = 0;
  private launchWatchers = new Map<string, vscode.FileSystemWatcher>();

  private constructor(
    context: vscode.ExtensionContext,
    meta: GameMeta,
    deps: WikiDeps,
    select: string | null
  ) {
    this.context = context;
    this.deps = deps;
    this.game = meta.id;
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
    this.disposables.push(watchBundle(source, "wiki", this.panel, render));
    this.panel.webview.onDidReceiveMessage(
      (msg: AppToHost) => void this.onMessage(msg),
      undefined,
      this.disposables
    );
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
    this.panel.onDidChangeViewState(
      () => {
        if (this.panel.visible) this.refreshLaunchOptions();
      },
      undefined,
      this.disposables
    );
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
      existing.deps = deps;
      existing.refreshWorkspace(meta);
      existing.panel.reveal(vscode.ViewColumn.Active);
      existing.refreshLaunchOptions();
      if (select) {
        if (existing.ready) existing.post({ type: "select", id: select });
        else existing.select = select;
      }
      return;
    }
    WikiPanel.instance = new WikiPanel(context, meta, deps, select);
  }

  /** Called after the extension resolves changed game paths or workspace folders. */
  static refresh(meta?: GameMeta): void {
    const existing = WikiPanel.instance;
    if (!existing) return;
    if (meta) existing.refreshWorkspace(meta);
    existing.refreshLaunchOptions();
  }

  private refreshWorkspace(meta: GameMeta): void {
    if (this.game === meta.id) return;
    this.game = meta.id;
    this.reportGeneration++;
    if (this.ready) this.post({ type: "hub", hub: hub(meta), game: this.game });
  }

  private launchArticles(): WikiArticle[] {
    const sources = new Set<string>();
    const articles = Object.values(GAME_METAS).map((meta) => {
      const dir = meta.launchOptionsFile ? this.deps.gamePath(meta) : null;
      if (dir && meta.launchOptionsFile) sources.add(path.join(dir, meta.launchOptionsFile));
      return readLaunchOptions(meta, dir);
    });
    for (const [source, watcher] of this.launchWatchers) {
      if (sources.has(source)) continue;
      watcher.dispose();
      this.launchWatchers.delete(source);
    }
    for (const source of sources) {
      if (this.launchWatchers.has(source)) continue;
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(path.dirname(source), path.basename(source))
      );
      const refresh = () => this.refreshLaunchOptions();
      watcher.onDidChange(refresh);
      watcher.onDidCreate(refresh);
      watcher.onDidDelete(refresh);
      this.launchWatchers.set(source, watcher);
    }
    return articles;
  }

  private refreshLaunchOptions(): void {
    if (this.disposed || !this.ready) return;
    this.post({ type: "launchOptions", articles: this.launchArticles() });
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    WikiPanel.instance = undefined;
    for (const watcher of this.launchWatchers.values()) watcher.dispose();
    this.launchWatchers.clear();
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
        this.ready = true;
        this.reportGeneration++;
        this.post({
          type: "content",
          hub: hub(GAME_METAS[this.game]),
          articles: [...readArticles(this.context), ...this.launchArticles()],
          games: Object.values(GAME_METAS).map((m) => ({ id: m.id, name: m.name, shortName: m.shortName })),
          game: this.game,
          select: this.select,
          state: parseWikiState(this.context.workspaceState.get(WikiPanel.stateKey)),
        });
        this.select = null;
        break;
      case "saveState": {
        const state = parseWikiState(msg.state);
        if (!state) return;
        try {
          await this.context.workspaceState.update(WikiPanel.stateKey, state);
        } catch (error) {
          void vscode.window.showErrorMessage(`Wiki: cannot save reading history: ${String(error)}`);
        }
        break;
      }
      case "searchExamples": {
        const target = parseExampleWikiTarget({ query: msg.query });
        if (!target || typeof msg.game !== "string" || !Object.hasOwn(GAME_METAS, msg.game)) {
          void vscode.window.showErrorMessage(
            "Wiki: the search or selected reference game is not supported."
          );
          return;
        }
        await vscode.commands.executeCommand("px.showExamplesWiki", { ...target, gameId: msg.game });
        break;
      }
      case "contribute": {
        const url = contributionUrl(
          msg.game,
          msg.article,
          Object.values(GAME_METAS),
          [...readArticles(this.context), ...this.launchArticles()],
          hub(GAME_METAS[this.game])
        );
        if (!url) {
          void vscode.window.showErrorMessage("Wiki: the selected page or game is unavailable.");
          return;
        }
        try {
          if (!(await vscode.env.openExternal(vscode.Uri.parse(url))))
            throw new Error("The browser did not open.");
        } catch (error) {
          void vscode.window.showErrorMessage(`Wiki: cannot open the contribution form: ${String(error)}`);
        }
        break;
      }
      case "refreshLaunchOptions":
        this.refreshLaunchOptions();
        break;
      case "run":
        if (msg.command === "px.showExamplesWiki") {
          if (msg.game === undefined) await vscode.commands.executeCommand(msg.command);
          else if (typeof msg.game === "string" && Object.hasOwn(GAME_METAS, msg.game))
            await vscode.commands.executeCommand(msg.command, { gameId: msg.game });
          else void vscode.window.showErrorMessage("Wiki: the selected reference game is not supported.");
        } else if (
          hub(GAME_METAS[this.game]).some(
            (entry) => "command" in entry.target && entry.target.command === msg.command
          )
        )
          await vscode.commands.executeCommand(msg.command);
        break;
      case "modReport": {
        const generation = ++this.reportGeneration;
        let markdown: string;
        try {
          markdown = await this.deps.modReport();
        } catch (e) {
          markdown = `# Mod Report\n\nThe report could not be built: ${e instanceof Error ? e.message : String(e)}`;
        }
        if (generation === this.reportGeneration) this.post({ type: "modReport", markdown });
        break;
      }
    }
  }
}

/** The front-page cards, in reading order, labelled for the active game. */
function hub(workspaceGame: GameMeta): WikiHubEntry[] {
  return [
    {
      label: "Examples Wiki",
      group: "Script reference",
      selectedGame: true,
      icon: "bookOpen",
      tip: "Search every trigger, effect and datafunction, with real examples out of the game's files.",
      target: { command: "px.showExamplesWiki" },
    },
    {
      label: "Launch Options",
      group: "Script reference",
      selectedGame: true,
      icon: "play",
      tip: "Launch flags and descriptions read from the installed game's documentation, updated when the file changes.",
      target: { page: LAUNCH_OPTIONS_ARTICLE },
    },
    {
      label: "CK3 Image Guidelines",
      group: "Images & formats",
      icon: "image",
      tip: "CK3 asset sizes, formats and file names. Requirements for other games have not been verified.",
      target: { page: IMAGE_GUIDELINES_ARTICLE },
    },
    {
      label: "Diagnostics",
      group: "Troubleshooting",
      icon: "alert",
      tip: "One page per problem code the toolkit reports: what it means, why the game fails, how to fix it.",
      target: { page: "diagnostics" },
    },
    {
      label: `${workspaceGame.shortName} Mod Report (workspace)`,
      group: "More",
      workspace: true,
      icon: "activity",
      tip: `${workspaceGame.name}. Content counts, problems, localization coverage and overrides of the focused workspace mod, built now. The reference game switch does not change this report.`,
      target: { page: "mod-report" },
    },
    {
      label: "Steam Error Codes",
      group: "Troubleshooting",
      icon: "cloudUpload",
      tip: "Every Steam result code a Workshop upload can fail with, and what to do about each.",
      target: { page: STEAM_ERRORS_ARTICLE },
    },
    {
      label: "Steam BBCode",
      group: "Images & formats",
      icon: "fileText",
      tip: "Every tag Steam renders in a description, changenote or translation, with the syntax.",
      target: { page: STEAM_BBCODE_ARTICLE },
    },
    {
      label: "Modding Guides",
      group: "Community",
      selectedGame: true,
      icon: "bookOpen",
      tip: "The game wiki's modding pages for the game you mod: events, map, sound, interface, compatibility, with what each covers.",
      target: { page: MODDING_GUIDES_ARTICLE },
    },
    {
      label: "Modding Tools",
      group: "Community",
      selectedGame: true,
      icon: "wrench",
      tip: "Tools other modders built for the game you mod: map editors, translators, audio, history converters, with links.",
      target: { page: MODDING_TOOLS_ARTICLE },
    },
    {
      label: "Credits",
      group: "More",
      icon: "heart",
      tip: "Every project the toolkit builds on, with links.",
      target: { page: CREDITS_ARTICLE },
    },
  ];
}

/** The pages that are not diagnostics and not the image guidelines. */
export const STEAM_ERRORS_ARTICLE = "steam-error-codes";
export const STEAM_BBCODE_ARTICLE = "steam-bbcode";
export const CREDITS_ARTICLE = "credits";
/** One page per game shares this id; the game switch picks which one shows. */
export const MODDING_TOOLS_ARTICLE = "modding-tools";
export const MODDING_GUIDES_ARTICLE = "modding-guides";

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
  const revisions = readRevisions(context.asAbsolutePath("dist/wiki-revisions.json"));
  const revision = (source: string) => revisions[source] ?? { uncommitted: false };
  const guidelines = read(context.asAbsolutePath("media/image-guidelines.md"));
  if (guidelines) {
    articles.push({
      id: IMAGE_GUIDELINES_ARTICLE,
      title: "CK3 Image Guidelines",
      game: "ck3",
      section: "Art & assets",
      revision: revision("packages/vscode/media/image-guidelines.md"),
      markdown: guidelines,
    });
    for (const meta of Object.values(GAME_METAS).filter((candidate) => candidate.id !== "ck3")) {
      articles.push({
        id: IMAGE_GUIDELINES_ARTICLE,
        title: "CK3 Image Guidelines",
        section: "Art & assets",
        game: meta.id,
        markdown: `# CK3 Image Guidelines\n\nThis reference contains CK3 asset requirements. No asset requirements have been verified here for ${meta.name}. Select Crusader Kings III to read the CK3 reference. Match a texture from your selected game's installation when replacing its artwork.`,
      });
    }
  }
  // The GitHub wiki's page, shipped in the vsix so it reads offline too.
  const steam = read(context.asAbsolutePath("media/steam-workshop-error-codes.md"));
  if (steam) {
    articles.push({
      id: STEAM_ERRORS_ARTICLE,
      title: "Steam Error Codes",
      section: "Steam Workshop",
      revision: revision("packages/vscode/media/steam-workshop-error-codes.md"),
      markdown: steam,
    });
  }
  const bbcode = read(context.asAbsolutePath("media/steam-bbcode.md"));
  if (bbcode) {
    articles.push({
      id: STEAM_BBCODE_ARTICLE,
      title: "Steam BBCode",
      section: "Steam Workshop",
      revision: revision("packages/vscode/media/steam-bbcode.md"),
      markdown: bbcode,
    });
  }
  articles.push({
    id: CREDITS_ARTICLE,
    title: "Credits",
    section: "About",
    revision: revision("packages/vscode/src/webviews/credits/credits.ts"),
    ...creditsPage(),
  });

  // One page for every game, each card tagged with the games its tool serves.
  // Built here, not read from a file: the list is typed in moddingTools.ts.
  const gameNames = Object.fromEntries(
    Object.keys(MODDING_TOOLS).map((id) => [id, GAME_METAS[id]?.name ?? id])
  );
  articles.push({
    id: MODDING_TOOLS_ARTICLE,
    title: "Modding Tools",
    section: "Community",
    revision: revision("packages/vscode/src/webviews/wiki/moddingTools.ts"),
    ...moddingToolsPage(gameNames),
  });
  articles.push({
    id: MODDING_GUIDES_ARTICLE,
    title: "Modding Guides",
    section: "Community",
    revision: revision("packages/vscode/src/webviews/wiki/moddingGuides.ts"),
    ...moddingGuidesPage(gameNames),
  });

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
      revision: revision(`docs/diagnostics/${name}`),
      markdown,
    });
  }
  return articles;
}

function readRevisions(file: string): Record<string, NonNullable<WikiArticle["revision"]>> {
  try {
    const data: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("expected a source-to-revision object");
    }
    for (const [source, revision] of Object.entries(data)) {
      if (
        !revision ||
        typeof revision !== "object" ||
        typeof revision.uncommitted !== "boolean" ||
        (revision.lastEdited !== undefined &&
          (typeof revision.lastEdited !== "string" || !Number.isFinite(Date.parse(revision.lastEdited))))
      ) {
        throw new Error(`invalid revision for ${source}`);
      }
    }
    return data as Record<string, NonNullable<WikiArticle["revision"]>>;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      console.warn(
        `Wiki edit metadata could not be read: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    return {};
  }
}

function read(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}
