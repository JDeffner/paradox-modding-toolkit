/**
 * tiger acquisition: download a release from GitHub into the extension's
 * global storage so diagnostics work without the user hunting for a binary.
 *
 * The extension never bundles tiger (it tracks game patches faster than the
 * extension releases); instead the effective tiger path resolves as:
 * px.tigerPath setting → most recent downloaded copy → none.
 *
 * Which tiger — and whether one exists at all — comes from the active game's
 * meta (GameMeta.tiger). Games without a tiger (EU5) have no flavor, and every
 * caller must treat that as "skip tiger entirely".
 */
import * as fs from "fs";
import * as path from "path";
import { execFile } from "child_process";
import { createHash } from "crypto";
import { promisify } from "util";
import type { GameMeta } from "@px-lsp/server/games/profile";
import { isCk3, metaFor } from "./meta";

/**
 * Both child processes run on the extension host thread. execFileSync blocked
 * every other extension in the window for as long as tar took, and again for as
 * long as the freshly written binary took to answer `--version` (up to its 15 s
 * timeout; a first run on Windows with Defender scanning 20 MB is the slow
 * case). The function is already async and already reports progress.
 */
const execFileAsync = promisify(execFile);

const ALLOWED_DOWNLOAD_HOSTS = new Set([
  "github.com",
  "objects.githubusercontent.com",
  // GitHub started redirecting release assets here in 2025 (both hosts remain in use).
  "release-assets.githubusercontent.com",
]);

/**
 * The parsed download URL, or null when it is not a GitHub release URL.
 * `base` resolves a relative `Location` header against the hop that sent it.
 *
 * `browser_download_url` is a field of the GitHub API answer, and what comes
 * back is written to disk, unpacked and then executed. There is no checksum to
 * verify against (tiger publishes none), so the host is the one thing that can
 * be asserted, and it is asserted for every URL the download touches, not just
 * the first one.
 */
export function checkedDownloadUrl(raw: string, base?: URL): URL | null {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !ALLOWED_DOWNLOAD_HOSTS.has(url.hostname)) return null;
  return url;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * GitHub hands a release asset over as a redirect chain (github.com answers a
 * 302 to a signed objects.githubusercontent.com URL), so redirects have to be
 * followed. Five hops is far more than that chain has ever taken and keeps a
 * redirect loop from spending the whole download timeout.
 */
const MAX_DOWNLOAD_REDIRECTS = 5;

/** Where a download response points next. */
export type RedirectStep =
  /** Not a redirect: this response carries the bytes. */
  | { kind: "done" }
  /** A redirect to an allowed host. */
  | { kind: "follow"; url: URL }
  /** A redirect off the allowlist. */
  | { kind: "refused"; target: string };

/**
 * The next step of a download's redirect chain.
 *
 * `fetch` follows redirects itself, which would leave the allowlist covering
 * only the first URL: a hop off it would then deliver the bytes that get
 * unpacked and executed, which is the whole thing the check exists to stop.
 * Split out of the fetch loop so each branch is testable without a network.
 */
export function redirectStep(status: number, location: string | null, from: URL): RedirectStep {
  if (!REDIRECT_STATUSES.has(status) || location === null) return { kind: "done" };
  const url = checkedDownloadUrl(location, from);
  return url ? { kind: "follow", url } : { kind: "refused", target: location };
}

/**
 * GET `url`, checking every redirect target against the host allowlist.
 *
 * The abort signal is created once and shared across the chain, so the timeout
 * bounds the whole download instead of restarting at each hop.
 */
async function fetchCheckedDownload(url: URL, timeoutMs: number): Promise<Response> {
  const signal = AbortSignal.timeout(timeoutMs);
  let current = url;
  for (let hop = 0; ; hop++) {
    const res = await fetch(current, {
      headers: { "User-Agent": "ck3-modding-vscode" },
      redirect: "manual",
      signal,
    });
    const step = redirectStep(res.status, res.headers.get("location"), current);
    if (step.kind === "done") return res;
    if (step.kind === "refused") {
      throw new Error(`refusing to follow the redirect to ${step.target}: not an https GitHub release URL.`);
    }
    if (hop >= MAX_DOWNLOAD_REDIRECTS) {
      throw new Error(`download of ${url.href} still redirecting after ${MAX_DOWNLOAD_REDIRECTS} hops.`);
    }
    try {
      await res.body?.cancel();
    } catch {
      // a 3xx body is empty in practice; failing to drain it is not fatal
    }
    current = step.url;
  }
}

/** Hang guards: without them a stalled connection leaves the progress notification up forever. */
const API_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 300_000;

/** Which tiger to fetch/run. The tiger releases ship one archive per game
 * (ck3-tiger-*, vic3-tiger-*); flavors keep the downloads apart. */
export interface TigerFlavor {
  /** Asset/binary name prefix, from `GameMeta.tiger.binaryName`. */
  prefix: string;
  /** GitHub `owner/repo` shipping the releases, from `GameMeta.tiger.repoSlug`. */
  repoSlug: string;
  /** Storage subfolder under global storage ("tiger" is the legacy CK3 spot). */
  subdir: string;
}

/**
 * The tiger flavor for a game, or null when the game has no tiger (EU5 — no
 * eu5-tiger exists). A null flavor is the single signal callers gate on.
 */
export function tigerFlavorFor(gameId: string): TigerFlavor | null {
  const meta: GameMeta = metaFor(gameId);
  if (!meta.tiger) return null;
  // CK3 keeps the pre-multi-game folder name so existing downloads survive.
  return {
    prefix: meta.tiger.binaryName,
    repoSlug: meta.tiger.repoSlug,
    subdir: isCk3(meta.id) ? "tiger" : `tiger-${meta.id}`,
  };
}

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

/** The right tiger asset for this platform, or null (e.g. macOS has no prebuilt). */
export function pickTigerAsset(
  assets: ReleaseAsset[],
  platform: NodeJS.Platform,
  flavor: TigerFlavor
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
 * Choose the tiger binary to use, preferring the plain validator over the
 * `-auto` variant. The Windows/Linux archive ships both `<game>-tiger` and
 * `<game>-tiger-auto`; the latter guesses the mod from the launcher and needs the
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
export function findDownloadedTiger(storageDir: string, flavor: TigerFlavor): string | null {
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
 * Download and unpack the latest tiger release of `flavor`. Throws with a
 * user-presentable message on any failure. `report` receives progress text.
 */
export async function downloadLatestTiger(
  storageDir: string,
  report: (msg: string) => void,
  flavor: TigerFlavor
): Promise<TigerDownloadResult> {
  report("querying latest release...");
  const apiRes = await fetch(`https://api.github.com/repos/${flavor.repoSlug}/releases/latest`, {
    headers: { "User-Agent": "ck3-modding-vscode", Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!apiRes.ok) throw new Error(`GitHub API returned ${apiRes.status} for the tiger releases feed.`);
  const release = (await apiRes.json()) as { tag_name?: string; assets?: ReleaseAsset[] };
  const tag = release.tag_name ?? "unknown";
  const asset = pickTigerAsset(release.assets ?? [], process.platform, flavor);
  if (!asset) {
    throw new Error(
      process.platform === "darwin"
        ? `${flavor.prefix} has no prebuilt macOS binary; build it from source (github.com/${flavor.repoSlug}) and set px.tigerPath.`
        : `no ${flavor.prefix} asset found for this platform in release ${tag}.`
    );
  }

  const assetUrl = checkedDownloadUrl(asset.browser_download_url);
  if (!assetUrl) {
    throw new Error(
      `refusing to download ${asset.name}: ${asset.browser_download_url} is not an https GitHub release URL.`
    );
  }

  report(`downloading ${assetUrl.href}...`);
  const dlRes = await fetchCheckedDownload(assetUrl, DOWNLOAD_TIMEOUT_MS);
  if (!dlRes.ok) throw new Error(`download failed with HTTP ${dlRes.status}.`);
  const buffer = Buffer.from(await dlRes.arrayBuffer());
  // tiger publishes no checksums, so there is nothing to verify against. The
  // hash goes to the output channel instead, where it can be compared with the
  // release page by hand.
  report(
    `${asset.name}: ${buffer.length} bytes, sha256 ${createHash("sha256").update(buffer).digest("hex")}`
  );

  const destDir = path.join(tigerStorageDir(storageDir, flavor), tag);
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  const archivePath = path.join(destDir, asset.name);
  fs.writeFileSync(archivePath, buffer);

  report("unpacking...");
  // bsdtar ships with Windows 10+ and handles zip; GNU/bsd tar handles tar.gz.
  try {
    await execFileAsync("tar", ["-xf", archivePath, "-C", destDir], { windowsHide: true });
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
    await execFileAsync(binaryPath, ["--version"], { windowsHide: true, timeout: 15000 });
  } catch (err) {
    throw new Error(`downloaded tiger does not run: ${String(err)}`);
  }

  return { binaryPath, version: tag };
}
