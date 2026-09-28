import { mkdir, readFile, writeFile, cp, rm } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { Marked } from "marked";
import { groupsFor, slug, titleFor, descriptionFor, routeFor } from "./catalog.mjs";
import { homepage, releasesPage, identityPage, demosPage } from "./pages.mjs";

const root = resolve(import.meta.dirname, "..");
const out = join(root, "dist");
const wikiRoot = join(root, ".cache/wiki");
const manifest = await readFile(join(wikiRoot, "manifest.json"), "utf8").catch((error) => {
  if (error.code === "ENOENT") throw new Error("Wiki cache missing. Run pnpm sync:wiki before building.");
  throw error;
});
const sources = {
  ...JSON.parse(await readFile(join(root, "sources.json"), "utf8")),
  ...JSON.parse(manifest),
};
const base = process.env.SITE_BASE ?? "/";
if (!base.startsWith("/") || !base.endsWith("/") || base.includes(".."))
  throw new Error("SITE_BASE must be an absolute pathname with a trailing slash.");
const origin = process.env.SITE_ORIGIN ?? "https://paradoxtoolkit.jdeffner.com";
const url = (path = "") => `${base}${path}`;
export const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
const repo = sources.repository;
const install = "https://marketplace.visualstudio.com/items?itemName=JDeffner.px-toolkit";
const ids = sources.importedPages.map((file) => basename(file, ".md"));
const groups = groupsFor(ids);
if (ids.some((id) => !slug(id)) || new Set(ids.map(routeFor)).size !== ids.length)
  throw new Error("Wiki page routes collide");
const aliases = new Map(
  ids.flatMap((id) => [
    [slug(id), id],
    [slug(titleFor(id)), id],
  ])
);
aliases.set("protocol", "Protocol-Reference");
aliases.set("embedding", "Embedding");
const resolveLink = (href) => {
  const wiki = `${repo}/wiki/`;
  if (href.startsWith(wiki)) href = href.slice(wiki.length);
  if (href.startsWith("images/")) return url(`assets/wiki/${href.slice(7)}`);
  if (/^(?:https?:|mailto:|#|\/)/.test(href)) return href;
  const [path, hash] = href.split("#");
  const id = aliases.get(slug(decodeURIComponent(basename(path)).replace(/\.md$/i, "")));
  if (id) return url(routeFor(id)) + (hash ? `#${hash}` : "");
  // Canonical developer guides refer to repository files as well as handbook pages.
  return `${repo}/blob/${sources.contentRevision}/${path.replace(/^(?:\.\.\/)+/, "")}${hash ? `#${hash}` : ""}`;
};

// Only the build directory owned by this package is replaced.
if (out !== resolve(root, "dist")) throw new Error("Invalid build output directory");
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(join(root, "public"), out, { recursive: true });
await cp(join(wikiRoot, "images"), join(out, "assets/wiki"), { recursive: true });
const search = [];
const routes = [];
const nav = (active) => `<nav class="main-nav" id="main-nav" aria-label="Main navigation">
  <a href="${url()}#features">Features</a><a ${active === "docs" ? 'aria-current="page"' : ""} href="${url("docs/")}">Handbook</a><a ${active === "releases" ? 'aria-current="page"' : ""} href="${url("releases/")}">Releases</a><a ${active === "credits" ? 'aria-current="page"' : ""} href="${url("credits/")}">Credits</a>
  <a href="${repo}" class="github-link">GitHub <span aria-hidden="true">↗</span></a><a href="${install}" class="button button-small">Get the extension <span aria-hidden="true">↗</span></a></nav>`;
const footer = `<footer class="site-footer"><div class="footer-top"><a class="brand" href="${url()}"><img src="${url("assets/logo.svg")}" width="44" height="44" alt=""><span>PARADOX<span>MODDING TOOLKIT</span></span></a><p>Script. Inspect. Create. Publish.</p><a href="${repo}">Source on GitHub ↗</a><a href="https://discord.gg/DfEJ2H9hj4">Join the community ↗</a></div><div class="footer-bottom"><span>By Joël Deffner · GPL-3.0-or-later</span><div><a href="${url("brand/")}">Visual identity</a><a href="${url("docs/contributing/")}">Contribute</a><a href="${url("docs/home/")}">About the docs</a></div><p>Community-built. Not affiliated with or endorsed by Paradox Interactive.</p></div></footer>`;

async function page(
  path,
  title,
  description,
  content,
  { active = "", className = "", noindex = false } = {}
) {
  const file = path === "404.html" ? path : `${path}index.html`;
  await mkdir(join(out, path === "404.html" ? "" : path), { recursive: true });
  await writeFile(
    join(out, file),
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escape(title)} | Paradox Modding Toolkit</title><meta name="description" content="${escape(description)}">${noindex ? '<meta name="robots" content="noindex">' : ""}<link rel="canonical" href="${origin}${url(path)}"><meta property="og:type" content="website"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:image" content="${origin}${url("assets/social-preview.png")}"><meta property="og:url" content="${origin}${url(path)}"><meta name="twitter:card" content="summary_large_image"><meta name="theme-color" content="#f2ede3"><link rel="icon" href="${url("assets/logo.svg")}" type="image/svg+xml"><link rel="preload" href="${url("assets/fonts/source-sans.woff2")}" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="${url("assets/site.css")}"><script type="module" src="${url("assets/site.mjs")}"></script></head><body class="${className}" data-base="${base}"><a href="#main" class="skip-link">Skip to content</a><header class="site-header"><a class="brand" href="${url()}"><img src="${url("assets/logo.svg")}" width="44" height="44" alt=""><span>PARADOX<span>MODDING TOOLKIT</span></span></a><button class="menu-toggle" aria-expanded="false" aria-controls="main-nav">Menu <span aria-hidden="true">+</span></button>${nav(active)}</header>${content}${footer}</body></html>`
  );
  if (!noindex) routes.push(path);
}

function sidebar(current) {
  return `<aside class="docs-sidebar"><details class="handbook-menu" open><summary>Browse the handbook</summary><nav aria-label="Handbook">${groups.map((group) => `<section><h2>${group.title}</h2>${group.pages.map((id) => `<a href="${url(routeFor(id))}" ${current === id ? 'aria-current="page"' : ""}>${escape(titleFor(id))}</a>`).join("")}</section>`).join("")}</nav></details></aside>`;
}

for (const id of ids) {
  let md = await readFile(join(wikiRoot, "content", `${id}.md`), "utf8");
  md = md.replace(/^\uFEFF/, "").replace(/^# .+\r?\n/, "");
  if (id === "Credits") md = (await readFile(join(root, "fragments/credits.md"), "utf8")) + "\n" + md;
  if (id === "Home")
    md = `This handbook follows the [public GitHub wiki](${repo}/wiki). Wiki edits trigger a new website build through GitHub Actions. This build uses wiki revision [${sources.wikiRevision.slice(0, 7)}](${repo}/wiki/_history). The homepage, visual identity and recordings are maintained in the main repository.\n\n## From the project wiki\n\n${md}`;
  md = md.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, first, second) => {
    const target = second ?? first.replaceAll(" ", "-");
    if (!aliases.has(slug(target.split("#")[0]))) throw new Error(`Unknown wiki page in ${id}: ${target}`);
    return `[${first}](${target})`;
  });
  const headings = [];
  const counts = new Map();
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        const text = html.replace(/<[^>]+>/g, "");
        const name = slug(text);
        const count = counts.get(name) ?? 0;
        counts.set(name, count + 1);
        const anchor = count ? `${name}-${count}` : name;
        headings.push({ text, anchor, depth });
        return `<h${depth} id="${anchor}">${html}<a class="heading-anchor" href="#${anchor}" aria-label="Link to ${escape(text)}">#</a></h${depth}>`;
      },
      link({ href, title, tokens }) {
        return `<a href="${escape(resolveLink(href))}"${title ? ` title="${escape(title)}"` : ""}>${this.parser.parseInline(tokens)}</a>`;
      },
      image({ href, text }) {
        return `<a class="doc-image-link" href="${escape(resolveLink(href))}"><img src="${escape(resolveLink(href))}" alt="${escape(text)}" loading="lazy" decoding="async"><span>Open full-size image ↗</span></a>`;
      },
      table(token) {
        return `<div class="table-scroll" tabindex="0" role="region" aria-label="Scrollable reference table">${Object.getPrototypeOf(this).table.call(this, token)}</div>`;
      },
    },
  });
  const html = marked.parse(md);
  search.push({
    title: titleFor(id),
    description: descriptionFor(id),
    url: url(routeFor(id)),
    text: md
      .replace(/<[^>]*>/g, " ")
      .replace(/[#*`[\]]/g, "")
      .replace(/\s+/g, " "),
  });
  const toc = headings.filter((h) => h.depth === 2);
  const versionNote = `Published ${sources.stableVersion}; the wiki also documents preview features. Check version labels.`;
  const sourceLink = `<a href="${repo}/wiki/${id === "Home" ? "" : encodeURIComponent(id)}">Original wiki page ↗</a>`;
  await page(
    routeFor(id),
    titleFor(id),
    descriptionFor(id),
    `<main id="main" class="docs-shell">${sidebar(id)}<div class="doc-main"><div class="doc-breadcrumb"><a href="${url("docs/")}">Handbook</a><span>/</span><span>${escape(titleFor(id))}</span></div><article class="prose"><h1>${escape(titleFor(id))}</h1><p class="doc-lede">${escape(descriptionFor(id))}</p><div class="version-note"><span class="tag">Beta handbook</span><span>${versionNote}</span></div>${html}</article><div class="doc-end"><p>Found something missing or out of date?</p><a href="${repo}/issues/new">Suggest a correction ↗</a>${sourceLink}</div></div><aside class="doc-toc"><a class="search-shortcut" href="${url("docs/")}#search">Search the handbook <kbd>/</kbd></a>${toc.length ? `<p>On this page</p><nav aria-label="On this page">${toc.map((h) => `<a href="#${h.anchor}">${h.text}</a>`).join("")}</nav>` : ""}</aside></main>`,
    { active: id === "Credits" ? "credits" : "docs", className: "documentation" }
  );
}

await page(
  "",
  "Paradox modding, from script to screen.",
  "Script editing, visual tools and Steam Workshop publishing for Crusader Kings III, Victoria 3 and Europa Universalis V. Free and open source, in VS Code.",
  homepage({ url, install, repo, sources }),
  { className: "homepage" }
);
await page(
  "docs/",
  "The modder’s handbook",
  "The complete Paradox Modding Toolkit handbook: setup, editing, visual tools, publishing and language server integration.",
  `<main id="main" class="docs-index"><div class="page-heading"><span class="section-label">Documentation</span><h1>The toolkit<br>handbook.</h1><p>Set up your workspace, learn a workflow or look up a setting. All ${ids.length} guides are searchable.</p></div><div id="search" class="search-box"><label for="docs-search">Search all ${ids.length} guides</label><div class="search-input"><span aria-hidden="true">⌕</span><input id="docs-search" type="search" placeholder="Try “mipmaps”, “localization” or “setup”" autocomplete="off" aria-describedby="search-status"><kbd>/</kbd></div><p id="search-status" role="status">Search titles and the full text of every guide.</p><div id="search-results"></div></div><div class="handbook-notice"><span class="tag">Read first</span><p>These guides cover ${sources.stableVersion} and marked ${sources.previewVersion} additions. Adapted from the project wiki, which is largely AI-written and has limited human review. <a href="${url("docs/home/")}">About these docs</a>.</p></div><div class="docs-directory">${groups.map((g) => `<section><h2>${g.title}</h2><div>${g.pages.map((id) => `<a href="${url(routeFor(id))}"><span>${escape(titleFor(id))}</span><span aria-hidden="true">↗</span></a>`).join("")}</div></section>`).join("")}</div></main>`,
  { active: "docs" }
);
await page(
  "releases/",
  "Release notes",
  "What ships in 0.5.0 and what is coming in the 0.5.2 preview.",
  releasesPage({ url, repo, sources }),
  { active: "releases" }
);
await page(
  "brand/",
  "The toolkit identity",
  "The palette, type, logo and visual principles of Paradox Modding Toolkit.",
  identityPage({ url })
);
await page(
  "demos/",
  "See the toolkit at work",
  "Short recordings of real Paradox Modding Toolkit workflows.",
  demosPage({ url, sources })
);
await page(
  "404.html",
  "Page not found",
  "Find your way back to the toolkit.",
  `<main id="main" class="not-found"><span class="section-label">404 · Unknown reference</span><h1>Page not found.</h1><p>The page may have moved. Search the handbook or return to the toolkit home page.</p><div class="actions"><a class="button" href="${url("docs/")}">Open the handbook</a><a href="${url()}">Back to the toolkit →</a></div></main>`,
  { noindex: true }
);
await writeFile(join(out, "search.json"), JSON.stringify(search));
await writeFile(join(out, ".nojekyll"), "");
await writeFile(
  join(out, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${routes.map((path) => `<url><loc>${origin}${url(path)}</loc></url>`).join("")}</urlset>`
);
await writeFile(
  join(out, "robots.txt"),
  `User-agent: *\nAllow: /\nSitemap: ${origin}${url("sitemap.xml")}\n`
);
await writeFile(join(out, "build.json"), JSON.stringify({ base, origin, routes, sources }, null, 2));
// Reserve dimensions from the actual PNG header, including small picker screenshots.
for (const path of [...routes.map((route) => `${route}index.html`), "404.html"]) {
  let html = await readFile(join(out, path), "utf8");
  for (const match of [...html.matchAll(/<img\b[^>]*src="([^"]+\.png)"[^>]*>/g)]) {
    if (/\bwidth=/.test(match[0]) || !match[1].startsWith(base)) continue;
    const data = await readFile(join(out, match[1].slice(base.length)));
    html = html.replace(
      match[0],
      match[0].replace("<img", `<img width="${data.readUInt32BE(16)}" height="${data.readUInt32BE(20)}"`)
    );
  }
  await writeFile(join(out, path), html);
}
console.log(`Built ${routes.length} pages and 404; ${search.length} searchable guides. Base: ${base}`);
