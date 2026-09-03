/**
 * `Paradox: New Mod` — create a mod, recommended into the mod projects layout
 * (see ./core.ts), with the launcher link that makes the game find it.
 */
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { GameMeta } from "@px-lsp/server/games/profile";
import { scaffoldDescriptor, wildcardVersion } from "@px-lsp/protocol/descriptorMod";
import { METADATA_REL_PATH, scaffoldMetadata } from "@px-lsp/protocol/descriptorMetadata";
import type { PxConfig } from "../config";
import { gameDocsSubdir } from "../config";
import { detectGameVersion } from "../descriptorMod";
import { GAME_METAS } from "../gameDetect";
import { metaFor } from "../meta";
import { ensurePxIgnore, PXIGNORE_FILE } from "../steam/pxignore";
import { PROJECT_CONTENT_DIR, pointerModText, projectFolderName, slugify } from "./core";

const PREFIX = "Paradox Modding Toolkit";

function modProjectsDirSetting(): string | null {
  const v = (vscode.workspace.getConfiguration("px").get<string>("modProjectsDir") ?? "").trim();
  return v === "" ? null : v;
}

/** The configured projects folder, or ask for one and save it (Global: it is
 * a per-machine choice, like the game path). Null when the user cancels. */
async function ensureModProjectsDir(): Promise<string | null> {
  const existing = modProjectsDirSetting();
  if (existing) {
    fs.mkdirSync(existing, { recursive: true });
    return existing;
  }
  const pick = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    title: "Pick your mod projects folder (each mod gets its own subfolder)",
    openLabel: "Use as Mod Projects Folder",
  });
  if (!pick || pick.length === 0) return null;
  const dir = pick[0].fsPath;
  await vscode.workspace
    .getConfiguration("px")
    .update("modProjectsDir", dir, vscode.ConfigurationTarget.Global);
  return dir;
}

/** The active game — asked explicitly when the workspace holds no Paradox
 * content, so a fresh window never silently creates a CK3 mod for Vic3. */
async function pickGame(cfg: PxConfig): Promise<GameMeta | null> {
  if (cfg.isCk3Workspace) return metaFor(cfg.gameId);
  type Item = vscode.QuickPickItem & { meta: GameMeta };
  const pick = await vscode.window.showQuickPick<Item>(
    Object.values(GAME_METAS).map((meta) => ({ label: meta.name, meta })),
    { title: "Which game?", placeHolder: "The game the mod is for" }
  );
  return pick?.meta ?? null;
}

/** The starter descriptor for a new mod, in the game's own convention. */
function scaffoldFor(
  meta: GameMeta,
  name: string,
  slug: string,
  gamePath: string | null
): { relPath: string[]; text: string } {
  const detected = detectGameVersion(gamePath);
  const version = (detected && wildcardVersion(detected)) ?? "1.*";
  return meta.descriptor === "metadata"
    ? {
        relPath: METADATA_REL_PATH.split("/"),
        text: scaffoldMetadata({ name, id: slug, supportedGameVersion: version }),
      }
    : { relPath: ["descriptor.mod"], text: scaffoldDescriptor(name, version) };
}

/** Create the launcher-side link for `contentDir` under `name`: a pointer
 * `.mod` file for the `.mod` games, a directory link for the metadata games
 * (junction on Windows — no admin rights needed — symlink elsewhere; linking
 * into the mod folder is the documented external-mod workflow for these
 * games). Returns the link path; throws when the name is taken. */
function createLauncherLink(
  meta: GameMeta,
  gameModDir: string,
  name: string,
  contentDir: string,
  descriptorText: string
): string {
  fs.mkdirSync(gameModDir, { recursive: true });
  if (meta.descriptor === "mod") {
    const pointer = path.join(gameModDir, `${name}.mod`);
    if (fs.existsSync(pointer)) throw new Error(`${pointer} already exists`);
    fs.writeFileSync(pointer, pointerModText(descriptorText, contentDir), "utf8");
    return pointer;
  }
  const link = path.join(gameModDir, name);
  if (entryExists(link)) throw new Error(`${link} already exists`);
  fs.symlinkSync(contentDir, link, "junction");
  return link;
}

/** existsSync is false for a dangling symlink; a link entry still blocks the name. */
function entryExists(p: string): boolean {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/** The metadata games list the mod without a thumbnail and the Workshop upload
 * refuses; we do not fabricate an image, so say it once (mirrors px.createDescriptor). */
function maybeThumbnailNote(meta: GameMeta, contentDir: string): string {
  if (meta.descriptor !== "metadata" || fs.existsSync(path.join(contentDir, "thumbnail.png"))) return "";
  return ` Add a square thumbnail.png to the mod root: ${meta.name} needs one for the Workshop upload.`;
}

async function offerToOpen(root: string): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    `${PREFIX}: mod created at ${root}.`,
    "Open in New Window",
    "Add to Workspace"
  );
  if (choice === "Open in New Window") {
    await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(root), {
      forceNewWindow: true,
    });
  } else if (choice === "Add to Workspace") {
    vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders?.length ?? 0, 0, {
      uri: vscode.Uri.file(root),
    });
  }
}

export async function createModCommand(cfg: PxConfig, log: (msg: string) => void): Promise<void> {
  const meta = await pickGame(cfg);
  if (!meta) return;

  const raw = await vscode.window.showInputBox({
    title: `New ${meta.shortName} Mod — name`,
    prompt: "Display name shown in the launcher and on the Workshop.",
    validateInput: (v) => (v.trim().length >= 3 ? null : "At least 3 characters (Workshop minimum)."),
  });
  if (!raw) return;
  const modName = raw.trim();
  const slug = slugify(modName);

  const gameModDir = gameDocsSubdir(meta, "mod");
  const projectsDir = modProjectsDirSetting();
  const linkNoun = meta.descriptor === "mod" ? `a small ${slug}.mod link file` : "a folder link";
  type LocItem = vscode.QuickPickItem & { mode: "project" | "game" };
  const loc = await vscode.window.showQuickPick<LocItem>(
    [
      {
        label: "Game mod folder (recommended)",
        description: gameModDir ?? undefined,
        detail:
          `Everything in one folder. A ${PXIGNORE_FILE} file keeps git, editor and toolkit files ` +
          `(${meta.configDirName}/) out of Workshop uploads made through the toolkit.`,
        mode: "game",
      },
      {
        label: "Mod projects folder",
        description: projectsDir ?? "you pick the folder next",
        detail:
          `The mod lives in <project>/${PROJECT_CONTENT_DIR}; git, notes and Workshop listing files stay ` +
          `next to it, outside the upload. The game finds it via ${linkNoun} in its mod folder.`,
        mode: "project",
      },
    ],
    { title: "New Mod — where", placeHolder: "Where should the mod live?" }
  );
  if (!loc) return;

  try {
    if (loc.mode === "game") {
      if (!gameModDir) {
        void vscode.window.showErrorMessage(
          `${PREFIX}: could not locate Documents/Paradox Interactive/${meta.docsFolderName}/mod.`
        );
        return;
      }
      const dir = path.join(gameModDir, slug);
      if (entryExists(dir)) {
        void vscode.window.showErrorMessage(`${PREFIX}: ${dir} already exists.`);
        return;
      }
      const scaffold = scaffoldFor(meta, modName, slug, cfg.gamePath);
      const file = path.join(dir, ...scaffold.relPath);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, scaffold.text, "utf8");
      fs.mkdirSync(path.join(dir, meta.configDirName, "workshop"), { recursive: true });
      ensurePxIgnore(dir);
      log(`new mod created at ${dir}${maybeThumbnailNote(meta, dir)}`);
      await offerToOpen(dir);
      return;
    }

    const projects = await ensureModProjectsDir();
    if (!projects) return;
    const projectDir = path.join(projects, projectFolderName(modName));
    if (entryExists(projectDir)) {
      void vscode.window.showErrorMessage(`${PREFIX}: ${projectDir} already exists.`);
      return;
    }
    const contentDir = path.join(projectDir, PROJECT_CONTENT_DIR);
    const scaffold = scaffoldFor(meta, modName, slug, cfg.gamePath);
    const file = path.join(contentDir, ...scaffold.relPath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, scaffold.text, "utf8");

    let linkNote: string;
    if (gameModDir) {
      try {
        linkNote = `Launcher link: ${createLauncherLink(meta, gameModDir, slug, contentDir, scaffold.text)}.`;
      } catch (err) {
        linkNote = `Launcher link NOT created (${err instanceof Error ? err.message : String(err)}).`;
      }
    } else {
      linkNote =
        `Launcher link NOT created: Documents/Paradox Interactive/${meta.docsFolderName}/mod not found. ` +
        `The game will not see the mod until it is linked there.`;
    }
    log(`new mod project at ${projectDir}. ${linkNote}`);
    const note = maybeThumbnailNote(meta, contentDir);
    if (note || linkNote.includes("NOT")) {
      void vscode.window.showWarningMessage(`${PREFIX}: ${linkNote}${note}`);
    }
    await offerToOpen(projectDir);
  } catch (err) {
    void vscode.window.showErrorMessage(`${PREFIX}: failed to create the mod: ${String(err)}`);
  }
}
