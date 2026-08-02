/**
 * Packaging regression for the GUI editor's webview bundle.
 *
 * The editor is the first feature whose runtime code is a SEPARATE bundle
 * rather than a string inside extension.js, which opens two ways to ship a
 * broken editor with every other test green: drop the build step from the
 * compile chain, or let an ignore rule swallow dist/webview/. Both are checked
 * here, the second against vsce's own file list rather than a re-implementation
 * of its ignore semantics.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { listFiles, PackageManager } from "@vscode/vsce";

const PKG_ROOT = path.join(__dirname, "..");
const BUNDLE_REL = "dist/webview/guiEditor.js";
const bundleBuilt = fs.existsSync(path.join(PKG_ROOT, ...BUNDLE_REL.split("/")));
if (!bundleBuilt) {
  // Loud skip, same rule as the wire-level smokes: a missing bundle must not
  // let "full suite green" hide that the shipped-artifact check never ran.
  process.stderr.write(
    `\nguiEditorPackaging: SKIPPING the vsix content check, ${BUNDLE_REL} is not built. Run \`pnpm run compile\` first.\n`
  );
}

const manifest = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

describe("the webview bundle is built by the compile chain", () => {
  it("compile runs compile:webview", () => {
    expect(manifest.scripts.compile).toContain("compile:webview");
  });

  it("compile:webview bundles the editor app to the path the panel loads", () => {
    const script = manifest.scripts["compile:webview"];
    expect(script).toContain("src/webviews/guiEditor/app/main.ts");
    expect(script).toContain(`--outfile=${BUNDLE_REL}`);
    const panel = fs.readFileSync(path.join(PKG_ROOT, "src", "webviews", "guiEditor", "panel.ts"), "utf8");
    expect(panel).toContain(`"dist", "webview", "guiEditor.js"`);
  });
});

describe("the webview bundle ships in the vsix", () => {
  it.skipIf(!bundleBuilt)("vsce lists dist/webview/guiEditor.js", async () => {
    // PackageManager.None is the API form of the --no-dependencies flag the
    // package script uses; without it vsce shells out to `npm ls`, which has
    // no answer in a pnpm workspace.
    const files = await listFiles({ cwd: PKG_ROOT, packageManager: PackageManager.None });
    expect(files.map((f) => f.replace(/\\/g, "/"))).toContain(BUNDLE_REL);
  });
});
