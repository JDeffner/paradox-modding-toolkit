/* global document */
import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// A reproducible export of the website's own typography and SVG mark.
const assets = resolve(import.meta.dirname, "../public/assets");
const font = (await readFile(resolve(assets, "fonts/archivo.woff2"))).toString("base64");
const readingFont = (await readFile(resolve(assets, "fonts/source-sans.woff2"))).toString("base64");
const logo = (await readFile(resolve(assets, "logo.svg"))).toString("base64");
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>@font-face{font-family:Archivo;src:url(data:font/woff2;base64,${font});font-weight:400 900}@font-face{font-family:Source;src:url(data:font/woff2;base64,${readingFont});font-weight:400 700}*{box-sizing:border-box}body{margin:0;padding:60px 64px;background:#f2ede3;color:#17161a;font-family:Source,sans-serif}header{display:flex;align-items:center;gap:22px}header img{width:80px;height:80px}header p{font-family:Archivo,sans-serif;margin:0;font-size:22px;font-weight:800}header span{display:block;margin-top:4px;font-size:13px;letter-spacing:.035em}h1{font-size:80px;line-height:1.04;letter-spacing:-.03em;font-weight:600;margin:54px 0 40px}footer{display:flex;justify-content:space-between;align-items:center;border-top:1px solid #d5cec0;padding-top:26px;font-size:18px;color:#666168}footer strong{color:#79551d;font-weight:500}</style></head><body><header><img src="data:image/svg+xml;base64,${logo}" alt=""><p>PARADOX<span>MODDING TOOLKIT</span></p></header><h1>Paradox modding,<br>from script to screen.</h1><footer><span>A field guide to the work behind your mod.</span><strong>paradoxtoolkit.jdeffner.com</strong></footer></body></html>`
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(assets, "social-preview.png") });
} finally {
  await browser.close();
}
console.log("Exported 1200 × 630 social-preview.png");
