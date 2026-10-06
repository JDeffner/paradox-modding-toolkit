import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, join } from "node:path";

const root = resolve(import.meta.dirname, "../dist");
const { base } = JSON.parse(await readFile(join(root, "build.json"), "utf8"));
async function walk(dir) {
  const paths = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      paths.map((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]))
    )
  ).flat();
}
const pages = (await walk(root)).filter((file) => file.endsWith(".html"));
const errors = [];
let links = 0;
for (const file of pages) {
  const html = await readFile(file, "utf8");
  const pageUrl = `https://site.invalid${base}${file.slice(root.length + 1).replaceAll("\\", "/")}`;
  if ((html.match(/<h1\b/g) ?? []).length !== 1) errors.push(`${file}: expected one h1`);
  if (/\[\[[^\]]+\]\]/.test(html)) errors.push(`${file}: unresolved wiki link`);
  for (const img of html.matchAll(/<img\b[^>]*>/g))
    if (!/\bwidth=/.test(img[0]) || !/\bheight=/.test(img[0]) || !/\balt=/.test(img[0]))
      errors.push(`${file}: image lacks dimensions or alt`);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  if (new Set(ids).size !== ids.length) errors.push(`${file}: duplicate id`);
  for (const match of html.matchAll(/\b(?:href|src|poster)="([^"]+)"/g)) {
    const raw = match[1].replaceAll("&amp;", "&");
    if (/^(?:https?:|mailto:|data:)/.test(raw)) continue;
    const target = new URL(raw, pageUrl);
    if (!target.pathname.startsWith(base)) {
      errors.push(`${file}: link escapes base: ${raw}`);
      continue;
    }
    let local = join(root, decodeURIComponent(target.pathname.slice(base.length)));
    try {
      if ((await stat(local)).isDirectory()) local = join(local, "index.html");
      await stat(local);
      if (target.hash && local.endsWith(".html")) {
        const body = await readFile(local, "utf8");
        const anchor = decodeURIComponent(target.hash.slice(1));
        if (!body.includes(`id="${anchor}"`) && !body.includes(`name="${anchor}"`))
          errors.push(`${file}: missing anchor ${raw}`);
      }
      links++;
    } catch {
      errors.push(`${file}: missing target ${raw}`);
    }
  }
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Checked ${pages.length} pages, ${links} internal links/assets, headings and image dimensions.`
  );
