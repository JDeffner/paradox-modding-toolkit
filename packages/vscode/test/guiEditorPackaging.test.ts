/**
 * Packaging regression for the webview bundles.
 *
 * Webview apps are SEPARATE bundles rather than strings inside extension.js,
 * which opens two ways to ship a broken panel with every other test green:
 * drop the build step from the compile chain, or let an ignore rule swallow
 * dist/webview/. Both are checked here, the second against vsce's own file
 * list rather than a re-implementation of its ignore semantics.
 *
 * Bundles are discovered, not listed: scripts/compile-webviews.mjs builds
 * every src/webviews/<name>/app/main.ts, and this test replays the same rule
 * so a new panel is covered the day its folder appears.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { listFiles, PackageManager } from "@vscode/vsce";

const PKG_ROOT = path.join(__dirname, "..");
const WEBVIEWS_DIR = path.join(PKG_ROOT, "src", "webviews");

/** The discovery rule of scripts/compile-webviews.mjs, replayed. */
const apps = fs
  .readdirSync(WEBVIEWS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(WEBVIEWS_DIR, e.name, "app", "main.ts")))
  .map((e) => e.name)
  .sort();

const bundleRel = (name: string) => `dist/webview/${name}.js`;
const allBuilt = apps.every((name) => fs.existsSync(path.join(PKG_ROOT, ...bundleRel(name).split("/"))));
if (!allBuilt) {
  // Loud skip, same rule as the wire-level smokes: a missing bundle must not
  // let "full suite green" hide that the shipped-artifact check never ran.
  process.stderr.write(
    `\nguiEditorPackaging: SKIPPING the vsix content check, not every dist/webview bundle is built. Run \`pnpm run compile\` first.\n`
  );
}

const manifest = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

describe("the webview bundles are built by the compile chain", () => {
  it("compile runs compile:webview", () => {
    expect(manifest.scripts.compile).toContain("compile:webview");
  });

  it("compile:webview runs the discovery script, and discovery finds the panels", () => {
    expect(manifest.scripts["compile:webview"]).toContain("compile-webviews.mjs");
    expect(fs.existsSync(path.join(PKG_ROOT, "..", "..", "scripts", "compile-webviews.mjs"))).toBe(true);
    // The rule replayed above must keep matching reality; an empty list would
    // make every assertion below pass vacuously.
    expect(apps).toContain("guiEditor");
  });

  it("each panel loads the bundle its app is built to", () => {
    // Panels resolve the bundle through devReload's bundleUri(webview, source,
    // name), so the guarded invariant is the helper call plus the exact name
    // the build produces.
    for (const name of apps) {
      const panel = fs.readFileSync(path.join(WEBVIEWS_DIR, name, "panel.ts"), "utf8");
      expect(panel, `${name}/panel.ts`).toContain("bundleUri(");
      expect(panel, `${name}/panel.ts`).toContain(`"${name}"`);
    }
  });
});

describe("the webview bundles ship in the vsix", () => {
  it.skipIf(!allBuilt)("vsce lists every dist/webview bundle", async () => {
    // PackageManager.None is the API form of the --no-dependencies flag the
    // package script uses; without it vsce shells out to `npm ls`, which has
    // no answer in a pnpm workspace.
    const files = await listFiles({ cwd: PKG_ROOT, packageManager: PackageManager.None });
    const normalized = files.map((f) => f.replace(/\\/g, "/"));
    for (const name of apps) {
      expect(normalized, bundleRel(name)).toContain(bundleRel(name));
    }
  });
});
