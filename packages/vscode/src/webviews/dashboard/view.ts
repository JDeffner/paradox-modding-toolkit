import * as vscode from "vscode";
import * as path from "path";
import { readModName } from "@px-lsp/protocol/modName";
import { allWorkspaceModCandidates, type PxConfig } from "../../config";
import { resolveWorkshopDir } from "../../steam/workshopFiles";
import { resolveConfigDir } from "@px-lsp/protocol/configDir";
import { metaFor } from "../../meta";
import type { FocusMod } from "../../views";
import type { ErrorLogWatcher } from "../../errorLog";
import uiCss from "../shared/ui.css";
import { icon, ICON_NAMES, PATHS, type IconName } from "../shared/icons";
import { actionGroups, visibleActionGroups, type ActionGroup } from "./actions";
import { makeNonce } from "../nonce";
import { tipScript } from "../shared/tips";

export const DASHBOARD_SECTIONS = {
  "px.tools": "Project",
  "px.utils": "Utils",
  "px.test": "Test & Troubleshoot",
  "px.paths": "Paths",
} as const;
export const PROJECT_GROUPS: readonly string[] = ["View", "Create", "Publish", "Info"];
const EDITOR_CHOICES = {
  completionMode: {
    label: "Suggestion verbosity",
    section: "completion.mode",
    tip: "Choose what accepting a script keyword suggestion inserts.",
    items: [
      { label: "Names only", value: "names", detail: "Insert only the keyword name." },
      {
        label: "Minimal fields",
        value: "minimal",
        detail: "Insert documented fields with blank values and Tab stops. Omit optional fields.",
      },
      {
        label: "Full examples",
        value: "examples",
        detail: "Insert documented examples and call parameters.",
      },
    ],
  },
  hoverDetail: {
    label: "Hover detail",
    section: "hover.detail",
    tip: "Choose how much information appears when you hover over script.",
    items: [
      { label: "Compact", value: "compact", detail: "Show the heading, key facts and source." },
      { label: "Standard", value: "standard", detail: "Include short documentation and example previews." },
      { label: "Full", value: "full", detail: "Show longer examples, all meanings and the scope chain." },
    ],
  },
} as const;
type EditorChoice = keyof typeof EDITOR_CHOICES;

export type DashboardSection = keyof typeof DASHBOARD_SECTIONS;

/** Messages the webview sends to the host. */
type InboundMessage =
  | { type: "ready" }
  | { type: "help" }
  | { type: "run"; command: string }
  | { type: "focus"; root: string | null }
  | { type: "exclude"; root: string; excluded: boolean }
  | { type: "setting"; key: "diagnosticsVanilla" | "scopeInlayHints"; value: boolean }
  | { type: "pickSetting"; key: EditorChoice }
  | { type: "watcher" }
  | { type: "baseline" }
  | { type: "openSettings" }
  | { type: "pickPath"; setting: string };

/** Messages the host sends to the webview. */
type OutboundMessage = { type: "state"; state: DashboardState };

interface ModState {
  root: string;
  name: string;
  excluded: boolean;
  /** Excluded entry whose folder no longer exists in the workspace. */
  missing: boolean;
}

/** One row of the Paths section: an effective folder/binary the extension uses. */
interface PathRow {
  label: string;
  /** The effective value, or null when nothing is configured or detected. */
  value: string | null;
  /** Where the value came from, shown as a badge ("set", "detected", ...). */
  source: string;
  /** The px.* setting the row opens. */
  setting: string;
}

interface DashboardState {
  /** Active game (full name) and whether it came from auto-detection. */
  gameName: string;
  gameAuto: boolean;
  focusLabel: string;
  paths: PathRow[];
  mods: ModState[];
  /** Raw pin, or null = follow the active editor. */
  pinnedRoot: string | null;
  /** The mod the sidebar views currently show. */
  focusRoot: string | null;
  /** False for games without a tiger (EU5): the baseline toggle hides. */
  hasTiger: boolean;
  tigerBaseline: boolean;
  watcherOn: boolean;
  watcherAvailable: boolean;
  diagnosticsVanilla: boolean;
  scopeInlayHints: boolean;
  completionMode: PxConfig["completionMode"];
  hoverDetail: PxConfig["hoverDetail"];
  /** Game-aware launcher groups (per-game labels). */
  actions: ActionGroup[];
}

export interface DashboardDeps {
  getCfg: () => PxConfig;
  focus: FocusMod;
  errorLog: ErrorLogWatcher;
  workspaceState: vscode.Memento;
}

/**
 * `px.tools` as a sidebar webview ("Project"): what the workspace looks like
 * and what the extension is doing — per-mod focus/index toggles, the on/off
 * switches that used to hide in settings and commands, and the tool launchers
 * of the old Tools tree. The host is the single source of truth; the webview
 * renders the last pushed state, so being disposed while hidden costs nothing.
 */
class DashboardViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly deps: DashboardDeps,
    private readonly section: DashboardSection
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = buildHtml(this.section);
    view.webview.onDidReceiveMessage((msg: InboundMessage) => void this.onMessage(msg));
    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined;
    });
    view.onDidChangeVisibility(() => {
      if (view.visible) this.refresh();
    });
  }

  refresh(): void {
    if (!this.view?.visible) return;
    const state = this.collectState();
    if (this.section === "px.tools") this.view.description = state.focusLabel;
    const msg: OutboundMessage = { type: "state", state };
    void this.view.webview.postMessage(msg);
  }

  private collectState(): DashboardState {
    const cfg = this.deps.getCfg();
    const meta = metaFor(cfg.gameId);
    const excluded = new Set(cfg.excludedMods.map(normKey));
    const candidates = allWorkspaceModCandidates();
    const known = new Set(candidates.map(normKey));
    const mods: ModState[] = candidates.map((root) => ({
      root,
      name: readModName(root),
      excluded: excluded.has(normKey(root)),
      missing: false,
    }));
    // Stale exclusions (folder gone) stay visible so they can be switched back.
    for (const p of cfg.excludedMods) {
      if (!known.has(normKey(p))) {
        mods.push({
          root: p,
          name: readModName(p),
          excluded: true,
          missing: true,
        });
      }
    }
    const focusRoot = this.deps.focus.current();
    const pinned = this.deps.focus.pinnedRoot();
    const focusLabel = focusRoot
      ? `${pinned && normKey(pinned) === normKey(focusRoot) ? "Pin" : "Follow"}: ${readModName(focusRoot)}`
      : "No mod selected";
    const actions = visibleActionGroups(meta, this.deps.errorLog.problemCount, hiddenRows());
    return {
      focusLabel,
      gameName: meta.name,
      gameAuto: (vscode.workspace.getConfiguration("px").get<string>("gameId") ?? "auto") === "auto",
      paths: collectPaths(cfg, meta.tiger !== undefined),
      mods,
      pinnedRoot: this.deps.focus.pinnedRoot(),
      focusRoot: this.deps.focus.current(),
      hasTiger: meta.tiger !== undefined,
      tigerBaseline: this.deps.workspaceState.get<boolean>("px.tigerBaselineEnabled") ?? false,
      watcherOn: this.deps.errorLog.watching,
      watcherAvailable: cfg.logsPath !== null,
      diagnosticsVanilla: cfg.diagnosticsVanilla,
      scopeInlayHints: cfg.scopeInlayHints,
      completionMode: cfg.completionMode,
      hoverDetail: cfg.hoverDetail,
      actions,
    };
  }

  private async onMessage(msg: InboundMessage): Promise<void> {
    switch (msg.type) {
      case "ready":
        this.refresh();
        return;
      case "help":
        await vscode.commands.executeCommand(
          "workbench.action.openWalkthrough",
          "JDeffner.px-toolkit#px.gettingStarted",
          false
        );
        return;
      case "run": {
        const allowed = actionGroups(
          metaFor(this.deps.getCfg().gameId),
          this.deps.errorLog.problemCount
        ).flatMap((group) => group.items.map((item) => item.command));
        if (![...allowed, "px.createDescriptor", "px.addModToWorkspace"].includes(msg.command)) return;
        await runDashboardAction(msg.command, this.deps);
        this.refresh();
        return;
      }
      case "focus":
        await this.deps.focus.pin(msg.root);
        return; // onDidPin refreshes
      case "exclude": {
        const key = normKey(msg.root);
        const next = this.deps.getCfg().excludedMods.filter((p) => normKey(p) !== key);
        if (msg.excluded) next.push(msg.root);
        await vscode.workspace
          .getConfiguration("px")
          .update("excludedMods", next, vscode.ConfigurationTarget.Workspace);
        this.refresh();
        return;
      }
      case "setting": {
        const sections = {
          diagnosticsVanilla: "diagnostics.vanilla",
          scopeInlayHints: "scopeInlayHints",
        } as const;
        if (!Object.hasOwn(sections, msg.key) || typeof msg.value !== "boolean") return;
        await this.saveSetting(sections[msg.key], msg.value);
        return;
      }
      case "pickSetting": {
        if (!Object.hasOwn(EDITOR_CHOICES, msg.key)) return;
        const setting = EDITOR_CHOICES[msg.key];
        const current = this.deps.getCfg()[msg.key];
        const items = setting.items.map((item) => ({
          ...item,
          description: item.value === current ? "Current" : undefined,
        }));
        const picked = await vscode.window.showQuickPick(items, {
          title: setting.label,
          placeHolder: setting.tip,
        });
        if (picked) await this.saveSetting(setting.section, picked.value);
        return;
      }
      case "watcher":
        this.deps.errorLog.toggle();
        this.refresh();
        return;
      case "openSettings":
        // The same Workspace-scoped @ext view the overflow menu opens.
        await vscode.commands.executeCommand("px.openSettings");
        return;
      case "pickPath": {
        // The key comes from webview script; resolve it host-side against the
        // effective rows, never trust it as a path.
        const cfg = this.deps.getCfg();
        const row = collectPaths(cfg, metaFor(cfg.gameId).tiger !== undefined).find(
          (p) => p.setting === msg.setting
        );
        if (!row) return;
        const isFile = msg.setting === "px.tigerPath";
        const picked = await vscode.window.showOpenDialog({
          canSelectFiles: isFile,
          canSelectFolders: !isFile,
          canSelectMany: false,
          defaultUri: row.value ? vscode.Uri.file(row.value) : undefined,
          openLabel: isFile ? "Use this binary" : "Use this folder",
          title: `${row.label} (${msg.setting})`,
        });
        const value = picked?.[0]?.fsPath;
        if (!value) return;
        await updateSetting(msg.setting.replace(/^px\./, ""), value);
        this.refresh();
        return;
      }
      case "baseline":
        await vscode.commands.executeCommand("px.tigerToggleBaseline");
        this.refresh();
        return;
    }
  }

  private async saveSetting(section: string, value: unknown): Promise<void> {
    try {
      await updateSetting(section, value);
    } catch (error) {
      void vscode.window.showErrorMessage(`Could not save px.${section}: ${String(error)}`);
    }
    this.refresh();
  }
}

/**
 * The Paths rows: what the extension is ACTUALLY using, with its origin. The
 * settings UI cannot show auto-detected values (an empty setting just looks
 * empty), so this is where "which game/logs/mod folder am I on?" gets its
 * answer. "set" = the px.* setting; "detected" = auto-detection (Steam,
 * Documents, the workspace); "downloaded" = the tiger copy we manage.
 */
function collectPaths(cfg: PxConfig, hasTiger: boolean): PathRow[] {
  const raw = vscode.workspace.getConfiguration("px");
  const isSet = (key: string) => (raw.get<string>(key) ?? "").trim() !== "";
  const row = (label: string, setting: string, value: string | null, detectedAs = "detected"): PathRow => ({
    label,
    setting,
    value,
    source: value === null ? "not found" : isSet(setting.replace(/^px\./, "")) ? "set" : detectedAs,
  });
  const projectsDir = (raw.get<string>("modProjectsDir") ?? "").trim() || null;
  // The Workshop listing folder is per mod (px.workshop.dir resolves against
  // the mod root), so without a mod there is no value.
  const workshopDir = cfg.modPath
    ? resolveWorkshopDir(
        cfg.modPath,
        raw.get<string>("workshop.dir"),
        resolveConfigDir(cfg.modPath, metaFor(cfg.gameId))
      )
    : null;
  const rows = [
    row("Game", "px.gamePath", cfg.gamePath),
    row("script_docs logs", "px.logsPath", cfg.logsPath),
    row("Configured mod", "px.modPath", cfg.modPath),
    {
      label: "Mod projects",
      setting: "px.modProjectsDir",
      value: projectsDir,
      source: projectsDir ? "set" : "not set",
    },
    {
      label: "Workshop listing",
      setting: "px.workshop.dir",
      value: workshopDir,
      source: workshopDir === null ? "not found" : isSet("workshop.dir") ? "set" : "default",
    },
  ];
  if (hasTiger) rows.push(row("Tiger", "px.tigerPath", cfg.tigerPath, "downloaded"));
  return rows;
}

/**
 * `px.sidebar.hidden`: the command ids the user removed from the panel's
 * tool sections. Read straight from the configuration (not from PxConfig): it is
 * panel taste, and nothing outside this view and the Customize command cares.
 */
export function hiddenRows(): string[] {
  const value = vscode.workspace.getConfiguration("px").get<unknown>("sidebar.hidden");
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Trailing-separator-free lowercase key for path comparisons (as in config.ts). */
function normKey(p: string): string {
  return path
    .normalize(p)
    .replace(/[\\/]+$/, "")
    .toLowerCase();
}

/**
 * Write a px.* setting where the user will find it again: the workspace when
 * a workspace override already exists (otherwise the toggle would look dead),
 * the user settings otherwise.
 */
async function updateSetting(section: string, value: unknown): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("px");
  const target =
    cfg.inspect(section)?.workspaceValue !== undefined
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
  await cfg.update(section, value, target);
}

/** Sidebar tasks use the visible mod as their explicit target. */
async function runDashboardAction(command: string, deps: DashboardDeps): Promise<void> {
  if (command === "px.convertBBCodeToMarkdown" || command === "px.convertMarkdownToBBCode") {
    const ext = command === "px.convertBBCodeToMarkdown" ? "bbcode" : "md";
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { Source: [ext] },
      title: "Select the file to convert",
    });
    if (picked?.[0]) await vscode.commands.executeCommand(command, picked[0]);
    return;
  }
  const root = deps.focus.current();
  const target =
    root && command === "px.showEventGraph"
      ? { modRoot: root }
      : root && command === "px.newContent"
        ? vscode.Uri.file(root)
        : undefined;
  await vscode.commands.executeCommand(command, target);
}

export function registerDashboardView(
  context: vscode.ExtensionContext,
  deps: DashboardDeps
): { refresh(): void } {
  const providers = (Object.keys(DASHBOARD_SECTIONS) as DashboardSection[]).map((id) => {
    const provider = new DashboardViewProvider(deps, id);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(id, provider));
    return provider;
  });
  const refresh = () => providers.forEach((provider) => provider.refresh());
  context.subscriptions.push(
    vscode.commands.registerCommand("px.allTools", async () => {
      const groups = actionGroups(metaFor(deps.getCfg().gameId), deps.errorLog.problemCount);
      const items = groups.flatMap((group) =>
        group.items.map((item) => ({
          label: item.label,
          description: group.label,
          detail: item.tip,
          command: item.command,
          iconPath: quickPickIcon(item.icon),
        }))
      );
      const picked = await vscode.window.showQuickPick(items, {
        title: "Paradox: All Tools",
        placeHolder: "Find a task",
        matchOnDescription: true,
        matchOnDetail: true,
      });
      if (picked) await runDashboardAction(picked.command, deps);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("px")) refresh();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(refresh),
    // Following the active editor can change the focus mod highlight.
    vscode.window.onDidChangeActiveTextEditor(refresh),
    deps.focus.onDidPin(refresh),
    deps.errorLog.onDidChangeState(refresh)
  );
  return { refresh };
}

// ---- html ------------------------------------------------------------------------------

/** Quick picks accept image URIs, so use the dashboard glyph without a Codicon translation. */
function quickPickIcon(name: IconName): { light: vscode.Uri; dark: vscode.Uri } {
  const uri = (color: string) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" color="${color}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${PATHS[name]}</svg>`;
    return vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
  };
  return { light: uri("#424242"), dark: uri("#c5c5c5") };
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * The static shell on top of px-ui: section frames, toggle rows and
 * containers; the mod list and the game-aware action groups are rendered by
 * script from the pushed state. The sidebar is narrow (200-350px), so
 * everything stacks: no toolbar, labels truncate, tooltips open to the left
 * of right-edge controls and below rows, left-aligned.
 */
export function buildHtml(section: DashboardSection): string {
  const nonce = makeNonce();
  const csp = [`default-src 'none'`, `style-src 'unsafe-inline'`, `script-src 'nonce-${nonce}'`].join("; ");

  // The whole row is the switch's label, so the text toggles too.
  const toggleRow = (id: string, label: string, tip: string): string =>
    `<label class="px-item toggle-row" data-toggle="${id}" data-tip="${escapeAttr(tip)}" data-tip-wrap>
      <span class="px-item-label">${label}</span>
      <span class="px-switch"><input type="checkbox" id="${id}" aria-label="${escapeAttr(label)}" /><span></span></span>
    </label>`;

  // Every icon, as markup, for the script that renders rows from state.
  const icons = Object.fromEntries(ICON_NAMES.map((n) => [n, icon(n)]));

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${DASHBOARD_SECTIONS[section]}</title>
<style>
${uiCss}
  body { min-height: 100%; user-select: none; overflow-x: hidden; }
  /* The top strip: the game row plus the ? that explains the whole panel. The
     button sits OUTSIDE the row, which is itself a click target. */
  #top { display: flex; align-items: center; gap: 2px; margin: 4px 4px 0; }
  #game { flex: 1 1 auto; min-width: 0; }
  #game .game-name { font-weight: 600; }
  .px-item[role="button"]:focus-visible, #game:focus-visible, .toggle-row:focus-within:has(input:focus-visible) {
    box-shadow: 0 0 0 3px var(--px-ring-soft);
  }
  .px-item .px-badge { flex: 0 0 auto; }
  .toggle-row { cursor: pointer; }
  .toggle-row:has(> .px-switch > input:disabled) { cursor: not-allowed; }
  .toggle-row:has(> .px-switch > input:disabled) > .px-switch { opacity: 0.5; }
  .toggle-row > .px-switch { flex: 0 0 auto; }
  .setting-choice, .settings-all { width: 100%; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
  .setting-choice { height: auto; padding-top: 5px; padding-bottom: 5px; }
  .setting-text { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 2px; }
  .setting-value { color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  /* Paths: two-line rows; the value truncates from the LEFT (the folder tail
     is the part that tells paths apart). */
  .path-row { flex-direction: column; align-items: stretch; gap: 1px; cursor: pointer; }
  .path-row .path-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .path-row .path-value {
    min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    direction: rtl; text-align: left;
    color: var(--px-muted-fg); font-size: var(--px-text-xs); font-family: var(--vscode-editor-font-family, monospace);
  }
  .path-row .path-value.none { direction: ltr; font-family: inherit; font-style: italic; }
  .mod-row.excluded .px-item-label, .mod-row.missing .px-item-label { color: var(--px-muted-fg); }
  .mod-row.missing .px-item-label { text-decoration: line-through; }
  #body-mods { max-height: calc(5 * var(--px-h-sm) + 8px); overflow-y: auto; }
  #body-mods > .px-item { flex: 0 0 var(--px-h-sm); }
  #troubleshoot-actions { display: flex; flex-direction: column; gap: 1px; }
  #troubleshoot-actions:empty { display: none; }
  .empty { padding: 4px 8px; color: var(--px-muted-fg); font-size: var(--px-text-sm); }
  .hidden { display: none; }
  .project-group { border-top: 1px solid var(--vscode-sideBarSectionHeader-border, var(--px-border)); }
  .project-group > summary { display: flex; align-items: center; gap: 4px; padding: 5px 8px; cursor: pointer; list-style: none; font-weight: 600; }
  .project-group > summary::-webkit-details-marker { display: none; }
  .project-group > summary > svg { width: 14px; height: 14px; flex-shrink: 0; transform: rotate(-90deg); }
  .project-group[open] > summary > svg { transform: none; }
  .mod-actions { display: flex; margin-left: auto; gap: 2px; }
  .project-group > summary:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  /* shadcn RadioGroupItem: the focus pin, one per mod plus "follow". */
  .radio {
    flex: 0 0 auto; width: 14px; height: 14px; padding: 0; position: relative;
    border: 1px solid var(--px-ring); border-radius: 999px; background: transparent; cursor: pointer;
    transition: border-color var(--px-ease), box-shadow var(--px-ease);
  }
  .radio[aria-checked="true"] { border-color: var(--px-primary); }
  .radio-dot { position: absolute; inset: 3px; border-radius: 999px; background: var(--px-primary); visibility: hidden; }
  .radio[aria-checked="true"] > .radio-dot { visibility: visible; }
  .radio:focus-visible { box-shadow: 0 0 0 3px var(--px-ring-soft); }
  /* The mod the views are on: its row is lit and its name is bold, so the pin
     reads from across the panel and not only from a 14px ring. */
  .px-item.focused { background: var(--px-muted); }
  .px-item.focused .px-item-label { font-weight: 600; color: var(--px-fg); }
</style>
</head>
<body>
${
  section === "px.tools"
    ? `<div id="top">
  <div class="px-item" id="game" role="button" tabindex="0" data-tip-wrap></div>
  <button id="help" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="How this panel works" data-tip-side="left" aria-label="How this panel works">${icon(
    "circleHelp"
  )}</button>
</div>
<div id="focus" class="empty"></div>
`
    : ""
}
${
  section === "px.tools"
    ? `<details class="project-group" id="section-mods" open>
  <summary>${icon("chevronDown")}Workspace Mods<span class="mod-actions">
    <button type="button" class="px-btn" data-variant="ghost" data-size="icon-sm" data-mod-command="px.createMod" aria-label="New Mod" data-tip="New Mod">${icon("plus")}</button>
    <button type="button" class="px-btn" data-variant="ghost" data-size="icon-sm" data-mod-command="px.addModToWorkspace" aria-label="Add Existing Mod to Workspace" data-tip="Add Existing Mod to Workspace">${icon("folderOpen")}</button>
  </span></summary>
  <div class="section-body px-list" id="body-mods"></div>
</details>
${PROJECT_GROUPS.map(
  (
    label
  ) => `<details class="project-group" id="group-${label.toLowerCase()}"${label === "View" || label === "Create" ? " open" : ""}>
  <summary>${icon("chevronDown")}${label}</summary>
  <div class="px-list" data-actions="${label}"></div>
</details>`
).join("")}
<details class="project-group" id="group-settings">
  <summary>${icon("chevronDown")}Settings</summary>
  <div class="px-list">
    ${toggleRow("inlay", "Scope inlay hints", "Show inferred target types beside scope-changing script blocks. Labels do not change the script.")}
    ${Object.entries(EDITOR_CHOICES)
      .map(
        ([
          key,
          setting,
        ]) => `<button type="button" class="px-item setting-choice" data-setting="${key}" aria-labelledby="${key}-label ${key}-value" data-tip="${escapeAttr(setting.tip)}" data-tip-wrap>
      <span class="setting-text"><span id="${key}-label">${setting.label}</span><span class="setting-value" id="${key}-value"></span></span>
      ${icon("chevronDown")}
    </button>`
      )
      .join("")}
    <button type="button" class="px-item settings-all" id="all-settings">${icon("settings")}<span class="px-item-label">All settings</span></button>
  </div>
</details>
`
    : ""
}
${
  section === "px.test"
    ? `<div class="section" id="section-test-troubleshoot">

  <div class="section-body px-list" id="body-test-troubleshoot">
    <div id="troubleshoot-actions"></div>
    ${toggleRow(
      "baseline",
      "Tiger: new problems only",
      "Report only tiger problems newer than the saved baseline."
    )}
    ${toggleRow(
      "watcher",
      "Watch game error.log",
      "Report new error.log entries of the running game as Problems."
    )}
    ${toggleRow("vanilla", "Diagnose vanilla files", "Also diagnose files under the game folder.")}
  </div>
</div>
`
    : ""
}
${
  section === "px.paths"
    ? `<div class="section" id="section-paths">

  <div class="section-body px-list" id="body-paths"></div>
</div>
`
    : ""
}
<div class="px-list" id="body-actions"></div>
${tipScript(nonce)}

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
// Compile-time constants from the host, safe as markup.
const ICONS = ${JSON.stringify(icons)};
const SECTION = ${JSON.stringify(section)};
const SECTION_LABEL = ${JSON.stringify(DASHBOARD_SECTIONS[section])};
const EDITOR_CHOICES = ${JSON.stringify(EDITOR_CHOICES)};
let state = null;
const saved = vscode.getState() ?? {};
for (const group of document.querySelectorAll(".project-group")) {
  if (typeof saved.groups?.[group.id] === "boolean") group.open = saved.groups[group.id];
  group.addEventListener("toggle", () => {
    saved.groups = Object.fromEntries([...document.querySelectorAll(".project-group")].map((item) => [item.id, item.open]));
    vscode.setState(saved);
  });
}

document.getElementById("help")?.addEventListener("click", () => vscode.postMessage({ type: "help" }));
document.getElementById("all-settings")?.addEventListener("click", () => vscode.postMessage({ type: "openSettings" }));
for (const button of document.querySelectorAll("[data-mod-command]")) {
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    vscode.postMessage({ type: "run", command: button.dataset.modCommand });
  });
}
for (const row of document.querySelectorAll("[data-setting]")) {
  row.addEventListener("click", () => vscode.postMessage({ type: "pickSetting", key: row.dataset.setting }));
}

function iconEl(name) {
  const t = document.createElement("template");
  t.innerHTML = ICONS[name] || "";
  return t.content.firstElementChild;
}
function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}
function badge(text, tip) {
  const b = el("span", "px-badge", text);
  b.setAttribute("data-variant", "outline");
  if (tip) { b.setAttribute("data-tip", tip); b.setAttribute("data-tip-wrap", ""); b.setAttribute("data-tip-side", "left"); }
  return b;
}
/** A px-item that runs something on click, Enter or Space. */
function actionRow(iconName, label, tip, run) {
  const row = el("div", "px-item");
  row.setAttribute("role", "button");
  row.tabIndex = 0;
  if (tip) { row.setAttribute("data-tip", tip); row.setAttribute("data-tip-wrap", ""); }
  row.appendChild(iconEl(iconName));
  row.appendChild(el("span", "px-item-label", label));
  row.addEventListener("click", run);
  row.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); run(); }
  });
  return row;
}

// ---- switches ----
const SWITCH_MSG = {
  vanilla: (on) => ({ type: "setting", key: "diagnosticsVanilla", value: on }),
  inlay: (on) => ({ type: "setting", key: "scopeInlayHints", value: on }),
  baseline: () => ({ type: "baseline" }),
  watcher: () => ({ type: "watcher" }),
};
for (const [id, make] of Object.entries(SWITCH_MSG)) {
  const input = document.getElementById(id);
  // Optimistic: the checkbox already moved; the pushed state reconciles.
  input?.addEventListener("change", () => vscode.postMessage(make(input.checked)));
}
function setSwitch(id, on, disabled, disabledTip) {
  const input = document.getElementById(id);
  if (!input) return;
  const row = input.closest(".toggle-row");
  input.checked = on;
  input.disabled = disabled;
  if (!row.hasAttribute("data-tip-default")) row.setAttribute("data-tip-default", row.getAttribute("data-tip"));
  row.setAttribute("data-tip", disabled && disabledTip ? disabledTip : row.getAttribute("data-tip-default"));
}

// Project groups share one scroll area; the detached views render one catalogue group.
function renderActionGroup(box, label) {
  box.textContent = "";
  const group = state.actions.find((group) => group.label === label);
  for (const it of group?.items ?? []) {
    const row = actionRow(it.icon, it.label, it.tip,
      () => vscode.postMessage({ type: "run", command: it.command }));
    if (it.count !== undefined) row.appendChild(badge(String(it.count)));
    box.appendChild(row);
  }
}
function renderActions() {
  if (SECTION === "px.tools") {
    for (const box of document.querySelectorAll("[data-actions]")) {
      renderActionGroup(box, box.dataset.actions);
      box.parentElement.classList.toggle("hidden", !box.children.length);
    }
    return;
  }
  const box = document.getElementById(SECTION === "px.test" ? "troubleshoot-actions" : "body-actions");
  renderActionGroup(box, SECTION_LABEL);
}

// ---- paths (effective values, host-computed) ----
function renderPaths() {
  const box = document.getElementById("body-paths");
  box.textContent = "";
  for (const p of state.paths) {
    const row = el("div", "px-item path-row");
    row.setAttribute("role", "button");
    row.tabIndex = 0;
    row.setAttribute("data-tip", (p.value ? p.value + " " : "") + "(" + p.setting + ")");
    row.setAttribute("data-tip-wrap", "");
    const head = el("div", "path-head");
    head.appendChild(el("span", "px-item-label", p.label));
    head.appendChild(el("span", "px-grow"));
    head.appendChild(badge(p.source));
    row.appendChild(head);
    // RTL truncation flips leading punctuation; the value is plain text either way.
    row.appendChild(el("div", "path-value" + (p.value ? "" : " none"), p.value ?? "none"));
    const open = () => vscode.postMessage({ type: "pickPath", setting: p.setting });
    row.addEventListener("click", open);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });
    box.appendChild(row);
  }
}

// ---- game header ----
const gameRow = document.getElementById("game");
gameRow?.setAttribute("data-tip", "The game this workspace mods. Click to change it.");
const openGameSettings = () => vscode.postMessage({ type: "openSettings" });
gameRow?.addEventListener("click", openGameSettings);
gameRow?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openGameSettings(); }
});
function renderGame() {
  gameRow.textContent = "";
  gameRow.appendChild(el("span", "px-item-label game-name", state.gameName));
  gameRow.appendChild(badge(state.gameAuto ? "auto-detected" : "set manually"));
}

// ---- mods ----
function radio(on, tipText, onClick) {
  const b = el("button", "radio");
  b.setAttribute("role", "radio");
  b.setAttribute("aria-label", tipText);
  b.setAttribute("aria-checked", String(on));
  b.setAttribute("data-tip", tipText);
  b.setAttribute("data-tip-wrap", "");
  b.appendChild(el("span", "radio-dot"));
  b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
  return b;
}
function renderMods() {
  const box = document.getElementById("body-mods");
  const focusedId = box.contains(document.activeElement) ? document.activeElement.id : null;
  const scrollTop = box.scrollTop;
  box.textContent = "";
  if (!state.mods.length) {
    box.appendChild(el("div", "empty", "No mod found. Open a mod folder or create a new mod."));
    box.appendChild(actionRow("plus", "Create Mod Descriptor",
      "Create the file that marks this folder as a mod.",
      () => vscode.postMessage({ type: "run", command: "px.createDescriptor" })));
    return;
  }
  const following = state.pinnedRoot === null;
  const included = state.mods.filter((m) => !m.excluded);
  const showFocusUi = included.length > 1;

  if (showFocusUi) {
    const row = el("div", "px-item follow-row" + (following ? " focused" : ""));
    const followRadio = radio(following,
      "Let the sidebar views follow the file you are editing.",
      () => vscode.postMessage({ type: "focus", root: null }));
    followRadio.id = "mod-follow";
    row.appendChild(followRadio);
    row.appendChild(el("span", "px-item-label", "Follow active editor"));
    row.addEventListener("click", () => vscode.postMessage({ type: "focus", root: null }));
    box.appendChild(row);
  }

  for (const mod of state.mods) {
    const row = el("div", "px-item mod-row" + (mod.excluded ? " excluded" : "") + (mod.missing ? " missing" : ""));
    if (showFocusUi && !mod.excluded) {
      if (state.pinnedRoot === mod.root || (following && state.focusRoot === mod.root)) row.classList.add("focused");
      const pinRadio = radio(state.pinnedRoot === mod.root,
        "Pin the sidebar views to this mod.",
        () => vscode.postMessage({ type: "focus", root: mod.root }));
      pinRadio.id = "mod-pin-" + mod.root;
      row.appendChild(pinRadio);
      row.addEventListener("click", () => vscode.postMessage({ type: "focus", root: mod.root }));
    } else {
      row.style.cursor = "default";
    }
    const label = el("span", "px-item-label", mod.name);
    label.setAttribute("data-tip", mod.root);
    label.setAttribute("data-tip-wrap", "");
    row.appendChild(label);

    if (mod.missing) {
      row.appendChild(badge("missing", "The folder is gone. Switch on to forget it."));
    } else if (!mod.excluded && following && state.focusRoot === mod.root && showFocusUi) {
      row.appendChild(badge("showing", "The sidebar views show this mod."));
    } else if (!mod.excluded && state.pinnedRoot === mod.root && showFocusUi) {
      row.appendChild(badge("pinned", "The sidebar views are pinned to this mod."));
    }

    const sw = el("label", "px-switch");
    sw.setAttribute("data-tip",
      mod.excluded ? "Not indexed. Switch on to index this mod." : "Indexed. Switch off to skip this mod.");
    sw.setAttribute("data-tip-wrap", "");
    sw.setAttribute("data-tip-side", "left");
    const input = el("input");
    input.type = "checkbox";
    input.id = "mod-index-" + mod.root;
    input.checked = !mod.excluded;
    input.setAttribute("aria-label", "Index " + mod.name);
    input?.addEventListener("change", () =>
      vscode.postMessage({ type: "exclude", root: mod.root, excluded: !mod.excluded }));
    sw.addEventListener("click", (e) => e.stopPropagation());
    sw.appendChild(input);
    sw.appendChild(el("span"));
    row.appendChild(sw);
    box.appendChild(row);
  }
  box.scrollTop = scrollTop;
  if (focusedId) document.getElementById(focusedId)?.focus({ preventScroll: true });
}

function render() {
  if (SECTION === "px.tools") {
    document.getElementById("focus").textContent = state.focusLabel;
    renderGame();
  }
  if (SECTION === "px.paths") renderPaths();
  if (SECTION === "px.tools") renderMods();
  renderActions();
  if (SECTION === "px.test") {
    document.querySelector('[data-toggle="baseline"]').classList.toggle("hidden", !state.hasTiger);
    setSwitch("baseline", state.tigerBaseline, false);
    setSwitch("watcher", state.watcherOn, !state.watcherAvailable, "Game logs folder not found (set px.logsPath).");
    setSwitch("vanilla", state.diagnosticsVanilla, false);
  }
  if (SECTION === "px.tools") {
    setSwitch("inlay", state.scopeInlayHints, false);
    for (const [key, setting] of Object.entries(EDITOR_CHOICES)) {
      const selected = setting.items.find((item) => item.value === state[key]);
      document.getElementById(key + "-value").textContent = selected?.label ?? state[key];
    }
  }
}

window.addEventListener("message", (ev) => {
  const msg = ev.data;
  if (msg && msg.type === "state") { state = msg.state; render(); }
});
vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`;
}
