import * as vscode from "vscode";
import * as path from "path";
import { readDescriptorName } from "@px-lsp/protocol/descriptorMod";
import type { GameMeta } from "@px-lsp/server/games/profile";
import { allWorkspaceModCandidates, type PxConfig } from "../../config";
import { isCk3, metaFor } from "../../meta";
import type { FocusMod } from "../../views";
import type { ErrorLogWatcher } from "../../errorLog";

/** Messages the webview sends to the host. */
type InboundMessage =
  | { type: "ready" }
  | { type: "run"; command: string }
  | { type: "focus"; root: string | null }
  | { type: "exclude"; root: string; excluded: boolean }
  | { type: "setting"; key: "diagnosticsVanilla" | "scopeInlayHints"; value: boolean }
  | { type: "watcher" }
  | { type: "baseline" };

/** Messages the host sends to the webview. */
type OutboundMessage = { type: "state"; state: DashboardState };

interface ModState {
  root: string;
  name: string;
  excluded: boolean;
  /** Excluded entry whose folder no longer exists in the workspace. */
  missing: boolean;
}

interface ActionGroup {
  label: string;
  items: Array<{ label: string; command: string; icon: keyof typeof ICONS; tip?: string }>;
}

interface DashboardState {
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
  /** Game-aware launcher groups (per-game labels, CK3-only tutorial). */
  actions: ActionGroup[];
}

export interface DashboardDeps {
  getCfg: () => PxConfig;
  focus: FocusMod;
  errorLog: ErrorLogWatcher;
  workspaceState: vscode.Memento;
}

/**
 * The command launchers the old Tools tree offered, hints moved into tooltips.
 * Built per game: labels carry the active game's name, and CK3-only content
 * (the tutorial) is absent elsewhere. Tiger runs and the error.log watcher are
 * NOT here — the status bar owns tiger, and the watcher is a toggle above.
 */
function actionGroups(meta: GameMeta): ActionGroup[] {
  return [
    {
      label: "Create",
      items: [
        {
          label: "New Content…",
          command: "px.newContent",
          icon: "plus",
          tip: "Scaffold an event, decision, trait, … into the right folder, with localization keys.",
        },
      ],
    },
    {
      label: "Localization",
      items: [
        {
          label: "Add Language",
          command: "px.createTranslation",
          icon: "globe",
          tip: "Scaffold localization files for another language from your existing keys.",
        },
        {
          label: "Translate Missing Keys",
          command: "px.translateNext",
          icon: "arrowRight",
          tip: "Walk the missing localization keys one by one, side by side with the source language.",
        },
        {
          label: "New Translation Mod",
          command: "px.createTranslationMod",
          icon: "clone",
          tip: "Create a standalone mod that translates another mod, including an AI translation prompt.",
        },
      ],
    },
    {
      label: "Images",
      items: [
        { label: "Convert Image to DDS", command: "px.convertToDds", icon: "image" },
        {
          label: "Image Guidelines",
          command: "px.imageGuidelines",
          icon: "book",
          tip: "Reference for the sizes and formats the game expects (icons, portraits, flags, …).",
        },
      ],
    },
    {
      label: "Inspect",
      items: [
        {
          label: "Event Graph",
          command: "px.showEventGraph",
          icon: "graph",
          tip: "Interactive graph of your event chains: triggers, options, follow-ups.",
        },
        {
          label: "Simulate Event",
          command: "px.simulateEvent",
          icon: "sim",
          tip: "Walk one event step by step: which triggers pass, which options show, where each leads.",
        },
        {
          label: "GUI Widget Tree",
          command: "px.showGuiTree",
          icon: "tree",
          tip: "Widget hierarchy of the active .gui file. Open a .gui file first.",
        },
        {
          label: "GUI Layout Preview",
          command: "px.showGuiPreview",
          icon: "layout",
          tip: "Approximate layout render of the active .gui file. Open a .gui file first.",
        },
        {
          label: "Mod Report",
          command: "px.modReport",
          icon: "report",
          tip: "Summary of the focused mod: content counts, localization coverage, problems.",
        },
        {
          label: "Format Docs (.info)",
          command: "px.openInfoDocs",
          icon: "info",
          tip: "Paradox's own format documentation for the kind of file you are editing.",
        },
      ],
    },
    {
      label: "Validate & Test",
      items: [
        {
          label: `Launch ${meta.shortName} (debug mode)`,
          command: "px.launchGame",
          icon: "play",
          tip: "Start the game via Steam with -debug_mode -develop, so scripts reload live.",
        },
        {
          label: "Setup & Health Check",
          command: "px.setup",
          icon: "check",
          tip: "Find the game and tools automatically and verify the workspace is wired up.",
        },
      ],
    },
    // The tutorial is CK3-specific content bundled with the extension.
    ...(isCk3(meta.id)
      ? [
          {
            label: "Learn",
            items: [{ label: "Tutorial: CK3 Modding from Zero", command: "px.tutorial", icon: "cap" }],
          } satisfies ActionGroup,
        ]
      : []),
  ];
}

/** 16×16 stroke icons (currentColor), hand-kept so the webview stays asset-free. */
const ICONS = {
  plus: '<path d="M8 3.5v9M3.5 8h9"/>',
  globe:
    '<circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c2.3 2.7 2.3 9.3 0 12M8 2c-2.3 2.7-2.3 9.3 0 12"/>',
  arrowRight: '<path d="M2.5 8h10M9 4.5 12.5 8 9 11.5"/>',
  clone: '<rect x="2.5" y="2.5" width="8" height="8" rx="1"/><path d="M5.5 13.5h7a1 1 0 0 0 1-1v-7"/>',
  image:
    '<rect x="2" y="3" width="12" height="10" rx="1"/><circle cx="5.5" cy="6.5" r="1"/><path d="M4 12l3-3 2 2 2.5-2.5L14 11"/>',
  book: '<path d="M8 4C6.4 3 4.4 3 2.5 3.5v9C4.4 12 6.4 12 8 13c1.6-1 3.6-1 5.5-.5v-9C11.6 3 9.6 3 8 4Zm0 0v9"/>',
  graph:
    '<circle cx="8" cy="3.5" r="1.7"/><circle cx="3.8" cy="12" r="1.7"/><circle cx="12.2" cy="12" r="1.7"/><path d="M7.2 5 4.6 10.5M8.8 5l2.6 5.5"/>',
  sim: '<path d="M3 3.5h6M3 7h4M3 10.5h4"/><path d="M9.5 6.5v6l5-3z" fill="currentColor" stroke="none"/>',
  tree: '<path d="M4.5 3v7.5A1.5 1.5 0 0 0 6 12h2.5M4.5 6.5H8"/><circle cx="4.5" cy="3" r="1.4"/><circle cx="10" cy="6.5" r="1.4"/><circle cx="10.5" cy="12" r="1.4"/>',
  layout: '<rect x="2" y="2.5" width="12" height="11" rx="1"/><path d="M2 5.5h12M6 5.5V13.5"/>',
  report: '<rect x="3" y="2" width="10" height="12" rx="1"/><path d="M5.5 5h5M5.5 8h5M5.5 11h3"/>',
  info: '<circle cx="8" cy="8" r="6"/><path d="M8 7.2v4"/><circle cx="8" cy="4.9" r=".5" fill="currentColor"/>',
  play: '<path d="M5.5 3.8v8.4L12.5 8Z" fill="currentColor" stroke="none"/>',
  check: '<path d="M8 2 13 4v4.3c0 3-2 5.2-5 5.7-3-.5-5-2.7-5-5.7V4Z"/><path d="M5.8 8.1l1.6 1.6 3-3.2"/>',
  cap: '<path d="M2 6.3 8 4l6 2.3L8 8.7Zm2.5 1.5v3.2c2 1.5 5 1.5 7 0V7.8M14 6.3v3.2"/>',
} as const;

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
      name: readDescriptorName(root) ?? path.basename(root),
      excluded: excluded.has(normKey(root)),
      missing: false,
    }));
    // Stale exclusions (folder gone) stay visible so they can be switched back.
    for (const p of cfg.excludedMods) {
      if (!known.has(normKey(p))) {
        mods.push({
          root: p,
          name: readDescriptorName(p) ?? path.basename(p),
          excluded: true,
          missing: true,
        });
      }
    }
    return {
      mods,
      pinnedRoot: this.deps.focus.pinnedRoot(),
      focusRoot: this.deps.focus.current(),
      hasTiger: meta.tiger !== undefined,
      tigerBaseline: this.deps.workspaceState.get<boolean>("px.tigerBaselineEnabled") ?? false,
      watcherOn: this.deps.errorLog.watching,
      watcherAvailable: cfg.logsPath !== null,
      diagnosticsVanilla: cfg.diagnosticsVanilla,
      scopeInlayHints: cfg.scopeInlayHints,
      actions: actionGroups(meta),
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
      case "baseline":
        await vscode.commands.executeCommand("px.tigerToggleBaseline");
        this.refresh();
        return;
    }
  }
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
 * The static shell: toggle rows and containers; the mod list and the
 * game-aware action groups are rendered by script from the pushed state.
 */
function buildHtml(): string {
  const nonce = makeNonce();
  const csp = [`default-src 'none'`, `style-src 'unsafe-inline'`, `script-src 'nonce-${nonce}'`].join("; ");

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
    margin: 0; padding: 0;
    font-family: var(--vscode-font-family, sans-serif);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-sideBar-foreground, var(--vscode-foreground));
    background: transparent;
    -webkit-user-select: none; user-select: none;
  }
  .section { padding: 2px 8px 8px; }
  .section + .section { border-top: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(128,128,128,0.2)); }
  h3 {
    display: flex; align-items: center; gap: 5px;
    margin: 8px 4px 4px; font-size: 11px; font-weight: 600;
    letter-spacing: .05em; text-transform: uppercase;
    color: var(--vscode-descriptionForeground);
  }
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
<div class="section" id="mods-section">
  <h3>Workspace Mods ${infoIcon(
    "Every mod detected in this workspace. Indexed mods are treated as yours: completion, navigation, diagnostics and the localization tools work across all of them. The filled dot marks the mod the sidebar views describe."
  )}</h3>
  <div id="mods"></div>
</div>
<div class="section">
  <h3>Toggles</h3>
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
<div class="section">
  <h3>Tools</h3>
  <div id="tools"></div>
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
    d.textContent = "No mods detected in this workspace.";
    box.appendChild(d);
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
  renderMods();
  renderActions();
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

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
