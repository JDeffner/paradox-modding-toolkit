import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { URI } from "vscode-uri";
import AdmZip from "adm-zip";
import { ck3Meta } from "@px-lsp/server/games/ck3/meta";
import type { AppToHost, HostToApp, WorkshopModInfo } from "../src/webviews/workshop/messages";
import type { BridgeDone, BridgeJob, ItemDetails } from "../src/steam/jobs";

const host = vi.hoisted(() => ({
  posted: [] as HostToApp[],
  receive: (_message: AppToHost) => {},
  close: () => {},
  runBridge: vi.fn(),
  input: vi.fn(),
  open: vi.fn(),
  errors: vi.fn(),
  warnings: vi.fn(),
  documents: [] as { uri: URI; isDirty: boolean; getText: () => string }[],
  listing: "",
}));

vi.mock("vscode", async () => {
  const { URI } = await import("vscode-uri");
  const disposable = { dispose() {} };
  return {
    Uri: URI,
    ViewColumn: { Active: 1 },
    RelativePattern: class {},
    workspace: {
      isTrusted: true,
      workspaceFolders: [],
      getWorkspaceFolder: () => undefined,
      get textDocuments() {
        return host.documents;
      },
      getConfiguration: () => ({
        get: (key: string, fallback: unknown) => (key === "workshop.dir" ? host.listing : fallback),
        inspect: (key: string) => ({ globalValue: key === "workshop.dir" ? host.listing : undefined }),
      }),
      createFileSystemWatcher: () => ({
        ...disposable,
        onDidChange: () => disposable,
        onDidCreate: () => disposable,
        onDidDelete: () => disposable,
      }),
    },
    window: {
      showInformationMessage: async () => undefined,
      showWarningMessage: (...args: unknown[]) => {
        host.warnings(...args);
        return Promise.resolve(undefined);
      },
      showErrorMessage: (...args: unknown[]) => {
        host.errors(...args);
        return Promise.resolve(undefined);
      },
      showInputBox: (...args: unknown[]) => host.input(...args),
      showOpenDialog: (...args: unknown[]) => host.open(...args),
      createWebviewPanel: () => ({
        reveal() {},
        dispose() {},
        onDidChangeViewState: () => disposable,
        onDidDispose: (callback: () => void) => {
          host.close = callback;
          return disposable;
        },
        webview: {
          html: "",
          options: {},
          cspSource: "https://webview.test",
          asWebviewUri: (uri: URI) => uri,
          postMessage: (message: HostToApp) => {
            host.posted.push(message);
            return Promise.resolve(true);
          },
          onDidReceiveMessage: (callback: (message: AppToHost) => void) => {
            host.receive = callback;
            return disposable;
          },
        },
      }),
    },
    env: { openExternal: vi.fn() },
  };
});
vi.mock("../src/config", () => ({ gameDocsSubdir: () => null }));
vi.mock("../src/descriptorMod", () => ({ detectGameVersion: () => null }));
vi.mock("../src/steamDetect", () => ({ findSteamLibraries: () => [] }));
vi.mock("../src/webviews/tabIcons", () => ({ tabIcon: () => undefined }));
vi.mock("../src/webviews/devReload", () => ({
  webviewSource: () => ({ root: URI.file("/extension"), watch: false }),
  bundleUri: () => "workshop.js",
  watchBundle: () => ({ dispose() {} }),
}));
vi.mock("../src/steam/workshop", async (original) => ({
  ...(await original<typeof import("../src/steam/workshop")>()),
  runBridge: (...args: unknown[]) => host.runBridge(...args),
  lastCommitSubject: async () => "",
  latestRelease: async () => null,
}));

import { WorkshopPanel } from "../src/webviews/workshop/panel";
import { BridgeStartError, BridgeWaitError } from "../src/steam/bridgeRunner";
import { readLegacyItem, updateLegacyItem } from "../src/steam/legacyWorkshop";
import { writeDependencies, writeListingFiles } from "../src/steam/workshopFiles";

let scratch: string;
let root: string;
let originalDescriptor: string;
const legacyDir = () => path.join(host.listing, "legacy_version", "1.19");
const mainTarget = () => ({ root, legacyKey: null });
const legacyTarget = () => ({ root, legacyKey: "1.19" });
const jobs = () => host.runBridge.mock.calls.map((args) => args[1] as BridgeJob);

function live(itemId: string): ItemDetails {
  return {
    itemId,
    title: "Remote",
    description: "Remote description",
    visibility: 2,
    tags: [],
    previewUrl: null,
    timeCreated: 1,
    timeUpdated: 2,
    banned: false,
    numUpvotes: 0,
    numDownvotes: 0,
    numSubscriptions: 0,
    numFavorites: 0,
    numUniqueWebsiteViews: 0,
    numComments: 0,
    appDependencies: [900],
    children: ["901"],
    additionalPreviews: [],
  };
}

async function completeBridge(_context: unknown, job: BridgeJob): Promise<BridgeDone> {
  if (job.action === "query") return { action: "query", item: live(job.itemId), translations: {} };
  if (job.action === "create") return { action: "create", itemId: "222", needsToAcceptAgreement: false };
  if (job.action === "publish")
    return { action: "publish", itemId: job.itemId, needsToAcceptAgreement: false };
  if (job.action === "setDependencies") return { action: "setDependencies", itemId: job.itemId };
  return { action: "dlc", dlc: [] };
}

async function drain(): Promise<WorkshopModInfo> {
  const before = host.posted.filter((message) => message.type === "init").length;
  host.receive({ type: "ready" });
  await vi.waitFor(() =>
    expect(host.posted.filter((message) => message.type === "init")).toHaveLength(before + 1)
  );
  const init = host.posted.filter((message) => message.type === "init").at(-1)!;
  if (!init.info) throw new Error("Expected a selected mod");
  return init.info;
}
async function send(message: AppToHost): Promise<WorkshopModInfo> {
  host.receive(message);
  return drain();
}
async function createLegacy(): Promise<WorkshopModInfo> {
  return send({ type: "createLegacy", version: "1.19.*", target: mainTarget() });
}
function upload(legacy = true, content = true): Extract<AppToHost, { type: "upload" }> {
  return {
    type: "upload",
    target: legacy ? legacyTarget() : mainTarget(),
    content,
    details: true,
    description: true,
    previews: false,
    requirements: false,
    languages: [],
    changeNote: "Saved release",
    visibility: 2,
  };
}

function showPanel(): void {
  WorkshopPanel.show(
    {
      subscriptions: [],
      globalStorageUri: URI.file(path.join(scratch, "storage")),
      asAbsolutePath: (file: string) => path.resolve(file),
    } as unknown as import("vscode").ExtensionContext,
    {
      meta: ck3Meta,
      mods: [{ label: "Test mod", path: root }],
      active: root,
      gamePath: null,
      log: vi.fn(),
    }
  );
}

it("offers Steam compatibility versions and persists the exact tag with existing categories", async () => {
  const info = await drain();
  expect(info.knownTags).toEqual(
    expect.arrayContaining([
      "1.18 'Crane'",
      "1.17 'Ascendant'",
      "1.16 'Chamfron'",
      "1.15 'Crown'",
      "Older",
      "1.19 'Scribe'",
      "1.20 'Crozier'",
    ])
  );
  const saved = await send({ type: "setTags", tags: ["Gameplay", "1.20 'Crozier'"], target: mainTarget() });
  expect(saved.tags).toEqual(["Gameplay", "1.20 'Crozier'"]);
  expect(fs.readFileSync(path.join(root, "descriptor.mod"), "utf8")).toContain("\"1.20 'Crozier'\"");
});

beforeEach(async () => {
  vi.clearAllMocks();
  host.posted = [];
  host.documents = [];
  const testing = path.resolve(".local/testing");
  fs.mkdirSync(testing, { recursive: true });
  scratch = fs.mkdtempSync(path.join(testing, "workshop-legacy-panel-"));
  root = path.join(scratch, "mod");
  host.listing = path.join(scratch, "workshop");
  fs.mkdirSync(root);
  originalDescriptor =
    '\uFEFFname="Main item"\nversion="2.0"\nsupported_version="1.20.*"\nremote_file_id="111"\n# Keep this unrelated comment\n';
  fs.writeFileSync(path.join(root, "descriptor.mod"), originalDescriptor);
  fs.writeFileSync(path.join(root, "current.txt"), "Current mod files");
  writeListingFiles(host.listing, {
    description: "Local description",
    translations: { german: { title: "Titel", description: "Text" } },
  });
  writeDependencies(host.listing, { apps: [700], items: ["701"] });
  host.runBridge.mockImplementation(completeBridge);
  showPanel();
  await drain();
});
afterEach(() => {
  host.close();
  vi.restoreAllMocks();
  fs.rmSync(scratch, { recursive: true, force: true });
});

async function chooseZip(
  files: Record<string, string> = {
    "release/descriptor.mod":
      '\uFEFFname="Archived mod"\nversion="1.0"\nsupported_version="1.18.*"\nremote_file_id="999"\n# Preserve archive comment\n',
    "release/events/old.txt": "\uFEFFOld files",
  }
): Promise<{ id: string; file: string }> {
  const file = path.join(scratch, "old.zip");
  const zip = new AdmZip();
  for (const [name, text] of Object.entries(files)) zip.addFile(name, Buffer.from(text));
  zip.writeZip(file);
  host.open.mockResolvedValueOnce([URI.file(file)]);
  await send({ type: "pickLegacyZip", request: "pick-1", target: mainTarget() });
  const reply = host.posted.filter((message) => message.type === "legacyZipPicked").at(-1);
  if (reply?.type !== "legacyZipPicked" || !reply.archive) throw new Error("Expected a ZIP selection");
  return { id: reply.archive.id, file };
}

describe("legacy ZIP source through the Workshop panel", () => {
  it("saves the archive locally and uploads only those files with a new ID, preserving both sources", async () => {
    const selected = await chooseZip();
    const originalZip = fs.readFileSync(selected.file);
    const info = await send({
      type: "createLegacy",
      version: "1.19",
      archive: selected.id,
      target: mainTarget(),
    });
    expect(host.errors).not.toHaveBeenCalled();
    expect(info).toMatchObject({ legacyArchive: "old.zip", version: "1.0", legacyContent: "new" });
    const saved = path.join(legacyDir(), "content");
    const descriptor = fs.readFileSync(path.join(saved, "descriptor.mod"), "utf8");
    expect(descriptor).toContain('remote_file_id="999"');
    expect(fs.readFileSync(selected.file)).toEqual(originalZip);
    fs.unlinkSync(selected.file);
    fs.writeFileSync(path.join(root, "current.txt"), "Later live files");
    host.documents.push({
      uri: URI.file(path.join(root, "events/old.txt")),
      isDirty: true,
      getText: () => "Unsaved live files",
    });
    let contents = "";
    host.runBridge.mockImplementation(async (context, job: BridgeJob) => {
      if (job.action === "publish") {
        const staged = job.submits[0].contentPath!;
        expect(fs.existsSync(path.join(staged, "current.txt"))).toBe(false);
        expect(fs.readFileSync(path.join(staged, "events/old.txt"), "utf8")).toBe("\uFEFFOld files");
        contents = fs.readFileSync(path.join(staged, "descriptor.mod"), "utf8");
      }
      return completeBridge(context, job);
    });
    await send(upload());
    expect(host.errors).not.toHaveBeenCalled();
    expect(contents).toContain('remote_file_id="222"');
    expect(contents).toContain('supported_version="1.19.*"');
    expect(contents).toContain('version="1.0"');
    expect(contents).toContain("# Preserve archive comment");
    expect(fs.readFileSync(path.join(saved, "descriptor.mod"), "utf8")).toBe(descriptor);
    expect(fs.readFileSync(path.join(root, "descriptor.mod"), "utf8")).toBe(originalDescriptor);
    const calls = jobs().length;
    await send(upload());
    expect(jobs()).toHaveLength(calls);
  });

  it("does not create local or remote items for a damaged ZIP or changed selection", async () => {
    const selected = await chooseZip({ "README.txt": "No mod" });
    await send({ type: "createLegacy", version: "1.19", archive: selected.id, target: mainTarget() });
    expect(host.errors.mock.calls.flat().join(" ")).toContain("exactly one descriptor");
    expect(fs.existsSync(legacyDir())).toBe(false);
    expect(jobs()).toHaveLength(0);
    fs.appendFileSync(selected.file, "changed");
    await send({ type: "createLegacy", version: "1.19", archive: selected.id, target: mainTarget() });
    expect(host.errors.mock.calls.flat().join(" ")).toContain("ZIP changed");
    expect(jobs()).toHaveLength(0);
  });

  it("rejects a missing saved archive before creating a Steam item, without falling back to live files", async () => {
    const selected = await chooseZip();
    await send({ type: "createLegacy", version: "1.19", archive: selected.id, target: mainTarget() });
    fs.unlinkSync(path.join(legacyDir(), "content/descriptor.mod"));
    host.runBridge.mockClear();
    await send(upload());
    expect(jobs()).toHaveLength(0);
    expect(readLegacyItem(legacyDir()).legacy.content).toBe("new");
    expect(host.errors).toHaveBeenCalled();
  });

  it("cancels the file picker without creation and rejects arbitrary archive paths", async () => {
    host.open.mockResolvedValueOnce(undefined);
    await send({ type: "pickLegacyZip", request: "cancel", target: mainTarget() });
    expect(host.posted).toContainEqual(expect.objectContaining({ type: "legacyZipPicked", archive: null }));
    await send({
      type: "createLegacy",
      version: "1.19",
      archive: path.join(scratch, "arbitrary.zip"),
      target: mainTarget(),
    });
    expect(fs.existsSync(legacyDir())).toBe(false);
    expect(jobs()).toHaveLength(0);
    expect(host.errors.mock.calls.flat().join(" ")).toContain("Choose the legacy ZIP again");
  });
});

describe("Workshop panel dependency failures", () => {
  it("does not overwrite dependencies saved while a remote import is pending", async () => {
    let resolveQuery!: (value: BridgeDone) => void;
    host.runBridge.mockImplementation(
      () =>
        new Promise<BridgeDone>((resolve) => {
          resolveQuery = resolve;
        })
    );
    host.receive({
      type: "pullListing",
      target: mainTarget(),
      parts: {
        details: false,
        description: false,
        translations: false,
        previews: false,
        requirements: true,
        thumbnail: false,
      },
    });
    await vi.waitFor(() => expect(resolveQuery).toBeDefined());
    writeDependencies(host.listing, { apps: [800], items: ["801"] });
    const saved = fs.readFileSync(path.join(host.listing, "dependencies.json"), "utf8");
    resolveQuery({ action: "query", item: live("111"), translations: {} });
    await drain();
    expect(fs.readFileSync(path.join(host.listing, "dependencies.json"), "utf8")).toBe(saved);
    expect(host.errors).toHaveBeenCalled();
  });

  it("keeps local requirements after a failed import and performs no remote mutations", async () => {
    const before = fs.readFileSync(path.join(host.listing, "dependencies.json"), "utf8");
    host.runBridge.mockRejectedValue(new Error("GetAppDependencies failed: network unavailable"));
    await send({
      type: "pullListing",
      target: mainTarget(),
      parts: {
        details: false,
        description: false,
        translations: false,
        previews: false,
        requirements: true,
        thumbnail: false,
      },
    });
    expect(fs.readFileSync(path.join(host.listing, "dependencies.json"), "utf8")).toBe(before);
    expect(jobs().map((job) => job.action)).toEqual(["query"]);
    expect(host.errors.mock.calls.flat().join(" ")).toContain("network unavailable");
    expect(host.posted).toContainEqual(expect.objectContaining({ type: "uploadState", busy: false }));
  });

  it("does not reconcile or publish from an unknown dependency snapshot", async () => {
    host.runBridge.mockRejectedValue(new Error("GetAppDependencies failed: network unavailable"));
    await send({ ...upload(false, false), requirements: true });
    expect(jobs().map((job) => job.action)).toEqual(["query"]);
    expect(host.errors.mock.calls.flat().join(" ")).toContain("network unavailable");
  });
});

describe("Workshop panel legacy items", () => {
  it.each(["create", "publish"])(
    "allows a manual retry when %s never reached a Workshop API",
    async (action) => {
      await createLegacy();
      let fail = true;
      host.runBridge.mockImplementation(async (context, job: BridgeJob) => {
        if (job.action === action && fail) {
          fail = false;
          throw new BridgeStartError("Steam init failed: client unavailable");
        }
        return completeBridge(context, job);
      });
      await send(upload());
      expect(readLegacyItem(legacyDir()).legacy.content).toBe(action === "create" ? "new" : "ready");
      expect(jobs().filter((job) => job.action === action)).toHaveLength(1);
      await send(upload());
      expect(readLegacyItem(legacyDir()).legacy.content).toBe("published");
      expect(jobs().filter((job) => job.action === action)).toHaveLength(2);
    }
  );

  it("copies remote-only requirements, previews and missing translations from the main item", async () => {
    fs.unlinkSync(path.join(host.listing, "dependencies.json"));
    host.runBridge.mockImplementation(async (context, job: BridgeJob) => {
      if (job.action === "query" && job.itemId === "111")
        return {
          action: "query",
          item: {
            ...live("111"),
            previewUrl: "https://example.test/thumbnail.png",
            additionalPreviews: [
              { type: 0, urlOrVideoId: "https://example.test/gallery.png", originalFileName: "gallery.png" },
            ],
          },
          translations: {
            french: { title: "Titre", description: "Texte" },
            german: { title: "Remote German", description: "Remote German text" },
          },
        };
      return completeBridge(context, job);
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(new Uint8Array([137, 80, 78, 71]))
    );
    const info = await createLegacy();
    expect(info.dependencies).toEqual({ apps: [900], items: ["901"] });
    expect(info.translations.french).toEqual({ title: "Titre", description: "Texte" });
    expect(info.translations.german).toEqual({ title: "Titel", description: "Text" });
    expect(info.previews?.images).toHaveLength(1);
    expect(info.previewUri).not.toBeNull();
    expect(info.publishedId).toBeNull();
    expect(jobs().every((job) => job.action === "query")).toBe(true);
  });

  it("keeps explicitly empty local dependencies and gallery instead of inheriting remote values", async () => {
    writeDependencies(host.listing, { apps: [], items: [] });
    fs.mkdirSync(path.join(host.listing, "previews"));
    const info = await createLegacy();
    expect(info.dependencies).toEqual({ apps: [], items: [] });
    expect(info.previews).toMatchObject({ images: [], videos: [] });
  });

  it("does not reserve a legacy directory after a failed main-item dependency read", async () => {
    host.runBridge.mockRejectedValue(new Error("GetAppDependencies failed: network unavailable"));
    await createLegacy();
    expect(fs.existsSync(legacyDir())).toBe(false);
    expect(jobs().every((job) => job.action === "query")).toBe(true);
    expect(host.errors.mock.calls.flat().join(" ")).toContain("network unavailable");
  });

  it("copies current unsaved listing text and stages unsaved mod edits without saving either source", async () => {
    const descriptionPath = path.join(host.listing, "description.bbcode");
    const contentPath = path.join(root, "current.txt");
    host.documents = [
      { uri: URI.file(descriptionPath), isDirty: true, getText: () => "Unsaved listing text" },
      { uri: URI.file(contentPath), isDirty: true, getText: () => "Unsaved mod content" },
    ];
    await createLegacy();
    expect(fs.readFileSync(path.join(legacyDir(), "description.bbcode"), "utf8")).toBe(
      "Unsaved listing text"
    );
    let uploadedText = "";
    host.runBridge.mockImplementation(async (context, job: BridgeJob) => {
      if (job.action === "publish") {
        const staging = job.submits.find((submit) => submit.contentPath)!.contentPath!;
        uploadedText = fs.readFileSync(path.join(staging, "current.txt"), "utf8");
      }
      return completeBridge(context, job);
    });
    await send(upload());
    expect(uploadedText).toBe("Unsaved mod content");
    expect(fs.readFileSync(contentPath, "utf8")).toBe("Current mod files");
    expect(fs.readFileSync(descriptionPath, "utf8")).toBe("Local description");
    expect(host.documents.every((document) => document.isDirty)).toBe(true);
  });

  it("creates a separate listing and switches between independent Workshop IDs", async () => {
    const created = await createLegacy();
    expect(created).toMatchObject({
      legacyKey: "1.19",
      publishedId: null,
      supportedVersion: "1.19.*",
      description: "Local description",
      dependencies: { apps: [700], items: ["701"] },
    });
    updateLegacyItem(legacyDir(), { publishedfileid: "222" });
    expect((await send({ type: "reload", target: legacyTarget() })).publishedId).toBe("222");
    const main = await send({ type: "selectListing", target: legacyTarget(), key: null });
    expect(main).toMatchObject({ publishedId: "111", legacyKey: null, supportedVersion: "1.20.*" });
    expect((await send({ type: "selectListing", target: mainTarget(), key: "1.19" })).publishedId).toBe(
      "222"
    );
  });

  it("refuses duplicate creation without replacing the directory's files", async () => {
    await createLegacy();
    const file = path.join(legacyDir(), "description.bbcode");
    fs.writeFileSync(file, "Keep this legacy draft");
    await send({ type: "createLegacy", version: "1.19.*", target: legacyTarget() });
    expect(fs.readFileSync(file, "utf8")).toBe("Keep this legacy draft");
    expect(host.errors.mock.calls.flat().join(" ")).toContain("Delete that local directory");
    expect(jobs().every((job) => job.action === "query")).toBe(true);
  });

  it("rejects writes from a stale selection", async () => {
    await createLegacy();
    await send({ type: "saveLocal", target: mainTarget(), description: "Wrong target", translations: {} });
    expect(fs.readFileSync(path.join(legacyDir(), "description.bbcode"), "utf8")).toBe("Local description");
    expect(fs.readFileSync(path.join(host.listing, "description.bbcode"), "utf8")).toBe("Local description");
    expect(host.warnings.mock.calls.flat().join(" ")).toContain("selected Workshop item changed");
  });

  it("creates its own ID, uploads current files once with the legacy game version, then blocks content", async () => {
    await createLegacy();
    fs.writeFileSync(path.join(root, "current.txt"), "Edited after legacy creation");
    let stagedDescriptor = "";
    let stagedContent = "";
    host.runBridge.mockImplementation(async (context, job: BridgeJob) => {
      if (job.action === "publish") {
        const staged = job.submits.find((submit) => submit.contentPath)?.contentPath;
        expect(staged).toBeTruthy();
        stagedDescriptor = fs.readFileSync(path.join(staged!, "descriptor.mod"), "utf8");
        stagedContent = fs.readFileSync(path.join(staged!, "current.txt"), "utf8");
        expect(fs.existsSync(path.join(staged!, "workshop"))).toBe(false);
        expect(readLegacyItem(legacyDir()).legacy.content).toBe("submitted");
      }
      return completeBridge(context, job);
    });
    await send(upload());
    expect(jobs().filter((job) => job.action === "create")).toHaveLength(1);
    expect(jobs().find((job) => job.action === "publish")).toMatchObject({ itemId: "222" });
    expect(stagedDescriptor).toContain('supported_version="1.19.*"');
    expect(stagedDescriptor).toContain('remote_file_id="222"');
    expect(stagedDescriptor).toContain("# Keep this unrelated comment");
    expect(stagedContent).toBe("Edited after legacy creation");
    expect(fs.readFileSync(path.join(root, "descriptor.mod"), "utf8")).toBe(originalDescriptor);
    expect(readLegacyItem(legacyDir())).toMatchObject({
      publishedfileid: "222",
      legacy: { content: "published" },
    });
    const count = jobs().length;
    await send(upload());
    expect(jobs()).toHaveLength(count);
    expect(host.errors.mock.calls.flat().join(" ")).toMatch(/separate project/i);
  });

  it("uses only the legacy ID for later information updates and omits content", async () => {
    await createLegacy();
    const item = readLegacyItem(legacyDir());
    updateLegacyItem(legacyDir(), {
      publishedfileid: "222",
      legacy: { ...item.legacy, content: "published" },
    });
    await send(upload(true, false));
    const publish = jobs().find((job) => job.action === "publish");
    expect(publish).toMatchObject({ action: "publish", itemId: "222" });
    if (publish?.action !== "publish") throw new Error("Expected publish");
    expect(publish.submits.every((submit) => submit.contentPath === undefined)).toBe(true);
    expect(jobs().some((job) => job.action === "create")).toBe(false);
    expect(fs.readFileSync(path.join(root, "descriptor.mod"), "utf8")).toBe(originalDescriptor);
  });

  it("stops waiting without retry, retains local work, and never resends ambiguous first content", async () => {
    await createLegacy();
    let started = false;
    host.runBridge.mockImplementation(
      async (context, job: BridgeJob, _log, _progress, signal?: AbortSignal) => {
        if (job.action !== "publish") return completeBridge(context, job);
        started = true;
        expect(signal).toBeDefined();
        return new Promise<BridgeDone>((_resolve, reject) =>
          signal!.addEventListener("abort", () => reject(new BridgeWaitError("stopped", job)), { once: true })
        );
      }
    );
    host.receive(upload());
    await vi.waitFor(() => expect(started).toBe(true));
    host.receive({ type: "stopWaiting", target: legacyTarget() });
    await drain();
    expect(host.posted).toContainEqual(expect.objectContaining({ type: "uploadState", busy: false }));
    expect(readLegacyItem(legacyDir())).toMatchObject({
      publishedfileid: "222",
      legacy: { content: "submitted" },
    });
    expect(fs.readFileSync(path.join(legacyDir(), "description.bbcode"), "utf8")).toBe("Local description");
    expect(fs.readFileSync(path.join(root, "current.txt"), "utf8")).toBe("Current mod files");
    const count = jobs().length;
    await send(upload());
    expect(jobs()).toHaveLength(count);
    expect(jobs().filter((job) => job.action === "publish")).toHaveLength(1);
    expect(host.errors.mock.calls.flat().join(" ")).toContain("Steam may already have applied");
    host.close();
    showPanel();
    await drain();
    const reopened = await send({ type: "selectListing", key: "1.19", target: mainTarget() });
    expect(reopened.legacyContent).toBe("submitted");
    await send(upload());
    expect(jobs()).toHaveLength(count);
  });

  it("does not create a second item when the first create response was lost", async () => {
    await createLegacy();
    host.runBridge.mockImplementation(async (_context, job: BridgeJob) => {
      throw new BridgeWaitError("silent", job);
    });
    await send(upload());
    expect(readLegacyItem(legacyDir()).legacy.content).toBe("creating");
    expect(
      jobs()
        .filter((job) => job.action !== "query")
        .map((job) => job.action)
    ).toEqual(["create"]);
    await send(upload());
    expect(
      jobs()
        .filter((job) => job.action !== "query")
        .map((job) => job.action)
    ).toEqual(["create"]);
  });
});
