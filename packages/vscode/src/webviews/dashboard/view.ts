import * as vscode from "vscode";
import * as path from "path";
import { readModName } from "@px-lsp/protocol/modName";
import { allWorkspaceModCandidates, type PxConfig } from "../../config";
import { metaFor } from "../../meta";
import type { FocusMod } from "../../views";
import type { ErrorLogWatcher } from "../../errorLog";
import { ICONS, visibleActionGroups, type ActionGroup } from "./actions";
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

function icon(name: keyof typeof ICONS, cls = "icon"): string {
  return (
    `<svg class="${cls}" viewBox="0 0 16 16" fill="none" stroke="currentColor" ` +
    `stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    ICONS[name] +
    `</svg>`
  );
}

function infoIcon(tip: string): string {
  return `<span class="hint" tabindex="0" data-tip="${escapeAttr(tip)}">${icon("info", "icon-sm")}</span>`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * The static shell: section frames, toggle rows and containers; the mod list
 * and the game-aware action groups are rendered by script from the pushed
 * state.
 */
function buildHtml(): string {
  const nonce = makeNonce();
  const csp = [`default-src 'none'`, `style-src 'unsafe-inline'`, `script-src 'nonce-${nonce}'`].join("; ");

  // The hint icon sits beside the collapse button, not inside it: a focusable
  // element nested in a button swallows its own hover/focus.
  const sectionHead = (id: SectionId, title: string, tip?: string): string =>
    `<div class="section-head">
      <button class="section-toggle" data-section="${id}" aria-expanded="true" aria-controls="body-${id}">
        ${icon("chevron", "chevron")}<span class="section-title">${title}</span>
      </button>
      ${tip ? infoIcon(tip) : ""}
    </div>`;

  const toggleRow = (id: string, label: string, tip: string): string =>
    `<div class="row toggle-row" data-toggle="${id}">
      <span class="label">${label}</span>
      ${infoIcon(tip)}
      <button class="switch" id="${id}" role="switch" aria-checked="false" aria-label="${escapeAttr(
        label
      )}"><span class="knob"></span></button>
    </div>`;

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Paradox Project</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0; min-height: 100%;
    font-family: var(--vscode-font-family, sans-serif);
    font-size: var(--vscode-font-size, 13px);
    /* Editor colors, not sidebar ones: the view should read like the other
       tabs, and the vars retheme themselves when the color theme changes. */
    color: var(--vscode-editor-foreground, var(--vscode-foreground));
    background: var(--vscode-editor-background);
    -webkit-user-select: none; user-select: none;
  }
  .section { padding: 0 8px 8px; }
  .section.collapsed { padding-bottom: 2px; }
  .section + .section { border-top: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,0.2)); }
  .section-head { display: flex; align-items: center; gap: 5px; margin: 8px 4px 4px; }
  .section-toggle {
    display: flex; align-items: center; gap: 3px; flex: 0 1 auto;
    margin: 0; padding: 0; border: none; background: none; cursor: pointer;
    font-family: inherit; font-size: 11px; font-weight: 600;
    letter-spacing: .05em; text-transform: uppercase;
    color: var(--vscode-descriptionForeground);
  }
  .section-toggle:hover { color: var(--vscode-foreground); }
  .section-toggle:focus-visible {
    outline: 1px solid var(--vscode-focusBorder, #007fd4); outline-offset: 2px; border-radius: 3px;
  }
  .chevron {
    width: 14px; height: 14px; flex: 0 0 auto; margin-left: -3px;
    transform: rotate(90deg); transition: transform .12s ease;
  }
  .section.collapsed .chevron { transform: rotate(0deg); }
  .section.collapsed .section-body { display: none; }
  .row {
    display: flex; align-items: center; gap: 7px;
    min-height: 24px; padding: 2px 6px; border-radius: 4px;
  }
  .row .label { flex: 1 1 auto; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .row.action { cursor: pointer; }
  .row.action:hover, .mod-row:hover, .follow-row:hover {
    background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.12));
  }
  .row.action:focus-visible, .switch:focus-visible, .hint:focus-visible, .dot:focus-visible {
    outline: 1px solid var(--vscode-focusBorder, #007fd4); outline-offset: 1px;
  }
  .icon { width: 16px; height: 16px; flex: 0 0 auto; opacity: .85; }
  .icon-sm { width: 12px; height: 12px; display: block; }
  .hint {
    display: inline-flex; flex: 0 0 auto; border-radius: 50%; cursor: default;
    color: var(--vscode-descriptionForeground); opacity: .8;
  }
  .hint:hover { opacity: 1; }
  .group { margin-top: 2px; }
  .group-label {
    margin: 6px 6px 1px; font-size: 10px; font-weight: 600;
    letter-spacing: .06em; text-transform: uppercase;
    color: var(--vscode-descriptionForeground); opacity: .8;
  }

  /* switches */
  .switch {
    position: relative; flex: 0 0 auto; width: 30px; height: 16px;
    padding: 0; border: none; border-radius: 8px; cursor: pointer;
    background: var(--vscode-checkbox-border, rgba(128,128,128,0.45));
    transition: background .12s ease;
  }
  .switch .knob {
    position: absolute; top: 2px; left: 2px; width: 12px; height: 12px;
    border-radius: 50%; background: var(--vscode-editor-background, #fff);
    box-shadow: 0 1px 2px rgba(0,0,0,.35);
    transition: transform .12s ease;
  }
  .switch[aria-checked="true"] { background: var(--vscode-button-background, #0e639c); }
  .switch[aria-checked="true"] .knob { transform: translateX(14px); }
  .switch[disabled] { opacity: .4; cursor: default; }

  /* mods */
  .mod-row, .follow-row { cursor: pointer; }
  .dot {
    flex: 0 0 auto; width: 13px; height: 13px; border-radius: 50%;
    border: 1px solid var(--vscode-descriptionForeground);
    background: transparent; padding: 0; cursor: pointer; position: relative;
  }
  .dot.on { border-color: var(--vscode-button-background, #0e639c); }
  .dot.on::after {
    content: ""; position: absolute; inset: 2px; border-radius: 50%;
    background: var(--vscode-button-background, #0e639c);
  }
  .badge {
    flex: 0 0 auto; padding: 0 6px; border-radius: 8px; font-size: 10px; line-height: 15px;
    color: var(--vscode-badge-foreground, #fff);
    background: var(--vscode-badge-background, rgba(128,128,128,0.5));
  }
  .badge.subtle {
    color: var(--vscode-descriptionForeground); background: transparent;
    border: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(128,128,128,0.35));
  }
  .mod-row.excluded .label { opacity: .5; }
  .mod-row.missing .label { opacity: .5; text-decoration: line-through; }
  .empty { padding: 4px 6px; color: var(--vscode-descriptionForeground); }
  .hidden { display: none; }

  /* game header */
  .game-row {
    display: flex; align-items: center; gap: 6px;
    margin: 6px 8px 0; padding: 2px 10px; cursor: pointer; border-radius: 4px;
  }
  .game-row:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.12)); }
  .game-row .game-name { font-weight: 600; }
  .game-row:focus-visible {
    outline: 1px solid var(--vscode-focusBorder, #007fd4); outline-offset: 1px;
  }

  /* tooltip */
  #tip {
    position: fixed; z-index: 10; max-width: 260px; padding: 5px 8px;
    font-size: 12px; line-height: 1.45; border-radius: 4px; pointer-events: none;
    color: var(--vscode-editorHoverWidget-foreground, var(--vscode-foreground));
    background: var(--vscode-editorHoverWidget-background, #252526);
    border: 1px solid var(--vscode-editorHoverWidget-border, rgba(128,128,128,0.4));
    box-shadow: 0 2px 8px rgba(0,0,0,.3);
    opacity: 0; transition: opacity .1s ease;
  }
  #tip.show { opacity: 1; }
</style>
</head>
<body>
<div class="game-row" id="game" role="button" tabindex="0"></div>
<div class="section" id="section-mods">
  ${sectionHead(
    "mods",
    "Workspace Mods",
    "Every mod detected in this workspace. Indexed mods are treated as yours: completion, navigation, diagnostics and the localization tools work across all of them. The filled dot marks the mod the sidebar views describe."
  )}
  <div class="section-body" id="body-mods"><div id="mods"></div></div>
</div>
<div class="section" id="section-toggles">
  ${sectionHead("toggles", "Toggles")}
  <div class="section-body" id="body-toggles">
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
  <div class="section-body" id="body-tools"><div id="tools"></div></div>
</div>
<div id="tip" role="tooltip"></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
// Compile-time constants from the host, safe as markup.
const ICONS = ${JSON.stringify(ICONS)};
let state = null;

function iconSvg(name, cls) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", cls || "icon");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ICONS[name] || "";
  return svg;
}

// ---- tooltips: one floating div, shown for any [data-tip] on hover/focus ----
const tip = document.getElementById("tip");
let tipTimer = null;
function showTip(target) {
  tip.textContent = target.getAttribute("data-tip");
  tip.classList.add("show");
  const r = target.getBoundingClientRect();
  tip.style.left = "0px"; tip.style.top = "0px"; // reset so size measures clean
  const w = tip.offsetWidth, h = tip.offsetHeight;
  const x = Math.min(Math.max(4, r.left), window.innerWidth - w - 4);
  let y = r.bottom + 6;
  if (y + h > window.innerHeight - 4) y = r.top - h - 6;
  tip.style.left = x + "px";
  tip.style.top = Math.max(4, y) + "px";
}
function hideTip() {
  if (tipTimer) { clearTimeout(tipTimer); tipTimer = null; }
  tip.classList.remove("show");
}
document.addEventListener("mouseover", (e) => {
  const t = e.target.closest("[data-tip]");
  if (!t) return;
  if (tipTimer) clearTimeout(tipTimer);
  tipTimer = setTimeout(() => showTip(t), 150);
});
document.addEventListener("mouseout", (e) => {
  if (e.target.closest("[data-tip]")) hideTip();
});
document.addEventListener("focusin", (e) => {
  const t = e.target.closest("[data-tip]");
  if (t) showTip(t);
});
document.addEventListener("focusout", hideTip);

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
  const el = document.getElementById(id);
  el.addEventListener("click", () => {
    if (el.hasAttribute("disabled")) return;
    const on = el.getAttribute("aria-checked") !== "true";
    el.setAttribute("aria-checked", String(on)); // optimistic; state reconciles
    vscode.postMessage(make(on));
  });
}
function setSwitch(id, on, disabled, disabledTip) {
  const el = document.getElementById(id);
  el.setAttribute("aria-checked", String(on));
  if (disabled) {
    el.setAttribute("disabled", "");
    if (disabledTip) el.setAttribute("data-tip", disabledTip);
  } else {
    el.removeAttribute("disabled");
    el.removeAttribute("data-tip");
  }
}

// ---- actions (game-aware, from state) ----
function renderActions() {
  const box = document.getElementById("tools");
  box.textContent = "";
  for (const group of state.actions) {
    const g = document.createElement("div");
    g.className = "group";
    const label = document.createElement("div");
    label.className = "group-label";
    label.textContent = group.label;
    g.appendChild(label);
    for (const it of group.items) {
      const row = document.createElement("div");
      row.className = "row action";
      row.setAttribute("role", "button");
      row.tabIndex = 0;
      if (it.tip) row.setAttribute("data-tip", it.tip);
      row.appendChild(iconSvg(it.icon));
      const l = document.createElement("span");
      l.className = "label";
      l.textContent = it.label;
      row.appendChild(l);
      const run = () => vscode.postMessage({ type: "run", command: it.command });
      row.addEventListener("click", run);
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); run(); }
      });
      g.appendChild(row);
    }
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
  const name = document.createElement("span");
  name.className = "game-name";
  name.textContent = state.gameName;
  gameRow.appendChild(name);
  const badge = document.createElement("span");
  badge.className = "badge subtle";
  badge.textContent = state.gameAuto ? "auto-detected" : "set manually";
  gameRow.appendChild(badge);
}

// ---- mods ----
function dot(on, tipText, onClick) {
  const b = document.createElement("button");
  b.className = "dot" + (on ? " on" : "");
  b.setAttribute("role", "radio");
  b.setAttribute("aria-checked", String(on));
  b.setAttribute("data-tip", tipText);
  b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
  return b;
}
function renderMods() {
  const box = document.getElementById("mods");
  box.textContent = "";
  if (!state.mods.length) {
    const d = document.createElement("div");
    d.className = "empty";
    d.textContent = "No mod descriptor found in this workspace.";
    box.appendChild(d);
    const fix = document.createElement("div");
    fix.className = "row action";
    fix.setAttribute("role", "button");
    fix.tabIndex = 0;
    fix.setAttribute("data-tip",
      "Create the descriptor file that marks this folder as a mod, so the game (and this extension) can load it.");
    fix.appendChild(iconSvg("plus"));
    const l = document.createElement("span");
    l.className = "label";
    l.textContent = "Create descriptor.mod";
    fix.appendChild(l);
    const run = () => vscode.postMessage({ type: "run", command: "px.createDescriptor" });
    fix.addEventListener("click", run);
    fix.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); run(); }
    });
    box.appendChild(fix);
    return;
  }
  const following = state.pinnedRoot === null;
  const included = state.mods.filter((m) => !m.excluded);
  const showFocusUi = included.length > 1;

  if (showFocusUi) {
    const row = document.createElement("div");
    row.className = "row follow-row";
    row.appendChild(dot(following,
      "Let the sidebar views (Mod Overview, Localization Coverage, Overrides) follow whichever mod owns the file you are editing.",
      () => vscode.postMessage({ type: "focus", root: null })));
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = "Follow active editor";
    row.appendChild(label);
    row.addEventListener("click", () => vscode.postMessage({ type: "focus", root: null }));
    box.appendChild(row);
  }

  for (const mod of state.mods) {
    const row = document.createElement("div");
    row.className = "row mod-row" + (mod.excluded ? " excluded" : "") + (mod.missing ? " missing" : "");
    if (showFocusUi && !mod.excluded) {
      row.appendChild(dot(state.pinnedRoot === mod.root,
        "Pin the sidebar views to this mod.",
        () => vscode.postMessage({ type: "focus", root: mod.root })));
      row.addEventListener("click", () => vscode.postMessage({ type: "focus", root: mod.root }));
    }
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = mod.name;
    label.setAttribute("data-tip", mod.root);
    row.appendChild(label);

    if (mod.missing) {
      const badge = document.createElement("span");
      badge.className = "badge subtle";
      badge.textContent = "missing";
      badge.setAttribute("data-tip", "This excluded folder no longer exists in the workspace. Switch on to forget it.");
      row.appendChild(badge);
    } else if (!mod.excluded && following && state.focusRoot === mod.root && showFocusUi) {
      const badge = document.createElement("span");
      badge.className = "badge subtle";
      badge.textContent = "showing";
      badge.setAttribute("data-tip", "The sidebar views currently show this mod (following the active editor).");
      row.appendChild(badge);
    }

    const sw = document.createElement("button");
    sw.className = "switch";
    sw.setAttribute("role", "switch");
    sw.setAttribute("aria-checked", String(!mod.excluded));
    sw.setAttribute("aria-label", "Index " + mod.name);
    sw.setAttribute("data-tip",
      mod.excluded
        ? "Not indexed: no completion, navigation, diagnostics or views for this mod. Switch on to index it again."
        : "Indexed. Switch off to skip this mod entirely (no completion, navigation, diagnostics or views).");
    const knob = document.createElement("span");
    knob.className = "knob";
    sw.appendChild(knob);
    sw.addEventListener("click", (e) => {
      e.stopPropagation();
      vscode.postMessage({ type: "exclude", root: mod.root, excluded: !mod.excluded });
    });
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
