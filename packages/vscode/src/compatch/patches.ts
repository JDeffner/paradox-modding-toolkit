import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  PatchAnalysis,
  PatchOutputPlan,
  PatchPolicy,
  PatchProject,
} from "@px-lsp/server/compatch/model";
import {
  analyzePatch,
  generatePatch,
  normalizePatchFile,
  resolvePatchEntry,
} from "@px-lsp/server/compatch/engine";
import { parsePatchProject } from "@px-lsp/server/compatch/project";
import {
  capturePatchSources,
  assertPatchSourcesFresh,
  preparePatchOutput,
  type PatchCapture,
} from "@px-lsp/server/compatch/node";
import {
  applyFileChanges,
  restoreFileChanges,
  type FrozenFileChange,
} from "@px-lsp/server/migrations/node/files";
import { parseScript } from "@px-lsp/server/parser";
import {
  readDescriptorBlock,
  scaffoldDescriptor,
  upsertDescriptorBlock,
  wildcardVersion,
} from "@px-lsp/protocol/descriptorMod";
import type { PatchBindings } from "@px-lsp/protocol/machineSettings";
import type { PxConfig } from "../config";
import { gameDocsSubdir } from "../config";
import { createLauncherLink } from "../modProjects/command";
import { ensurePxIgnore } from "../steam/pxignore";
import { metaFor } from "../meta";
import { requireExperimentalFeatures } from "../experimental";
import { readPatchBindings, writePatchBindings } from "../machineSettings";
import { prepareProjectConfigWrite, readProjectConfigText } from "../projectConfigFile";
import { detectGameVersion } from "../descriptorMod";
import { LocalizationProject } from "../localizationProject";
import { bundleUri, watchBundle, webviewSource } from "../webviews/devReload";
import { makeNonce } from "../webviews/nonce";
import { patchHtml } from "../webviews/patches/html";
import type { PatchViewMessage, PatchViewState } from "../webviews/patches/messages";
import { patchDocuments, patchDocumentHost } from "./documents";
import { PatchOutputGuard, routePatchLocalization } from "./patchOutput";
import { physicalPath } from "../modWrite";

const CONFIG = "compatibility.json";
const RECENT = "compatibilityPatch.recent.v1";
const RECOVERY = "compatibilityPatch.recovery.v1";
const within = (root: string, file: string) => {
  const relative = path.relative(root, file);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const serial = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
const bytes = (text?: string) => (text === undefined ? undefined : Buffer.from(text, "utf8"));
interface RecoveryStep {
  path: string;
  complete: boolean;
}
interface ReviewPlan {
  output: PatchOutputPlan;
  files: FrozenFileChange[];
  guard: PatchOutputGuard;
  bindingsStamp: string;
  project: string;
}

export class PatchWorkbench implements vscode.Disposable {
  readonly ready: Promise<void>;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly rootWatchers: vscode.Disposable[] = [];
  private readonly policy: PatchPolicy;
  private project?: PatchProject;
  private bindings?: PatchBindings;
  private capture?: PatchCapture;
  private analysis?: PatchAnalysis;
  private plan?: ReviewPlan;
  private choices: Record<string, "current" | "generated"> = {};
  private steps: RecoveryStep[] = [];
  private controller?: AbortController;
  private disposed = false;
  private applying = false;
  private selectedId?: string;
  private readonly previews = new Map<string, string>();
  private readonly previewScheme = `px-patch-${randomUUID()}`;
  private state: PatchViewState = {
    inputs: [],
    rows: [],
    filter: "attention",
    page: 0,
    total: 0,
    counts: { attention: 0, ready: 0, manual: 0, identical: 0 },
    files: [],
    conflicts: [],
    issues: [],
    busy: false,
    status: "",
    needsRefresh: true,
    canPrepare: false,
    canApply: false,
    canRestore: false,
    recoveryBlocked: false,
  };

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly cfg: PxConfig
  ) {
    requireExperimentalFeatures();
    const policy = metaFor(cfg.gameId).compatchComposition;
    if (!policy) throw new Error("Maintained compatibility patches are not supported for this game yet.");
    this.policy = policy;
    const source = webviewSource(context);
    this.panel = vscode.window.createWebviewPanel(
      "px.compatibilityPatch",
      "Compatibility Patch",
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [source.root] }
    );
    const render = () => {
      const nonce = makeNonce();
      this.panel.webview.html = patchHtml({
        scriptSrc: bundleUri(this.panel.webview, source, "patches"),
        nonce,
        csp: `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'`,
      });
    };
    render();
    this.disposables.push(watchBundle(source, "patches", this.panel, render));
    this.panel.webview.onDidReceiveMessage(
      (message) => {
        void this.handle(message);
      },
      undefined,
      this.disposables
    );
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
    this.disposables.push(
      vscode.workspace.registerTextDocumentContentProvider(this.previewScheme, {
        provideTextDocumentContent: (uri) =>
          this.previews.get(uri.toString()) ?? "Preview no longer available.",
      })
    );
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => this.changed(event.document.uri))
    );
    context.subscriptions.push(this);
    this.ready = this.resume();
  }
  get isDisposed(): boolean {
    return this.disposed;
  }
  reveal(): void {
    this.panel.reveal();
  }
  async open(uri: vscode.Uri): Promise<void> {
    requireExperimentalFeatures();
    if (!vscode.workspace.isTrusted || uri.scheme !== "file")
      throw new Error("Open a local patch in a trusted workspace.");
    if (this.state.busy) throw new Error("Wait for the current patch operation to finish.");
    await this.load(uri.fsPath);
    this.post();
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.controller?.abort();
    this.rootWatchers.splice(0).forEach((item) => item.dispose());
    this.disposables.splice(0).forEach((item) => item.dispose());
    this.previews.clear();
    this.panel.dispose();
  }
  private changed(uri: vscode.Uri): void {
    if (this.applying || this.disposed || uri.scheme !== "file" || !this.bindings) return;
    try {
      // Stored bindings, events and buffers can use different junction spellings.
      // Deleted and new paths resolve through their nearest existing parent.
      const file = physicalPath(uri.fsPath);
      if (Object.values(this.bindings.sources).some((root) => within(physicalPath(root), file))) {
        this.state.needsRefresh = true;
        this.plan = undefined;
        this.state.status = "Source content changed. Refresh conflicts before building.";
        this.post();
      } else if (within(physicalPath(this.bindings.output), file)) {
        this.plan = undefined;
        this.state.status = "Output content changed. Build the patch again.";
        this.post();
      }
    } catch (error) {
      this.plan = undefined;
      this.state.needsRefresh = true;
      this.state.error = `Could not check changed patch input: ${String(error)}`;
      this.post();
      return;
    }
  }
  private watchRoots(): void {
    this.rootWatchers.splice(0).forEach((item) => item.dispose());
    if (!this.bindings) return;
    // VS Code filters RelativePattern events before our handler sees them. The
    // workspace glob also receives junction spellings; bound roots cover external mods.
    const patterns = [
      "**/*",
      ...[this.bindings.output, ...Object.values(this.bindings.sources)].map(
        (root) => new vscode.RelativePattern(root, "**/*")
      ),
    ];
    for (const pattern of patterns) {
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      const changed = (uri: vscode.Uri) => this.changed(uri);
      watcher.onDidChange(changed, undefined, this.rootWatchers);
      watcher.onDidCreate(changed, undefined, this.rootWatchers);
      watcher.onDidDelete(changed, undefined, this.rootWatchers);
      this.rootWatchers.push(watcher);
    }
  }
  private get configPath(): string {
    return `${metaFor(this.cfg.gameId).configDirName}/${CONFIG}`;
  }
  private requireProject(): { project: PatchProject; bindings: PatchBindings } {
    if (!this.project || !this.bindings) throw new Error("Create or open a patch project first.");
    return { project: this.project, bindings: this.bindings };
  }
  private post(): void {
    this.state.canCancel = !!this.controller;
    const entries = this.analysis?.entries ?? [];
    this.state.name = this.project?.name;
    this.state.output = this.bindings?.output;
    this.state.inputs =
      this.project?.inputs.map((input) => ({
        ...input,
        path: this.bindings?.sources[input.id],
        version: this.capture?.snapshot.sources.find((source) => source.id === input.id)?.version,
      })) ?? [];
    this.state.counts = {
      attention: entries.filter((entry) => ["needs-decision", "changed", "unsupported"].includes(entry.state))
        .length,
      ready: entries.filter((entry) => entry.state === "ready").length,
      manual: entries.filter(
        (entry) => entry.state === "ready" && entry.decision?.resolution.mode === "defer"
      ).length,
      identical: entries.filter((entry) => entry.state === "identical").length,
    };
    const filtered = entries.filter(
      (entry) =>
        this.state.filter === "all" ||
        (this.state.filter === "ready"
          ? entry.state === "ready"
          : ["needs-decision", "changed", "unsupported"].includes(entry.state))
    );
    this.state.page = Math.max(0, Math.min(this.state.page, Math.ceil(filtered.length / 40) - 1));
    this.state.total = filtered.length;
    this.state.rows = filtered
      .slice(this.state.page * 40, (this.state.page + 1) * 40)
      .map(({ id, name, kind, state }) => ({ id, name, kind, state }));
    this.state.selected = entries.find((entry) => entry.id === this.selectedId);
    this.state.files =
      this.plan?.files.map((file) => ({
        path: file.path,
        action: file.before === undefined ? "create" : file.after === undefined ? "remove" : "update",
      })) ?? [];
    this.state.conflicts = this.plan?.output.conflicts ?? [];
    this.state.issues = this.analysis?.issues ?? [];
    this.state.canRestore = this.steps.length > 0;
    this.state.recoveryBlocked = this.steps.some((step) => !step.complete);
    this.state.canPrepare =
      !!this.analysis &&
      !this.state.needsRefresh &&
      !this.state.busy &&
      !this.state.recoveryBlocked &&
      this.state.counts.attention === 0;
    this.state.canApply =
      !!this.plan?.files.length &&
      !this.plan.output.conflicts.length &&
      !this.state.busy &&
      !this.state.needsRefresh &&
      !this.state.recoveryBlocked;
    if (!this.disposed) void this.panel.webview.postMessage({ type: "state", state: this.state });
  }
  private async resume(): Promise<void> {
    try {
      const id = this.context.workspaceState.get<string>(RECENT);
      if (id) {
        const local = readPatchBindings(id);
        if (local.error) throw new Error(local.error);
        if (local.bindings) await this.load(local.bindings.output);
      }
    } catch (error) {
      this.state.error = String(error);
    }
    this.post();
  }
  private async load(root: string): Promise<void> {
    root = await fs.realpath(root);
    await this.assertOutputBoundary(root);
    const text = readProjectConfigText(root, metaFor(this.cfg.gameId), CONFIG);
    if (text === undefined)
      throw new Error("This folder has no compatibility patch project. Use Create patch to start a new one.");
    const project = parsePatchProject(text.replace(/^\uFEFF/, ""), this.cfg.gameId);
    const local = readPatchBindings(project.id);
    if (local.error) throw new Error(local.error);
    const bindings = { ...local.bindings, output: root, sources: local.bindings?.sources ?? {} };
    this.assertWritable();
    await writePatchBindings(project.id, bindings, local.stamp);
    this.project = project;
    this.bindings = bindings;
    this.watchRoots();
    this.analysis = undefined;
    this.capture = undefined;
    this.plan = undefined;
    this.choices = {};
    this.selectedId = undefined;
    this.steps = this.context.globalState.get<Record<string, RecoveryStep[]>>(RECOVERY)?.[project.id] ?? [];
    // A crash before journal creation leaves no output to restore.
    this.steps = (
      await Promise.all(
        this.steps.map(async (step) => {
          try {
            await fs.lstat(step.path);
            return step;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT" && !step.complete) return undefined;
            throw error;
          }
        })
      )
    ).filter((step): step is RecoveryStep => !!step);
    await this.saveRecovery();
    await this.context.workspaceState.update(RECENT, project.id);
    this.state.needsRefresh = true;
    this.state.status = "Connect the source folders, match their launcher order, then scan.";
  }
  private async saveRecovery(): Promise<void> {
    if (!this.project) return;
    const all = this.context.globalState.get<Record<string, RecoveryStep[]>>(RECOVERY) ?? {};
    await this.context.globalState.update(RECOVERY, { ...all, [this.project.id]: this.steps });
  }
  private async saveProject(next: PatchProject): Promise<void> {
    const { project, bindings } = this.requireProject();
    const write = await prepareProjectConfigWrite(bindings.output, metaFor(this.cfg.gameId), CONFIG);
    if (
      !write.text ||
      JSON.stringify(parsePatchProject(write.text.replace(/^\uFEFF/, ""), this.cfg.gameId)) !==
        JSON.stringify(project)
    )
      throw new Error(
        "Patch settings changed in another editor. Open the patch again before saving decisions."
      );
    this.assertWritable();
    await this.assertOutputBoundary(bindings.output);
    this.assertWritable();
    await write.write((write.text.startsWith("\uFEFF") ? "\uFEFF" : "") + serial(next));
    this.project = next;
    this.plan = undefined;
  }
  private async descriptorName(root: string): Promise<string> {
    const text =
      patchDocuments(root).find((doc) => doc.path === "descriptor.mod")?.text ??
      (await fs.readFile(path.join(root, "descriptor.mod"), "utf8"));
    const parsed = parseScript(text);
    if (parsed.errors.length) throw new Error(`Fix descriptor.mod in ${path.basename(root)} first.`);
    const names = parsed.root.statements.filter(
      (statement) => statement.kind === "assignment" && statement.key.text === "name"
    );
    const name =
      names.length === 1 && names[0].kind === "assignment" && names[0].value?.kind === "scalar"
        ? names[0].value.text
        : undefined;
    if (!name?.trim()) throw new Error(`The mod in ${root} needs one name in descriptor.mod.`);
    return name;
  }
  private async create(name: string): Promise<void> {
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 100 ||
      /[\r\n]/.test(name) ||
      name.includes(String.fromCharCode(0))
    )
      throw new Error("Enter a patch name of 1 to 100 characters.");
    const chosen = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      title: "Choose the parent folder for the new patch",
    });
    if (!chosen?.[0]) return;
    const parent = await fs.realpath(chosen[0].fsPath);
    const folder =
      name
        .trim()
        .replace(/[^a-zA-Z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 70) || "compatibility_patch";
    const root = path.join(parent, folder);
    await this.assertOutputBoundary(root);
    this.assertWritable();
    if (
      Object.values(this.bindings?.sources ?? {}).some(
        (source) => within(source, root) || within(root, source)
      )
    )
      throw new Error("Create the patch outside its read-only source mods.");
    const meta = metaFor(this.cfg.gameId);
    const gameModDir = gameDocsSubdir(meta, "mod");
    if (!gameModDir)
      throw new Error(
        "The game's user mod folder could not be located. Set up the game before creating a patch."
      );
    const pointer = path.join(gameModDir, `${folder}.mod`);
    try {
      await fs.lstat(pointer);
      throw new Error("A launcher link with this patch name already exists. Choose another name.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.assertWritable();
    await fs.mkdir(root);
    const version = detectGameVersion(this.cfg.gamePath) ?? "";
    const descriptor = "\uFEFF" + scaffoldDescriptor(name.trim(), wildcardVersion(version) ?? "");
    this.assertWritable();
    await fs.writeFile(path.join(root, "descriptor.mod"), descriptor, { flag: "wx" });
    const project: PatchProject = {
      version: 1,
      id: randomUUID(),
      gameId: this.cfg.gameId,
      name: name.trim(),
      inputs: [],
      decisions: {},
      generated: {},
    };
    const write = await prepareProjectConfigWrite(root, metaFor(this.cfg.gameId), CONFIG);
    this.assertWritable();
    await write.write(serial(project));
    const gameChoice = await prepareProjectConfigWrite(root, meta, "project.json");
    this.assertWritable();
    await gameChoice.write(serial({ version: 1, gameId: meta.id }));
    this.assertWritable();
    ensurePxIgnore(root);
    createLauncherLink(meta, gameModDir, folder, root, descriptor);
    await this.load(root);
    this.state.status =
      "Patch created and registered with the launcher. Add source mods, then match their launcher order. Enable the finished patch in your playset after those mods.";
  }
  private sourceDocuments() {
    return Object.entries(this.bindings?.sources ?? {})
      .filter(([sourceId]) => this.project?.inputs.some((input) => input.id === sourceId))
      .flatMap(([sourceId, root]) => patchDocuments(root).map((document) => ({ ...document, sourceId })));
  }
  private async saveSetup(next: PatchProject, local: PatchBindings): Promise<void> {
    const { project, bindings } = this.requireProject();
    const stamp = this.assertBindings();
    this.assertWritable();
    await writePatchBindings(project.id, local, stamp);
    const written = readPatchBindings(project.id).stamp;
    try {
      await this.saveProject(next);
    } catch (error) {
      try {
        await writePatchBindings(project.id, bindings, written);
      } catch (rollback) {
        throw new Error(
          `${String(error)} Local folder rollback also failed: ${String(rollback)}. Open the project again.`
        );
      }
      throw error;
    }
    this.bindings = local;
    this.watchRoots();
  }
  private assertWritable(): void {
    requireExperimentalFeatures();
    if (!vscode.workspace.isTrusted)
      throw new Error("Trust this workspace before changing a compatibility patch.");
  }
  private async assertOutputBoundary(root: string): Promise<void> {
    if (!this.cfg.gamePath) return;
    const game = await fs.realpath(this.cfg.gamePath);
    if (within(game, root) || within(root, game))
      throw new Error("The game installation is read-only. Open a separate patch mod.");
  }
  private assertBindings(): string {
    const { project, bindings } = this.requireProject();
    const current = readPatchBindings(project.id);
    if (current.error || JSON.stringify(current.bindings) !== JSON.stringify(bindings))
      throw new Error(current.error ?? "Source folder bindings changed. Open the patch again.");
    return current.stamp;
  }
  private async scan(): Promise<void> {
    const { project, bindings } = this.requireProject();
    if (project.inputs.length < 2) throw new Error("Add at least two source mods.");
    this.assertBindings();
    this.controller = new AbortController();
    this.state.status = "Reading source mods...";
    this.post();
    const capture = await capturePatchSources(project, bindings, this.policy, {
      documents: this.sourceDocuments(),
      signal: this.controller.signal,
    });
    const analysis = await analyzePatch(capture.snapshot, project, this.policy);
    if (this.controller.signal.aborted)
      throw new Error("Scan cancelled. The previous results are still available.");
    this.capture = capture;
    this.analysis = analysis;
    this.plan = undefined;
    this.choices = {};
    this.state.needsRefresh = false;
    this.selectedId =
      analysis.entries.find((entry) => ["needs-decision", "changed", "unsupported"].includes(entry.state))
        ?.id ?? analysis.entries[0]?.id;
    this.state.status = `Scanned ${analysis.sourceCount} mods and ${analysis.fileCount} files. Review overlapping content before building.`;
  }
  private async build(): Promise<void> {
    const { project, bindings } = this.requireProject();
    if (!this.analysis || !this.capture || this.state.needsRefresh)
      throw new Error("Scan or refresh the mods before building.");
    const bindingsStamp = this.assertBindings();
    this.controller = new AbortController();
    this.state.status = "Building the patch and preserving output edits...";
    this.post();
    await assertPatchSourcesFresh(this.capture, project, bindings, this.policy, {
      documents: this.sourceDocuments(),
      signal: this.controller.signal,
    });
    const desired = await generatePatch(this.analysis, project);
    if (desired.issues.length) throw new Error(desired.issues.join("\n"));
    const outputCfg = { ...this.cfg, modPath: bindings.output };
    const routing = new LocalizationProject(outputCfg);
    const routed = await routePatchLocalization(project, desired, outputCfg);
    routing.assertCurrent();
    const guard = await PatchOutputGuard.capture(bindings.output, outputCfg, [
      ...new Set([
        ...Object.keys(project.generated),
        ...routed.desired.files.map((file) => file.path),
        this.configPath,
        "descriptor.mod",
      ]),
    ]);
    if (
      JSON.stringify(parsePatchProject(guard.text(this.configPath) ?? "", this.cfg.gameId)) !==
      JSON.stringify(project)
    )
      throw new Error("Patch settings changed. Open the project again.");
    const output = await preparePatchOutput(routed.project, routed.desired, guard.files(), this.choices);
    output.files = output.files.filter((file) => {
      if (file.after === undefined) return true;
      try {
        file.after = normalizePatchFile(file.path, file.after, this.policy);
        return file.after !== file.before;
      } catch (error) {
        output.conflicts.push({
          path: file.path,
          reason: error instanceof Error ? error.message : String(error),
          current: file.before,
          generated:
            routed.desired.files.find((desired) => desired.path === file.path)?.text ??
            project.generated[file.path]?.original,
        });
        return false;
      }
    });
    const descriptor = guard.text("descriptor.mod");
    if (!descriptor || parseScript(descriptor).errors.length)
      throw new Error("The patch needs a valid descriptor.mod.");
    const names = this.capture.snapshot.sources.map((source) => source.name);
    if (new Set(names).size !== names.length)
      throw new Error("Source mod names must be unique for launcher dependencies.");
    const prior = Array.isArray(project.dependencyNames) ? project.dependencyNames : [];
    const dependencies = [
      ...new Set([
        ...readDescriptorBlock(descriptor, "dependencies").filter((name) => !prior.includes(name)),
        ...names,
      ]),
    ];
    const nextDescriptor = upsertDescriptorBlock(descriptor, "dependencies", dependencies);
    if (nextDescriptor !== descriptor)
      output.files.push({ path: "descriptor.mod", before: descriptor, after: nextDescriptor });
    output.project.dependencyNames = names;
    const text = (guard.text(this.configPath)?.startsWith("\uFEFF") ? "\uFEFF" : "") + serial(output.project);
    if (text !== guard.text(this.configPath))
      output.files.push({ path: this.configPath, before: guard.text(this.configPath), after: text });
    await guard.assertCurrent();
    if (this.controller.signal.aborted) throw new Error("Patch build cancelled.");
    this.plan = {
      output,
      guard,
      files: output.files.map((file) => ({
        path: file.path,
        before: bytes(file.before),
        after: bytes(file.after),
      })),
      bindingsStamp,
      project: JSON.stringify(project),
    };
    this.state.status = output.conflicts.length
      ? "Some output edits need a choice before the patch can be applied."
      : this.plan.files.length
        ? "Patch built. Review the file changes, then apply."
        : "The patch already matches the saved decisions.";
  }
  private async apply(): Promise<void> {
    const { project, bindings } = this.requireProject();
    const plan = this.plan;
    if (
      !plan ||
      !this.capture ||
      !plan.files.length ||
      plan.output.conflicts.length ||
      this.state.needsRefresh
    )
      throw new Error("Build and review a current patch before applying.");
    for (const file of plan.files) {
      const doc = vscode.workspace.textDocuments.find(
        (doc) =>
          doc.uri.scheme === "file" &&
          path.relative(doc.uri.fsPath, path.join(bindings.output, file.path)) === ""
      );
      if (doc && file.after) {
        const bom = file.after[0] === 239 && file.after[1] === 187 && file.after[2] === 191;
        if (doc.encoding !== (bom ? "utf8bom" : "utf8"))
          throw new Error(
            `Save ${file.path} as ${bom ? "UTF-8 with BOM" : "UTF-8"}, then build the patch again.`
          );
      }
    }
    const storage = path.join(this.context.globalStorageUri.fsPath, "compatibility");
    await fs.mkdir(storage, { recursive: true });
    const step: RecoveryStep = { path: path.join(storage, `patch-${randomUUID()}.json`), complete: false };
    this.steps.push(step);
    await this.saveRecovery();
    this.applying = true;
    try {
      const result = await applyFileChanges(plan.files, {
        root: bindings.output,
        protectedRoots: [
          ...Object.values(bindings.sources),
          ...(this.cfg.gamePath ? [this.cfg.gamePath] : []),
        ],
        journalPath: step.path,
        documentHost: patchDocumentHost(bindings.output),
        documents: patchDocuments(bindings.output),
        assertFresh: async () => {
          this.assertWritable();
          if (JSON.stringify(this.project) !== plan.project || this.assertBindings() !== plan.bindingsStamp)
            throw new Error("Patch setup changed. Build again.");
          await assertPatchSourcesFresh(this.capture!, project, bindings, this.policy, {
            documents: this.sourceDocuments(),
          });
          await plan.guard.assertCurrent();
          this.assertWritable();
        },
        onApplied: async (file) => {
          plan.guard.applied(file);
        },
      });
      if (result.status === "applied") {
        step.complete = true;
        this.project = plan.output.project;
        this.state.status = `Applied ${result.completed.length} files. ${this.state.counts.manual ? `${this.state.counts.manual} decisions still need manual work. ` : ""}Load the patch after its source mods and test it in the game.`;
      } else {
        this.state.error = result.error;
        this.state.status = `Apply stopped after ${result.completed.length} files. Restore this update before continuing.`;
      }
      try {
        await fs.lstat(step.path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") this.steps.pop();
        else throw error;
      }
      await this.saveRecovery();
    } finally {
      this.applying = false;
      this.plan = undefined;
    }
  }
  private async restore(): Promise<void> {
    const { bindings } = this.requireProject();
    await this.assertOutputBoundary(bindings.output);
    this.assertWritable();
    const step = this.steps.at(-1);
    if (!step) throw new Error("No update is available to restore.");
    const storage = path.join(this.context.globalStorageUri.fsPath, "compatibility");
    if (
      path.relative(storage, path.dirname(step.path)) !== "" ||
      !/^patch-[\w-]+\.json$/.test(path.basename(step.path))
    )
      throw new Error("Invalid patch recovery location.");
    const stat = await fs.lstat(step.path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Invalid recovery file.");
    const journal = JSON.parse(await fs.readFile(step.path, "utf8")) as {
      version?: number;
      root?: string;
      roots?: { mod?: string };
    };
    const journalRoot = journal.version === 2 ? journal.root : journal.roots?.mod;
    if (!journalRoot || path.relative(await fs.realpath(bindings.output), journalRoot) !== "")
      throw new Error("This journal belongs to another output folder.");
    this.applying = true;
    try {
      const result = await restoreFileChanges(step.path, {
        documentHost: patchDocumentHost(bindings.output),
      });
      this.state.status = `Recovery ${result.status}: ${result.completed.length} files restored.`;
      this.state.error = [result.error, ...(result.conflicts ?? [])].filter(Boolean).join("\n") || undefined;
      if (result.status === "restored") {
        this.steps.pop();
        const text = readProjectConfigText(bindings.output, metaFor(this.cfg.gameId), CONFIG);
        this.project = parsePatchProject(text ?? "", this.cfg.gameId);
      } else step.complete = false;
      await this.saveRecovery();
      this.plan = undefined;
      this.state.needsRefresh = true;
    } finally {
      this.applying = false;
    }
  }
  async handle(message: PatchViewMessage): Promise<void> {
    if (this.disposed || !message || typeof message.type !== "string") return;
    if (message.type === "ready") {
      this.post();
      return;
    }
    if (message.type === "cancel") {
      this.controller?.abort();
      return;
    }
    if (this.state.busy) return;
    this.state.busy = true;
    this.state.error = undefined;
    this.post();
    try {
      requireExperimentalFeatures();
      if (!vscode.workspace.isTrusted)
        throw new Error("Trust this workspace before using compatibility patches.");
      if (
        this.steps.some((step) => !step.complete) &&
        !["restore", "select", "source", "diff", "filter", "page", "migrations"].includes(message.type)
      )
        throw new Error("Restore the incomplete update before changing the patch.");
      switch (message.type) {
        case "create":
          await this.create(message.name);
          break;
        case "open": {
          const folder = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            title: "Open a compatibility patch mod",
          });
          if (folder?.[0]) await this.load(folder[0].fsPath);
          break;
        }
        case "add":
        case "bind": {
          const { project, bindings } = this.requireProject();
          if (message.type === "bind" && !project.inputs.some((input) => input.id === message.id))
            throw new Error("Unknown source mod.");
          const folders = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: message.type === "add",
            title: message.type === "add" ? "Select the source mods" : "Connect this source mod",
          });
          if (!folders?.length) break;
          const next = structuredClone(project),
            local = structuredClone(bindings);
          for (const folder of folders) {
            const root = await fs.realpath(folder.fsPath);
            if (
              [
                local.output,
                ...Object.entries(local.sources)
                  .filter(([sourceId]) => message.type !== "bind" || sourceId !== message.id)
                  .map(([, root]) => root),
              ].some((other) => within(other, root) || within(root, other))
            )
              throw new Error(
                "Source mods and output must be separate folders. Remove a source before adding it again."
              );
            const name = await this.descriptorName(root);
            const id = message.type === "bind" ? message.id : randomUUID();
            local.sources[id] = root;
            if (message.type === "add") next.inputs.push({ id, name });
            else next.inputs.find((input) => input.id === id)!.name = name;
          }
          await this.saveSetup(next, local);
          this.state.needsRefresh = true;
          this.state.status = "Source mods updated. Match their launcher order, then scan.";
          break;
        }
        case "move":
        case "remove": {
          const { project } = this.requireProject();
          const next = structuredClone(project);
          const index = next.inputs.findIndex((input) => input.id === message.id);
          if (index < 0) throw new Error("Unknown source mod.");
          if (message.type === "remove") next.inputs.splice(index, 1);
          else {
            if (message.direction !== -1 && message.direction !== 1) throw new Error("Invalid move.");
            const target = index + message.direction;
            if (target < 0 || target >= next.inputs.length) break;
            [next.inputs[index], next.inputs[target]] = [next.inputs[target], next.inputs[index]];
          }
          if (message.type === "remove") {
            const local = structuredClone(this.bindings!);
            delete local.sources[message.id];
            await this.saveSetup(next, local);
          } else await this.saveProject(next);
          this.state.needsRefresh = true;
          break;
        }
        case "scan":
          await this.scan();
          break;
        case "select":
          if (!this.analysis?.entries.some((entry) => entry.id === message.id))
            throw new Error("Unknown conflict.");
          this.selectedId = message.id;
          break;
        case "filter":
          if (!["attention", "ready", "all"].includes(message.value)) throw new Error("Invalid filter.");
          this.state.filter = message.value;
          this.state.page = 0;
          break;
        case "page":
          if (!Number.isSafeInteger(message.value) || message.value < 0) throw new Error("Invalid page.");
          this.state.page = message.value;
          break;
        case "resolve": {
          const { project } = this.requireProject();
          if (!this.analysis || this.state.needsRefresh)
            throw new Error("Refresh conflicts before saving a decision.");
          const next = await resolvePatchEntry(this.analysis, project, message.id, message.resolution);
          await this.saveProject(next);
          this.analysis = await analyzePatch(this.analysis.snapshot, next, this.policy);
          this.choices = {};
          this.state.status =
            message.resolution.mode === "defer"
              ? "Saved for manual work. This item will need review again if its inputs change."
              : "Decision saved. It will be reused while its inputs and loading rules stay the same.";
          break;
        }
        case "source": {
          const entry = this.analysis?.entries.find((entry) => entry.id === message.id);
          const contribution = entry?.contributors.find((c) => c.id === message.contributorId);
          const root = contribution && this.bindings?.sources[contribution.sourceId];
          if (!contribution || !root) throw new Error("Source contribution is no longer available.");
          const uri = vscode.Uri.parse(
            `${this.previewScheme}:/source-${randomUUID()}/${path.basename(contribution.path)}`
          );
          const captured = this.capture?.snapshot.sources
            .find((source) => source.id === contribution.sourceId)
            ?.files.find((file) => file.path === contribution.path);
          this.previews.set(
            uri.toString(),
            captured?.text ?? `${contribution.context}\n${contribution.text}`
          );
          await vscode.window.showTextDocument(uri, { preview: true });
          break;
        }
        case "prepare":
          this.choices = {};
          await this.build();
          break;
        case "output-choice":
          if (
            !this.plan?.output.conflicts.some((conflict) => conflict.path === message.path) ||
            !["current", "generated"].includes(message.choice)
          )
            throw new Error("Choose a current output conflict.");
          this.choices[message.path] = message.choice;
          await this.build();
          break;
        case "diff": {
          const file = this.plan?.output.files.find((file) => file.path === message.path);
          const conflict = this.plan?.output.conflicts.find((file) => file.path === message.path);
          if (!file && !conflict) throw new Error("Build the patch before opening its changes.");
          const left = vscode.Uri.parse(
              `${this.previewScheme}:/before-${randomUUID()}/${path.basename(message.path)}`
            ),
            right = vscode.Uri.parse(
              `${this.previewScheme}:/after-${randomUUID()}/${path.basename(message.path)}`
            );
          this.previews.set(left.toString(), file?.before ?? conflict?.current ?? "");
          this.previews.set(right.toString(), file?.after ?? conflict?.generated ?? "");
          await vscode.commands.executeCommand("vscode.diff", left, right, message.path, { preview: true });
          break;
        }
        case "apply":
          await this.apply();
          break;
        case "restore":
          await this.restore();
          break;
        case "migrations":
          await vscode.commands.executeCommand("px.openMigrations");
          break;
      }
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : String(error);
      this.state.status = "";
    } finally {
      this.state.busy = false;
      this.controller = undefined;
      this.post();
    }
  }
}

export function registerCompatibilityPatches(context: vscode.ExtensionContext, getCfg: () => PxConfig): void {
  let current: PatchWorkbench | undefined;
  context.subscriptions.push(
    vscode.commands.registerCommand("px.openCompatibilityPatch", async (uri?: vscode.Uri) => {
      requireExperimentalFeatures();
      if (!current || current.isDisposed) current = new PatchWorkbench(context, getCfg());
      else current.reveal();
      await current.ready;
      if (uri) await current.open(uri);
    })
  );
}
