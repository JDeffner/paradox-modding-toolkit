/**
 * Steam Workshop publishing without the Paradox launcher: create or update the
 * focused mod's Workshop item through the Steam client's own UGC API (the
 * launcher is just another client of the same API). The native Steamworks
 * binding runs in a child process (steam/bridge.ts -> dist/steamBridge.js), so
 * no credentials are involved - the user's running Steam session authorizes
 * the upload - and a native failure cannot crash the extension host.
 *
 * New items are created PRIVATE (Steam's default): nothing goes public until
 * the user flips visibility on the Workshop page, which is also where the
 * description is written. The published id is persisted where each game's
 * tooling expects it: `remote_file_id` in descriptor.mod for launcher-`.mod`
 * games, `<configDir>/workshop.json` for `.metadata` games (their metadata.json
 * has no field for it).
 */
import * as vscode from "vscode";
import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { PxConfig } from "../config";
import { metaFor } from "../meta";
import type { GameMeta } from "@px-lsp/server/games/profile";
import { parseDescriptor, readDescriptorBlock, upsertDescriptorValue } from "@px-lsp/protocol/descriptorMod";
import { readMetadata } from "@px-lsp/protocol/descriptorMetadata";

const LEGAL_AGREEMENT_URL = "https://steamcommunity.com/sharedfiles/workshoplegalagreement";
/** Steam rejects preview images of 1 MB or more (k_cchFilenameMax aside). */
const PREVIEW_MAX_BYTES = 1024 * 1024;

interface PublishInfo {
  name: string | null;
  tags: string[];
  /** Workshop item id (decimal string), or null when never published. */
  publishedId: string | null;
  /** First-publish description; later edits happen on the Workshop page. */
  description: string | null;
  previewPath: string | null;
}

interface BridgeResult {
  itemId: string;
  needsToAcceptAgreement: boolean;
}

const unquote = (v: string): string => v.replace(/^"([^]*)"$/, "$1").trim();

function findPreview(root: string, preferred: string | null): string | null {
  const candidates = [preferred, "thumbnail.png", "thumbnail.jpg", "thumbnail.jpeg"].filter(
    (f): f is string => !!f
  );
  for (const f of candidates) {
    const p = path.join(root, f);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function workshopStateFile(root: string, meta: GameMeta): string {
  return path.join(root, meta.configDirName, "workshop.json");
}

/** What the mod's descriptor tells us about publishing it. Null = no descriptor. */
function readPublishInfo(root: string, meta: GameMeta): PublishInfo | null {
  if (meta.descriptor === "mod") {
    let text: string;
    try {
      text = fs.readFileSync(path.join(root, "descriptor.mod"), "utf8");
    } catch {
      return null;
    }
    const entries = parseDescriptor(text);
    const value = (key: string) => {
      const e = entries.find((x) => x.key === key && x.value !== "");
      return e ? unquote(e.value) : null;
    };
    const remote = value("remote_file_id");
    return {
      name: value("name"),
      tags: readDescriptorBlock(text, "tags"),
      publishedId: remote && /^\d+$/.test(remote) ? remote : null,
      description: null,
      previewPath: findPreview(root, value("picture")),
    };
  }
  const md = readMetadata(root);
  if (!md) return null;
  let publishedId: string | null = null;
  try {
    const state = JSON.parse(fs.readFileSync(workshopStateFile(root, meta), "utf8")) as {
      publishedFileId?: string;
    };
    if (state.publishedFileId && /^\d+$/.test(state.publishedFileId)) publishedId = state.publishedFileId;
  } catch {
    // Never published (or unreadable state): treated as a first publish.
  }
  return {
    name: typeof md.name === "string" && md.name.trim() !== "" ? md.name : null,
    tags: Array.isArray(md.tags) ? md.tags.filter((t): t is string => typeof t === "string") : [],
    publishedId,
    description: typeof md.short_description === "string" ? md.short_description : null,
    previewPath: findPreview(root, null),
  };
}

function persistPublishedId(root: string, meta: GameMeta, itemId: string): void {
  if (meta.descriptor === "mod") {
    const file = path.join(root, "descriptor.mod");
    fs.writeFileSync(
      file,
      upsertDescriptorValue(fs.readFileSync(file, "utf8"), "remote_file_id", itemId),
      "utf8"
    );
    return;
  }
  const file = workshopStateFile(root, meta);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ publishedFileId: itemId }, null, 2) + "\n", "utf8");
}

/**
 * Copy the mod into a staging folder for the upload, leaving out dot entries
 * (`.git`, `.vscode`, the toolkit's own config dir) at every level - except
 * `.metadata`, which IS the descriptor for the newer games.
 */
function stageContent(root: string, staging: string): void {
  fs.rmSync(staging, { recursive: true, force: true });
  fs.cpSync(root, staging, {
    recursive: true,
    filter: (src) => {
      const base = path.basename(src);
      return !base.startsWith(".") || base === ".metadata" || src === root;
    },
  });
}

/** Subject of the mod's last git commit, as a changenote suggestion. */
function lastCommitSubject(root: string): Promise<string> {
  return new Promise((resolve) => {
    cp.execFile("git", ["log", "-1", "--format=%s"], { cwd: root, windowsHide: true }, (err, stdout) =>
      resolve(err ? "" : stdout.trim())
    );
  });
}

interface BridgeJob {
  appId: number;
  action: "create" | "update";
  itemId?: string;
  update?: {
    title?: string;
    description?: string;
    changeNote?: string;
    previewPath?: string;
    contentPath: string;
    tags?: string[];
  };
}

function runBridge(
  context: vscode.ExtensionContext,
  job: BridgeJob,
  log: (msg: string) => void,
  onProgress?: (status: string, uploaded: number, total: number) => void
): Promise<BridgeResult> {
  const bridge = context.asAbsolutePath(path.join("dist", "steamBridge.js"));
  const steamworksDir = context.asAbsolutePath(path.join("dist", "steamworks"));
  return new Promise((resolve, reject) => {
    const child = cp.spawn(process.execPath, [bridge, steamworksDir], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let result: BridgeResult | null = null;
    let errorMessage: string | null = null;
    let buffer = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          if (event.type === "progress" && onProgress) {
            onProgress(String(event.status), Number(event.uploaded), Number(event.total));
          } else if (event.type === "done") {
            result = { itemId: String(event.itemId), needsToAcceptAgreement: !!event.needsToAcceptAgreement };
          } else if (event.type === "error") {
            errorMessage = String(event.message);
          }
        } catch {
          log(`steam bridge: unparseable line: ${line}`);
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("error", (err) => reject(new Error(`cannot start the Steam bridge: ${err.message}`)));
    child.on("close", (code) => {
      if (stderr.trim()) log(`steam bridge stderr: ${stderr.trim()}`);
      if (result) resolve(result);
      else reject(new Error(errorMessage ?? `Steam bridge exited with code ${code ?? "?"}`));
    });
    child.stdin.end(JSON.stringify(job));
  });
}

function workshopUrl(itemId: string): string {
  return `https://steamcommunity.com/sharedfiles/filedetails/?id=${itemId}`;
}

function friendlyError(e: unknown, meta: GameMeta): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("Steam init failed")) {
    return (
      `could not connect to Steam (${msg}). ` +
      `Steam must be running and logged in to an account that owns ${meta.name}.`
    );
  }
  return msg;
}

async function publishCommand(
  context: vscode.ExtensionContext,
  cfg: PxConfig,
  root: string | null,
  log: (msg: string) => void
): Promise<void> {
  const meta = metaFor(cfg.gameId);
  if (!root) {
    void vscode.window.showWarningMessage(
      "Paradox Modding Toolkit: open a mod folder as a workspace folder first."
    );
    return;
  }
  const info = readPublishInfo(root, meta);
  if (!info) {
    void vscode.window
      .showErrorMessage(
        `Paradox Modding Toolkit: the mod has no descriptor - the Workshop upload needs one (${root}).`,
        "Create Descriptor"
      )
      .then((choice) => {
        if (choice) void vscode.commands.executeCommand("px.createDescriptor");
      });
    return;
  }
  if (!info.name) {
    void vscode.window.showErrorMessage(
      "Paradox Modding Toolkit: the mod's descriptor has no name= - the Workshop needs a title."
    );
    return;
  }

  const isNew = !info.publishedId;
  if (isNew) {
    const go = await vscode.window.showInformationMessage(
      `Publish "${info.name}" to the Steam Workshop as a new ${meta.name} item?`,
      {
        modal: true,
        detail:
          "The item is created PRIVATE: only you can see it until you change its visibility " +
          "on its Workshop page. Steam must be running and logged in.",
      },
      "Publish"
    );
    if (go !== "Publish") return;
  }

  let changeNote = "Initial upload.";
  if (!isNew) {
    const suggestion = await lastCommitSubject(root);
    const note = await vscode.window.showInputBox({
      title: `Update "${info.name}" on the Steam Workshop`,
      prompt: "Changenote, shown on the item's Change Notes tab. Enter to upload.",
      value: suggestion,
      ignoreFocusOut: true,
    });
    if (note === undefined) return;
    changeNote = note;
  }

  let previewPath = info.previewPath ?? undefined;
  if (previewPath && fs.statSync(previewPath).size >= PREVIEW_MAX_BYTES) {
    void vscode.window.showWarningMessage(
      `Paradox Modding Toolkit: ${path.basename(previewPath)} is 1 MB or larger; ` +
        "Steam rejects such preview images, so this upload keeps the current one."
    );
    previewPath = undefined;
  }

  const staging = path.join(os.tmpdir(), "px-toolkit-workshop", path.basename(root));
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Steam Workshop: "${info.name}"`,
      cancellable: false, // Steam has no way to abort a running SubmitItemUpdate.
    },
    async (progress) => {
      let itemId = info.publishedId;
      let needsAgreement = false;
      try {
        if (!itemId) {
          progress.report({ message: "creating the Workshop item…" });
          const created = await runBridge(context, { appId: meta.steamAppId, action: "create" }, log);
          itemId = created.itemId;
          needsAgreement = created.needsToAcceptAgreement;
          // Persist BEFORE uploading: a failed upload must not orphan the item,
          // and for .mod games the uploaded descriptor then carries the id.
          persistPublishedId(root, meta, itemId);
          log(`workshop: created item ${itemId} for ${root}`);
        }

        progress.report({ message: "preparing files…" });
        stageContent(root, staging);

        const done = await runBridge(
          context,
          {
            appId: meta.steamAppId,
            action: "update",
            itemId,
            update: {
              title: info.name ?? undefined,
              description: isNew ? (info.description ?? undefined) : undefined,
              changeNote,
              previewPath,
              contentPath: staging,
              tags: info.tags.length ? info.tags : undefined,
            },
          },
          log,
          (status, uploaded, total) => {
            const pct = total > 0 ? ` (${Math.round((uploaded / total) * 100)}%)` : "";
            progress.report({ message: `${status.toLowerCase()}${pct}` });
          }
        );
        needsAgreement = needsAgreement || done.needsToAcceptAgreement;
        log(`workshop: uploaded ${root} to item ${itemId}`);
      } catch (e) {
        void vscode.window.showErrorMessage(
          `Paradox Modding Toolkit: Workshop upload failed - ${friendlyError(e, meta)}`
        );
        return;
      } finally {
        fs.rmSync(staging, { recursive: true, force: true });
      }

      if (needsAgreement) {
        void vscode.window
          .showWarningMessage(
            "Steam says you have not accepted the Workshop legal agreement yet; the item stays " +
              "hidden until you do.",
            "Open Agreement"
          )
          .then((choice) => {
            if (choice) void vscode.env.openExternal(vscode.Uri.parse(LEGAL_AGREEMENT_URL));
          });
      }
      void vscode.window
        .showInformationMessage(
          isNew
            ? `Paradox Modding Toolkit: "${info.name}" is on the Workshop as a private item. ` +
                "Add a description and set its visibility on the Workshop page."
            : `Paradox Modding Toolkit: "${info.name}" updated on the Workshop.`,
          "Open Workshop Page"
        )
        .then((choice) => {
          if (choice && itemId) void vscode.env.openExternal(vscode.Uri.parse(workshopUrl(itemId)));
        });
    }
  );
}

export function registerWorkshop(
  context: vscode.ExtensionContext,
  deps: { cfg: () => PxConfig; focusRoot: () => string | null; log: (msg: string) => void }
): void {
  const activeRoot = () => deps.focusRoot() ?? deps.cfg().modPath;
  context.subscriptions.push(
    vscode.commands.registerCommand("px.publishToWorkshop", () =>
      publishCommand(context, deps.cfg(), activeRoot(), deps.log)
    ),
    vscode.commands.registerCommand("px.openWorkshopPage", () => {
      const cfg = deps.cfg();
      const meta = metaFor(cfg.gameId);
      const root = activeRoot();
      const info = root ? readPublishInfo(root, meta) : null;
      if (!info?.publishedId) {
        void vscode.window
          .showInformationMessage(
            "Paradox Modding Toolkit: this mod has no Workshop item yet - publish it first.",
            "Publish to Workshop"
          )
          .then((choice) => {
            if (choice) void vscode.commands.executeCommand("px.publishToWorkshop");
          });
        return;
      }
      void vscode.env.openExternal(vscode.Uri.parse(workshopUrl(info.publishedId)));
    })
  );
}
