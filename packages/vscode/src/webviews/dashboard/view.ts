import * as vscode from "vscode";
import * as path from "path";
import { readModName } from "@px-lsp/protocol/modName";
import { allWorkspaceModCandidates, type PxConfig } from "../../config";
import { metaFor } from "../../meta";
import type { FocusMod } from "../../views";
import type { ErrorLogWatcher } from "../../errorLog";
import uiCss from "../shared/ui.css";
import { icon, ICON_NAMES } from "../shared/icons";
import { visibleActionGroups, type ActionGroup } from "./actions";
import { makeNonce } from "../nonce";

/** The three collapsible sections, in render order. */
type SectionId = "mods" | "toggles" | "tools";

/** workspaceState key holding the per-section collapse flags (absent = expanded). */
const COLLAPSED_KEY = "px.dashboardCollapsed";

/** Messages the webview sends to the host. */
type InboundMessage =
  | { type: "ready" }
  | { type: "run"; command: string }
  | { type: "focus"; root: string | null }
  | { type: "exclude"; root: string; excluded: boolean }
  | { type: "setting"; key: "diagnosticsVanilla" | "scopeInlayHints"; value: boolean }
  | { type: "watcher" }
  | { type: "baseline" }
  | { type: "gameSettings" }
  | { type: "collapse"; section: SectionId; collapsed: boolean };

/** Messages the host sends to the webview. */
type OutboundMessage = { type: "state"; state: DashboardState };

interface ModState {
  root: string;
  name: string;
  excluded: boolean;
  /** Excluded entry whose folder no longer exists in the workspace. */
  missing: boolean;
}

interface DashboardState {
  /** Active game (full name) and whether it came from auto-detection. */
  gameName: string;
  gameAuto: boolean;
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
  /** Game-aware launcher groups (per-game labels). */
  actions: ActionGroup[];
  /** Persisted per-section collapse flags; every section defaults to expanded. */
  collapsed: Record<SectionId, boolean>;
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

  constructor(private readonly deps: DashboardDeps) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = buildHtml();
    view.webview.onDidReceiveMessage((msg: InboundMessage) => void this.onMessage(msg));
    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined;
    });
    view.onDidChangeVisibility(() => {
      if (view.visible) this.refresh();
    });
  }

  refresh(): void {
    if (!this.view) return;
    const msg: OutboundMessage = { type: "state", state: this.collectState() };
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
    return {
      gameName: meta.name,
      gameAuto: (vscode.workspace.getConfiguration("px").get<string>("gameId") ?? "auto") === "auto",
      mods,
      pinnedRoot: this.deps.focus.pinnedRoot(),
      focusRoot: this.deps.focus.current(),
      hasTiger: meta.tiger !== undefined,
      tigerBaseline: this.deps.workspaceState.get<boolean>("px.tigerBaselineEnabled") ?? false,
      watcherOn: this.deps.errorLog.watching,
      watcherAvailable: cfg.logsPath !== null,
      diagnosticsVanilla: cfg.diagnosticsVanilla,
      scopeInlayHints: cfg.scopeInlayHints,
      actions: visibleActionGroups(meta, this.deps.errorLog.problemCount, hiddenRows()),
      collapsed: this.collapsedState(),
    };
  }

  private collapsedState(): Record<SectionId, boolean> {
    const stored = this.deps.workspaceState.get<Partial<Record<SectionId, boolean>>>(COLLAPSED_KEY);
    return {
      mods: stored?.mods === true,
      toggles: stored?.toggles === true,
      tools: stored?.tools === true,
    };
  }

  private async onMessage(msg: InboundMessage): Promise<void> {
    switch (msg.type) {
      case "ready":
        this.refresh();
        return;
      case "run":
        await vscode.commands.executeCommand(msg.command);
        this.refresh();
        return;
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
        await updateSetting(sections[msg.key], msg.value);
        this.refresh();
        return;
      }
      case "watcher":
        this.deps.errorLog.toggle();
        this.refresh();
        return;
      case "gameSettings":
        await vscode.commands.executeCommand("workbench.action.openSettings", "px.gameId");
        return;
      case "baseline":
        await vscode.commands.executeCommand("px.tigerToggleBaseline");
        this.refresh();
        return;
      case "collapse":
        // The webview already moved; persist only, no state push back.
        await this.deps.workspaceState.update(COLLAPSED_KEY, {
          ...this.collapsedState(),
          [msg.section]: msg.collapsed,
        });
        return;
    }
  }
}

/**
 * `px.sidebar.hidden`: the command ids the user removed from the Tools
 * section. Read straight from the configuration (not from PxConfig): it is
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

export function registerDashboardView(
  context: vscode.ExtensionContext,
  deps: DashboardDeps
): { refresh(): void } {
  const provider = new DashboardViewProvider(deps);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("px.tools", provider),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("px")) provider.refresh();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.refresh()),
    // Following the active editor can change the focus mod highlight.
    vscode.window.onDidChangeActiveTextEditor(() => provider.refresh()),
    deps.focus.onDidPin(() => provider.refresh()),
    deps.errorLog.onDidChangeState(() => provider.refresh())
  );
  return { refresh: () => provider.refresh() };
}

// ---- html ------------------------------------------------------------------------------

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** The ⓘ beside a section title: an icon button whose tooltip is the explanation. */
function hintButton(tip: string): string {
  return `<button class="px-btn" data-variant="ghost" data-size="icon-xs" data-tip="${escapeAttr(
    tip
  )}" data-tip-wrap data-tip-side="left" aria-label="About this section">${icon("info")}</button>`;
}

/**
 * The static shell on top of px-ui: section frames, toggle rows and
 * containers; the mod list and the game-aware action groups are rendered by
 * script from the pushed state. The sidebar is narrow (200-350px), so
 * everything stacks: no toolbar, labels truncate, tooltips open to the left
 * of right-edge controls and below rows, left-aligned.
 */
function buildHtml(): string {
  const nonce = makeNonce();
  const csp = [`default-src 'none'`, `style-src 'unsafe-inline'`, `script-src 'nonce-${nonce}'`].join("; ");

  // The hint button sits beside the fold button, not inside it: a focusable
  // element nested in a button swallows its own hover/focus.
  const sectionHead = (id: SectionId, title: string, tip?: string): string =>
    `<div class="px-panel-title">
      <button class="section-toggle" data-section="${id}" aria-expanded="true" aria-controls="body-${id}">
        ${icon("chevronDown", "px-icon caret")}<span class="px-truncate">${title}</span>
      </button>
      <span class="px-grow"></span>
      ${tip ? hintButton(tip) : ""}
    </div>`;

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
<title>Paradox Project</title>
<style>
${uiCss}
  body { min-height: 100%; user-select: none; }
  #game { margin: 4px 4px 0; }
  #game .game-name { font-weight: 600; }
  .section + .section { border-top: 1px solid var(--px-border); }
  .section-toggle {
    display: flex; align-items: center; gap: 2px; min-width: 0;
    margin: 0 0 0 -6px; padding: 0 6px; height: 24px; border: 1px solid transparent;
    border-radius: var(--px-radius-md); background: none; cursor: pointer;
    font: inherit; font-size: inherit; font-weight: inherit; letter-spacing: inherit;
    text-transform: inherit; color: inherit;
    transition: background-color var(--px-ease), box-shadow var(--px-ease);
  }
  .section-toggle:hover { background: var(--px-muted); }
  .section-toggle:focus-visible { border-color: var(--px-ring); box-shadow: 0 0 0 3px var(--px-ring-soft); }
  .section-toggle .caret { width: 14px; height: 14px; transition: transform var(--px-ease); }
  .section.collapsed .caret { transform: rotate(-90deg); }
  .section.collapsed .section-body { display: none; }
  .section-body { padding-top: 0; }
  .group-label {
    margin: 6px 8px 1px; font-size: var(--px-text-xs); font-weight: 500; color: var(--px-muted-fg);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .group + .group { margin-top: 2px; }
  .px-item[role="button"]:focus-visible, #game:focus-visible, .toggle-row:focus-within:has(input:focus-visible) {
    box-shadow: 0 0 0 3px var(--px-ring-soft);
  }
  .px-item .px-badge { flex: 0 0 auto; }
  .toggle-row { cursor: pointer; }
  .toggle-row:has(> .px-switch > input:disabled) { cursor: not-allowed; }
  .toggle-row:has(> .px-switch > input:disabled) > .px-switch { opacity: 0.5; }
  .toggle-row > .px-switch { flex: 0 0 auto; }
  /* Tooltips open below, flush left: a centered one overflows a narrow sidebar. */
  [data-tip]:not([data-tip-side])::after { left: 0; transform: none; }
  .mod-row.excluded .px-item-label, .mod-row.missing .px-item-label { color: var(--px-muted-fg); }
  .mod-row.missing .px-item-label { text-decoration: line-through; }
  .empty { padding: 4px 8px; color: var(--px-muted-fg); font-size: var(--px-text-sm); }
  .hidden { display: none; }
  /* shadcn RadioGroupItem: the focus pin, one per mod plus "follow". */
  .radio {
    flex: 0 0 auto; width: 14px; height: 14px; padding: 0; position: relative;
    border: 1px solid var(--px-ring); border-radius: 999px; background: transparent; cursor: pointer;
    transition: border-color var(--px-ease), box-shadow var(--px-ease);
  }
  .radio[aria-checked="true"] { border-color: var(--px-primary); }
  .radio[aria-checked="true"]::after {
    content: ""; position: absolute; inset: 3px; border-radius: 999px; background: var(--px-primary);
  }
  .radio:focus-visible { box-shadow: 0 0 0 3px var(--px-ring-soft); }
</style>
</head>
<body>
<div class="px-item" id="game" role="button" tabindex="0" data-tip-wrap></div>
<div class="section" id="section-mods">
  ${sectionHead(
    "mods",
    "Workspace Mods",
    "Every mod detected in this workspace. Indexed mods are treated as yours: completion, navigation, diagnostics and the localization tools work across all of them. The filled dot marks the mod the sidebar views describe."
  )}
  <div class="section-body px-list" id="body-mods"></div>
</div>
<div class="section" id="section-toggles">
  ${sectionHead("toggles", "Toggles")}
  <div class="section-body px-list" id="body-toggles">
    ${toggleRow(
      "baseline",
      "Tiger: new problems only",
      "Hide every problem recorded in the saved baseline, so tiger reports only what changed since. Create the snapshot via the 'Create Baseline' command."
    )}
    ${toggleRow(
      "watcher",
      "Watch game error.log",
      "Tail the game's error.log while it runs and surface new entries as Problems on your mod files. Launch the game in debug mode for live script reloads."
    )}
    ${toggleRow(
      "vanilla",
      "Diagnose vanilla files",
      "Also diagnose files under the game folder. Off: only your mod files are checked."
    )}
    ${toggleRow(
      "inlay",
      "Scope inlay hints",
      "Show the inferred scope (e.g. character) after scope-changing block openers like every_vassal = {. Best-effort inference, display only."
    )}
  </div>
</div>
<div class="section" id="section-tools">
  ${sectionHead(
    "tools",
    "Tools",
    "Every tool the extension offers, in one place. Editor tabs, view titles, the status bar and the keyboard chords stay as the fast path while you work. Rows you never use: hide them with 'Customize Project Panel Rows'."
  )}
  <div class="section-body" id="body-tools"></div>
</div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
// Compile-time constants from the host, safe as markup.
const ICONS = ${JSON.stringify(icons)};
let state = null;

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

// ---- collapsible sections (state persisted host-side in workspaceState) ----
function setCollapsed(id, collapsed) {
  const section = document.getElementById("section-" + id);
  if (!section) return;
  section.classList.toggle("collapsed", collapsed);
  section.querySelector(".section-toggle").setAttribute("aria-expanded", String(!collapsed));
}
for (const btn of document.querySelectorAll(".section-toggle")) {
  btn.addEventListener("click", () => {
    const id = btn.getAttribute("data-section");
    const collapsed = !document.getElementById("section-" + id).classList.contains("collapsed");
    setCollapsed(id, collapsed);
    vscode.postMessage({ type: "collapse", section: id, collapsed });
  });
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
  input.addEventListener("change", () => vscode.postMessage(make(input.checked)));
}
function setSwitch(id, on, disabled, disabledTip) {
  const input = document.getElementById(id);
  const row = input.closest(".toggle-row");
  input.checked = on;
  input.disabled = disabled;
  if (!row.hasAttribute("data-tip-default")) row.setAttribute("data-tip-default", row.getAttribute("data-tip"));
  row.setAttribute("data-tip", disabled && disabledTip ? disabledTip : row.getAttribute("data-tip-default"));
}

// ---- actions (game-aware, from state) ----
function renderActions() {
  const box = document.getElementById("body-tools");
  box.textContent = "";
  for (const group of state.actions) {
    const g = el("div", "group");
    g.appendChild(el("div", "group-label", group.label));
    const list = el("div", "px-list");
    for (const it of group.items) {
      const row = actionRow(it.icon, it.label, it.tip,
        () => vscode.postMessage({ type: "run", command: it.command }));
      if (it.count !== undefined) {
        const b = el("span", "px-badge", String(it.count));
        b.setAttribute("data-variant", "secondary");
        row.appendChild(b);
      }
      list.appendChild(row);
    }
    g.appendChild(list);
    box.appendChild(g);
  }
}

// ---- game header ----
const gameRow = document.getElementById("game");
gameRow.setAttribute("data-tip",
  "The game this workspace mods. Click to change it (px.gameId) if the detection guessed wrong.");
const openGameSettings = () => vscode.postMessage({ type: "gameSettings" });
gameRow.addEventListener("click", openGameSettings);
gameRow.addEventListener("keydown", (e) => {
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
  b.setAttribute("aria-checked", String(on));
  b.setAttribute("data-tip", tipText);
  b.setAttribute("data-tip-wrap", "");
  b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
  return b;
}
function renderMods() {
  const box = document.getElementById("body-mods");
  box.textContent = "";
  if (!state.mods.length) {
    box.appendChild(el("div", "empty", "No mod descriptor found in this workspace."));
    box.appendChild(actionRow("plus", "Create descriptor.mod",
      "Create the descriptor file that marks this folder as a mod, so the game (and this extension) can load it.",
      () => vscode.postMessage({ type: "run", command: "px.createDescriptor" })));
    return;
  }
  const following = state.pinnedRoot === null;
  const included = state.mods.filter((m) => !m.excluded);
  const showFocusUi = included.length > 1;

  if (showFocusUi) {
    const row = el("div", "px-item follow-row");
    row.appendChild(radio(following,
      "Let the sidebar views (Mod Overview, Localization Coverage, Overrides) follow whichever mod owns the file you are editing.",
      () => vscode.postMessage({ type: "focus", root: null })));
    row.appendChild(el("span", "px-item-label", "Follow active editor"));
    row.addEventListener("click", () => vscode.postMessage({ type: "focus", root: null }));
    box.appendChild(row);
  }

  for (const mod of state.mods) {
    const row = el("div", "px-item mod-row" + (mod.excluded ? " excluded" : "") + (mod.missing ? " missing" : ""));
    if (showFocusUi && !mod.excluded) {
      row.appendChild(radio(state.pinnedRoot === mod.root,
        "Pin the sidebar views to this mod.",
        () => vscode.postMessage({ type: "focus", root: mod.root })));
      row.addEventListener("click", () => vscode.postMessage({ type: "focus", root: mod.root }));
    } else {
      row.style.cursor = "default";
    }
    const label = el("span", "px-item-label", mod.name);
    label.setAttribute("data-tip", mod.root);
    label.setAttribute("data-tip-wrap", "");
    row.appendChild(label);

    if (mod.missing) {
      row.appendChild(badge("missing",
        "This excluded folder no longer exists in the workspace. Switch on to forget it."));
    } else if (!mod.excluded && following && state.focusRoot === mod.root && showFocusUi) {
      row.appendChild(badge("showing",
        "The sidebar views currently show this mod (following the active editor)."));
    }

    const sw = el("label", "px-switch");
    sw.setAttribute("data-tip",
      mod.excluded
        ? "Not indexed: no completion, navigation, diagnostics or views for this mod. Switch on to index it again."
        : "Indexed. Switch off to skip this mod entirely (no completion, navigation, diagnostics or views).");
    sw.setAttribute("data-tip-wrap", "");
    sw.setAttribute("data-tip-side", "left");
    const input = el("input");
    input.type = "checkbox";
    input.checked = !mod.excluded;
    input.setAttribute("aria-label", "Index " + mod.name);
    input.addEventListener("change", () =>
      vscode.postMessage({ type: "exclude", root: mod.root, excluded: !mod.excluded }));
    sw.addEventListener("click", (e) => e.stopPropagation());
    sw.appendChild(input);
    sw.appendChild(el("span"));
    row.appendChild(sw);
    box.appendChild(row);
  }
}

function render() {
  renderGame();
  renderMods();
  renderActions();
  for (const id of Object.keys(state.collapsed)) setCollapsed(id, state.collapsed[id]);
  document.querySelector('[data-toggle="baseline"]').classList.toggle("hidden", !state.hasTiger);
  setSwitch("baseline", state.tigerBaseline, false);
  setSwitch("watcher", state.watcherOn, !state.watcherAvailable,
    "Game logs folder not found (set px.logsPath).");
  setSwitch("vanilla", state.diagnosticsVanilla, false);
  setSwitch("inlay", state.scopeInlayHints, false);
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
