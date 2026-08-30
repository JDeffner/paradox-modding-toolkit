/**
 * Steam Workshop publishing without the Paradox launcher: create or update the
 * focused mod's Workshop item through the Steam client's own UGC API (the
 * launcher is just another client of the same API). The native Steamworks
 * binding runs in a child process (steam/bridge.ts -> dist/steamBridge.js), so
 * no credentials are involved - the user's running Steam session authorizes
 * the upload - and a native failure cannot crash the extension host.
 *
 * New items are created PRIVATE (Steam's default): nothing goes public until
 * the user flips visibility, on the Workshop page or in the Workshop panel.
 * The published id is persisted where each game's tooling expects it:
 * `remote_file_id` in descriptor.mod for launcher-`.mod` games,
 * `<configDir>/workshop.json` for `.metadata` games (their metadata.json has
 * no field for it). Description and per-language translations live in the
 * workshop folder as files when it exists (steam/workshopFiles.ts), else in
 * `<configDir>/workshop.json`, and ride along on every upload.
 *
 * This module is the quick path (px.publishToWorkshop); the Workshop panel
 * (webviews/workshop/) is the full editor and reuses everything exported here.
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
import {
  readWorkshopMeta,
  upsertWorkshopMeta,
  type WorkshopTranslation,
} from "@px-lsp/protocol/workshopMeta";
import {
  hasListingFiles,
  readListingFiles,
  resolveChangeNote,
  resolveWorkshopDir,
  type ChangeNote,
} from "./workshopFiles";
import {
  LANGUAGE_UPDATE_MIN_VERSION,
  versionAtLeast,
  type BridgeDone,
  type BridgeEvent,
  type BridgeJob,
  type SubmitSpec,
} from "./jobs";

export const LEGAL_AGREEMENT_URL = "https://steamcommunity.com/sharedfiles/workshoplegalagreement";
/** Steam rejects preview images of 1 MB or more (k_cchFilenameMax aside). */
export const PREVIEW_MAX_BYTES = 1024 * 1024;

/** Resolved px.workshop.dir for `root`: where the listing lives as files. */
export function workshopDirFor(root: string): string {
  const setting = vscode.workspace.getConfiguration("px").get<string>("workshop.dir");
  return resolveWorkshopDir(root, setting);
}

/** The changenote resolved from px.workshop.changelog, or null. */
export function changelogNoteFor(root: string, version: string | null): ChangeNote | null {
  const setting = vscode.workspace.getConfiguration("px").get<string>("workshop.changelog");
  return resolveChangeNote(workshopDirFor(root), setting, version);
}

export interface PublishInfo {
  name: string | null;
  tags: string[];
  /** Workshop item id (decimal string), or null when never published. */
  publishedId: string | null;
  /** The local copy of the item's description (workshop.json, else the metadata short_description). */
  description: string | null;
  /** The local per-language translations (workshop.json), keyed by Steam API language code. */
  translations: Record<string, WorkshopTranslation>;
  previewPath: string | null;
  /** The mod's own version (descriptor version= / metadata version). */
  version: string | null;
  /** The game version the mod says it works with. */
  supportedVersion: string | null;
}

const unquote = (v: string): string => v.replace(/^"([^]*)"$/, "$1").trim();

export function findPreview(root: string, preferred: string | null): string | null {
  const candidates = [preferred, "thumbnail.png", "thumbnail.jpg", "thumbnail.jpeg"].filter(
    (f): f is string => !!f
  );
  for (const f of candidates) {
    const p = path.join(root, f);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * What the mod's descriptor, workshop.json and the workshop folder tell us
 * about publishing it. Null = no descriptor. When the workshop folder exists
 * its files win over workshop.json, field by field (`workshopDir` defaults to
 * the px.workshop.dir resolution; pass a value to skip re-reading settings).
 */
export function readPublishInfo(
  root: string,
  meta: GameMeta,
  workshopDir: string = workshopDirFor(root)
): PublishInfo | null {
  const store = readWorkshopMeta(root, meta.configDirName);
  const files = hasListingFiles(workshopDir) ? readListingFiles(workshopDir) : null;
  const translations: Record<string, WorkshopTranslation> = { ...(store?.translations ?? {}) };
  for (const [lang, t] of Object.entries(files?.translations ?? {})) {
    translations[lang] = { ...translations[lang], ...t };
  }
  const description = files?.description ?? store?.description ?? null;
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
      description,
      translations,
      previewPath: findPreview(root, value("picture")),
      version: value("version"),
      supportedVersion: value("supported_version"),
    };
  }
  const md = readMetadata(root);
  if (!md) return null;
  const storedId = store?.publishedFileId;
  return {
    name: typeof md.name === "string" && md.name.trim() !== "" ? md.name : null,
    tags: Array.isArray(md.tags) ? md.tags.filter((t): t is string => typeof t === "string") : [],
    publishedId: storedId && /^\d+$/.test(storedId) ? storedId : null,
    description: description ?? (typeof md.short_description === "string" ? md.short_description : null),
    translations,
    previewPath: findPreview(root, null),
    version: typeof md.version === "string" ? md.version : null,
    supportedVersion: typeof md.supported_game_version === "string" ? md.supported_game_version : null,
  };
}

export function persistPublishedId(root: string, meta: GameMeta, itemId: string): void {
  if (meta.descriptor === "mod") {
    const file = path.join(root, "descriptor.mod");
    fs.writeFileSync(
      file,
      upsertDescriptorValue(fs.readFileSync(file, "utf8"), "remote_file_id", itemId),
      "utf8"
    );
    return;
  }
  upsertWorkshopMeta(root, meta.configDirName, { publishedFileId: itemId });
}

/**
 * Copy the mod into a staging folder for the upload, leaving out dot entries
 * (`.git`, `.vscode`, the toolkit's own config dir) at every level - except
 * `.metadata`, which IS the descriptor for the newer games.
 */
export function stageContent(root: string, staging: string, exclude: string[] = []): void {
  fs.rmSync(staging, { recursive: true, force: true });
  const skip = exclude.map((p) => path.resolve(p).toLowerCase());
  fs.cpSync(root, staging, {
    recursive: true,
    filter: (src) => {
      if (skip.includes(path.resolve(src).toLowerCase())) return false;
      const base = path.basename(src);
      return !base.startsWith(".") || base === ".metadata" || src === root;
    },
  });
}

/** The staging folder an upload of `root` copies into. */
export function stagingDir(root: string): string {
  return path.join(os.tmpdir(), "px-toolkit-workshop", path.basename(root));
}

/** Subject of the mod's last git commit, as a changenote suggestion. */
export function lastCommitSubject(root: string): Promise<string> {
  return new Promise((resolve) => {
    cp.execFile("git", ["log", "-1", "--format=%s"], { cwd: root, windowsHide: true }, (err, stdout) =>
      resolve(err ? "" : stdout.trim())
    );
  });
}

/**
 * Whether the bundled steamworks.js can set per-language title/description
 * (jobs.ts LANGUAGE_UPDATE_MIN_VERSION; the bridge enforces the same gate).
 */
export function supportsTranslationUpload(context: vscode.ExtensionContext): boolean {
  try {
    const pkg = context.asAbsolutePath(path.join("dist", "steamworks", "package.json"));
    const version = (JSON.parse(fs.readFileSync(pkg, "utf8")) as { version?: string }).version ?? "0.0.0";
    return versionAtLeast(version, LANGUAGE_UPDATE_MIN_VERSION);
  } catch {
    return false;
  }
}

/**
 * The translation submits of an upload: one per language that has any text.
 * No changenote on them - one upload should read as one change on the item's
 * Change Notes tab, not one entry per language.
 */
export function translationSubmits(translations: Record<string, WorkshopTranslation>): SubmitSpec[] {
  return Object.entries(translations)
    .filter(([, t]) => (t.title ?? "").trim() !== "" || (t.description ?? "").trim() !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([language, t]) => ({
      language,
      title: (t.title ?? "").trim() !== "" ? t.title : undefined,
      description: (t.description ?? "").trim() !== "" ? t.description : undefined,
    }));
}

export function runBridge(
  context: vscode.ExtensionContext,
  job: BridgeJob,
  log: (msg: string) => void,
  onProgress?: (status: string, uploaded: number, total: number, submit: number, submits: number) => void
): Promise<BridgeDone> {
  const bridge = context.asAbsolutePath(path.join("dist", "steamBridge.js"));
  const steamworksDir = context.asAbsolutePath(path.join("dist", "steamworks"));
  return new Promise((resolve, reject) => {
    const child = cp.spawn(process.execPath, [bridge, steamworksDir], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let result: BridgeDone | null = null;
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
          const event = JSON.parse(line) as BridgeEvent;
          if (event.type === "progress" && onProgress) {
            onProgress(event.status, event.uploaded, event.total, event.submit, event.submits);
          } else if (event.type === "done") {
            result = event.result;
          } else if (event.type === "error") {
            errorMessage = event.message;
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

export function workshopUrl(itemId: string): string {
  return `https://steamcommunity.com/sharedfiles/filedetails/?id=${itemId}`;
}

export function friendlyError(e: unknown, meta: GameMeta): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("Steam init failed")) {
    return (
      `could not connect to Steam (${msg}). ` +
      `Steam must be running and logged in to an account that owns ${meta.name}.`
    );
  }
  return msg;
}

/** Warn about (and drop) a preview image Steam would reject. */
function usablePreview(previewPath: string | null): string | undefined {
  if (!previewPath) return undefined;
  if (fs.statSync(previewPath).size >= PREVIEW_MAX_BYTES) {
    void vscode.window.showWarningMessage(
      `Paradox Modding Toolkit: ${path.basename(previewPath)} is 1 MB or larger; ` +
        "Steam rejects such preview images, so this upload keeps the current one."
    );
    return undefined;
  }
  return previewPath;
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
          "in the Workshop panel or on its Workshop page. Steam must be running and logged in.",
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

  // Translations ride along when the bundled binding can set them; on an older
  // binding they are skipped (never silently mis-uploaded - the bridge would
  // refuse them too) and the panel says what version is needed.
  const translations = supportsTranslationUpload(context) ? translationSubmits(info.translations) : [];
  const staging = stagingDir(root);
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
          const created = await runBridge(context, { action: "create", appId: meta.steamAppId }, log);
          if (created.action !== "create") throw new Error("unexpected bridge reply");
          itemId = created.itemId;
          needsAgreement = created.needsToAcceptAgreement;
          // Persist BEFORE uploading: a failed upload must not orphan the item,
          // and for .mod games the uploaded descriptor then carries the id.
          persistPublishedId(root, meta, itemId);
          log(`workshop: created item ${itemId} for ${root}`);
        }

        progress.report({ message: "preparing files…" });
        stageContent(root, staging, [workshopDirFor(root)]);

        const submits: SubmitSpec[] = [
          {
            title: info.name ?? undefined,
            description: info.description ?? undefined,
            changeNote,
            previewPath: usablePreview(info.previewPath),
            contentPath: staging,
            tags: info.tags.length ? info.tags : undefined,
          },
          ...translations,
        ];
        const done = await runBridge(
          context,
          { action: "publish", appId: meta.steamAppId, itemId, submits },
          log,
          (status, uploaded, total, submit, count) => {
            const pct = total > 0 ? ` (${Math.round((uploaded / total) * 100)}%)` : "";
            const step = count > 1 ? (submit > 1 ? ` - translations ${submit - 1}/${count - 1}` : "") : "";
            progress.report({ message: `${status.toLowerCase()}${pct}${step}` });
          }
        );
        if (done.action !== "publish") throw new Error("unexpected bridge reply");
        needsAgreement = needsAgreement || done.needsToAcceptAgreement;
        log(
          `workshop: uploaded ${root} to item ${itemId}` +
            (translations.length ? ` (+${translations.length} translation(s))` : "")
        );
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
                "Add a description and set its visibility in the Workshop panel."
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
