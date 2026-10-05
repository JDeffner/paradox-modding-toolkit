import * as fs from "fs";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { ck3Meta } from "../../server/src/games/ck3/meta";
import { vic3Meta } from "../../server/src/games/vic3/meta";
import { eu5Meta } from "../../server/src/games/eu5/meta";
import { devPath } from "../../../scripts/devPaths";
import { renderMarkdown } from "../src/webviews/markdown";
import { LAUNCH_OPTIONS_ARTICLE, readLaunchOptions } from "../src/webviews/wiki/launchOptions";

const roots: string[] = [];
function fixture(source: string): { root: string; file: string } {
  const scratch = path.resolve(".local/testing");
  fs.mkdirSync(scratch, { recursive: true });
  const root = fs.mkdtempSync(path.join(scratch, "launch-reader-"));
  roots.push(root);
  const file = path.join(root, ck3Meta.launchOptionsFile!);
  fs.writeFileSync(file, source);
  return { root, file };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("installed launch-options reference", () => {
  it("preserves descriptions, headings, warning and consecutive syntaxes from BOM/CRLF input", () => {
    const { root, file } = fixture(
      "\uFEFF### Commandline Options\r\n" +
        "# Options may be combined.\r\n# Values may be quoted.\r\n\r\n" +
        "##### NOTE: Developer features! Use at your own risk. #####\r\n\r\n" +
        "### Graphics\r\n# Choose a backend\r\n-opengl\r\n-dx11\r\n-vulkan\r\n" +
        "# Load a save by name\r\n-loadsave=<name>\r\n\r\n" +
        "# A new option introduced by an update\r\n-new_unknown=<future_value>\r\n"
    );
    fs.utimesSync(file, new Date("2026-01-01T12:00:00Z"), new Date("2026-01-01T12:00:00Z"));
    const article = readLaunchOptions(ck3Meta, root);
    expect(article).toMatchObject({
      id: LAUNCH_OPTIONS_ARTICLE,
      title: "Launch Options",
      game: "ck3",
      section: "Game reference",
    });
    expect(article.markdown).toContain("_commandline_options.info");
    expect(article.markdown).toContain("2026-01-01T12:00:00.000Z");
    expect(article.markdown).toContain("```\n-opengl\n-dx11\n-vulkan\n```");
    expect(article.markdown).toContain("-loadsave=<name>");
    expect(article.markdown).toContain("-new_unknown=<future_value>");
    const html = renderMarkdown(article.markdown);
    expect(html).toContain("<h1>Launch Options</h1>");
    expect(html).toContain("<h3>Graphics</h3>");
    expect(html).toContain("Options may be combined. Values may be quoted.");
    expect(html).toContain("<strong>NOTE: Developer features! Use at your own risk.</strong>");
    expect(html).toContain("<pre><code>-loadsave=&lt;name&gt;</code></pre>");
    expect(html).toContain("-new_unknown=&lt;future_value&gt;");
  });

  it("reads changed source and removes old options when the source is deleted", () => {
    const { root, file } = fixture("# Old description\n-old_option\n");
    expect(readLaunchOptions(ck3Meta, root).markdown).toContain("-old_option");
    fs.writeFileSync(file, "# New description\n-new_option\n");
    const updated = readLaunchOptions(ck3Meta, root).markdown;
    expect(updated).toContain("-new_option");
    expect(updated).not.toContain("-old_option");
    fs.unlinkSync(file);
    const missing = readLaunchOptions(ck3Meta, root).markdown;
    expect(missing).toContain("reference is missing");
    expect(missing).toContain("ENOENT");
    expect(missing).not.toContain("-new_option");
  });

  it("reports no configured game folder", () => {
    expect(readLaunchOptions(ck3Meta, null).markdown).toContain("game data folder in toolkit settings");
  });

  it.each([vic3Meta, eu5Meta])("reports an unverified source for $id", (meta) => {
    const article = readLaunchOptions(meta, null);
    expect(meta.launchOptionsFile).toBeNull();
    expect(article.game).toBe(meta.id);
    expect(article.markdown).toContain(`verified for ${meta.name}`);
  });

  it("also supports profiles without a verified reference field", () => {
    expect(readLaunchOptions({ ...ck3Meta, launchOptionsFile: undefined }, null).markdown).toContain(
      "No installed launch-options reference has been verified"
    );
  });

  it("reports an empty installed source", () => {
    const { root } = fixture("\uFEFF\r\n \r\n");
    expect(readLaunchOptions(ck3Meta, root).markdown).toContain("reference is empty");
  });

  it("reports the actual read failure and clears previously readable content", () => {
    const { root, file } = fixture("-old_option\n");
    expect(readLaunchOptions(ck3Meta, root).markdown).toContain("-old_option");
    fs.unlinkSync(file);
    fs.mkdirSync(file);
    const failed = readLaunchOptions(ck3Meta, root).markdown;
    expect(failed).toContain("reference could not be read");
    expect(failed).toContain("EISDIR");
    expect(failed).not.toContain("reference is missing");
    expect(failed).not.toContain("-old_option");
  });

  const gamePath = devPath("gamePath", "ck3");
  it.skipIf(!gamePath)("preserves every non-empty line from the installed CK3 reference", () => {
    const file = path.join(gamePath!, ck3Meta.launchOptionsFile!);
    const source = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    const article = readLaunchOptions(ck3Meta, gamePath);
    expect(article.markdown).not.toContain("could not be read");
    let position = 0;
    for (const line of source.split(/\r?\n/).filter((line) => line.trim())) {
      const content = line.replace(/^#+\s*/, "").replace(/\s+#####\s*$/, "");
      const found = article.markdown.indexOf(content, position);
      expect(found, line).toBeGreaterThanOrEqual(position);
      position = found + content.length;
    }
  });
});
