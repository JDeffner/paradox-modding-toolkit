/**
 * `Paradox: New Mod` and `Paradox: Move Mod` — create a mod (recommended: the
 * mod projects layout, see ./core.ts) with the launcher link that makes the
 * game find it, and convert an existing mod between the two layouts.
 */
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { GameMeta } from "@px-lsp/server/games/profile";
import { parseDescriptor, scaffoldDescriptor, wildcardVersion } from "@px-lsp/protocol/descriptorMod";
import { METADATA_REL_PATH, scaffoldMetadata } from "@px-lsp/protocol/descriptorMetadata";
import { readModName } from "@px-lsp/protocol/modName";
import type { PxConfig } from "../config";
import { gameDocsSubdir } from "../config";
import { detectGameVersion } from "../descriptorMod";
import { GAME_METAS } from "../gameDetect";
import { metaFor } from "../meta";
import { ensurePxIgnore, PXIGNORE_FILE } from "../steam/pxignore";
import {
  PROJECT_CONTENT_DIR,
  claimDest,
  copyTreeVerified,
  detectLayout,
  planMove,
  pointerModText,
  projectFolderName,
  retireSource,
  slugify,
  type MovePlan,
  type RetireResult,
} from "./core";

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

// ---- Paradox: Move Mod ---------------------------------------------------------

/** The mod roots this window is editing, most likely first. */
function workspaceModRoots(cfg: PxConfig): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const root of [cfg.modPath, ...cfg.workspaceMods]) {
    if (!root) continue;
    const key = path.resolve(root).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(root);
  }
  return out;
}

async function pickModRoot(cfg: PxConfig): Promise<string | null> {
  const roots = workspaceModRoots(cfg);
  if (roots.length === 0) return null;
  if (roots.length === 1) return roots[0];
  const pick = await vscode.window.showQuickPick(
    roots.map((root) => ({ label: readModName(root), description: root, root })),
    { title: "Move Mod", placeHolder: "Which mod?" }
  );
  return pick?.root ?? null;
}

/** A descriptor inside the mod must not keep a stale `path=`. Rewrite the line
 * the way New Mod writes it, and only when the file already has one. */
function syncDescriptorPath(contentDir: string): void {
  const file = path.join(contentDir, "descriptor.mod");
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  if (!parseDescriptor(text).some((e) => e.key === "path")) return;
  fs.writeFileSync(file, pointerModText(text, contentDir), "utf8");
}

/** Replace the moved folder in the workspace so watchers let go of the source.
 * Returns false when the window does not hold it as a folder. */
function swapWorkspaceFolder(oldRoots: string[], newRoot: string): boolean {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const keys = new Set(oldRoots.map((r) => path.resolve(r).toLowerCase()));
  const index = folders.findIndex((f) => keys.has(path.resolve(f.uri.fsPath).toLowerCase()));
  if (index < 0) return false;
  return vscode.workspace.updateWorkspaceFolders(index, 1, { uri: vscode.Uri.file(newRoot) });
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retire the copied-and-verified sources. Windows frees a folder a moment after
 * the watchers drop it, so a locked source is retried twice with a short delay
 * before it is renamed aside or left for the user. No persisted resume state:
 * the destination already holds everything, so the worst a window reload can
 * produce is a leftover folder that the log names.
 */
async function retireAll(dirs: string[]): Promise<RetireResult[]> {
  const out: RetireResult[] = [];
  for (const dir of dirs) {
    let result = retireSource(dir);
    for (const delay of [400, 1500]) {
      if (result.removed) break;
      await wait(delay);
      result = retireSource(dir);
    }
    out.push(result);
  }
  return out;
}

/** Run the copies and the in-destination relocation. Throws before anything is
 * retired when a copy does not verify. */
function runPlan(plan: MovePlan): number {
  let files = 0;
  for (const step of plan.copies) files += copyTreeVerified(step.from, step.to).files;
  for (const step of plan.relocate) {
    if (!claimDest(step.to)) throw new Error(`${step.to} already exists`);
    fs.mkdirSync(path.dirname(step.to), { recursive: true });
    fs.renameSync(step.from, step.to);
  }
  return files;
}

export async function moveModCommand(cfg: PxConfig, log: (msg: string) => void): Promise<void> {
  const meta = metaFor(cfg.gameId);
  const content = await pickModRoot(cfg);
  if (!content) {
    void vscode.window.showErrorMessage(`${PREFIX}: no mod in this workspace to move.`);
    return;
  }
  const gameModDir = gameDocsSubdir(meta, "mod");
  const projectsDir = modProjectsDirSetting();
  const info = detectLayout(content, { gameModDir, projectsDir, descriptor: meta.descriptor });
  if (info.layout === "unknown") {
    void vscode.window.showErrorMessage(
      `${PREFIX}: ${content} is neither inside ${gameModDir ?? "the game's mod folder"} nor a mod project, ` +
        `so there is no other layout to move it to.`
    );
    return;
  }
  if (!gameModDir) {
    void vscode.window.showErrorMessage(
      `${PREFIX}: could not locate Documents/Paradox Interactive/${meta.docsFolderName}/mod, ` +
        `so the launcher link cannot be kept correct.`
    );
    return;
  }

  const workshopSetting = vscode.workspace.getConfiguration("px").get<string>("workshop.dir");
  const linkNoun = meta.descriptor === "mod" ? "pointer file" : "folder link";

  let plan: MovePlan;
  let oldRoots: string[];
  let linkName: string;
  if (info.layout === "game") {
    const projects = await ensureModProjectsDir();
    if (!projects) return;
    linkName = path.basename(content);
    const destRoot = path.join(projects, projectFolderName(readModName(content)));
    if (!claimDest(destRoot)) {
      void vscode.window.showErrorMessage(`${PREFIX}: ${destRoot} already exists.`);
      return;
    }
    plan = planMove({
      direction: "toProjects",
      srcContent: content,
      destRoot,
      names: meta,
      workshopDirSetting: workshopSetting,
    });
    oldRoots = [content];
  } else {
    // Keep the launcher name the mod already has, so it keeps its identity.
    linkName = info.pointer
      ? path.basename(info.pointer, path.extname(info.pointer))
      : info.links.length > 0
        ? path.basename(info.links[0])
        : slugify(readModName(content));
    // A metadata game's link IS a directory entry under the destination name.
    for (const link of info.links) fs.rmSync(link);
    const destRoot = path.join(gameModDir, linkName);
    if (!claimDest(destRoot)) {
      void vscode.window.showErrorMessage(`${PREFIX}: ${destRoot} already exists.`);
      return;
    }
    plan = planMove({
      direction: "toGame",
      srcContent: content,
      destRoot,
      projectDir: info.projectDir,
      names: meta,
      workshopDirSetting: workshopSetting,
    });
    oldRoots = info.projectDir ? [info.projectDir, content] : [content];
  }

  const listingLine = plan.listingPinned
    ? " The Workshop listing stays where px.workshop.dir points."
    : plan.relocate.length > 0 || plan.copies.length > 1
      ? " The Workshop listing folder moves with it."
      : "";
  const ok = await vscode.window.showInformationMessage(
    `${PREFIX}: move ${readModName(content)} from ${content} to ${plan.destContent}? ` +
      `The folder is copied first, then the original is removed, and the launcher ` +
      `${linkNoun} is updated.${listingLine}`,
    "Move",
    "Cancel"
  );
  if (ok !== "Move") return;

  let files: number;
  try {
    files = runPlan(plan);
  } catch (err) {
    void vscode.window.showErrorMessage(
      `${PREFIX}: move stopped before anything was removed: ${err instanceof Error ? err.message : String(err)}`
    );
    return;
  }

  // From here the destination holds everything; the rest is wiring and cleanup.
  syncDescriptorPath(plan.destContent);
  let linkNote: string;
  try {
    if (plan.direction === "toProjects") {
      if (info.pointer) {
        const text = fs.readFileSync(info.pointer, "utf8");
        fs.writeFileSync(info.pointer, pointerModText(text, plan.destContent), "utf8");
        linkNote = `launcher ${linkNoun} updated: ${info.pointer}`;
      } else {
        let descriptor: string;
        try {
          descriptor = fs.readFileSync(path.join(plan.destContent, "descriptor.mod"), "utf8");
        } catch {
          descriptor = scaffoldDescriptor(readModName(plan.destContent), "1.*");
        }
        const link = createLauncherLink(meta, gameModDir, linkName, plan.destContent, descriptor);
        linkNote = `launcher ${linkNoun} created: ${link}`;
      }
    } else if (info.pointer) {
      fs.rmSync(info.pointer);
      linkNote = `launcher ${linkNoun} removed: ${info.pointer}, the game reads the folder directly now`;
    } else {
      linkNote = "the game reads the folder directly now";
    }
  } catch (err) {
    linkNote = `launcher ${linkNoun} NOT updated (${err instanceof Error ? err.message : String(err)})`;
  }

  const swapped = swapWorkspaceFolder(oldRoots, plan.destRoot);
  const retired = await retireAll(plan.retire);
  if (plan.pruneIfEmpty) {
    try {
      if (fs.readdirSync(plan.pruneIfEmpty).length === 0) fs.rmdirSync(plan.pruneIfEmpty);
    } catch {
      // Still holds git history or notes: it stays, which is the point of the layout.
    }
  }

  const leftovers = retired
    .filter((r) => !r.removed)
    .map((r) => (r.renamedTo ? `renamed to ${r.renamedTo}` : `still at ${r.left}`))
    .join("; ");
  log(
    `moved ${content} -> ${plan.destContent} (${files} files); ${linkNote}` +
      `${leftovers ? `; old folder ${leftovers}` : ""}${swapped ? "" : "; workspace folder not swapped"}`
  );

  const body = `${PREFIX}: moved to ${plan.destContent} (${linkNote}).`;
  if (leftovers) {
    void vscode.window.showWarningMessage(
      `${body} The old folder could not be removed: ${leftovers}. Delete it yourself once nothing holds it open.`
    );
  } else if (!swapped) {
    const choice = await vscode.window.showInformationMessage(body, "Open Folder");
    if (choice === "Open Folder") {
      await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(plan.destRoot), {
        forceNewWindow: true,
      });
    }
  } else {
    void vscode.window.showInformationMessage(body);
  }
}
