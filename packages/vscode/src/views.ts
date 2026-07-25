/**
 * The CK3 activity-bar container (rework plan AD-7): native tree views —
 * Tools, Mod Overview, Problems by Type, Localization Coverage, Overrides &
 * Conflicts. All data comes from the language server via ck3/* requests
 * (except Problems, which slices the editor's own diagnostics); views refresh
 * on the server's ck3/indexChanged notification.
 */
import * as vscode from "vscode";
import * as path from "path";
import type { LanguageClient } from "vscode-languageclient/node";
import {
  indexChangedNotification,
  locCoverageRequest,
  modOverviewRequest,
  overridesRequest,
  type DependenciesResult,
  type DependencyGroup,
  type LocCoverage,
  type ModOverview,
  type ModScopedParams,
  type OverrideInfo,
} from "@paradox-lsp/protocol/protocol";
import { readDescriptorName } from "@paradox-lsp/protocol/descriptorMod";
import { allWorkspaceModCandidates, modRootFor, type Ck3Config } from "./config";

/**
 * Which mod the mod-scoped views (Overview, Loc Coverage, Overrides, event
 * graph, report) show. Default: follow the mod that owns the active editor's
 * file; the user can pin one via `CK3: Pick Focus Mod` instead. There is no
 * "primary mod" — this is a view filter, nothing else.
 */
export class FocusMod {
  /** Pinned root, or null = follow the active editor. */
  private pinned: string | null;
  private lastAutoRoot: string | null = null;

  constructor(
    private readonly state: vscode.Memento,
    private readonly getCfg: () => Ck3Config
  ) {
    this.pinned = state.get<string | null>("ck3.focusModRoot", null) ?? null;
  }

  /** Every mod the workspace edits (dedup, config order). */
  roots(): string[] {
    const cfg = this.getCfg();
    const out: string[] = [];
    const seen = new Set<string>();
    for (const r of [cfg.modPath, ...cfg.workspaceMods]) {
      if (!r) continue;
      const key = r.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    return out;
  }

  current(): string | null {
    const roots = this.roots();
    const has = (r: string) => roots.some((x) => x.toLowerCase() === r.toLowerCase());
    if (this.pinned && has(this.pinned)) return this.pinned;
    const active = vscode.window.activeTextEditor?.document.uri.fsPath;
    const owner = active ? modRootFor(active, this.getCfg()) : null;
    if (owner) this.lastAutoRoot = owner;
    if (this.lastAutoRoot && has(this.lastAutoRoot)) return this.lastAutoRoot;
    return roots[0] ?? null;
  }

  isPinned(): boolean {
    return this.pinned !== null;
  }

  async pin(root: string | null): Promise<void> {
    this.pinned = root;
    await this.state.update("ck3.focusModRoot", root);
  }

  label(root: string | null = this.current()): string {
    if (!root) return "";
    return readDescriptorName(root) ?? path.basename(root);
  }

  params(): ModScopedParams {
    return { modRoot: this.current() };
  }
}

function openCommand(file: string, line: number): vscode.Command {
  return {
    command: "vscode.open",
    title: "Open",
    arguments: [
      vscode.Uri.file(file),
      {
        selection: new vscode.Range(line, 0, line, 0),
        preview: true,
      } satisfies vscode.TextDocumentShowOptions,
    ],
  };
}

class Node extends vscode.TreeItem {
  children: Node[] = [];
  /** For loc-coverage items: the loc key, consumed by ck3.addLocalizationFromView. */
  ck3Key?: string;

  constructor(label: string, state: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None) {
    super(label, state);
  }
}

abstract class BaseProvider implements vscode.TreeDataProvider<Node> {
  private emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(node: Node): vscode.TreeItem {
    return node;
  }

  getChildren(node?: Node): vscode.ProviderResult<Node[]> {
    if (node) return node.children;
    return this.roots();
  }

  protected abstract roots(): Promise<Node[]>;
}

// ---- Mod Overview -------------------------------------------------------------

class OverviewProvider extends BaseProvider {
  constructor(
    private readonly lc: LanguageClient,
    private readonly focus: FocusMod
  ) {
    super();
  }

  protected async roots(): Promise<Node[]> {
    const overview = await this.lc.sendRequest<ModOverview>(modOverviewRequest, this.focus.params());
    if (overview.kinds.length === 0) {
      const empty = new Node("No mod content indexed");
      empty.iconPath = new vscode.ThemeIcon("info");
      return [empty];
    }
    return overview.kinds.map((k) => {
      const node = new Node(
        `${k.kind.replace(/_/g, " ")} (${k.count})`,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      node.iconPath = new vscode.ThemeIcon("symbol-class");
      node.children = k.defs.map((d) => {
        const child = new Node(d.name);
        child.description = path.basename(d.file);
        child.command = openCommand(d.file, d.line);
        child.iconPath = new vscode.ThemeIcon("symbol-field");
        return child;
      });
      if (k.count > k.defs.length) {
        node.children.push(new Node(`… ${k.count - k.defs.length} more`));
      }
      return node;
    });
  }
}

// ---- Problems Summary ------------------------------------------------------------

const SEVERITY_ORDER: Array<[vscode.DiagnosticSeverity, string, string]> = [
  [vscode.DiagnosticSeverity.Error, "Errors", "error"],
  [vscode.DiagnosticSeverity.Warning, "Warnings", "warning"],
  [vscode.DiagnosticSeverity.Information, "Info", "info"],
  [vscode.DiagnosticSeverity.Hint, "Hints", "lightbulb"],
];

class ProblemsProvider extends BaseProvider {
  protected async roots(): Promise<Node[]> {
    const all = vscode.languages.getDiagnostics();
    const bySeverity = new Map<vscode.DiagnosticSeverity, Map<string, Map<string, vscode.Diagnostic[]>>>();
    for (const [uri, diags] of all) {
      for (const d of diags) {
        let byKey = bySeverity.get(d.severity);
        if (!byKey) bySeverity.set(d.severity, (byKey = new Map()));
        const code = typeof d.code === "object" ? String(d.code.value) : String(d.code ?? "other");
        const key = `${d.source ?? "?"} · ${code}`;
        let byFile = byKey.get(key);
        if (!byFile) byKey.set(key, (byFile = new Map()));
        const f = uri.fsPath;
        let list = byFile.get(f);
        if (!list) byFile.set(f, (list = []));
        list.push(d);
      }
    }

    const roots: Node[] = [];
    for (const [severity, label, icon] of SEVERITY_ORDER) {
      const byKey = bySeverity.get(severity);
      if (!byKey) continue;
      let total = 0;
      for (const byFile of byKey.values()) for (const list of byFile.values()) total += list.length;
      const sevNode = new Node(`${label} (${total})`, vscode.TreeItemCollapsibleState.Expanded);
      sevNode.iconPath = new vscode.ThemeIcon(icon);
      for (const [key, byFile] of [...byKey.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        let keyTotal = 0;
        for (const list of byFile.values()) keyTotal += list.length;
        const keyNode = new Node(`${key} (${keyTotal})`, vscode.TreeItemCollapsibleState.Collapsed);
        keyNode.iconPath = new vscode.ThemeIcon("tag");
        for (const [file, list] of [...byFile.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
          const fileNode = new Node(path.basename(file));
          fileNode.description = `${list.length}×`;
          fileNode.tooltip = list[0].message;
          fileNode.command = openCommand(file, list[0].range.start.line);
          fileNode.iconPath = new vscode.ThemeIcon("file");
          keyNode.children.push(fileNode);
        }
        sevNode.children.push(keyNode);
      }
      roots.push(sevNode);
    }
    if (roots.length === 0) {
      const ok = new Node("No problems reported");
      ok.iconPath = new vscode.ThemeIcon("check");
      return [ok];
    }
    return roots;
  }
}

// ---- Localization Coverage -----------------------------------------------------------

class LocCoverageProvider extends BaseProvider {
  constructor(
    private readonly lc: LanguageClient,
    private readonly focus: FocusMod
  ) {
    super();
  }

  protected async roots(): Promise<Node[]> {
    const coverage = await this.lc.sendRequest<LocCoverage[]>(locCoverageRequest, this.focus.params());
    if (coverage.length === 0) {
      const empty = new Node("No localization files in the mod");
      empty.iconPath = new vscode.ThemeIcon("info");
      return [empty];
    }
    return coverage.map((lang) => {
      const issues = lang.missing.length + lang.orphaned.length + lang.untranslated.length;
      const node = new Node(
        `${lang.language} — ${lang.defined} keys${issues > 0 ? `, ${issues} issue(s)` : ""}`,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      node.iconPath = new vscode.ThemeIcon(issues > 0 ? "globe" : "check");
      const category = (
        label: string,
        icon: string,
        items: LocCoverage["missing"],
        contextValue: string,
        value?: boolean
      ) => {
        if (items.length === 0) return;
        const cat = new Node(`${label} (${items.length})`, vscode.TreeItemCollapsibleState.Collapsed);
        cat.iconPath = new vscode.ThemeIcon(icon);
        cat.children = items.map((i) => {
          const item = new Node(i.key);
          if (i.file !== undefined && i.line !== undefined) item.command = openCommand(i.file, i.line);
          if (value && i.value) item.description = i.value.slice(0, 60);
          item.iconPath = new vscode.ThemeIcon("symbol-string");
          item.contextValue = contextValue;
          item.ck3Key = i.key;
          return item;
        });
        node.children.push(cat);
      };
      // Missing keys carry an inline "Add localization…" action (ck3.locMissing).
      category("Missing (referenced but not defined)", "error", lang.missing, "ck3.locMissing");
      category("Orphaned (defined but never referenced)", "circle-slash", lang.orphaned, "ck3.locKey");
      category("Untranslated (identical to source)", "arrow-right", lang.untranslated, "ck3.locKey", true);
      if (node.children.length === 0) {
        const ok = new Node("Complete");
        ok.iconPath = new vscode.ThemeIcon("check");
        node.children.push(ok);
      }
      return node;
    });
  }
}

// ---- Overrides & Conflicts ------------------------------------------------------------

class OverridesProvider extends BaseProvider {
  constructor(
    private readonly lc: LanguageClient,
    private readonly focus: FocusMod
  ) {
    super();
  }

  protected async roots(): Promise<Node[]> {
    const overrides = await this.lc.sendRequest<OverrideInfo[]>(overridesRequest, this.focus.params());
    if (overrides.length === 0) {
      const empty = new Node("Nothing overridden (vanilla, parents, other mods)");
      empty.iconPath = new vscode.ThemeIcon("check");
      return [empty];
    }
    const byKind = new Map<string, OverrideInfo[]>();
    for (const o of overrides) {
      let list = byKind.get(o.kind);
      if (!list) byKind.set(o.kind, (list = []));
      list.push(o);
    }
    return [...byKind.entries()].map(([kind, list]) => {
      const kindNode = new Node(
        `${kind.replace(/_/g, " ")} (${list.length})`,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      kindNode.iconPath = new vscode.ThemeIcon("symbol-class");
      kindNode.children = list.map((o) => {
        const won = o.winner === "mod";
        const node = new Node(o.name, vscode.TreeItemCollapsibleState.Collapsed);
        // Between two enabled workspace mods the launcher load order decides.
        node.description = o.note?.includes("load order")
          ? `${o.rule} — load order decides`
          : `${o.rule} — ${won ? "mod wins" : "vanilla wins"}`;
        node.iconPath = new vscode.ThemeIcon(won ? "arrow-swap" : "warning");
        node.tooltip = o.note;
        node.command = openCommand(o.mod.file, o.mod.line);
        node.children = o.shadowed.map((s) => {
          const site = new Node(`${s.label ?? s.source}: ${path.basename(s.file)}`);
          site.command = openCommand(s.file, s.line);
          site.iconPath = new vscode.ThemeIcon("references");
          return site;
        });
        return node;
      });
      return kindNode;
    });
  }
}

// ---- Dependencies --------------------------------------------------------------------

/** Command-driven: holds the last ck3/dependencies result until the next run. */
class DependenciesProvider extends BaseProvider {
  private result: DependenciesResult | null = null;

  setResult(result: DependenciesResult): void {
    this.result = result;
    this.refresh();
  }

  protected async roots(): Promise<Node[]> {
    const r = this.result;
    if (!r || !r.def) {
      const empty = new Node("Place the cursor on a definition, then run “CK3: Show Dependencies”.");
      empty.iconPath = new vscode.ThemeIcon("info");
      return [empty];
    }
    const count = (groups: DependencyGroup[]) => groups.reduce((n, g) => n + g.items.length, 0);
    const header = new Node(r.def.name);
    header.description = r.def.kind.replace(/_/g, " ");
    header.iconPath = new vscode.ThemeIcon("symbol-class");
    header.command = openCommand(r.def.file, r.def.line);
    return [
      header,
      this.section(
        `Dependents (${count(r.dependents)})`,
        "references",
        r.dependents,
        "nothing in the mod references this"
      ),
      this.section(
        `Dependencies (${count(r.dependencies)})`,
        "type-hierarchy-sub",
        r.dependencies,
        "this definition references nothing indexed"
      ),
    ];
  }

  private section(label: string, icon: string, groups: DependencyGroup[], emptyMsg: string): Node {
    const root = new Node(label, vscode.TreeItemCollapsibleState.Expanded);
    root.iconPath = new vscode.ThemeIcon(icon);
    if (groups.length === 0) {
      const none = new Node(emptyMsg);
      none.iconPath = new vscode.ThemeIcon("dash");
      root.children = [none];
      return root;
    }
    root.children = groups.map((g) => {
      const kindNode = new Node(
        `${g.kind.replace(/_/g, " ")} (${g.items.length})`,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      kindNode.iconPath = new vscode.ThemeIcon("symbol-class");
      kindNode.children = g.items.map((it) => {
        const leaf = new Node(it.name);
        leaf.description = path.basename(it.file);
        leaf.command = openCommand(it.file, it.line);
        leaf.iconPath = new vscode.ThemeIcon("symbol-field");
        return leaf;
      });
      return kindNode;
    });
    return root;
  }
}

// ---- Tools -----------------------------------------------------------------------------

/** One-click launcher for the extension's commands, grouped by workflow. */
const TOOL_GROUPS: Array<[group: string, items: Array<[label: string, command: string, icon: string]>]> = [
  ["Create", [["New Content (event, decision, …)", "ck3.newContent", "new-file"]]],
  [
    "Localization",
    [
      ["Add Language (scaffold files)", "ck3.createTranslation", "globe"],
      ["Translate Missing Keys (one by one)", "ck3.translateNext", "arrow-right"],
      ["New Translation Mod (translate another mod)", "ck3.createTranslationMod", "repo-clone"],
    ],
  ],
  [
    "Images",
    [
      ["Convert Image to DDS", "ck3.convertToDds", "file-media"],
      ["Image Guidelines (sizes & formats)", "ck3.imageGuidelines", "book"],
    ],
  ],
  [
    "Inspect",
    [
      ["Event Graph", "ck3.showEventGraph", "type-hierarchy"],
      ["GUI Widget Tree (open a .gui first)", "ck3.showGuiTree", "list-tree"],
      ["GUI Layout Preview (open a .gui first)", "ck3.showGuiPreview", "preview"],
      ["Mod Report", "ck3.modReport", "output"],
      ["Format Docs (.info) for This File", "ck3.openInfoDocs", "question"],
    ],
  ],
  [
    "Validate & Test",
    [
      ["Run Tiger Validation", "ck3.runTiger", "bug"],
      ["Launch CK3 (debug mode)", "ck3.launchGame", "play"],
      ["Toggle error.log Watcher", "ck3.watchErrorLog", "eye"],
      ["Run Setup & Health Check", "ck3.setup", "tools"],
    ],
  ],
  ["Learn", [["Tutorial: CK3 Modding from Zero", "ck3.tutorial", "mortar-board"]]],
];

class ToolsProvider extends BaseProvider {
  constructor(
    private readonly getCfg: () => Ck3Config,
    private readonly focus: FocusMod
  ) {
    super();
  }

  protected async roots(): Promise<Node[]> {
    const groups = TOOL_GROUPS.map(([group, items]) => {
      const g = new Node(group, vscode.TreeItemCollapsibleState.Expanded);
      g.children = items.map(([label, command, icon]) => {
        const item = new Node(label);
        item.iconPath = new vscode.ThemeIcon(icon);
        item.command = { command, title: label };
        return item;
      });
      return g;
    });
    return [this.workspaceModsGroup(), ...groups];
  }

  /** Top group: focus-mod picker, exclusion picker, and the excluded mods. */
  private workspaceModsGroup(): Node {
    const g = new Node("Workspace Mods", vscode.TreeItemCollapsibleState.Expanded);
    const pick = new Node("Pick Focus Mod (sidebar views)");
    pick.iconPath = new vscode.ThemeIcon("folder-library");
    pick.command = { command: "ck3.pickFocusMod", title: "Pick Focus Mod" };
    pick.description = this.focus.isPinned() ? `${this.focus.label()} (pinned)` : this.focus.label();
    const exclude = new Node("Exclude Mods from Indexing");
    exclude.iconPath = new vscode.ThemeIcon("eye-closed");
    exclude.command = { command: "ck3.excludeMods", title: "Exclude Workspace Mods from Indexing" };
    g.children = [pick, exclude];

    const excluded = this.getCfg().excludedMods;
    if (excluded.length > 0) {
      const list = new Node(`Excluded (${excluded.length})`, vscode.TreeItemCollapsibleState.Collapsed);
      list.iconPath = new vscode.ThemeIcon("circle-slash");
      list.children = excluded.map((p) => {
        const item = new Node(readDescriptorName(p) ?? path.basename(p));
        item.description = p;
        item.iconPath = new vscode.ThemeIcon("circle-slash");
        item.tooltip = "Not indexed. Run 'Exclude Mods from Indexing' to re-include.";
        return item;
      });
      g.children.push(list);
    }
    return g;
  }
}

// ---- registration ----------------------------------------------------------------------

export interface Ck3Views {
  refreshAll(): void;
  /** Populate and reveal the Dependencies view from a ck3/dependencies result. */
  showDependencies(result: DependenciesResult): void;
  /** The mod the mod-scoped views currently show (event graph/report reuse it). */
  focusRoot(): string | null;
}

export function registerCk3Views(
  context: vscode.ExtensionContext,
  lc: LanguageClient,
  getCfg: () => Ck3Config
): Ck3Views {
  const focus = new FocusMod(context.workspaceState, getCfg);
  const overview = new OverviewProvider(lc, focus);
  const problems = new ProblemsProvider();
  const locCoverage = new LocCoverageProvider(lc, focus);
  const overrides = new OverridesProvider(lc, focus);
  const dependencies = new DependenciesProvider();
  const tools = new ToolsProvider(getCfg, focus);

  // Mod-scoped views are created as TreeViews so their header can show WHICH
  // mod they describe (the focus mod's descriptor name).
  const overviewView = vscode.window.createTreeView("ck3.overview", { treeDataProvider: overview });
  const locCoverageView = vscode.window.createTreeView("ck3.locCoverage", { treeDataProvider: locCoverage });
  const overridesView = vscode.window.createTreeView("ck3.overrides", { treeDataProvider: overrides });
  const updateDescriptions = () => {
    const label = focus.label();
    const suffix = focus.isPinned() ? `${label} (pinned)` : label;
    overviewView.description = suffix;
    locCoverageView.description = suffix;
    overridesView.description = suffix;
  };
  updateDescriptions();

  context.subscriptions.push(
    overviewView,
    locCoverageView,
    overridesView,
    vscode.window.registerTreeDataProvider("ck3.problems", problems),
    vscode.window.registerTreeDataProvider("ck3.dependencies", dependencies),
    vscode.window.registerTreeDataProvider("ck3.tools", tools),
    vscode.commands.registerCommand("ck3.addLocalizationFromView", (node?: { ck3Key?: string }) =>
      vscode.commands.executeCommand("ck3.editLocalization", node?.ck3Key)
    )
  );

  const refreshServerBacked = () => {
    updateDescriptions();
    overview.refresh();
    locCoverage.refresh();
    overrides.refresh();
    // Tools shows the focus mod and the exclusion list: keep it in sync.
    tools.refresh();
  };
  lc.onNotification(indexChangedNotification, refreshServerBacked);

  // Follow the active editor between mods (unless pinned): switching files in
  // a multi-mod workspace re-filters the in-memory index — no re-indexing.
  let lastShown = focus.current();
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      const now = focus.current();
      if (now !== lastShown) {
        lastShown = now;
        refreshServerBacked();
      }
    })
  );

  // `CK3: Pick Focus Mod` — pin one workspace mod or go back to following the
  // active editor. Descriptor names, so 20 folders stay tellable apart.
  context.subscriptions.push(
    vscode.commands.registerCommand("ck3.pickFocusMod", async () => {
      const roots = focus.roots();
      if (roots.length === 0) {
        void vscode.window.showInformationMessage("CK3: no workspace mods to focus.");
        return;
      }
      type Item = vscode.QuickPickItem & { root: string | null };
      const items: Item[] = [
        {
          label: "$(sync) Follow the active editor",
          description: "default: the views show the mod of the file you are working on",
          root: null,
        },
        ...roots.map((r) => ({
          label: focus.label(r),
          description: r,
          root: r as string | null,
        })),
      ];
      const picked = await vscode.window.showQuickPick(items, {
        title: "Focus mod for the CK3 sidebar views",
        placeHolder: "Which mod should Mod Overview, Localization Coverage and Overrides show?",
      });
      if (!picked) return;
      await focus.pin(picked.root);
      lastShown = focus.current();
      refreshServerBacked();
    })
  );

  // `CK3: Exclude Workspace Mods from Indexing` — checked mods are skipped
  // entirely. Persisted in the workspace's ck3.excludedMods setting; the
  // config-change listener pushes new paths to the server, which reindexes.
  context.subscriptions.push(
    vscode.commands.registerCommand("ck3.excludeMods", async () => {
      const cfg = getCfg();
      const candidates = allWorkspaceModCandidates();
      const known = new Set(candidates.map((r) => r.toLowerCase()));
      // Stale entries (folder gone) stay listed so they can be unchecked.
      for (const p of cfg.excludedMods) {
        if (!known.has(p.toLowerCase())) candidates.push(p);
      }
      if (candidates.length === 0) {
        void vscode.window.showInformationMessage("CK3: no workspace mods found.");
        return;
      }
      const excluded = new Set(cfg.excludedMods.map((p) => p.toLowerCase()));
      type Item = vscode.QuickPickItem & { root: string };
      const items: Item[] = candidates.map((r) => ({
        label: readDescriptorName(r) ?? path.basename(r),
        description: r,
        picked: excluded.has(r.toLowerCase()),
        root: r,
      }));
      const picked = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        title: "Exclude workspace mods from indexing",
        placeHolder: "Checked mods are skipped entirely: no completion, navigation, diagnostics or views",
      });
      if (!picked) return;
      await vscode.workspace.getConfiguration("ck3").update(
        "excludedMods",
        picked.map((i) => i.root),
        vscode.ConfigurationTarget.Workspace
      );
      tools.refresh();
    })
  );

  let diagTimer: ReturnType<typeof setTimeout> | null = null;
  context.subscriptions.push(
    vscode.languages.onDidChangeDiagnostics(() => {
      if (diagTimer) clearTimeout(diagTimer);
      diagTimer = setTimeout(() => problems.refresh(), 500);
    })
  );

  return {
    refreshAll() {
      refreshServerBacked();
      problems.refresh();
      dependencies.refresh();
    },
    showDependencies(result) {
      dependencies.setResult(result);
    },
    focusRoot() {
      return focus.current();
    },
  };
}
