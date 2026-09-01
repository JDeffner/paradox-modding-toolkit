import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { renderMarkdown } from "../src/webviews/markdown";

describe("renderMarkdown", () => {
  it("renders the blocks our documents use", () => {
    const html = renderMarkdown(
      [
        "# Mod Report",
        "",
        "*Generated now*",
        "",
        "## Content",
        "",
        "| Kind | Count |",
        "|---|---|",
        "| trait | 3 |",
        "",
        "- A `gfx/x.dds` path with **bold**",
        "  and a wrapped second line.",
      ].join("\n")
    );
    expect(html).toContain("<h1>Mod Report</h1>");
    expect(html).toContain("<p><em>Generated now</em></p>");
    expect(html).toContain("<th>Kind</th>");
    expect(html).toContain("<td>trait</td>");
    expect(html).toContain(
      "<li>A <code>gfx/x.dds</code> path with <strong>bold</strong> and a wrapped second line.</li>"
    );
  });

  it("escapes html instead of passing it through", () => {
    expect(renderMarkdown("<script>alert(1)</script>")).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });

  it("leaves no unrendered markdown in the shipped image guidelines", () => {
    const doc = fs.readFileSync(path.join(__dirname, "..", "media", "image-guidelines.md"), "utf8");
    const html = renderMarkdown(doc);
    // Every source line became a block: no stray pipes, bullets or hashes.
    expect(html).not.toMatch(/<p>[|#]|<p>- /);
    expect(html).not.toContain("**");
  });
});
