/**
 * The Paradox Modding Toolkit activity-bar container (rework plan AD-7): native tree views —
 * Mod Overview, Problems by Type, Localization Coverage, Overrides &
 * Conflicts, Dependencies. All data comes from the language server via paradox/*
 * requests (except Problems, which slices the editor's own diagnostics); views
 * refresh on the server's paradox/indexChanged notification. The Project view
 * (formerly Tools) is a webview — see webviews/dashboard/view.ts.
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
} from "@px-lsp/protocol/protocol";
import { readModName } from "@px-lsp/protocol/modName";
import { allWorkspaceModCandidates, modRootFor, type PxConfig } from "./config";

/**
 * Which mod the mod-scoped views (Overview, Loc Coverage, Overrides, event
 * graph, report) show. Default: follow the mod that owns the active editor's
 * file; the user can pin one via `Paradox: Pick Focus Mod` instead. There is no
 * "primary mod" — this is a view filter, nothing else.
 */
export class FocusMod {
  /** Pinned root, or null = follow the active editor. */
  private pinned: string | null;
  private lastAutoRoot: string | null = null;
  private readonly pinEmitter = new vscode.EventEmitter<void>();
  /** Fires after pin() persists — both the tree views and the Project webview listen. */
  readonly onDidPin = this.pinEmitter.event;

  constructor(
    private readonly state: vscode.Memento,
    private readonly getCfg: () => PxConfig
  ) {
    this.pinned = state.get<string | null>("px.focusModRoot", null) ?? null;
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

  /** The raw pinned root (may point at an excluded/removed mod), or null = follow. */
  pinnedRoot(): string | null {
    return this.pinned;
  }

  async pin(root: string | null): Promise<void> {
    this.pinned = root;
    await this.state.update("px.focusModRoot", root);
    this.pinEmitter.fire();
  }

  label(root: string | null = this.current()): string {
    if (!root) return "";
    return readModName(root);
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
  /** For loc-coverage items: the loc key, consumed by px.addLocalizationFromView. */
  pxKey?: string;

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
          item.pxKey = i.key;
          return item;
        });
        node.children.push(cat);
      };
      // Missing keys carry an inline "Add localization…" action (px.locMissing).
      category("Missing (referenced but not defined)", "error", lang.missing, "px.locMissing");
      category("Orphaned (defined but never referenced)", "circle-slash", lang.orphaned, "px.locKey");
      category("Untranslated (identical to source)", "arrow-right", lang.untranslated, "px.locKey", true);
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

/** Command-driven: holds the last paradox/dependencies result until the next run. */
class DependenciesProvider extends BaseProvider {
  private result: DependenciesResult | null = null;

  setResult(result: DependenciesResult): void {
    this.result = result;
    this.refresh();
  }

  protected async roots(): Promise<Node[]> {
    const r = this.result;
    if (!r || !r.def) {
      const empty = new Node("Place the cursor on a definition, then run “Paradox: Show Dependencies”.");
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

// ---- registration ----------------------------------------------------------------------

export interface PxViews {
  refreshAll(): void;
  /** Populate and reveal the Dependencies view from a paradox/dependencies result. */
  showDependencies(result: DependenciesResult): void;
  /** The mod the mod-scoped views currently show (event graph/report reuse it). */
  focusRoot(): string | null;
}

export function registerPxViews(
  context: vscode.ExtensionContext,
  lc: LanguageClient,
  getCfg: () => PxConfig,
  focus: FocusMod
): PxViews {
  const overview = new OverviewProvider(lc, focus);
  const problems = new ProblemsProvider();
  const locCoverage = new LocCoverageProvider(lc, focus);
  const overrides = new OverridesProvider(lc, focus);
  const dependencies = new DependenciesProvider();

  // Mod-scoped views are created as TreeViews so their header can show WHICH
  // mod they describe (the focus mod's descriptor name).
  const overviewView = vscode.window.createTreeView("px.overview", { treeDataProvider: overview });
  const locCoverageView = vscode.window.createTreeView("px.locCoverage", { treeDataProvider: locCoverage });
  const overridesView = vscode.window.createTreeView("px.overrides", { treeDataProvider: overrides });
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
    vscode.window.registerTreeDataProvider("px.problems", problems),
    vscode.window.registerTreeDataProvider("px.dependencies", dependencies),
    vscode.commands.registerCommand("px.addLocalizationFromView", (node?: { pxKey?: string }) =>
      vscode.commands.executeCommand("px.editLocalization", node?.pxKey)
    )
  );

  const refreshServerBacked = () => {
    updateDescriptions();
    overview.refresh();
    locCoverage.refresh();
    overrides.refresh();
  };
  lc.onNotification(indexChangedNotification, refreshServerBacked);

  // Follow the active editor between mods (unless pinned): switching files in
  // a multi-mod workspace re-filters the in-memory index — no re-indexing.
  let lastShown = focus.current();
  // Pins land here from the quick pick below AND from the Project webview.
  context.subscriptions.push(
    focus.onDidPin(() => {
      lastShown = focus.current();
      refreshServerBacked();
    })
  );
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      const now = focus.current();
      if (now !== lastShown) {
        lastShown = now;
        refreshServerBacked();
      }
    })
  );

  // `Paradox: Pick Focus Mod` — pin one workspace mod or go back to following the
  // active editor. Descriptor names, so 20 folders stay tellable apart.
  context.subscriptions.push(
    vscode.commands.registerCommand("px.pickFocusMod", async () => {
      const roots = focus.roots();
      if (roots.length === 0) {
        void vscode.window.showInformationMessage("Paradox Modding Toolkit: no workspace mods to focus.");
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
        title: "Focus mod for the Paradox Modding Toolkit sidebar views",
        placeHolder: "Which mod should Mod Overview, Localization Coverage and Overrides show?",
      });
      if (!picked) return;
      await focus.pin(picked.root);
    })
  );

  // `Paradox: Exclude Workspace Mods from Indexing` — checked mods are skipped
  // entirely. Persisted in the workspace's px.excludedMods setting; the
  // config-change listener pushes new paths to the server, which reindexes.
  context.subscriptions.push(
    vscode.commands.registerCommand("px.excludeMods", async () => {
      const cfg = getCfg();
      const candidates = allWorkspaceModCandidates();
      const known = new Set(candidates.map((r) => r.toLowerCase()));
      // Stale entries (folder gone) stay listed so they can be unchecked.
      for (const p of cfg.excludedMods) {
        if (!known.has(p.toLowerCase())) candidates.push(p);
      }
      if (candidates.length === 0) {
        void vscode.window.showInformationMessage("Paradox Modding Toolkit: no workspace mods found.");
        return;
      }
      const excluded = new Set(cfg.excludedMods.map((p) => p.toLowerCase()));
      type Item = vscode.QuickPickItem & { root: string };
      const items: Item[] = candidates.map((r) => ({
        label: readModName(r),
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
      await vscode.workspace.getConfiguration("px").update(
        "excludedMods",
        picked.map((i) => i.root),
        vscode.ConfigurationTarget.Workspace
      );
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
