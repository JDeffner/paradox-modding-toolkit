import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { URI } from "vscode-uri";
import type { BridgeJob } from "../src/steam/jobs";
import type { AppToHost, HostToApp } from "../src/webviews/workshop/messages";

const ui = vi.hoisted(() => ({
  receive: (_message: AppToHost) => {},
  close: () => {},
  posted: [] as HostToApp[],
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(async () => undefined),
  bridge: vi.fn(),
  encode: vi.fn(),
}));
vi.mock("vscode", () => {
  const disposable = { dispose() {} };
  return {
    Uri: URI,
    ViewColumn: { Active: 1 },
    DiagnosticSeverity: { Error: 0, Warning: 1 },
    RelativePattern: class {},
    workspace: {
      getConfiguration: () => ({ get: () => undefined }),
      createFileSystemWatcher: () => ({
        ...disposable,
        onDidCreate: () => disposable,
        onDidChange: () => disposable,
        onDidDelete: () => disposable,
      }),
    },
    window: {
      showErrorMessage: ui.error,
      showWarningMessage: ui.warn,
      showInformationMessage: ui.info,
      createWebviewPanel: () => ({
        dispose() {},
        onDidDispose: (callback: () => void) => {
          ui.close = callback;
          return disposable;
        },
        onDidChangeViewState: () => disposable,
        webview: {
          html: "",
          options: {},
          asWebviewUri: (uri: URI) => uri,
          postMessage: async (message: HostToApp) => {
            ui.posted.push(message);
            if (message.type === "preparePreview") queueMicrotask(() => ui.receive(ui.encode(message)));
            return true;
          },
          onDidReceiveMessage: (callback: typeof ui.receive) => {
            ui.receive = callback;
            return disposable;
          },
        },
      }),
    },
  };
});
vi.mock("../src/webviews/devReload", () => ({
  webviewSource: () => ({ root: URI.file("/extension"), watch: false }),
  bundleUri: () => "app.js",
  watchBundle: () => ({ dispose() {} }),
}));
vi.mock("../src/steam/workshop", async (original) => ({
  ...(await original<typeof import("../src/steam/workshop")>()),
  runBridge: ui.bridge,
  lastCommitSubject: async () => null,
  latestRelease: async () => null,
}));

import { WorkshopPanel } from "../src/webviews/workshop/panel";
import { metaFor } from "../src/meta";

let root: string;
const upload: AppToHost = {
  type: "upload",
  content: false,
  details: false,
  description: false,
  previews: true,
  requirements: false,
  languages: [],
  changeNote: "",
  visibility: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  ui.posted.length = 0;
  ui.warn.mockResolvedValue("Create Smaller Copies");
  ui.encode.mockImplementation((message: Extract<HostToApp, { type: "preparePreview" }>) => ({
    type: "previewPrepared",
    id: message.id,
    error: "Invalid image data",
  }));
  const scratch = path.resolve(".local/testing");
  fs.mkdirSync(scratch, { recursive: true });
  root = fs.mkdtempSync(path.join(scratch, "workshop-upload-"));
  fs.writeFileSync(path.join(root, "descriptor.mod"), 'name="Preview test"\nremote_file_id="123"\n');
  fs.mkdirSync(path.join(root, ".px-toolkit/workshop/previews"), { recursive: true });
  ui.bridge.mockImplementation(async (_context: unknown, job: BridgeJob) => {
    if (job.action === "query")
      return { action: "query", item: { additionalPreviews: [] }, translations: {} };
    return { action: "publish", itemId: "123", needsToAcceptAgreement: false };
  });
  WorkshopPanel.show(
    {
      globalStorageUri: URI.file(root),
    } as import("vscode").ExtensionContext,
    {
      meta: metaFor("ck3"),
      mods: [{ label: "Preview test", path: root }],
      active: root,
      gamePath: null,
      log: () => {},
    }
  );
});

async function runUpload(message: AppToHost = upload): Promise<void> {
  ui.receive(message);
  await vi.waitFor(() =>
    expect(ui.posted).toContainEqual({ type: "progress", job: "upload", step: null, done: 0, total: 0 })
  );
}

function imageFile(name: string, size: number): string {
  const file = path.join(root, ".px-toolkit/workshop/previews", name);
  fs.writeFileSync(file, Buffer.alloc(size, 7));
  return file;
}
afterEach(() => {
  ui.close();
  fs.rmSync(root, { recursive: true, force: true });
});

it("does not report success after dropping oversized gallery images", async () => {
  for (const [name, size] of [
    ["small.png", 100],
    ["large.png", 1_200_000],
  ] as const)
    fs.writeFileSync(path.join(root, ".px-toolkit/workshop/previews", name), Buffer.alloc(size));
  await runUpload();
  const publish = ui.bridge.mock.calls.map((c) => c[1] as BridgeJob).find((j) => j.action === "publish");
  // Invalid oversized image data must fail before changing the gallery.
  expect(publish).toBeUndefined();
  expect(ui.error).toHaveBeenCalledWith(expect.stringContaining("large.png"));
  expect(ui.info).not.toHaveBeenCalledWith(
    expect.stringContaining("Upload complete"),
    expect.anything(),
    expect.anything()
  );
});

it("uploads all five images in listing order, preserves source bytes, and cleans temporary copies", async () => {
  const names = ["01.png", "02.png", "03.png", "04.png", "05.png"];
  const originals = names.map((name, i) => imageFile(name, i === 1 ? 917_304 : 1_400_000));
  const snapshots = originals.map((file) => fs.readFileSync(file));
  fs.writeFileSync(path.join(root, ".px-toolkit/workshop/previews/order.txt"), "05.png\n01.png\n");
  const staged: string[] = [];
  ui.encode.mockImplementation((message: Extract<HostToApp, { type: "preparePreview" }>) => ({
    type: "previewPrepared",
    id: message.id,
    image: { mime: "image/jpeg", data: Buffer.alloc(400_000, 3).toString("base64") },
  }));
  ui.bridge.mockImplementation(async (_context: unknown, job: BridgeJob) => {
    if (job.action === "query")
      return { action: "query", item: { additionalPreviews: [{}, {}] }, translations: {} };
    if (job.action === "publish") {
      staged.push(...job.submits[0].previewImages!);
      expect(staged.map((file) => path.basename(file))).toEqual([
        "05.jpg",
        "01.jpg",
        "02.png",
        "03.jpg",
        "04.jpg",
      ]);
      expect(staged.every((file) => fs.statSync(file).size < 1_048_576)).toBe(true);
      expect(fs.readFileSync(staged[2])).toEqual(snapshots[1]);
      expect(job.submits[0].removePreviewIndexes).toEqual([0, 1]);
    }
    return { action: "publish", itemId: "123", needsToAcceptAgreement: false };
  });
  await runUpload();
  expect(ui.error).not.toHaveBeenCalled();
  expect(staged).toHaveLength(5);
  expect(staged.every((file) => !fs.existsSync(file))).toBe(true);
  expect(originals.map((file) => fs.readFileSync(file))).toEqual(snapshots);
  expect(ui.encode).toHaveBeenCalledTimes(4);
  expect(ui.warn).toHaveBeenCalledWith(
    expect.stringContaining("4 preview image(s)"),
    "Create Smaller Copies",
    "Cancel Upload"
  );
  const copiesRoot = path.join(root, ".px-toolkit/workshop-upload-previews");
  const batch = path.join(copiesRoot, fs.readdirSync(copiesRoot)[0]);
  const copies = fs
    .readdirSync(batch, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile());
  expect(copies).toHaveLength(4);
  expect(
    copies.every((entry) =>
      fs.readFileSync(path.join(entry.parentPath, entry.name)).equals(Buffer.alloc(400_000, 3))
    )
  ).toBe(true);
  expect(ui.info).toHaveBeenCalledWith(
    expect.stringContaining("Upload complete"),
    "Open in Steam",
    "Open in Browser"
  );
});

it.each(["Cancel Upload", undefined])(
  "cancels without Steam calls or saved copies when the prompt returns %s",
  async (choice) => {
    imageFile("large.png", 1_200_000);
    ui.warn.mockResolvedValueOnce(choice);
    await runUpload();
    expect(ui.bridge).not.toHaveBeenCalled();
    expect(ui.encode).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(root, ".px-toolkit/workshop-upload-previews"))).toBe(false);
    expect(ui.error).not.toHaveBeenCalled();
  }
);

it("fails before creating a new Steam item when a gallery image cannot be prepared", async () => {
  fs.writeFileSync(path.join(root, "descriptor.mod"), 'name="New item"\n');
  imageFile("animation.gif", 1_048_576);
  await runUpload();
  expect(ui.bridge).not.toHaveBeenCalled();
  expect(ui.error).toHaveBeenCalledWith(expect.stringContaining("animation.gif"));
  expect(fs.readFileSync(path.join(root, "descriptor.mod"), "utf8")).not.toContain("remote_file_id");
});

it("reports a copy-folder write failure and preserves the existing path", async () => {
  imageFile("large.png", 1_200_000);
  const blocked = path.join(root, ".px-toolkit/workshop-upload-previews");
  fs.writeFileSync(blocked, "preserve this file");
  await runUpload();
  expect(ui.error).toHaveBeenCalledWith(expect.stringContaining("Workshop upload failed"));
  expect(ui.bridge).not.toHaveBeenCalled();
  expect(ui.encode).not.toHaveBeenCalled();
  expect(fs.readFileSync(blocked, "utf8")).toBe("preserve this file");
});

it("rejects converted images that still meet or exceed Steam's limit", async () => {
  imageFile("large.png", 1_200_000);
  ui.encode.mockImplementation((message: Extract<HostToApp, { type: "preparePreview" }>) => ({
    type: "previewPrepared",
    id: message.id,
    image: { mime: "image/png", data: Buffer.alloc(1_048_576).toString("base64") },
  }));
  await runUpload();
  expect(ui.error).toHaveBeenCalledWith(expect.stringContaining("large.png"));
  expect(ui.bridge).not.toHaveBeenCalled();
});

it("rejects pending conversion when the panel closes, without submitting to Steam", async () => {
  imageFile("large.png", 1_200_000);
  ui.encode.mockImplementation((message: Extract<HostToApp, { type: "preparePreview" }>) => {
    ui.close();
    return { type: "previewPrepared", id: message.id, error: "late response" };
  });
  ui.receive(upload);
  await vi.waitFor(() =>
    expect(ui.error).toHaveBeenCalledWith(expect.stringContaining("Workshop panel closed"))
  );
  expect(ui.bridge).not.toHaveBeenCalled();
});

it("leaves an existing gallery alone when Steam cannot return its current previews", async () => {
  imageFile("small.png", 100);
  ui.bridge.mockResolvedValue({ action: "query", item: null, translations: {} });
  await runUpload();
  expect(ui.bridge.mock.calls.map((c) => c[1].action)).toEqual(["query"]);
  expect(ui.error).toHaveBeenCalledWith(expect.stringContaining("current gallery"));
});

it("cleans all prepared images and reports a Steam submission failure", async () => {
  imageFile("small.gif", 100);
  let staged = "";
  ui.bridge.mockImplementation(async (_context: unknown, job: BridgeJob) => {
    if (job.action === "query")
      return { action: "query", item: { additionalPreviews: [] }, translations: {} };
    if (job.action === "publish") {
      staged = job.submits[0].previewImages![0];
      throw new Error("Steam unavailable");
    }
  });
  await runUpload();
  expect(staged).not.toBe("");
  expect(fs.existsSync(staged)).toBe(false);
  expect(ui.error).toHaveBeenCalledWith(expect.stringContaining("Steam unavailable"));
});

it("does not prepare or replace the gallery when previews are switched off", async () => {
  imageFile("animation.gif", 1_048_576);
  await runUpload({ ...upload, previews: false, description: true });
  expect(ui.error).not.toHaveBeenCalled();
  expect(ui.encode).not.toHaveBeenCalled();
  expect(ui.bridge).toHaveBeenCalledTimes(1);
  expect(ui.bridge.mock.calls[0][1].submits[0]).not.toHaveProperty("previewImages");
});

it("removes every old gallery preview when the local previews folder is empty", async () => {
  ui.bridge.mockImplementation(async (_context: unknown, job: BridgeJob) =>
    job.action === "query"
      ? { action: "query", item: { additionalPreviews: [{}, {}, {}] }, translations: {} }
      : { action: "publish", itemId: "123", needsToAcceptAgreement: false }
  );
  await runUpload();
  expect(ui.error).not.toHaveBeenCalled();
  expect(ui.bridge.mock.calls[1][1].submits[0]).toMatchObject({
    previewImages: [],
    removePreviewIndexes: [0, 1, 2],
  });
});
