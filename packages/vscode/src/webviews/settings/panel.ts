import * as vscode from "vscode";
import * as fs from "node:fs";
import { readModName } from "@px-lsp/protocol/modName";
import type { StatusPayload } from "@px-lsp/protocol/protocol";
import { coaLibraryDir, type PxConfig } from "../../config";
import { metaFor } from "../../meta";
import { dataHealthLines } from "../../dataHealth";
import { resolveWorkshopDir } from "../../steam/workshopFiles";
import { resolveConfigDir } from "@px-lsp/protocol/configDir";
import { makeNonce } from "../nonce";
import { tabIcon } from "../tabIcons";
import { bundleUri, watchBundle, webviewSource } from "../devReload";
import { settingsHtml } from "./html";
import { scopedValue, settingsCatalog, unsupportedSetting, validateSetting, valueStamp } from "./model";
import type { AppToHost, HostToApp, SettingSchema, SettingsState, SettingsTarget } from "./messages";

interface SettingsDeps {
  getCfg(): PxConfig;
  getStatus(): StatusPayload;
}

export class SettingsPanel {
  private static instance: SettingsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly catalog: ReturnType<typeof settingsCatalog>;
  private readonly disposables: vscode.Disposable[] = [];
  private target: SettingsTarget = vscode.workspace.workspaceFolders?.length ? "workspace" : "user";
  private ready = false;
  private disposed = false;
  private writes = Promise.resolve();
  private revealKey: string | undefined;

  private constructor(
    context: vscode.ExtensionContext,
    private readonly deps: SettingsDeps
  ) {
    this.catalog = settingsCatalog(
      context.extension.packageJSON.contributes.configuration as {
        properties: Record<string, SettingSchema>;
      }[]
    );
    const source = webviewSource(context);
    this.panel = vscode.window.createWebviewPanel(
      "px.settings",
      "Toolkit Settings",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [source.root],
      }
    );
    this.panel.iconPath = tabIcon("settings");
    const render = () => {
      this.ready = false;
      const nonce = makeNonce();
      this.panel.webview.html = settingsHtml({
        scriptSrc: bundleUri(this.panel.webview, source, "settings"),
        nonce,
        csp: `default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'`,
      });
    };
    render();
    this.disposables.push(watchBundle(source, "settings", this.panel, render));
    this.panel.webview.onDidReceiveMessage(
      (message: AppToHost) => {
        // Serialize writes so two messages cannot both pass a stale-value check.
        const operation =
          message?.type === "save"
            ? this.writes.then(() => this.onMessage(message))
            : this.onMessage(message);
        const handled = operation.catch((error: unknown) => {
          const text = error instanceof Error ? error.message : String(error);
          this.post(
            message && "id" in message
              ? { type: "result", id: message.id, error: text }
              : { type: "error", message: text }
          );
        });
        if (message?.type === "save") this.writes = handled;
      },
      undefined,
      this.disposables
    );
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
    vscode.workspace.onDidChangeConfiguration(
      (e) => {
        if (e.affectsConfiguration("px")) this.refresh();
      },
      undefined,
      this.disposables
    );
    vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh(), undefined, this.disposables);
    context.subscriptions.push(this);
  }

  static show(context: vscode.ExtensionContext, deps: SettingsDeps, key?: string): void {
    if (this.instance) {
      this.instance.panel.reveal();
      this.instance.refresh();
    } else this.instance = new SettingsPanel(context, deps);
    if (typeof key === "string" && this.instance.catalog.some((r) => r.key === key)) {
      this.instance.revealKey = key;
      this.instance.refresh();
    }
  }

  static refresh(): void {
    this.instance?.refresh();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    SettingsPanel.instance = undefined;
    for (const d of this.disposables.splice(0)) d.dispose();
    this.panel.dispose();
  }

  private post(message: HostToApp): void {
    if (!this.disposed) void this.panel.webview.postMessage(message);
  }

  private targets(): SettingsState["targets"] {
    const folders = vscode.workspace.workspaceFolders ?? [];
    return [
      { id: "user", label: "User" },
      ...(folders.length || vscode.workspace.workspaceFile
        ? [{ id: "workspace" as const, label: "Workspace" }]
        : []),
      // In a single-folder window its .vscode/settings.json IS workspace settings.
      ...(vscode.workspace.workspaceFile
        ? folders.map((f) => ({ id: `folder:${f.uri.toString()}` as const, label: `Folder: ${f.name}` }))
        : []),
    ];
  }

  private configuration(target: SettingsTarget) {
    if (!this.targets().some((t) => t.id === target))
      throw new Error("This settings scope is no longer available. Choose another scope.");
    const folder = target.startsWith("folder:")
      ? vscode.workspace.workspaceFolders?.find((f) => `folder:${f.uri.toString()}` === target)
      : undefined;
    return {
      config: vscode.workspace.getConfiguration("px", folder?.uri),
      target:
        target === "user"
          ? vscode.ConfigurationTarget.Global
          : target === "workspace"
            ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.WorkspaceFolder,
    };
  }

  private snapshot(): SettingsState {
    const targets = this.targets();
    if (!targets.some((t) => t.id === this.target)) this.target = targets[0].id;
    const { config } = this.configuration(this.target);
    const workspaceConfig = vscode.workspace.getConfiguration("px");
    const cfg = this.deps.getCfg();
    const meta = metaFor(cfg.gameId);
    const paths: Record<string, string | null> = {
      gamePath: cfg.gamePath,
      logsPath: cfg.logsPath,
      tigerPath: cfg.tigerPath,
      modPath: cfg.modPath,
      coaLibraryDir: coaLibraryDir(meta),
      "workshop.dir": cfg.modPath
        ? resolveWorkshopDir(
            cfg.modPath,
            workspaceConfig.get<string>("workshop.dir"),
            resolveConfigDir(cfg.modPath, meta)
          )
        : null,
    };
    const rows = this.catalog.map((entry) => {
      const value = scopedValue(config.inspect(entry.key) ?? {}, this.target, entry.schema.default);
      const disabled =
        unsupportedSetting(entry.key, meta) ??
        (this.target.startsWith("folder:") && entry.schema.scope !== "resource"
          ? "This setting is read for the whole workspace. Edit it in User or Workspace settings."
          : undefined);
      const effective = workspaceConfig.get<unknown>(entry.key);
      const raw = typeof effective === "string" ? effective.trim() : "";
      const resolved = Object.hasOwn(paths, entry.key)
        ? (paths[entry.key] ?? undefined)
        : entry.browse && raw
          ? raw
          : undefined;
      let pathStatus: string | undefined;
      if (entry.browse && entry.schema.type !== "array") {
        if (resolved) {
          try {
            const stat = fs.statSync(resolved);
            pathStatus = (entry.browse === "file" ? stat.isFile() : stat.isDirectory())
              ? "Found"
              : "Wrong path type";
          } catch {
            pathStatus = "Not found";
          }
        } else pathStatus = raw ? "Not found" : "Not detected";
      }
      const names =
        ["parentMods", "excludedMods"].includes(entry.key) && Array.isArray(value.value)
          ? value.value
              .filter((root) => typeof root === "string")
              .map((root) => `${readModName(root)} (${root})`)
              .join("\n")
          : undefined;
      const folderOverrides =
        entry.schema.scope === "resource" && !this.target.startsWith("folder:")
          ? (vscode.workspace.workspaceFolders ?? [])
              .filter(
                (f) =>
                  vscode.workspace.getConfiguration("px", f.uri).inspect(entry.key)?.workspaceFolderValue !==
                  undefined
              )
              .map((f) => f.name)
          : [];
      return {
        ...entry,
        ...value,
        disabled,
        resolved,
        pathStatus,
        names,
        override:
          [value.override, folderOverrides.length ? `Folder overrides: ${folderOverrides.join(", ")}` : ""]
            .filter(Boolean)
            .join(". ") || undefined,
      };
    });
    const actions = [
      { command: "px.setup", label: "Check setup", group: "Game & paths" },
      { command: "px.reloadScriptDocs", label: "Reload game data", group: "Game & paths" },
      { command: "px.pickFocusMod", label: "Choose focus mod", group: "Mods" },
      { command: "px.addDependencyMod", label: "Add dependency mod", group: "Mods" },
      { command: "px.excludeMods", label: "Choose excluded mods", group: "Mods" },
      { command: "px.customizeSidebar", label: "Customize Project panel", group: "Advanced" },
      { command: "px.declareCalendar", label: "Declare a mod calendar", group: "Advanced" },
      ...(meta.tiger
        ? [
            { command: "px.downloadTiger", label: "Download validator", group: "Validation" },
            { command: "px.runTiger", label: "Validate mod", group: "Validation" },
          ]
        : []),
      { command: "px.openNativeSettings", label: "Open VS Code settings", group: "native" },
    ];
    return {
      target: this.target,
      targets,
      rows,
      game: meta.name,
      actions,
      summary: [
        cfg.modPath ? `Main mod: ${readModName(cfg.modPath)}` : "No main mod detected",
        meta.tiger
          ? cfg.tigerPath
            ? "Tiger executable found"
            : "Tiger is not installed or its path is unavailable"
          : "Tiger is not available for this game. Structural checks still run.",
        ...dataHealthLines(this.deps.getStatus(), meta.dataTypesCommand ?? "DumpDataTypes"),
        ...cfg.warnings,
      ],
    };
  }

  private refresh(): void {
    if (this.ready && !this.disposed) {
      this.post({ type: "state", state: this.snapshot() });
      if (this.revealKey) {
        this.post({ type: "reveal", key: this.revealKey });
        this.revealKey = undefined;
      }
    }
  }

  private async onMessage(message: AppToHost): Promise<void> {
    if (!message || typeof message !== "object") return;
    switch (message.type) {
      case "ready":
        this.ready = true;
        if (message.target && this.targets().some((t) => t.id === message.target))
          this.target = message.target;
        this.refresh();
        return;
      case "target":
        this.configuration(message.target);
        this.target = message.target;
        this.refresh();
        return;
      case "refresh":
        this.refresh();
        return;
      case "action":
        if (!this.snapshot().actions.some((a) => a.command === message.command))
          throw new Error("Unknown settings action.");
        await vscode.commands.executeCommand(message.command);
        this.refresh();
        return;
      case "browse": {
        this.configuration(message.target);
        const entry = this.catalog.find((r) => r.key === message.key);
        if (!entry?.browse) throw new Error("This setting does not have a path picker.");
        const picked = await vscode.window.showOpenDialog({
          title: entry.label,
          openLabel: "Use this path",
          canSelectMany: false,
          canSelectFiles: entry.browse === "file",
          canSelectFolders: entry.browse === "folder",
        });
        this.post({ type: "result", id: message.id, value: picked?.[0]?.fsPath });
        return;
      }
      case "save": {
        const entry = this.catalog.find((r) => r.key === message.key);
        if (!entry) throw new Error("Unknown toolkit setting.");
        const unsupported = unsupportedSetting(entry.key, metaFor(this.deps.getCfg().gameId));
        if (unsupported && !message.reset) throw new Error(unsupported);
        if (message.target.startsWith("folder:") && entry.schema.scope !== "resource")
          throw new Error("Edit this setting at User or Workspace scope.");
        const { config, target } = this.configuration(message.target);
        const current = scopedValue(config.inspect(entry.key) ?? {}, message.target, entry.schema.default);
        if (current.stamp !== message.stamp)
          throw new Error(
            "This setting changed elsewhere. Discard your draft to load the current value, then try again."
          );
        if (!message.reset) {
          validateSetting(entry.key, entry.schema, message.value);
          if (
            ["gamePath", "logsPath", "modPath", "tigerPath"].includes(entry.key) &&
            typeof message.value === "string" &&
            message.value.trim()
          ) {
            const stat = fs.statSync(message.value);
            if (entry.browse === "file" ? !stat.isFile() : !stat.isDirectory())
              throw new Error("Choose the correct path type for this setting.");
          }
        }
        // VS Code applies the single-setting edit, preserving other keys and open documents.
        await config.update(entry.key, message.reset ? undefined : message.value, target);
        const saved = scopedValue(
          this.configuration(message.target).config.inspect(entry.key) ?? {},
          message.target,
          entry.schema.default
        );
        if (saved.stamp !== valueStamp(message.reset ? undefined : message.value))
          throw new Error("VS Code did not save the requested value. Check the settings file and try again.");
        this.post({ type: "result", id: message.id });
        this.refresh();
      }
    }
  }
}
