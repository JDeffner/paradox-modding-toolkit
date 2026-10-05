import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { MigrationManifest, MigrationSession } from "@px-lsp/protocol/migration";
import { planMigrationRoutes } from "@px-lsp/server/migrations/routes";
import type { MigrationSnapshot, PreparedMigration } from "@px-lsp/server/migrations/sdk";
import {
  captureMigration,
  assertMigrationFresh,
  applyMigration,
  restoreMigration,
  type MigrationDocument,
  type MigrationDocumentHost,
} from "@px-lsp/server/migrations/node/files";
import { hashSnapshot } from "@px-lsp/server/migrations/engine";
import {
  runMigrationWorker,
  type RecipeSelection,
  type MigrationWorkerRequest,
} from "@px-lsp/server/migrations/node/runner";
import type { PxConfig } from "../config";
import { requireExperimentalFeatures } from "../experimental";
import { migrationHtml } from "../webviews/compatch/html";
import type { MigrationViewMessage, MigrationViewState } from "../webviews/compatch/messages";
import { makeNonce } from "../webviews/nonce";
import { bundleUri, watchBundle, webviewSource } from "../webviews/devReload";
import { migrationTemplate, advisoryTemplate } from "./migrationTemplate";
import { migrationBinaryReview } from "./migrationBinaryReview";
import { detectGameVersion } from "../descriptorMod";
import { entryBlock, entryCompleted, clearDownstream, mergeMigrationCatalog } from "./migrationRouteSession";
import { discoverMigrationLibraryFiles, migrationLibraryPathKey } from "./migrationLibraryFiles";
import { patchDocuments, patchDocumentHost } from "./documents";

const SESSION_KEY = "migrationSession.v2";
const JOURNAL_KEY = "migrationJournal.v1";
const JOURNALS_KEY = "migrationJournals.v2";
const PENDING_JOURNAL_KEY = "pendingMigrationJournal.v1";
interface RecoveryStep {
  path: string;
  entryId?: string;
  complete: boolean;
}
const manifestNeedsCode = (entry?: MigrationManifest) => entry?.detection === "script";
const decodeText = (bytes?: Uint8Array): string | undefined => {
  if (!bytes) return "";
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return text.includes("\0") ? undefined : text;
  } catch {
    return undefined;
  }
};
const within = (root: string, filename: string) => {
  const relative = path.relative(root, filename);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const sameFile = (left: string, right: string) => path.relative(left, right) === "";

export class MigrationWorkbench implements vscode.Disposable {
  readonly ready: Promise<void>;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private session: MigrationSession;
  private state: MigrationViewState;
  private selection: RecipeSelection | undefined;
  private snapshot?: MigrationSnapshot;
  private plan?: PreparedMigration;
  private capturedDocuments: MigrationDocument[] = [];
  private controller?: AbortController;
  private journals: RecoveryStep[] = [];
  private builtin: MigrationManifest[] = [];
  private readonly trusted = new Map<string, RecipeSelection>();
  private applying = false;
  private disposed = false;
  private generation = 0;
  private readonly previews = new Map<string, string>();
  private readonly previewScheme = `px-migration-${randomUUID()}`;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly cfg: PxConfig
  ) {
    const saved = context.workspaceState.get<MigrationSession>(SESSION_KEY);
    this.session =
      saved?.version === 2 &&
      saved.gameId === cfg.gameId &&
      saved.roots &&
      saved.answers &&
      saved.localEntries &&
      saved.completions &&
      saved.references
        ? saved
        : {
            version: 2,
            gameId: cfg.gameId,
            roots: { mod: cfg.modPath ?? undefined },
            answers: {},
            fromVersion: "",
            toVersion: "",
            references: {},
            localEntries: [],
            completions: {},
          };
    this.journals = context.workspaceState.get<RecoveryStep[]>(JOURNALS_KEY) ?? [];
    const legacy = context.workspaceState.get<string>(JOURNAL_KEY);
    if (!this.journals.length && legacy) this.journals.push({ path: legacy, complete: false });
    this.state = {
      roots: this.session.roots,
      catalog: [],
      fromVersion: this.session.fromVersion,
      toVersion: this.session.toVersion,
      versions: [],
      routes: [],
      issues: [],
      entries: {},
      references: [],
      local: false,
      answers: {},
      missing: [],
      busy: false,
      canCancel: false,
      status: "Choose the mod and its source and target game versions.",
      canRestore: !!this.journals.length,
    };
    const source = webviewSource(context);
    this.panel = vscode.window.createWebviewPanel(
      "px.migrations",
      "Mod Compatibility",
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [source.root] }
    );
    const render = () => {
      const nonce = makeNonce();
      this.panel.webview.html = migrationHtml({
        scriptSrc: bundleUri(this.panel.webview, source, "compatch"),
        nonce,
        csp: `default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'`,
      });
    };
    render();
    this.disposables.push(watchBundle(source, "compatch", this.panel, render));
    this.panel.webview.onDidReceiveMessage(
      (message: MigrationViewMessage) => {
        void this.handle(message);
      },
      undefined,
      this.disposables
    );
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
    // Each panel uses its own provider so closed previews never expose newer output.
    this.disposables.push(
      vscode.workspace.registerTextDocumentContentProvider(this.previewScheme, {
        provideTextDocumentContent: (uri) =>
          this.previews.get(uri.toString()) ?? "Preview no longer available.",
      })
    );
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (
          !this.applying &&
          this.session.roots.mod &&
          within(this.session.roots.mod, event.document.uri.fsPath)
        )
          void this.sourceChanged("Editor content changed. Inspect again before preparing a new preview.");
      })
    );
    const watcher = vscode.workspace.createFileSystemWatcher("**/*");
    const changed = async (uri: vscode.Uri) => {
      if (
        !this.applying &&
        [
          this.session.roots.mod,
          ...Object.values(this.session.references),
          ...this.session.localEntries.map((entry) => entry.localPath),
        ].some((root) => root && within(root, uri.fsPath))
      ) {
        await this.sourceChanged("Source files changed. Inspect again before applying.");
      }
    };
    watcher.onDidChange(changed, undefined, this.disposables);
    watcher.onDidCreate(changed, undefined, this.disposables);
    watcher.onDidDelete(changed, undefined, this.disposables);
    this.disposables.push(watcher);
    context.subscriptions.push(this);
    this.ready = this.handle({ type: "ready" });
  }
  reveal(): void {
    this.panel.reveal();
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.controller?.abort();
    this.disposables.splice(0).forEach((item) => item.dispose());
    this.previews.clear();
    this.panel.dispose();
  }
  get isDisposed(): boolean {
    return this.disposed;
  }
  private post(): void {
    this.syncState();
    if (!this.disposed) void this.panel.webview.postMessage({ type: "state", state: this.state });
  }
  private rootsFor(entry: MigrationManifest): MigrationSession["roots"] {
    const roots: MigrationSession["roots"] = { mod: this.session.roots.mod };
    if (entry.inputs.some((input) => input.root === "source"))
      roots.source = this.session.references[entry.fromVersion];
    if (entry.inputs.some((input) => input.root === "target"))
      roots.target = this.session.references[entry.toVersion];
    return roots;
  }
  private syncState(): void {
    this.state.canCancel = this.state.busy && !!this.controller && !this.applying;
    this.state.fromVersion = this.session.fromVersion;
    this.state.toVersion = this.session.toVersion;
    this.state.route = this.state.routes.find((route) => route.id === this.session.routeId);
    this.session.roots = this.state.selected
      ? this.rootsFor(this.state.selected)
      : { mod: this.session.roots.mod };
    this.state.roots = this.session.roots;
    this.state.entries = Object.fromEntries(
      this.state.catalog.map((entry) => [
        entry.id,
        {
          trusted:
            !this.session.localEntries.some((item) => item.manifest.id === entry.id) ||
            this.trusted.has(entry.id),
          blocked: this.journals.some((step) => !step.complete)
            ? "Restore the incomplete migration before continuing."
            : entryBlock(this.session, this.state.catalog, this.state.route, entry),
          completion: entryCompleted(this.session, entry) ? this.session.completions[entry.id] : undefined,
        },
      ])
    );
    this.state.nextEntryId = this.state.route?.entryIds.find((id) => {
      const entry = this.state.catalog.find((item) => item.id === id);
      return entry && !entryCompleted(this.session, entry) && !this.state.entries[id]?.blocked;
    });
    const versions = new Set([
      this.session.fromVersion,
      this.session.toVersion,
      ...Object.keys(this.session.references),
    ]);
    for (const transition of this.state.route?.transitions ?? []) {
      versions.add(transition.fromVersion);
      versions.add(transition.toVersion);
    }
    this.state.references = [...versions].filter(Boolean).map((version) => ({
      version,
      path: this.session.references[version],
      verified: detectGameVersion(this.session.references[version] ?? null) === version,
    }));
    const selectedLocal = this.session.localEntries.find(
      (item) => item.manifest.id === this.state.selected?.id
    );
    this.state.localFormat = selectedLocal
      ? /\.json$/i.test(selectedLocal.localPath)
        ? "data"
        : "code"
      : undefined;
    this.state.canRestore = this.journals.length > 0;
  }
  private planRoutes(): void {
    const result = planMigrationRoutes(
      this.state.catalog,
      this.session.gameId,
      this.session.fromVersion,
      this.session.toVersion
    );
    this.state.versions = result.versions.length
      ? result.versions
      : [...new Set(this.state.catalog.flatMap((entry) => [entry.fromVersion, entry.toVersion]))];
    this.state.routes = result.routes;
    this.state.issues = this.session.fromVersion && this.session.toVersion ? result.issues : [];
    if (!result.routes.some((route) => route.id === this.session.routeId)) {
      this.session.routeId = result.routes.length === 1 ? result.routes[0].id : undefined;
    }
    this.syncState();
  }
  private requireEntry(code = false): MigrationManifest {
    this.syncState();
    const entry = this.state.selected;
    if (!entry) throw new Error("Select a migration entry first.");
    const status = this.state.entries[entry.id];
    if (status?.blocked) throw new Error(status.blocked);
    if (code && !status?.trusted)
      throw new Error("Reload and explicitly trust this local artifact before running its code.");
    if (code && this.state.local && !vscode.workspace.isTrusted)
      throw new Error("Trust this workspace before running local author code.");
    for (const input of entry.inputs) {
      if (input.root === "mod") continue;
      const version = input.root === "source" ? entry.fromVersion : entry.toVersion;
      const folder = this.session.references[version];
      const detected = detectGameVersion(folder ?? null);
      if (detected && detected !== version)
        throw new Error(
          `Reference ${version} now reports ${detected}. Select the correct folder before continuing.`
        );
    }
    return entry;
  }
  private async checkpoint(ignoreModPaths: string[] = [], includeSelected = false): Promise<string> {
    const documents = await this.documents();
    const hash = createHash("sha256");
    hash.update(
      JSON.stringify({
        route: this.state.route,
        mod: this.session.roots.mod,
      })
    );
    const artifactHashes = new Map<string, string>();
    for (const id of this.state.route?.entryIds ?? []) {
      const entry = this.state.catalog.find((item) => item.id === id)!;
      const roots = this.rootsFor(entry);
      const tracked =
        entryCompleted(this.session, entry) || (includeSelected && this.state.selected?.id === entry.id);
      const snapshot = tracked
        ? await captureMigration(roots, entry, this.session.gameId, documents, {
            signal: this.controller?.signal,
            capture:
              this.session.completions[entry.id]?.capture ??
              (includeSelected && this.state.selected?.id === entry.id
                ? (this.snapshot?.capture ?? this.plan?.capture)
                : undefined),
          })
        : undefined;
      // Progress tracks effective text and disk bytes, not editor lifecycle or undo version counters.
      if (snapshot)
        for (const key of Object.keys(snapshot.metadata)) {
          if (key.startsWith("editor:")) delete snapshot.metadata[key];
        }
      if (snapshot && ignoreModPaths.length) {
        snapshot.listings = snapshot.listings?.filter(
          (file) => file.root !== "mod" || !ignoreModPaths.includes(file.path)
        );
        snapshot.files = snapshot.files.filter(
          (file) => file.root !== "mod" || !ignoreModPaths.includes(file.path)
        );
        for (const key of Object.keys(snapshot.metadata)) {
          const relative = key.startsWith("disk:mod:")
            ? key.slice(9)
            : key.startsWith("editor:")
              ? key.slice(7)
              : undefined;
          if (relative !== undefined && ignoreModPaths.includes(relative)) delete snapshot.metadata[key];
          if (key.startsWith("listing:mod:")) {
            const listing = JSON.parse(snapshot.metadata[key]) as string[];
            snapshot.metadata[key] = JSON.stringify(
              listing.filter((item) => {
                const relative = item.slice(0, item.lastIndexOf(":"));
                return !ignoreModPaths.some(
                  (changed) => relative === changed || !relative || changed.startsWith(relative + "/")
                );
              })
            );
          }
        }
      }
      const artifact =
        this.session.localEntries.find((item) => item.manifest.id === id)?.localPath ??
        this.context.asAbsolutePath("dist/migrationWorker.js");
      if (!artifactHashes.has(artifact))
        artifactHashes.set(
          artifact,
          createHash("sha256")
            .update(await fs.readFile(artifact))
            .digest("hex")
        );
      hash.update(
        JSON.stringify({
          entry,
          snapshot: snapshot ? await hashSnapshot(snapshot) : undefined,
          referenceVersions: tracked
            ? {
                source: roots.source ? detectGameVersion(roots.source) : undefined,
                target: roots.target ? detectGameVersion(roots.target) : undefined,
              }
            : undefined,
          artifact,
          codeHash: artifactHashes.get(artifact),
        })
      );
    }
    return hash.digest("hex");
  }
  private async validateCheckpoint(): Promise<void> {
    if (!this.session.checkpoint) return;
    let current: string | undefined;
    try {
      current = await this.checkpoint();
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : String(error);
    }
    if (current !== this.session.checkpoint) {
      this.session.completions = {};
      this.session.checkpoint = undefined;
      this.invalidate("Migration inputs changed. Route progress was reopened; saved answers remain.");
      this.state.status = "Migration inputs changed. Route progress was reopened; saved answers remain.";
      await this.persist();
    }
  }
  private async sourceChanged(message: string): Promise<void> {
    if (this.disposed || this.state.busy || this.applying) return;
    const generation = this.generation;
    const checkpoint = this.session.checkpoint;
    const snapshot = this.snapshot;
    let progressChanged = false;
    let checkingProgress = !!checkpoint;
    let failure: unknown;
    try {
      if (checkpoint) progressChanged = (await this.checkpoint()) !== checkpoint;
      checkingProgress = false;
      if (this.state.selected) await this.verifyArtifact(this.state.selected);
      if (snapshot) await this.ensureFresh(snapshot);
    } catch (error) {
      failure = error;
      // Failed checkpoint reads cannot establish that saved progress is still current.
      if (checkingProgress) progressChanged = true;
    }
    // Passive reads may overlap a later action. Only the idle state they observed can be invalidated.
    if (
      this.disposed ||
      this.state.busy ||
      this.applying ||
      this.generation !== generation ||
      this.session.checkpoint !== checkpoint ||
      this.snapshot !== snapshot
    )
      return;
    if (!progressChanged && !failure) return;
    this.generation++;
    if (progressChanged) {
      this.session.completions = {};
      this.session.checkpoint = undefined;
    }
    if (failure) this.state.error = failure instanceof Error ? failure.message : String(failure);
    this.invalidate(
      progressChanged
        ? "Migration inputs changed. Route progress was reopened; saved answers remain."
        : message
    );
    await this.persist();
  }
  private async recordCompletion(
    state: "manual" | "read" | "not-applicable" | "applied",
    note?: string
  ): Promise<void> {
    const entry = this.requireEntry();
    await this.verifyArtifact(entry);
    const capture =
      this.snapshot?.capture ?? this.plan?.capture ?? this.session.completions[entry.id]?.capture;
    await captureMigration(this.rootsFor(entry), entry, this.session.gameId, await this.documents(), {
      capture,
      signal: this.controller?.signal,
    });
    const previous = this.session.completions[entry.id];
    if (
      state === "applied" ||
      (previous &&
        (previous.revision !== entry.revision || previous.state !== state || previous.note !== note))
    )
      clearDownstream(this.session, this.state.route, entry.id);
    this.session.completions[entry.id] = {
      revision: entry.revision,
      state,
      ...(capture ? { capture } : {}),
      ...(note ? { note } : {}),
    };
    try {
      this.session.checkpoint = await this.checkpoint();
    } catch (error) {
      delete this.session.completions[entry.id];
      throw error;
    }
    await this.persist();
  }
  private async verifyArtifact(entry: MigrationManifest): Promise<void> {
    const saved = this.session.localEntries.find((item) => item.manifest.id === entry.id);
    if (
      saved &&
      createHash("sha256")
        .update(await fs.readFile(saved.localPath))
        .digest("hex") !== saved.codeHash
    )
      throw new Error("Local contribution changed. Reload it before continuing.");
  }
  private async loadLocal(paths: readonly string[]): Promise<void> {
    const signal = this.controller?.signal;
    const checkCancelled = () => {
      if (this.disposed || signal?.aborted) throw new Error("Migration cancelled.");
    };
    let currentPath = paths[0] ?? "Contribution library";
    let committed = false;
    try {
      const discovered = await discoverMigrationLibraryFiles(paths, signal);
      if (!discovered.files.length) {
        this.state.status = "No .json, .cjs or .js contribution files were found in the selected folders.";
        return;
      }
      let files = discovered.files;
      if (discovered.hasFolders) {
        const selected = await vscode.window.showQuickPick(
          files.map((file) => ({
            ...file,
            description: file.dataOnly ? "JSON note" : "Executable JavaScript",
            detail: file.localPath,
            picked: true,
          })),
          {
            canPickMany: true,
            title: "Choose contribution files",
            placeHolder: "Choose contribution files. Deselect helpers and config files.",
          }
        );
        if (!selected?.length) return;
        files = selected;
      }
      checkCancelled();
      const selections: RecipeSelection[] = [];
      // Pin every selected file before requesting trust, including data-only notes.
      for (const file of files) {
        currentPath = file.localPath;
        selections.push({
          localPath: file.localPath,
          codeHash: createHash("sha256")
            .update(await fs.readFile(file.localPath))
            .digest("hex"),
        });
      }
      const code = files.filter((file) => !file.dataOnly);
      if (code.length) {
        if (!vscode.workspace.isTrusted)
          throw new Error("Trust this workspace before running local author code.");
        const approved = await vscode.window.showWarningMessage(
          code.length === 1 && files.length === 1
            ? `Run ${path.basename(code[0].localPath)} as trusted code? It has your user permissions. Only load code you have reviewed.`
            : `Load ${files.length} contribution files, including ${code.length} executable JavaScript files (${code.map((file) => file.localPath).join(", ")})? They run with your user permissions. Only load code you have reviewed.`,
          "Trust and load"
        );
        if (approved !== "Trust and load") return;
      }
      checkCancelled();
      const incoming: MigrationSession["localEntries"] = [];
      for (const selection of selections) {
        currentPath = selection.localPath!;
        checkCancelled();
        const result = await this.worker({ action: "load", selection });
        checkCancelled();
        if (result.kind !== "loaded") throw new Error("Invalid recipe load response.");
        if (result.codeHash !== selection.codeHash)
          throw new Error("Local contribution changed while loading.");
        incoming.push(
          ...result.manifests.map((manifest) => ({
            manifest,
            localPath: selection.localPath!,
            codeHash: result.codeHash,
          }))
        );
      }
      // A previous file can change while a later worker runs. Commit only one stable batch.
      for (const selection of selections) {
        currentPath = selection.localPath!;
        if (
          createHash("sha256")
            .update(await fs.readFile(currentPath))
            .digest("hex") !== selection.codeHash
        )
          throw new Error("Local contribution changed while loading. Load the files again.");
      }
      const reloaded = new Set(selections.map((selection) => migrationLibraryPathKey(selection.localPath!)));
      const retained = this.session.localEntries.filter(
        (entry) => !reloaded.has(migrationLibraryPathKey(entry.localPath))
      );
      const nextLocal = [...retained, ...incoming];
      const ids = new Set(this.builtin.map((entry) => entry.id));
      for (const entry of nextLocal) {
        currentPath = entry.localPath;
        // Leave the canonical merge responsible for rejecting duplicate IDs, but report its file.
        if (ids.has(entry.manifest.id)) break;
        ids.add(entry.manifest.id);
      }
      const catalog = mergeMigrationCatalog(this.builtin, nextLocal);
      checkCancelled();
      committed = true;
      for (const entry of this.session.localEntries)
        if (reloaded.has(migrationLibraryPathKey(entry.localPath))) this.trusted.delete(entry.manifest.id);
      for (const entry of incoming)
        this.trusted.set(entry.manifest.id, {
          localPath: entry.localPath,
          codeHash: entry.codeHash,
          id: entry.manifest.id,
        });
      this.session.localEntries = nextLocal;
      this.state.catalog = catalog;
      this.planRoutes();
      await this.validateCheckpoint();
      const preferred = this.state.selected?.id;
      const id = incoming.some((entry) => entry.manifest.id === preferred)
        ? preferred
        : incoming[0]?.manifest.id;
      if (id) this.selectEntry(id);
      else {
        this.invalidate("Contribution library loaded.");
        if (!catalog.some((entry) => entry.id === preferred)) {
          this.state.selected = undefined;
          this.selection = undefined;
          this.state.local = false;
          this.state.answers = {};
          this.session.recipeId = undefined;
        }
      }
      this.state.status = `Loaded ${incoming.length} entries from ${files.length} files.`;
      await this.persist();
    } catch (error) {
      const failure = `${currentPath}: ${error instanceof Error ? error.message : String(error)}`;
      throw new Error(
        committed
          ? `The library loaded, but its session could not be updated. ${failure}`
          : `${failure} Nothing was added to the library.`
      );
    }
  }
  private invalidate(message: string): void {
    this.plan = undefined;
    this.snapshot = undefined;
    this.state.preview = undefined;
    this.state.inspection = undefined;
    this.state.missing = [];
    this.state.status = message;
    this.post();
  }
  private persist(): Thenable<void> {
    return this.context.workspaceState.update(SESSION_KEY, this.session);
  }
  private progress(message: string): void {
    this.state.status = message;
    this.post();
  }
  private worker(request: Omit<MigrationWorkerRequest, "gameId">) {
    return runMigrationWorker(
      this.context.asAbsolutePath("dist/migrationWorker.js"),
      { ...request, gameId: this.session.gameId },
      this.controller?.signal
    );
  }
  private async documents(): Promise<MigrationDocument[]> {
    const root = this.session.roots.mod;
    return root ? patchDocuments(root) : [];
  }
  private answerKey(manifest: MigrationManifest): string {
    return `${manifest.id}@${manifest.revision}`;
  }
  private async load(selection: RecipeSelection): Promise<void> {
    const result = await this.worker({ action: "load", selection });
    if (result.kind !== "loaded") throw new Error("Invalid recipe load response.");
    for (const manifest of result.manifests)
      this.trusted.set(manifest.id, { ...selection, id: manifest.id, codeHash: result.codeHash });
    this.planRoutes();
    await this.validateCheckpoint();
    const id = result.manifests.some((item) => item.id === selection.id)
      ? selection.id!
      : result.manifests[0]?.id;
    if (id) this.selectEntry(id);
    await this.persist();
  }
  private selectEntry(id: string): void {
    const entry = this.state.catalog.find((item) => item.id === id);
    if (!entry) throw new Error("Unknown migration entry.");
    this.invalidate("Read the guidance, then check or resolve this migration entry.");
    this.state.selected = entry;
    this.state.local = this.session.localEntries.some((item) => item.manifest.id === id);
    this.selection = this.trusted.get(id);
    this.state.answers = this.session.answers[this.answerKey(entry)] ?? {};
    this.session.recipeId = id;
    this.syncState();
  }
  private async inspect(): Promise<void> {
    this.progress("Checking saved migration inputs…");
    await this.validateCheckpoint();
    const manifest = this.requireEntry(manifestNeedsCode(this.state.selected));
    await this.verifyArtifact(manifest);
    if (manifest.detection === "none") {
      this.invalidate(
        "This entry has no automatic inspection. Read its guidance and record the manual resolution."
      );
      return;
    }
    if (!this.selection) {
      await this.load({ id: manifest.id });
    }
    this.plan = undefined;
    this.snapshot = undefined;
    this.state.preview = undefined;
    for (const root of ["mod", "source", "target"] as const) {
      const value = this.session.roots[root];
      if (value) this.session.roots[root] = await fs.realpath(value);
    }
    this.capturedDocuments = await this.documents();
    this.progress("Reading mod and game reference files…");
    let snapshot = await captureMigration(
      this.session.roots,
      manifest,
      this.session.gameId,
      this.capturedDocuments,
      { signal: this.controller?.signal }
    );
    if (manifest.sdkVersion === 2) {
      const seed = snapshot;
      this.progress("Checking which files this migration needs…");
      const discovered = await this.worker({
        action: "discover",
        selection: this.selection,
        snapshot: seed,
        answers: this.state.answers,
      });
      if (discovered.kind !== "discovered") throw new Error("Invalid discovery response.");
      await this.ensureFresh(seed);
      this.progress("Reading the selected migration files…");
      snapshot = await captureMigration(
        this.session.roots,
        manifest,
        this.session.gameId,
        this.capturedDocuments,
        { capture: { selected: discovered.selected }, signal: this.controller?.signal }
      );
      await this.ensureFresh(snapshot);
    }
    this.progress("Inspecting files and updating your choices…");
    const result = await this.worker({
      action: "inspect",
      selection: this.selection,
      snapshot,
      answers: this.state.answers,
    });
    if (result.kind !== "inspected") throw new Error("Invalid inspection response.");
    await this.ensureFresh(snapshot);
    this.snapshot = snapshot;
    this.state.inspection = result.result.inspection;
    this.state.answers = result.result.answers;
    this.state.missing = result.result.missingAnswers;
    this.session.answers[this.answerKey(manifest)] = this.state.answers;
    this.state.status = result.result.invalidAnswers.length
      ? "Some choices no longer match the inputs. Choose them again."
      : this.state.missing.length
        ? `${this.state.missing.length} required choices remain.`
        : "Inspection finished. Review coverage before preparing changes.";
    if (
      result.result.inspection.applicability === "not-applicable" &&
      this.session.completions[manifest.id]?.state !== "applied"
    ) {
      await this.recordCompletion("not-applicable");
      this.state.status =
        "Inspection found this entry not applicable. This does not establish whole-mod compatibility.";
    }
    await this.persist();
  }
  private async ensureFresh(snapshot: MigrationSnapshot): Promise<void> {
    this.progress("Checking that the migration inputs are still current…");
    await assertMigrationFresh(
      this.session.roots,
      this.state.selected!,
      await hashSnapshot(snapshot),
      await this.documents(),
      snapshot.capture,
      this.controller?.signal
    );
  }
  private documentHost(mod = this.session.roots.mod!): MigrationDocumentHost {
    return patchDocumentHost(mod);
  }
  private beginWrites(): void {
    if (this.disposed || this.controller?.signal.aborted) throw new Error("Migration cancelled.");
    requireExperimentalFeatures();
    if (!vscode.workspace.isTrusted) throw new Error("Trust this workspace before changing migration files.");
    // Once writes start, finish the journal and route bookkeeping even if the panel closes.
    this.applying = true;
    this.controller = undefined;
    this.post();
  }
  private async diff(relative: string): Promise<void> {
    await this.validateCheckpoint();
    this.requireEntry(true);
    const file = this.plan?.files.find((item) => item.path === relative);
    if (!file) throw new Error("Prepare a current preview first.");
    if (this.snapshot) await this.ensureFresh(this.snapshot);
    const left = decodeText(file.before),
      right = decodeText(file.after);
    if (left === undefined || right === undefined) {
      const document = await vscode.workspace.openTextDocument({
        language: "plaintext",
        content: migrationBinaryReview(relative, file.before, file.after, this.plan!.hash),
      });
      await vscode.window.showTextDocument(document);
      return;
    }
    const key = randomUUID();
    const a = vscode.Uri.from({ scheme: this.previewScheme, path: `/${key}/before/${relative}` });
    const b = vscode.Uri.from({ scheme: this.previewScheme, path: `/${key}/after/${relative}` });
    this.previews.set(a.toString(), left);
    this.previews.set(b.toString(), right);
    await vscode.commands.executeCommand("vscode.diff", a, b, `${relative}: migration preview`);
  }
  private async apply(): Promise<void> {
    requireExperimentalFeatures();
    if (!vscode.workspace.isTrusted) throw new Error("Trust this workspace before applying migrations.");
    await this.validateCheckpoint();
    this.requireEntry(true);
    if (!this.plan || !this.state.selected) throw new Error("Prepare and review a current plan first.");
    if (!this.plan.files.length) throw new Error("This recipe has no automatic changes to apply.");
    if (this.plan.inspection.applicability !== "applicable" || this.plan.unresolved.length)
      throw new Error("Resolve unknown applicability or unresolved recipe work before applying.");
    const artifact = this.selection?.localPath ?? this.context.asAbsolutePath("dist/migrationWorker.js");
    if (
      createHash("sha256")
        .update(await fs.readFile(artifact))
        .digest("hex") !== this.plan.recipe.codeHash
    )
      throw new Error("Recipe code changed. Load the recipe again and prepare a fresh preview.");
    for (const file of this.plan.files) {
      const doc = vscode.workspace.textDocuments.find(
        (item) =>
          !item.isClosed &&
          item.uri.scheme === "file" &&
          sameFile(item.uri.fsPath, path.resolve(this.session.roots.mod!, file.path))
      );
      if (!doc || !file.after) continue;
      const bom = file.after[0] === 239 && file.after[1] === 187 && file.after[2] === 191;
      const encoding = doc.encoding;
      if (
        (encoding !== "utf8" && encoding !== "utf8bom") ||
        (bom && encoding !== "utf8bom") ||
        (!bom && encoding === "utf8bom")
      )
        throw new Error(
          `Save ${file.path} with ${bom ? "UTF-8 with BOM" : "UTF-8"} encoding, then prepare a new preview. Its editor content has not been changed.`
        );
    }
    for (const tab of vscode.window.tabGroups.all.flatMap((group) => group.tabs)) {
      const input = tab.input;
      if (
        tab.isDirty &&
        input instanceof vscode.TabInputCustom &&
        this.plan.files.some((file) =>
          sameFile(path.resolve(this.session.roots.mod!, file.path), input.uri.fsPath)
        )
      )
        throw new Error("Save the affected custom editor before preparing a new preview.");
    }
    const storage = this.context.storageUri ?? this.context.globalStorageUri;
    await fs.mkdir(storage.fsPath, { recursive: true });
    const journalPath = path.join(storage.fsPath, `migration-${randomUUID()}.json`);
    const changedPaths = this.plan.files.map((file) => file.path);
    const unchangedInputs = await this.checkpoint(changedPaths, true);
    // Retain the last real journal if freshness checks reject this attempt before writing.
    // The pending pointer makes a newly written journal discoverable after a host crash.
    this.beginWrites();
    try {
      await this.context.workspaceState.update(PENDING_JOURNAL_KEY, {
        path: journalPath,
        entryId: this.state.selected.id,
        complete: false,
      } satisfies RecoveryStep);
      this.progress("Applying the reviewed changes…");
      const result = await applyMigration(this.plan, {
        roots: this.session.roots,
        manifest: this.state.selected,
        gameId: this.session.gameId,
        journalPath,
        documents: await this.documents(),
        documentHost: this.documentHost(),
      });
      this.state.status = `${result.completed.length} files completed. ${result.status === "applied" ? "Applied. Game compatibility has not been established." : "Apply stopped. Review the recovery result before continuing."}`;
      if (result.error) this.state.error = result.error;
      await this.recoverPendingJournal();
      const step = this.journals.find((item) => item.path === journalPath);
      if (result.status === "applied") {
        if (!step)
          throw new Error("Applied changes have no recovery journal. Route progress was not recorded.");
        step.complete = true;
        await this.persistJournals();
        if ((await this.checkpoint(changedPaths, true)) !== unchangedInputs) {
          this.session.completions = {};
          this.session.checkpoint = undefined;
          this.state.status =
            "Changes applied, but other route inputs changed during the step. Route progress was reopened; recovery remains available.";
          await this.persist();
        } else if (this.plan.continuation) {
          clearDownstream(this.session, this.state.route, this.state.selected!.id);
          if (Object.keys(this.session.completions).length) this.session.checkpoint = await this.checkpoint();
          this.state.status = "Applied this batch. Check the remaining files before continuing the route.";
          await this.persist();
        } else await this.recordCompletion("applied");
      }
    } finally {
      // A throwing writer can still leave a partial journal that must remain discoverable.
      await this.recoverPendingJournal();
      this.applying = false;
      this.plan = undefined;
      this.snapshot = undefined;
      this.state.preview = undefined;
    }
  }
  private async recoverPendingJournal(): Promise<void> {
    const saved = this.context.workspaceState.get<string | RecoveryStep>(PENDING_JOURNAL_KEY);
    const pending = typeof saved === "string" ? { path: saved, complete: false } : saved;
    if (!pending) return;
    const storage = this.context.storageUri ?? this.context.globalStorageUri;
    if (
      !sameFile(path.dirname(pending.path), storage.fsPath) ||
      !/^migration-[\w-]+\.json$/.test(path.basename(pending.path))
    )
      throw new Error("Invalid pending recovery journal.");
    try {
      const stat = await fs.lstat(pending.path);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Invalid pending recovery file.");
      if (!this.journals.some((step) => step.path === pending.path)) this.journals.push(pending);
      await this.persistJournals();
      this.state.canRestore = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await this.context.workspaceState.update(PENDING_JOURNAL_KEY, undefined);
  }
  private async persistJournals(): Promise<void> {
    await this.context.workspaceState.update(JOURNALS_KEY, this.journals);
    await this.context.workspaceState.update(JOURNAL_KEY, undefined);
  }
  async handle(
    message: MigrationViewMessage,
    localRecipeUri?: vscode.Uri | readonly vscode.Uri[]
  ): Promise<void> {
    if (!message || typeof message.type !== "string" || this.disposed) return;
    if (message.type === "cancel") {
      if (!this.applying) this.controller?.abort();
      return;
    }
    if (this.state.busy) return;
    this.generation++;
    this.state.busy = true;
    this.state.error = undefined;
    this.controller = new AbortController();
    this.post();
    try {
      requireExperimentalFeatures();
      switch (message.type) {
        case "ready": {
          await this.recoverPendingJournal();
          const result = await this.worker({ action: "catalog" });
          if (result.kind !== "catalog") throw new Error("Invalid migration catalog.");
          this.builtin = result.manifests;
          this.state.catalog = mergeMigrationCatalog(this.builtin, this.session.localEntries);
          for (const [version, folder] of Object.entries(this.session.references)) {
            const detected = detectGameVersion(folder);
            if (detected && detected !== version) {
              delete this.session.references[version];
              this.state.status = `Reference ${version} now reports ${detected}. Choose the correct reference again.`;
            }
          }
          this.planRoutes();
          await this.validateCheckpoint();
          if (
            !this.state.selected &&
            this.session.recipeId &&
            this.state.catalog.some((item) => item.id === this.session.recipeId)
          )
            this.selectEntry(this.session.recipeId);
          await this.persist();
          break;
        }
        case "versions": {
          if (typeof message.fromVersion !== "string" || typeof message.toVersion !== "string")
            throw new Error("Enter concrete source and target versions.");
          const fromVersion = message.fromVersion.trim(),
            toVersion = message.toVersion.trim();
          if (!fromVersion || !toVersion || /[*xX]/.test(fromVersion + toVersion))
            throw new Error("Use exact source and target game builds, without wildcards.");
          if (fromVersion !== this.session.fromVersion || toVersion !== this.session.toVersion) {
            this.session.completions = {};
            this.session.checkpoint = undefined;
            this.session.routeId = undefined;
          }
          this.session.fromVersion = fromVersion;
          this.session.toVersion = toVersion;
          const detected = detectGameVersion(this.cfg.gamePath);
          if (detected === toVersion && this.cfg.gamePath && !this.session.references[toVersion])
            this.session.references[toVersion] = await fs.realpath(this.cfg.gamePath);
          this.invalidate("Choose a route, then work through its entries.");
          this.planRoutes();
          if (
            this.state.route &&
            !this.state.route.entryIds.includes(this.state.selected?.id ?? "") &&
            this.state.nextEntryId
          )
            this.selectEntry(this.state.nextEntryId);
          await this.persist();
          break;
        }
        case "route": {
          const route = this.state.routes.find((item) => item.id === message.id);
          if (!route) throw new Error("Unknown migration route.");
          if (this.session.routeId !== route.id) {
            this.session.routeId = route.id;
            this.session.completions = {};
            this.session.checkpoint = undefined;
            this.invalidate("Route selected. Work through its entries in order.");
          }
          this.syncState();
          if (this.state.nextEntryId) this.selectEntry(this.state.nextEntryId);
          await this.persist();
          break;
        }
        case "next": {
          await this.validateCheckpoint();
          this.syncState();
          if (this.state.nextEntryId) this.selectEntry(this.state.nextEntryId);
          else
            this.state.status =
              "No unresolved eligible entries remain. Whole-mod compatibility has not been established.";
          await this.persist();
          break;
        }
        case "complete": {
          await this.validateCheckpoint();
          const entry = this.requireEntry();
          if (!["manual", "read"].includes(message.state)) throw new Error("Invalid completion state.");
          if (message.state === "read" && entry.requirement !== "informational")
            throw new Error("Required entries need a manual resolution note.");
          const note = typeof message.note === "string" ? message.note.trim() : "";
          if (message.state === "manual" && !note)
            throw new Error("Describe how the migration was resolved before marking it complete.");
          await this.recordCompletion(message.state, note);
          this.invalidate(
            message.state === "read"
              ? "Informational guidance recorded as read."
              : "Manual resolution recorded. Target-game compatibility has not been established."
          );
          break;
        }
        case "root": {
          await this.validateCheckpoint();
          if (!["mod", "source", "target"].includes(message.root)) throw new Error("Invalid source role.");
          const chosen = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            title:
              message.root === "mod" ? "Choose the mod folder" : `Choose ${message.root} game-data folder`,
          });
          if (!chosen?.[0]) break;
          const folder = await fs.realpath(chosen[0].fsPath);
          if (message.root === "mod") {
            this.session.roots.mod = folder;
            this.session.answers = {};
            this.state.answers = {};
            this.session.completions = {};
            this.session.checkpoint = undefined;
          } else {
            const entry = this.state.selected;
            const version =
              message.root === "source"
                ? (entry?.fromVersion ?? this.session.fromVersion)
                : (entry?.toVersion ?? this.session.toVersion);
            if (!version)
              throw new Error("Select a concrete game version before choosing its reference folder.");
            const detected = detectGameVersion(folder);
            if (detected && detected !== version)
              throw new Error(
                `This folder reports game version ${detected}; the selected reference is ${version}.`
              );
            if (!detected) {
              const approved = await vscode.window.showWarningMessage(
                `No launcher version metadata was found. Use this folder as game version ${version}? Its version will remain unverified.`,
                "Use as selected version"
              );
              if (approved !== "Use as selected version") break;
            }
            this.session.references[version] = folder;
          }
          await this.validateCheckpoint();
          this.state.inspection = undefined;
          this.invalidate("Sources changed. Inspect again.");
          await this.persist();
          break;
        }
        case "recipe": {
          this.selectEntry(message.id);
          await this.persist();
          break;
        }
        case "load":
        case "load-folder": {
          const explicit: readonly vscode.Uri[] | undefined = localRecipeUri
            ? Array.isArray(localRecipeUri)
              ? localRecipeUri
              : [localRecipeUri as vscode.Uri]
            : undefined;
          if (explicit?.some((uri) => uri.scheme !== "file"))
            throw new Error("Select local contribution files or folders.");
          const files = explicit
            ? explicit
            : await vscode.window.showOpenDialog({
                canSelectMany: true,
                canSelectFiles: message.type === "load",
                canSelectFolders: message.type === "load-folder",
                ...(message.type === "load"
                  ? { filters: { "Migration contribution": ["json", "cjs", "js"] } }
                  : {}),
                title:
                  message.type === "load"
                    ? "Select compatibility notes or self-contained recipe libraries"
                    : "Select contribution folders",
              });
          if (!files?.length) break;
          await this.loadLocal(files.map((file) => file.fsPath));
          break;
        }
        case "reload": {
          const local = this.session.localEntries.find(
            (item) => item.manifest.id === this.state.selected?.id
          );
          if (!local) throw new Error("Select a local contribution to reload.");
          await this.loadLocal([local.localPath]);
          break;
        }
        case "template": {
          const kind = await vscode.window.showQuickPick(
            [
              {
                label: "Compatibility note",
                description: "Manual guidance, no code required",
                value: "note",
              },
              {
                label: "Migration recipe",
                description: "JavaScript example that updates files in a folder",
                value: "recipe",
              },
            ],
            { title: "Create a compatibility contribution" }
          );
          if (!kind) break;
          const note = kind.value === "note";
          const target = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(
              path.join(
                this.session.roots.mod ?? "",
                note ? "example-compatibility.json" : "example-migration.cjs"
              )
            ),
            filters: note ? { "Compatibility note": ["json"] } : { "Migration recipe": ["cjs"] },
            title: "Create a contribution-author example",
          });
          if (!target) break;
          await fs.writeFile(
            target.fsPath,
            note ? advisoryTemplate(this.session.gameId) : migrationTemplate(this.session.gameId),
            {
              encoding: "utf8",
              flag: "wx",
            }
          );
          await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target));
          this.state.status =
            "Created an author example. Its header explains the synthetic folder inputs. Build real migrations with evidence and fixtures.";
          break;
        }
        case "answer": {
          if (
            typeof message.id !== "string" ||
            !this.state.inspection?.questions.some((q) => q.id === message.id) ||
            !["string", "boolean"].includes(typeof message.value)
          )
            throw new Error("Invalid recipe answer.");
          this.state.answers = { ...this.state.answers, [message.id]: message.value };
          const selected = this.state.selected!;
          const previous = this.session.answers[this.answerKey(selected)]?.[message.id];
          if (previous !== message.value && this.session.completions[selected.id]) {
            clearDownstream(this.session, this.state.route, selected.id);
            if (Object.keys(this.session.completions).length)
              this.session.checkpoint = await this.checkpoint();
          }
          this.session.answers[this.answerKey(selected)] = this.state.answers;
          await this.persist();
          await this.inspect();
          break;
        }
        case "scan":
          await this.inspect();
          break;
        case "prepare": {
          const entry = this.requireEntry(true);
          if (entry.kind !== "recipe") throw new Error("Advisory entries do not prepare automatic changes.");
          await this.inspect();
          if (this.state.inspection?.applicability !== "applicable")
            throw new Error("Automatic changes require applicable inspection results.");
          const snapshot = this.snapshot!;
          this.progress("Preparing migration changes…");
          const result = await this.worker({
            action: "prepare",
            selection: this.selection,
            snapshot,
            answers: this.state.answers,
          });
          if (result.kind !== "prepared") throw new Error("Invalid preparation response.");
          await this.ensureFresh(snapshot);
          this.snapshot = snapshot;
          this.plan = result.plan;
          this.state.preview = {
            files: result.plan.files.map((file) => ({
              path: file.path,
              before: file.before?.length ?? 0,
              after: file.after?.length ?? 0,
              text: decodeText(file.before) !== undefined && decodeText(file.after) !== undefined,
            })),
            checks: result.plan.checks,
            blocked: result.plan.unresolved.length
              ? "Resolve the remaining recipe work before applying, or record a manual resolution."
              : result.plan.checks.some(
                    (check) =>
                      check.stage === "before-apply" &&
                      check.necessity === "required" &&
                      check.status !== "passed"
                  )
                ? "Required checks must pass before applying."
                : undefined,
          };
          this.state.status = result.plan.files.length
            ? "Preview prepared. Review changes before applying."
            : "No automatic changes were prepared. Review unresolved work.";
          this.state.inspection!.findings.push(...result.plan.unresolved);
          break;
        }
        case "diff":
          if (typeof message.path === "string") await this.diff(message.path);
          break;
        case "apply":
          this.progress("Checking files before applying changes…");
          await this.apply();
          break;
        case "restore": {
          this.progress("Restoring migration files…");
          if (!vscode.workspace.isTrusted)
            throw new Error("Trust this workspace before restoring migration files.");
          const step = this.journals.at(-1);
          if (!step) throw new Error("No migration journal is available.");
          const storage = this.context.storageUri ?? this.context.globalStorageUri;
          if (
            !sameFile(path.dirname(step.path), storage.fsPath) ||
            !/^migration-[\w-]+\.json$/.test(path.basename(step.path))
          )
            throw new Error("Invalid recovery journal location.");
          const stat = await fs.lstat(step.path);
          if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Invalid migration recovery file.");
          const journal = JSON.parse(await fs.readFile(step.path, "utf8")) as { roots?: { mod?: string } };
          if (!journal.roots?.mod) throw new Error("Recovery journal has no mod root.");
          this.beginWrites();
          try {
            const result = await restoreMigration(step.path, {
              documentHost: this.documentHost(journal.roots.mod),
            });
            this.state.status = `Recovery ${result.status}: ${result.completed.length} files restored.`;
            this.state.error =
              [result.error, ...(result.conflicts ?? [])].filter(Boolean).join("\n") || undefined;
            clearDownstream(this.session, this.state.route, step.entryId ?? "");
            if (result.status === "restored") {
              this.journals.pop();
              await this.persistJournals();
              if (Object.keys(this.session.completions).length)
                this.session.checkpoint = await this.checkpoint();
            } else step.complete = false;
            await this.persistJournals();
            await this.persist();
          } finally {
            this.applying = false;
            this.invalidate(this.state.status);
          }
          break;
        }
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

export function registerMigrations(context: vscode.ExtensionContext, getCfg: () => PxConfig): void {
  let current: MigrationWorkbench | undefined;
  const show = async () => {
    requireExperimentalFeatures();
    if (!current || current.isDisposed) current = new MigrationWorkbench(context, getCfg());
    else current.reveal();
    await current.ready;
    return current;
  };
  context.subscriptions.push(
    vscode.commands.registerCommand("px.openMigrations", async () => {
      await show();
    }),
    vscode.commands.registerCommand(
      "px.loadMigrationRecipe",
      async (uri?: vscode.Uri, selection?: vscode.Uri[]) => {
        await (await show()).handle({ type: "load" }, selection?.length ? selection : uri);
      }
    ),
    vscode.commands.registerCommand(
      "px.loadMigrationFolder",
      async (uri?: vscode.Uri, selection?: vscode.Uri[]) => {
        await (await show()).handle({ type: "load-folder" }, selection?.length ? selection : uri);
      }
    )
  );
}
