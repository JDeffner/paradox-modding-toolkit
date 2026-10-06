/* global document */
import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const assets = resolve(import.meta.dirname, "../public/assets");
const font = (await readFile(resolve(assets, "fonts/archivo.woff2"))).toString("base64");
const readingFont = (await readFile(resolve(assets, "fonts/source-sans.woff2"))).toString("base64");
const logo = (await readFile(resolve(assets, "logo.svg"))).toString("base64");
// Reuse the three real editor captures embedded in the maintained GitHub card.
const reference = await readFile(
  resolve(import.meta.dirname, "../../.github/assets/github-social-preview.svg"),
  "utf8"
);
const captures = [...reference.matchAll(/<image\b[^>]*\bhref="(data:image\/png;base64,[^"]+)"/g)].map(
  (match) => match[1]
);
if (captures.length !== 3) throw new Error("Expected completion, Workshop and coat-of-arms captures");

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
    @font-face{font-family:Archivo;src:url(data:font/woff2;base64,${font});font-weight:400 900}
    @font-face{font-family:Source;src:url(data:font/woff2;base64,${readingFont});font-weight:400 700}
    /* Colors and paired feature/capture layout follow the toolkit's GitHub social card. */
    *{box-sizing:border-box}
    body{margin:0;width:1200px;height:630px;padding:26px 40px;background:#17161a;color:#f2ede3;font-family:Source,sans-serif}
    header{display:flex;align-items:center;gap:22px;padding-bottom:18px;border-bottom:1px solid #494239}
    header img{width:76px;height:76px}
    h1{margin:0;font-family:Archivo,sans-serif;font-size:46px;font-weight:750;letter-spacing:-.025em}
    header p{margin:6px 0 0;color:#c8952f;font-size:24px}
    main{display:grid;grid-template-columns:350px 1fr;gap:30px;padding:18px 0}
    .features{display:flex;flex-direction:column;justify-content:space-between}
    h2{font-size:27px;line-height:1.15;margin:0 0 7px}
    p{font-size:21px;line-height:1.3;margin:0;color:#c2bbaf}
    .screens{display:grid;grid-template-columns:1fr 1fr;gap:14px 18px}
    figure{margin:0;min-width:0}
    figure:first-child{grid-column:1/-1}
    figcaption{font-size:19px;font-weight:700;color:#c8952f;margin-bottom:7px}
    figure img{display:block;width:100%;height:96px;object-fit:cover;object-position:top;border:1px solid #514a40}
    figure:first-child img{height:160px}
    figure:last-child img{object-fit:contain;background:#1e1e1e}
    footer{border-top:1px solid #494239;padding-top:15px}
    .games{font-size:24px;color:#f2ede3}
    .details{display:flex;justify-content:space-between;margin-top:9px;font-size:20px;color:#c2bbaf}
    .details strong{color:#c8952f;font-weight:600}
  </style></head><body>
    <header><img src="data:image/svg+xml;base64,${logo}" alt="" width="76" height="76"><div>
      <h1>Paradox Modding Toolkit</h1><p>Write scripts. Create content. Publish your mod.</p>
    </div></header>
    <main>
      <div class="features">
        <section><h2>Script editing</h2><p>Scope-aware completion<br>Hover docs · Navigation<br>Diagnostics · Localization</p></section>
        <section><h2>Steam Workshop upload</h2><p>Publish and update in VS Code<br>Descriptions · Images · Changelogs</p></section>
        <section><h2>Visual tools</h2><p>Coat of Arms Designer · GUI editor<br>Event Graph · Content creators</p></section>
      </div>
      <div class="screens">
        <figure><figcaption>SCOPE-AWARE COMPLETION</figcaption><img src="${captures[0]}" width="1130" height="390" alt="Script completion with effect documentation"></figure>
        <figure><figcaption>STEAM WORKSHOP</figcaption><img src="${captures[1]}" width="1491" height="420" alt="Workshop publishing panel"></figure>
        <figure><figcaption>COAT OF ARMS DESIGNER</figcaption><img src="${captures[2]}" width="1515" height="610" alt="Visual coat of arms editor"></figure>
      </div>
    </main>
    <footer><p class="games">Crusader Kings III · Victoria 3 · Europa Universalis V</p>
      <div class="details"><span>Free and open source · VS Code extension</span><strong>paradoxtoolkit.jdeffner.com</strong></div>
    </footer>
  </body></html>`);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => img.decode()));
    if (document.documentElement.scrollHeight > 630 || document.documentElement.scrollWidth > 1200)
      throw new Error("Social card overflows its 1200 × 630 canvas");
  });
  await page.screenshot({ path: resolve(assets, "social-preview.png") });
} finally {
  await browser.close();
}
console.log("Exported 1200 × 630 social-preview.png");
