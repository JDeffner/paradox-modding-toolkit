/**
 * ck3-tiger acquisition: download a release from GitHub into the extension's
 * global storage so diagnostics work without the user hunting for a binary.
 *
 * The extension never bundles tiger (it tracks game patches faster than the
 * extension releases); instead the effective tiger path resolves as:
 * px.tigerPath setting → most recent downloaded copy → none.
 */
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";

const RELEASES_API = "https://api.github.com/repos/amtep/tiger/releases/latest";

/** Which tiger to fetch/run. The amtep/tiger releases ship one archive per
 * game (ck3-tiger-*, vic3-tiger-*); flavors keep the downloads apart. */
export interface TigerFlavor {
  /** Asset/binary name prefix ("ck3-tiger", "vic3-tiger"). */
  prefix: string;
  /** Storage subfolder under global storage ("tiger" is the legacy CK3 spot). */
  subdir: string;
}

export const CK3_TIGER: TigerFlavor = { prefix: "ck3-tiger", subdir: "tiger" };
export const VIC3_TIGER: TigerFlavor = { prefix: "vic3-tiger", subdir: "tiger-vic3" };

export function tigerFlavorFor(gameId: string): TigerFlavor {
  return gameId === "vic3" ? VIC3_TIGER : CK3_TIGER;
}

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

/** The right tiger asset for this platform, or null (e.g. macOS has no prebuilt). */
export function pickTigerAsset(
  assets: ReleaseAsset[],
  platform: NodeJS.Platform,
  flavor: TigerFlavor = CK3_TIGER
): ReleaseAsset | null {
  const pattern =
    platform === "win32"
      ? new RegExp(`^${flavor.prefix}-windows-.*\\.zip$`)
      : platform === "linux"
        ? new RegExp(`^${flavor.prefix}-linux-.*\\.(tar\\.gz|tgz)$`)
        : null;
  if (!pattern) return null;
  return assets.find((a) => pattern.test(a.name)) ?? null;
}

function tigerStorageDir(storageDir: string, flavor: TigerFlavor): string {
  return path.join(storageDir, flavor.subdir);
}

/** Every tiger binary of the flavor inside `dir` (recursive). */
function findBinaries(dir: string, flavor: TigerFlavor): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...findBinaries(full, flavor));
    } else if (
      entry.isFile() &&
      (process.platform === "win32"
        ? new RegExp(`^${flavor.prefix}.*\\.exe$`, "i")
        : new RegExp(`^${flavor.prefix}[^.]*$`)
      ).test(entry.name)
    ) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Choose the ck3-tiger binary to use, preferring the plain validator over the
 * `-auto` variant. The Windows/Linux archive ships both `ck3-tiger` and
 * `ck3-tiger-auto`; the latter guesses the mod from the launcher and needs the
 * Paradox user directory (and fails with "Cannot find the Paradox directory"
 * when Documents is redirected). We always invoke tiger with an explicit mod
 * path, so the plain binary is the correct one — and the only one that answers
 * `--version` without touching any game directory.
 */
export function preferPlainBinary(paths: string[]): string | null {
  if (paths.length === 0) return null;
  const plain = paths.find((p) => !/auto/i.test(path.basename(p)));
  return plain ?? paths[0];
}

/** The tiger binary to use inside `dir` (recursive), plain variant preferred. */
function locateBinary(dir: string, flavor: TigerFlavor): string | null {
  return preferPlainBinary(findBinaries(dir, flavor));
}

/** The most recently downloaded tiger binary in global storage, or null. */
export function findDownloadedTiger(storageDir: string, flavor: TigerFlavor = CK3_TIGER): string | null {
  const base = tigerStorageDir(storageDir, flavor);
  let versions: string[];
  try {
    versions = fs.readdirSync(base).sort().reverse();
  } catch {
    return null;
  }
  for (const v of versions) {
    const bin = locateBinary(path.join(base, v), flavor);
    if (bin) return bin;
  }
  return null;
}

export interface TigerDownloadResult {
  binaryPath: string;
  version: string;
}

/**
 * Download and unpack the latest ck3-tiger release. Throws with a
 * user-presentable message on any failure. `report` receives progress text.
 */
export async function downloadLatestTiger(
  storageDir: string,
  report: (msg: string) => void,
  flavor: TigerFlavor = CK3_TIGER
): Promise<TigerDownloadResult> {
  report("querying latest release...");
  const apiRes = await fetch(RELEASES_API, {
    headers: { "User-Agent": "ck3-modding-vscode", Accept: "application/vnd.github+json" },
  });
  if (!apiRes.ok) throw new Error(`GitHub API returned ${apiRes.status} for the tiger releases feed.`);
  const release = (await apiRes.json()) as { tag_name?: string; assets?: ReleaseAsset[] };
  const tag = release.tag_name ?? "unknown";
  const asset = pickTigerAsset(release.assets ?? [], process.platform, flavor);
  if (!asset) {
    throw new Error(
      process.platform === "darwin"
        ? "tiger has no prebuilt macOS binary; build it from source (github.com/amtep/tiger) and set px.tigerPath."
        : `no ${flavor.prefix} asset found for this platform in release ${tag}.`
    );
  }

  report(`downloading ${asset.name}...`);
  const dlRes = await fetch(asset.browser_download_url, {
    headers: { "User-Agent": "ck3-modding-vscode" },
  });
  if (!dlRes.ok) throw new Error(`download failed with HTTP ${dlRes.status}.`);
  const buffer = Buffer.from(await dlRes.arrayBuffer());

  const destDir = path.join(tigerStorageDir(storageDir, flavor), tag);
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  const archivePath = path.join(destDir, asset.name);
  fs.writeFileSync(archivePath, buffer);

  report("unpacking...");
  // bsdtar ships with Windows 10+ and handles zip; GNU/bsd tar handles tar.gz.
  try {
    execFileSync("tar", ["-xf", archivePath, "-C", destDir], { windowsHide: true });
  } catch (err) {
    throw new Error(`could not unpack ${asset.name}: ${String(err)}`);
  } finally {
    try {
      fs.rmSync(archivePath);
    } catch {
      // leftover archive is harmless
    }
  }

  const binaryPath = locateBinary(destDir, flavor);
  if (!binaryPath) throw new Error(`archive unpacked but no ${flavor.prefix} binary was found in it.`);
  if (process.platform !== "win32") fs.chmodSync(binaryPath, 0o755);

  // Keep only the freshly downloaded version.
  for (const entry of fs.readdirSync(tigerStorageDir(storageDir, flavor))) {
    if (entry !== tag) {
      try {
        fs.rmSync(path.join(tigerStorageDir(storageDir, flavor), entry), { recursive: true, force: true });
      } catch {
        // old versions are cleaned up best-effort
      }
    }
  }

  // Sanity check the binary runs.
  try {
    execFileSync(binaryPath, ["--version"], { windowsHide: true, timeout: 15000 });
  } catch (err) {
    throw new Error(`downloaded tiger does not run: ${String(err)}`);
  }

  return { binaryPath, version: tag };
}
