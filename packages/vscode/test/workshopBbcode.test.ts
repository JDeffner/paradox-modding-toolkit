/**
 * The Workshop panel's BBCode preview renderer: whitelisted tags become
 * elements, everything else stays literal (and escaped), URLs are http(s)
 * only. The preview must be safe against whatever the description holds.
 */
import { describe, expect, it } from "vitest";
import { bbcodeToHtml } from "../src/webviews/workshop/bbcode";

describe("bbcodeToHtml", () => {
  it("escapes HTML in plain text", () => {
    expect(bbcodeToHtml('<script>alert("x")</script>')).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"
    );
  });

  it("renders the basic tags and newlines", () => {
    expect(bbcodeToHtml("[b]bold[/b]\nnext")).toBe('<strong class="bb-b">bold</strong><br>next');
    expect(bbcodeToHtml("[h1]Title[/h1]")).toBe('<div class="bb-h1">Title</div>');
    expect(bbcodeToHtml("[hr][/hr]")).toBe('<hr class="bb-hr">');
  });

  it("renders lists with implicit item closes", () => {
    expect(bbcodeToHtml("[list]\n[*] one\n[*] two\n[/list]")).toBe(
      '<ul class="bb-list"><li class="bb-li"> one</li><li class="bb-li"> two</li></ul>'
    );
  });

  it("links only http(s) urls; other schemes stay plain", () => {
    expect(bbcodeToHtml("[url=https://example.com]x[/url]")).toBe(
      '<a class="bb-url" href="https://example.com" title="https://example.com">x</a>'
    );
    const bad = bbcodeToHtml("[url=javascript:alert(1)]x[/url]");
    expect(bad).not.toContain("href");
    expect(bad).toContain("x");
  });

  it("images render https only", () => {
    expect(bbcodeToHtml("[img]https://cdn/x.png[/img]")).toBe(
      '<img class="bb-img" src="https://cdn/x.png" alt="">'
    );
    expect(bbcodeToHtml("[img]file:///c/x.png[/img]")).toBe("");
  });

  it("noparse and code keep their contents literal", () => {
    expect(bbcodeToHtml("[noparse][b]raw[/b][/noparse]")).toBe("[b]raw[/b]");
    expect(bbcodeToHtml("[code]\nif (a < b) {}\n[/code]")).toBe(
      '<pre class="bb-code">if (a &lt; b) {}\n</pre>'
    );
  });

  it("leaves unknown tags and stray closers as text", () => {
    expect(bbcodeToHtml("[wat]x[/wat]")).toBe("[wat]x[/wat]");
    expect(bbcodeToHtml("x[/b]")).toBe("x[/b]");
  });

  it("closes unbalanced markup at the end instead of leaking", () => {
    expect(bbcodeToHtml("[b]open")).toBe('<strong class="bb-b">open</strong>');
  });

  it("quotes carry their author", () => {
    expect(bbcodeToHtml("[quote=Joel]hi[/quote]")).toBe(
      '<blockquote class="bb-quote"><div class="bb-quote-author">Originally posted by Joel:</div>hi</blockquote>'
    );
  });

  it("tables swallow the whitespace between structural tags", () => {
    expect(bbcodeToHtml("[table]\n[tr]\n[th]h[/th]\n[/tr]\n[/table]")).toBe(
      '<table class="bb-table"><tr><th>h</th></tr></table>'
    );
  });
});
