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
 * Publishing happens in the Workshop panel (webviews/workshop/), the single
 * place uploads are reviewed and confirmed; this module carries the shared
 * plumbing plus px.openWorkshopPage.
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
import { bundledSteamworksVersion, supportsLanguageUpdate } from "./languageProbe";
import { explainSteamError } from "./steamErrors";
import {
  hasListingFiles,
  readListingFiles,
  resolveChangeNote,
  resolveWorkshopDir,
  type ChangeNote,
} from "./workshopFiles";
import { type BridgeDone, type BridgeEvent, type BridgeJob, type SubmitSpec } from "./jobs";

export const LEGAL_AGREEMENT_URL = "https://steamcommunity.com/sharedfiles/workshoplegalagreement";
/**
 * How long the bridge may say nothing before it counts as hung. A running job
 * streams upload progress, and every other job answers in seconds, so silence
 * this long means the Steam client or the native call is wedged: without a
 * bound on it the upload promise never settles, the panel stays "uploading"
 * for the rest of the session and the staging copy is never removed.
 */
const BRIDGE_SILENCE_MS = 5 * 60_000;
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

/**
 * A fresh staging folder for one upload. Private per upload on purpose: two
 * windows publishing mods whose folder name matches would otherwise stage into
 * the same place and one would overwrite what the other is uploading. The
 * caller removes it when the upload ends.
 */
export function makeStagingDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "px-toolkit-workshop-"));
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
 * Whether the bundled steamworks.js can set per-language title/description.
 * Capability-probed, not version-compared (languageProbe.ts explains why);
 * the bridge enforces the same gate before anything uploads.
 */
export function supportsTranslationUpload(context: vscode.ExtensionContext): boolean {
  return supportsLanguageUpdate(context.asAbsolutePath(path.join("dist", "steamworks")));
}

/** The bundled steamworks.js version, for the panel's gate message. */
export function bundledSteamworks(context: vscode.ExtensionContext): string {
  return bundledSteamworksVersion(context.asAbsolutePath(path.join("dist", "steamworks")));
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
    let silence: NodeJS.Timeout | undefined;
    let hung = false;
    const heard = (): void => {
      clearTimeout(silence);
      silence = setTimeout(() => {
        hung = true;
        child.kill();
      }, BRIDGE_SILENCE_MS);
    };
    heard();
    child.stdout.on("data", (chunk: Buffer) => {
      heard();
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
    child.stderr.on("data", (chunk: Buffer) => {
      heard();
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(silence);
      reject(new Error(`cannot start the Steam bridge: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(silence);
      if (stderr.trim()) log(`steam bridge stderr: ${stderr.trim()}`);
      if (result) resolve(result);
      else if (hung)
        reject(
          new Error(
            "the Steam bridge stopped responding and was closed - Steam may be busy or hung; " +
              "restart Steam and try again"
          )
        );
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
  // Steam's EResult phrases are accurate but bare ("limit exceeded"); say
  // what the phrase usually means for a Workshop upload.
  const hint = explainSteamError(msg);
  return hint ? `${msg} (${hint})` : msg;
}

export function registerWorkshop(
  context: vscode.ExtensionContext,
  deps: { cfg: () => PxConfig; focusRoot: () => string | null; log: (msg: string) => void }
): void {
  const activeRoot = () => deps.focusRoot() ?? deps.cfg().modPath;
  context.subscriptions.push(
    vscode.commands.registerCommand("px.openWorkshopPage", () => {
      const cfg = deps.cfg();
      const meta = metaFor(cfg.gameId);
      const root = activeRoot();
      const info = root ? readPublishInfo(root, meta) : null;
      if (!info?.publishedId) {
        void vscode.window
          .showInformationMessage(
            "Paradox Modding Toolkit: this mod has no Workshop item yet - publish it from the Workshop panel first.",
            "Open Workshop Panel"
          )
          .then((choice) => {
            if (choice) void vscode.commands.executeCommand("px.openWorkshopManager");
          });
        return;
      }
      void vscode.env.openExternal(vscode.Uri.parse(workshopUrl(info.publishedId)));
    })
  );
}
