import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, mkdtemp, rm, rename, access } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const excludedPages = ["TODO.md", "_Sidebar.md", "_Footer.md"];
const git = (cwd, args, encoding = "utf8") =>
  execFileSync("git", ["-C", cwd, ...args], { encoding, maxBuffer: 32 * 1024 * 1024 });

// Read committed blobs, not a possibly dirty working tree. A failed import leaves
// the previous cache intact, but still fails the build instead of publishing it.
export async function importWiki(checkout, destination) {
  const wikiRevision = git(checkout, ["rev-parse", "HEAD"]).trim();
  const entries = git(checkout, ["ls-tree", "-rz", "--full-tree", wikiRevision])
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const [metadata, path] = entry.split("\t");
      const [mode, type, hash] = metadata.split(" ");
      return { mode, type, hash, path };
    });
  const pages = entries.filter(
    ({ path }) => !path.includes("/") && path.endsWith(".md") && !excludedPages.includes(path)
  );
  if (!pages.some(({ path }) => path === "Home.md")) throw new Error("Wiki has no Home.md");
  const files = [...pages, ...entries.filter(({ path }) => path.startsWith("images/"))];
  for (const { mode, type, path } of files) {
    if (type !== "blob" || !["100644", "100755"].includes(mode))
      throw new Error(`Unsupported wiki entry: ${path}`);
    if (path.includes("\\") || path.split("/").some((part) => part === ".." || part === "."))
      throw new Error(`Invalid wiki path: ${path}`);
  }
  const manifest = {
    wikiRevision,
    importedPages: pages.map(({ path }) => path).sort(),
    excludedPages,
  };
  const parent = dirname(resolve(destination));
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(join(parent, "wiki-import-"));
  let backup;
  try {
    for (const { hash, path } of files) {
      const target = join(staging, path.startsWith("images/") ? path : `content/${path}`);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, git(checkout, ["cat-file", "blob", hash], null));
    }
    await mkdir(join(staging, "images"), { recursive: true });
    await writeFile(join(staging, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    try {
      await access(destination);
      backup = `${staging}-previous`;
      await rename(destination, backup);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    try {
      await rename(staging, destination);
    } catch (error) {
      if (backup) await rename(backup, destination);
      throw error;
    }
    if (backup) await rm(backup, { recursive: true });
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const cache = join(root, ".cache");
  await mkdir(cache, { recursive: true });
  let temporary;
  try {
    let checkout = process.argv[2];
    if (!checkout) {
      const { repository } = JSON.parse(await readFile(join(root, "sources.json"), "utf8"));
      temporary = await mkdtemp(join(cache, "wiki-checkout-"));
      execFileSync("git", ["clone", "--depth", "1", `${repository}.wiki.git`, temporary], {
        stdio: "inherit",
      });
      checkout = temporary;
    }
    const manifest = await importWiki(resolve(checkout), join(cache, "wiki"));
    console.log(`Imported ${manifest.importedPages.length} wiki pages at ${manifest.wikiRevision}.`);
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}
