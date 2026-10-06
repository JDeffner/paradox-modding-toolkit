import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { readModName } from "@px-lsp/protocol/modName";
import type { StatusPayload } from "@px-lsp/protocol/protocol";
import { coaLibraryDir, readConfig, type PxConfig } from "../../config";
import { metaFor } from "../../meta";
import { dataHealthLines } from "../../dataHealth";
import { resolveWorkshopDir } from "../../steam/workshopFiles";
import { resolveConfigPath } from "@px-lsp/protocol/configDir";
import { PROJECT_SETTING_KEYS, type ProjectSettingKey } from "@px-lsp/protocol/projectSettings";
import { isMachineSetting } from "@px-lsp/protocol/machineSettings";
import { inspectMachineSetting, writeMachineSettings } from "../../machineSettings";
import { inspectProjectSetting, projectRoot, saveProjectSettings } from "../../projectSettings";
import { makeNonce } from "../nonce";
import { tabIcon } from "../tabIcons";
import { bundleUri, watchBundle, webviewSource } from "../devReload";
import { settingsHtml } from "./html";
import {
  type InspectedSetting,
  scopedValue,
  settingsCatalog,
  unsupportedSetting,
  validateSetting,
  valueStamp,
} from "./model";
import type {
  AppToHost,
  HostToApp,
  SettingSchema,
  SettingsState,
  SettingsTarget,
  SettingRow,
  SettingsSave,
} from "./messages";

interface SettingsDeps {
  getCfg(): PxConfig;
  getStatus(): StatusPayload;
}
const MACHINE_SOURCES = {
  folder: "Personal folder paths",
  workspace: "Personal workspace paths",
  default: "Personal defaults",
  legacyFolder: "Legacy folder setting",
  legacyWorkspace: "Legacy workspace setting",
  legacyGlobal: "Legacy User setting",
  legacyDefault: "Default",
  unset: "Not set",
};

export class SettingsPanel {
  private static instance: SettingsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly catalog: ReturnType<typeof settingsCatalog>;
  private readonly disposables: vscode.Disposable[] = [];
  private target: SettingsTarget = vscode.workspace.workspaceFolders?.length ? "workspace" : "user";
  private readonly destinations = new Map<string, SettingsTarget>();
  private ready = false;
  private disposed = false;
  private writes = Promise.resolve();
  private revealKey: string | undefined;
  private refreshGeneration = 0;

  private constructor(
    context: vscode.ExtensionContext,
    private readonly deps: SettingsDeps
  ) {
    this.catalog = settingsCatalog(
      context.extension.packageJSON.contributes.configuration as {
        properties: Record<string, SettingSchema>;
      }[]
    );
    if (deps.getCfg().modPath) this.target = `project:${vscode.Uri.file(deps.getCfg().modPath!).toString()}`;
    const source = webviewSource(context);
    this.panel = vscode.window.createWebviewPanel(
      "px.settings",
      "Toolkit Settings",
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [source.root] }
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
        const saving = message?.type === "save" || message?.type === "saveBatch";
        const operation = saving ? this.writes.then(() => this.onMessage(message)) : this.onMessage(message);
        const handled = operation.catch((error: unknown) => {
          const text = error instanceof Error ? error.message : String(error);
          this.post(
            message && "id" in message
              ? { type: "result", id: message.id, error: text }
              : { type: "error", message: text }
          );
        });
        if (saving) this.writes = handled;
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
    const watcher = vscode.workspace.createFileSystemWatcher(
      "**/{.px-toolkit,.ck3modding,.vic3modding,.eu5modding}/{project,calendar,localization}.json"
    );
    watcher.onDidChange(() => this.refresh(), undefined, this.disposables);
    watcher.onDidCreate(() => this.refresh(), undefined, this.disposables);
    watcher.onDidDelete(() => this.refresh(), undefined, this.disposables);
    this.disposables.push(watcher);
    vscode.workspace.onDidChangeTextDocument(
      (event) => {
        if (event.document.uri.fsPath.endsWith("project.json")) this.refresh();
      },
      undefined,
      this.disposables
    );
    context.subscriptions.push(this);
  }

  static show(context: vscode.ExtensionContext, deps: SettingsDeps, key?: string): void {
    if (this.instance) {
      this.instance.panel.reveal();
      this.instance.refresh();
    } else this.instance = new SettingsPanel(context, deps);
    if (typeof key === "string" && this.instance.catalog.some((row) => row.key === key)) {
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
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
    this.panel.dispose();
  }
  private post(message: HostToApp): void {
    if (!this.disposed) void this.panel.webview.postMessage(message);
  }

  private hasWorkspace(): boolean {
    return !!(vscode.workspace.workspaceFolders?.length || vscode.workspace.workspaceFile);
  }
  private targets(): SettingsState["targets"] {
    const cfg = this.deps.getCfg();
    const mods = [
      ...new Set([cfg.modPath, ...(cfg.workspaceMods ?? [])].filter((root): root is string => !!root)),
    ];
    const targets: SettingsState["targets"] = mods.flatMap((root) => {
      try {
        projectRoot({ ...cfg, modPath: root });
        return [{ id: `project:${vscode.Uri.file(root).toString()}` as const, label: readModName(root) }];
      } catch {
        // Reference and vanilla inputs cannot become shared-setting destinations.
        return [];
      }
    });
    return targets.length
      ? targets
      : [
          {
            id: this.hasWorkspace() ? "workspace" : "user",
            label: this.hasWorkspace() ? "This workspace" : "Personal defaults",
          },
        ];
  }
  private contextResource(context: SettingsTarget): vscode.Uri | undefined {
    if (!this.targets().some((item) => item.id === context))
      throw new Error("This settings context is no longer available. Choose another mod.");
    return context.startsWith("project:") ? vscode.Uri.parse(context.slice("project:".length)) : undefined;
  }
  private contextConfig(context: SettingsTarget): PxConfig {
    const resource = this.contextResource(context);
    return resource ? { ...readConfig(resource), modPath: resource.fsPath } : this.deps.getCfg();
  }
  private allowedTargets(
    entry: ReturnType<typeof settingsCatalog>[number],
    context: SettingsTarget
  ): SettingRow["targets"] {
    const resource = this.contextResource(context);
    const folder = resource ? vscode.workspace.getWorkspaceFolder(resource) : undefined;
    const personal = { id: "user" as const, label: "Personal defaults" };
    if (PROJECT_SETTING_KEYS.includes(entry.key as ProjectSettingKey))
      return [...(resource ? [{ id: context, label: "This mod · Shared" }] : []), personal];
    if (isMachineSetting(entry.key))
      return [
        personal,
        ...(this.hasWorkspace()
          ? [{ id: "machine:workspace" as const, label: "This workspace · Private" }]
          : []),
        ...(folder && entry.key !== "modProjectsDir"
          ? [{ id: `machine-folder:${folder.uri.toString()}` as const, label: `${folder.name} · Private` }]
          : []),
      ];
    const userOnly = entry.schema.scope === "application" || entry.schema.scope === "machine";
    return [
      personal,
      ...(!userOnly && this.hasWorkspace() ? [{ id: "workspace" as const, label: "This workspace" }] : []),
      ...(!userOnly &&
      folder &&
      vscode.workspace.workspaceFile &&
      (entry.schema.scope === "resource" || entry.schema.scope === "language-overridable")
        ? [{ id: `folder:${folder.uri.toString()}` as const, label: `${folder.name} folder` }]
        : []),
    ];
  }
  private validateDestination(context: SettingsTarget, key: string, target: SettingsTarget) {
    const entry = this.catalog.find((row) => row.key === key);
    if (!entry) throw new Error("Unknown toolkit setting.");
    if (!this.allowedTargets(entry, context).some((item) => item.id === target))
      throw new Error(
        PROJECT_SETTING_KEYS.includes(key as ProjectSettingKey)
          ? "Save shared authoring rules in this mod's shared settings or Personal defaults."
          : "This destination is not available for this setting and mod."
      );
    return entry;
  }
  private configuration(target: SettingsTarget, context: SettingsTarget) {
    return {
      config: vscode.workspace.getConfiguration("px", this.contextResource(context)),
      target:
        target === "user"
          ? vscode.ConfigurationTarget.Global
          : target === "workspace"
            ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.WorkspaceFolder,
    };
  }
  private machineTarget(target: SettingsTarget, context: SettingsTarget, key: string) {
    return {
      scope:
        target === "user"
          ? ("default" as const)
          : target === "machine:workspace"
            ? ("workspace" as const)
            : ("folder" as const),
      // New-project locations have no selected mod; their consumers read workspace defaults.
      resource: key === "modProjectsDir" ? undefined : this.contextResource(context),
    };
  }

  private async snapshot(): Promise<SettingsState> {
    const targets = this.targets();
    if (!targets.some((item) => item.id === this.target)) this.target = targets[0].id;
    const context = this.target;
    const resource = this.contextResource(context);
    const cfg = this.contextConfig(context);
    const meta = metaFor(cfg.gameId);
    const config = vscode.workspace.getConfiguration("px", resource);
    const rows = await Promise.all(
      this.catalog.map(async (entry): Promise<SettingRow> => {
        const choices = this.allowedTargets(entry, context);
        const rowConfig = entry.key === "modProjectsDir" ? vscode.workspace.getConfiguration("px") : config;
        const native: InspectedSetting = rowConfig.inspect(entry.key) ?? {};
        const project =
          PROJECT_SETTING_KEYS.includes(entry.key as ProjectSettingKey) && resource
            ? await inspectProjectSetting(cfg, entry.key as ProjectSettingKey)
            : undefined;
        const machine = isMachineSetting(entry.key)
          ? inspectMachineSetting(
              entry.key,
              cfg.gameId,
              "default",
              entry.key === "modProjectsDir" ? undefined : resource
            )
          : undefined;
        const nativeDefault =
          native.workspaceFolderValue !== undefined && choices.some((item) => item.id.startsWith("folder:"))
            ? choices.find((item) => item.id.startsWith("folder:"))!.id
            : native.workspaceValue !== undefined && choices.some((item) => item.id === "workspace")
              ? "workspace"
              : native.globalValue !== undefined
                ? "user"
                : choices.some((item) => item.id === "workspace")
                  ? "workspace"
                  : "user";
        const machineDefault =
          machine?.source === "folder" || machine?.source === "legacyFolder"
            ? choices.find((item) => item.id.startsWith("machine-folder:"))?.id
            : machine?.source === "workspace" || machine?.source === "legacyWorkspace"
              ? choices.find((item) => item.id === "machine:workspace")?.id
              : undefined;
        const remembered = this.destinations.get(`${context}/${entry.key}`);
        const target =
          remembered && choices.some((item) => item.id === remembered)
            ? remembered
            : project
              ? context
              : machine
                ? (machineDefault ?? "user")
                : nativeDefault;
        let value: Omit<ReturnType<typeof scopedValue>, "resetValue"> & Pick<SettingRow, "resetValue"> =
          scopedValue(native, target, entry.schema.default);
        let storageError: string | undefined;
        if (project && (!machine || target === context)) {
          const effectiveValue = (project.ownValue ??
            machine?.value ??
            project.value ??
            entry.schema.default) as SettingRow["value"];
          const source =
            project.source === "project"
              ? "Mod rules"
              : machine
                ? MACHINE_SOURCES[machine.source]
                : project.source[0].toUpperCase() + project.source.slice(1);
          if (target === context)
            value = {
              ...value,
              value: effectiveValue,
              explicit: project.ownValue !== undefined,
              stamp: project.stamp,
              source,
              effectiveValue,
              effectiveSource: source,
              resetLabel: "Remove mod override",
              resetValue:
                entry.key === "gameId"
                  ? undefined
                  : (machine?.value ?? config.get(entry.key, entry.schema.default)),
              override: undefined,
            };
          else
            value = {
              ...value,
              effectiveValue,
              effectiveSource: source,
              resetValue: project.ownValue !== undefined ? effectiveValue : value.resetValue,
              override:
                project.ownValue !== undefined
                  ? `Mod rules are active: ${valueStamp(effectiveValue)}`
                  : value.override,
            };
          storageError = project.error;
        } else if (machine && isMachineSetting(entry.key)) {
          const slot = this.machineTarget(target, context, entry.key);
          const inspected = inspectMachineSetting(entry.key, cfg.gameId, slot.scope, slot.resource);
          const effectiveValue = (project?.ownValue ??
            inspected.value ??
            entry.schema.default) as SettingRow["value"];
          const effectiveSource =
            project?.ownValue !== undefined ? "Mod rules" : MACHINE_SOURCES[inspected.source];
          const own = inspected.ownValue;
          // Undefined resource excludes folder bindings in getMachineSettingsIdentity.
          const inherited =
            target === "user"
              ? scopedValue(native, "user", entry.schema.default)
              : target === "machine:workspace"
                ? inspectMachineSetting(entry.key, cfg.gameId, "workspace")
                : inspected;
          const inheritedSource =
            "effectiveSource" in inherited ? inherited.source : MACHINE_SOURCES[inherited.source];
          value = {
            ...value,
            value: (own ?? inherited.value ?? entry.schema.default) as SettingRow["value"],
            explicit: own !== undefined,
            stamp: inspected.stamp,
            source:
              own !== undefined
                ? target === "user"
                  ? "Personal defaults"
                  : target === "machine:workspace"
                    ? "Personal workspace paths"
                    : "Personal folder paths"
                : inheritedSource,
            effectiveValue,
            effectiveSource,
            resetLabel:
              target === "user"
                ? "Remove personal default"
                : target === "machine:workspace"
                  ? "Remove workspace override"
                  : "Remove folder override",
            resetValue: project
              ? ((project.ownValue ??
                  (inspected.source === "default"
                    ? (native.globalValue ?? native.defaultValue ?? entry.schema.default)
                    : (inspected.value ?? entry.schema.default))) as SettingRow["value"])
              : undefined,
            override:
              own !== undefined && valueStamp(own) !== valueStamp(effectiveValue)
                ? `Active ${effectiveSource.toLowerCase()}: ${valueStamp(effectiveValue)}`
                : undefined,
          };
          storageError = project?.error ?? inspected.error;
        }
        const disabled = storageError ?? unsupportedSetting(entry.key, meta);
        const raw = typeof value.effectiveValue === "string" ? value.effectiveValue.trim() : "";
        const detected: Record<string, string | null> = {
          gamePath: cfg.gamePath,
          logsPath: cfg.logsPath,
          tigerPath: cfg.tigerPath,
          modPath: cfg.modPath,
        };
        const resolved = !entry.browse
          ? undefined
          : entry.key === "workshop.dir" && cfg.modPath
            ? resolveWorkshopDir(
                cfg.modPath,
                raw,
                path.dirname(resolveConfigPath(cfg.modPath, meta, "workshop"))
              )
            : raw
              ? path.isAbsolute(raw)
                ? raw
                : cfg.modPath
                  ? path.resolve(cfg.modPath, raw)
                  : raw
              : entry.key === "coaLibraryDir"
                ? machine?.error
                  ? undefined
                  : (coaLibraryDir(meta, resource) ?? undefined)
                : (detected[entry.key] ?? undefined);
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
          ["parentMods", "excludedMods"].includes(entry.key) && Array.isArray(value.effectiveValue)
            ? value.effectiveValue.map((root) => `${readModName(root)} (${root})`).join("\n")
            : undefined;
        return {
          ...entry,
          ...(target.startsWith("project:") && entry.key === "gameId"
            ? {
                schema: {
                  ...entry.schema,
                  enum: entry.schema.enum?.filter((game) => game !== "auto"),
                  enumDescriptions: undefined,
                },
              }
            : {}),
          ...value,
          target,
          targetLabel: choices.find((item) => item.id === target)!.label,
          targets: choices,
          disabled,
          resolved,
          pathStatus,
          names,
        };
      })
    );
    const workspaceLabel = (label: string) => `${label} · Current workspace`;
    const modLabel = (label: string) => (resource ? label : workspaceLabel(label));
    const actions = [
      { command: "px.setup", label: workspaceLabel("Check setup"), group: "Game & paths" },
      { command: "px.reloadScriptDocs", label: workspaceLabel("Reload game data"), group: "Game & paths" },
      { command: "px.pickFocusMod", label: workspaceLabel("Choose focus mod"), group: "Mods" },
      { command: "px.addDependencyMod", label: workspaceLabel("Add dependency mod"), group: "Mods" },
      { command: "px.excludeMods", label: workspaceLabel("Choose excluded mods"), group: "Mods" },
      { command: "px.customizeSidebar", label: workspaceLabel("Customize Project panel"), group: "Advanced" },
      { command: "px.declareCalendar", label: modLabel("Declare a mod calendar"), group: "Advanced" },
      {
        command: "px.configureLocalizationDefaults",
        label: modLabel("Localization authoring defaults"),
        group: "Mods",
      },
      {
        command: "px.migrateToolkitStorage",
        label: workspaceLabel("Upgrade existing settings"),
        group: "Advanced",
      },
      ...(meta.tiger
        ? [
            { command: "px.downloadTiger", label: workspaceLabel("Download validator"), group: "Validation" },
            { command: "px.runTiger", label: modLabel("Validate mod"), group: "Validation" },
          ]
        : []),
      { command: "px.openNativeSettings", label: "Open VS Code settings", group: "native" },
    ];
    return {
      target: context,
      targets,
      rows,
      game: meta.name,
      scopeDescription:
        "Choose a mod to inspect. Each setting shows its save destination and the value active for this context.",
      actions,
      summary: [
        resource ? `Settings for: ${readModName(resource.fsPath)}` : "No editable mod detected",
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
      const generation = ++this.refreshGeneration;
      void this.snapshot()
        .then((state) => {
          if (generation !== this.refreshGeneration || this.disposed) return;
          this.post({ type: "state", state });
          if (this.revealKey) {
            this.post({ type: "reveal", key: this.revealKey });
            this.revealKey = undefined;
          }
        })
        .catch((error: unknown) => {
          if (generation === this.refreshGeneration && !this.disposed)
            this.post({ type: "error", message: error instanceof Error ? error.message : String(error) });
        });
    }
  }

  private async onMessage(message: AppToHost): Promise<void> {
    if (!message || typeof message !== "object") return;
    switch (message.type) {
      case "ready":
        this.ready = true;
        if (message.target && this.targets().some((item) => item.id === message.target))
          this.target = message.target;
        this.refresh();
        return;
      case "target":
        this.contextResource(message.target);
        this.target = message.target;
        this.refresh();
        return;
      case "destination":
        this.validateDestination(message.context, message.key, message.target);
        this.destinations.set(`${message.context}/${message.key}`, message.target);
        this.refresh();
        return;
      case "refresh":
        this.refresh();
        return;
      case "action": {
        const context = this.target;
        if (!(await this.snapshot()).actions.some((action) => action.command === message.command))
          throw new Error("Unknown settings action.");
        const targetable = ["px.declareCalendar", "px.configureLocalizationDefaults", "px.runTiger"].includes(
          message.command
        );
        await vscode.commands.executeCommand(
          message.command,
          targetable ? this.contextResource(context) : undefined
        );
        this.refresh();
        return;
      }
      case "browse": {
        const entry = this.validateDestination(message.context, message.key, message.target);
        if (!entry.browse) throw new Error("This setting does not have a path picker.");
        const unsupported = unsupportedSetting(
          entry.key,
          metaFor(this.contextConfig(message.context).gameId)
        );
        if (unsupported) throw new Error(unsupported);
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
      case "save":
        await this.saveChanges([message]);
        return;
      case "saveBatch":
        await this.saveChanges(message.changes);
        return;
    }
  }

  private validateSave(change: SettingsSave) {
    const entry = this.validateDestination(change.context, change.key, change.target);
    const cfg = this.contextConfig(change.context);
    const unsupported = unsupportedSetting(entry.key, metaFor(cfg.gameId));
    if (unsupported && !change.reset) throw new Error(unsupported);
    if (!change.reset) {
      validateSetting(entry.key, entry.schema, change.value);
      if (
        ["gamePath", "logsPath", "modPath", "tigerPath"].includes(entry.key) &&
        typeof change.value === "string" &&
        change.value.trim()
      ) {
        const stat = fs.statSync(change.value);
        if (entry.browse === "file" ? !stat.isFile() : !stat.isDirectory())
          throw new Error("Choose the correct path type for this setting.");
      }
    }
    return { change, entry, cfg };
  }

  private async saveChanges(changes: SettingsSave[]): Promise<void> {
    if (!Array.isArray(changes)) throw new Error("Invalid settings batch.");
    const groups = new Map<string, SettingsSave[]>();
    for (const [index, change] of changes.entries()) {
      const store = change.target.startsWith("project:")
        ? change.target
        : isMachineSetting(change.key) || change.target.startsWith("machine")
          ? "machine"
          : `native:${index}`;
      const group = groups.get(store) ?? [];
      group.push(change);
      groups.set(store, group);
    }
    // Project stamps also inspect inherited native values. Save shared files first.
    const stores = [...groups].sort(
      ([a], [b]) => Number(b.startsWith("project:")) - Number(a.startsWith("project:"))
    );
    // A shared game pin can change context resolution. Capture each draft's game before any write.
    const prepared = stores.map(([store, group]) => {
      try {
        return { store, group, validated: group.map((change) => this.validateSave(change)) };
      } catch (error) {
        return { store, group, error: error instanceof Error ? error.message : String(error) };
      }
    });
    for (const { store, group, validated, error } of prepared) {
      if (!validated) {
        for (const change of group) this.post({ type: "result", id: change.id, error });
        continue;
      }
      try {
        if (store.startsWith("project:")) {
          await saveProjectSettings(
            validated[0].cfg,
            validated.map(({ change }) => ({
              key: change.key as ProjectSettingKey,
              value: change.reset ? undefined : change.value,
              expectedStamp: change.stamp,
            }))
          );
        } else if (store === "machine") {
          await writeMachineSettings(
            validated.map(({ change, cfg }) => {
              if (!isMachineSetting(change.key))
                throw new Error("Only machine paths belong in private path storage.");
              const slot = this.machineTarget(change.target, change.context, change.key);
              return {
                key: change.key,
                value: change.reset ? undefined : (change.value as string | string[]),
                gameId: cfg.gameId,
                scope: slot.scope,
                resource: slot.resource,
                expectedStamp: change.stamp,
              };
            })
          );
        } else {
          const { change, entry } = validated[0];
          const { config, target } = this.configuration(change.target, change.context);
          const current = scopedValue(config.inspect(entry.key) ?? {}, change.target, entry.schema.default);
          if (current.stamp !== change.stamp)
            throw new Error(
              "This setting changed elsewhere. Discard your draft to load the current value, then try again."
            );
          // VS Code applies the single-setting edit, preserving other keys and open documents.
          await config.update(entry.key, change.reset ? undefined : change.value, target);
          const saved = scopedValue(
            this.configuration(change.target, change.context).config.inspect(entry.key) ?? {},
            change.target,
            entry.schema.default
          );
          if (saved.stamp !== valueStamp(change.reset ? undefined : change.value))
            throw new Error(
              "VS Code did not save the requested value. Check the settings file and try again."
            );
        }
        for (const change of group) this.post({ type: "result", id: change.id });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        for (const change of group) this.post({ type: "result", id: change.id, error: message });
      }
    }
    this.refresh();
  }
}
