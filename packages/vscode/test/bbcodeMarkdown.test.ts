/**
 * Steam BBCode <-> Markdown (steam/bbcodeMarkdown.ts): one case per tag of
 * Steam's formatting help in each direction, plus a whole description that
 * survives BBCode -> Markdown -> BBCode.
 *
 * Round-trip normalisation: trailing spaces are dropped and runs of three or
 * more newlines collapse to a blank line. Nothing else may differ, so the
 * fixture is written the way the converter formats blocks.
 */
import { describe, expect, it } from "vitest";
import { bbcodeToMarkdown, markdownToBBCode } from "../src/steam/bbcodeMarkdown";

const norm = (s: string): string =>
  s
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

describe("bbcodeToMarkdown", () => {
  it("maps headings, each its own block", () => {
    expect(bbcodeToMarkdown("[h1]A[/h1]\n[h2]B[/h2]\n[h3]C[/h3]")).toBe("# A\n\n## B\n\n### C");
  });

  it("maps the inline emphasis tags", () => {
    expect(bbcodeToMarkdown("[b]a[/b] [i]b[/i] [u]c[/u] [strike]d[/strike]")).toBe(
      "**a** *b* <u>c</u> ~~d~~"
    );
  });

  it("maps a spoiler to a details block", () => {
    expect(bbcodeToMarkdown("[spoiler]he dies[/spoiler]")).toBe(
      "<details><summary>Spoiler</summary>he dies</details>"
    );
  });

  it("maps noparse to a code span and hr to a rule", () => {
    expect(bbcodeToMarkdown("[noparse][b]x[/b][/noparse]")).toBe("`[b]x[/b]`");
    expect(bbcodeToMarkdown("[hr][/hr]")).toBe("---");
  });

  it("maps links and images", () => {
    expect(bbcodeToMarkdown("[url=https://a.b]text[/url]")).toBe("[text](https://a.b)");
    expect(bbcodeToMarkdown("[url]https://a.b[/url]")).toBe("<https://a.b>");
    expect(bbcodeToMarkdown("[img]https://a.b/x.png[/img]")).toBe("![](https://a.b/x.png)");
  });

  it("maps both list kinds, nested", () => {
    expect(bbcodeToMarkdown("[list]\n[*] one\n[*] two\n[/list]")).toBe("- one\n- two");
    expect(bbcodeToMarkdown("[olist]\n[*] one\n[*] two\n[/olist]")).toBe("1. one\n2. two");
    expect(bbcodeToMarkdown("[list]\n[*] one\n[list]\n[*] deep\n[/list]\n[/list]")).toBe("- one\n  - deep");
  });

  it("maps a quote, with the author as a bold first line", () => {
    expect(bbcodeToMarkdown("[quote=Ragnar]\nfine\n[/quote]")).toBe("> **Ragnar**\n> fine");
    expect(bbcodeToMarkdown("[quote]\nfine\n[/quote]")).toBe("> fine");
  });

  it("maps code to a fenced block, content untouched", () => {
    expect(bbcodeToMarkdown("[code]\nx = { [b] }\n[/code]")).toBe("```\nx = { [b] }\n```");
  });

  it("maps a table, taking the header row from [th]", () => {
    const bb = "[table]\n[tr]\n[th]A[/th]\n[th]B[/th]\n[/tr]\n[tr]\n[td]1[/td]\n[td]2[/td]\n[/tr]\n[/table]";
    expect(bbcodeToMarkdown(bb)).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |");
  });

  it("keeps markup inside markup", () => {
    expect(bbcodeToMarkdown("[h2]a [b]b[/b][/h2]")).toBe("## a **b**");
    expect(bbcodeToMarkdown("[quote]\n[list]\n[*] one\n[/list]\n[/quote]")).toBe("> - one");
  });

  it("passes an unknown tag through verbatim", () => {
    expect(bbcodeToMarkdown("[previewyoutube=abc;full][/previewyoutube]")).toBe(
      "[previewyoutube=abc;full][/previewyoutube]"
    );
    expect(bbcodeToMarkdown("[color=red]x[/color]")).toBe("[color=red]x[/color]");
  });
});

describe("markdownToBBCode", () => {
  it("maps headings, and Steam's ceiling is h3", () => {
    expect(markdownToBBCode("# A\n## B\n### C\n#### D")).toBe(
      "[h1]A[/h1]\n[h2]B[/h2]\n[h3]C[/h3]\n[h3]D[/h3]"
    );
  });

  it("maps the inline emphasis forms", () => {
    expect(markdownToBBCode("**a** *b* <u>c</u> ~~d~~")).toBe(
      "[b]a[/b] [i]b[/i] [u]c[/u] [strike]d[/strike]"
    );
    expect(markdownToBBCode("__a__ _b_")).toBe("[b]a[/b] [i]b[/i]");
  });

  it("maps a details block back to a spoiler", () => {
    expect(markdownToBBCode("<details><summary>Spoiler</summary>he dies</details>")).toBe(
      "[spoiler]he dies[/spoiler]"
    );
  });

  it("maps a code span to noparse and a rule to hr", () => {
    expect(markdownToBBCode("say `[b]x[/b]` here")).toBe("say [noparse][b]x[/b][/noparse] here");
    expect(markdownToBBCode("---")).toBe("[hr][/hr]");
  });

  it("maps links and images", () => {
    expect(markdownToBBCode("[text](https://a.b)")).toBe("[url=https://a.b]text[/url]");
    expect(markdownToBBCode("<https://a.b>")).toBe("[url]https://a.b[/url]");
    expect(markdownToBBCode("![](https://a.b/x.png)")).toBe("[img]https://a.b/x.png[/img]");
  });

  it("maps both list kinds, nested", () => {
    expect(markdownToBBCode("- one\n- two")).toBe("[list]\n[*] one\n[*] two\n[/list]");
    expect(markdownToBBCode("1. one\n2. two")).toBe("[olist]\n[*] one\n[*] two\n[/olist]");
    expect(markdownToBBCode("- one\n  - deep")).toBe("[list]\n[*] one\n[list]\n[*] deep\n[/list]\n[/list]");
  });

  it("maps a quote, reading a bold first line as the author", () => {
    expect(markdownToBBCode("> **Ragnar**\n> fine")).toBe("[quote=Ragnar]\nfine\n[/quote]");
    expect(markdownToBBCode("> fine")).toBe("[quote]\nfine\n[/quote]");
    expect(markdownToBBCode("> - one")).toBe("[quote]\n[list]\n[*] one\n[/list]\n[/quote]");
  });

  it("maps a fenced block to code, content untouched", () => {
    expect(markdownToBBCode("```\nx = { **b** }\n```")).toBe("[code]\nx = { **b** }\n[/code]");
  });

  it("maps a table, the header row becoming [th]", () => {
    expect(markdownToBBCode("| A | B |\n| --- | --- |\n| 1 | 2 |")).toBe(
      "[table]\n[tr]\n[th]A[/th]\n[th]B[/th]\n[/tr]\n[tr]\n[td]1[/td]\n[td]2[/td]\n[/tr]\n[/table]"
    );
  });

  it("passes an unknown form through verbatim", () => {
    expect(markdownToBBCode("[previewyoutube=abc;full][/previewyoutube]")).toBe(
      "[previewyoutube=abc;full][/previewyoutube]"
    );
  });
});

/** A description that uses every tag Steam's formatting help documents. */
const FULL = [
  "[h1]Grand Overhaul[/h1]",
  "",
  "An overhaul with [b]bold[/b], [i]italic[/i], [u]underline[/u] and [strike]struck[/strike] text, plus [noparse][b]literal[/b][/noparse].",
  "",
  "[h2]Features[/h2]",
  "",
  "[list]",
  "[*] New [url=https://ck3.paradoxwikis.com]events[/url]",
  "[*] A [spoiler]hidden twist[/spoiler]",
  "[/list]",
  "",
  "[olist]",
  "[*] Subscribe",
  "[*] Enable it in the launcher",
  "[/olist]",
  "",
  "[hr][/hr]",
  "",
  "[h3]Compatibility[/h3]",
  "",
  "[table]",
  "[tr]",
  "[th]Mod[/th]",
  "[th]Status[/th]",
  "[/tr]",
  "[tr]",
  "[td]Community Flavor Pack[/td]",
  "[td]Works[/td]",
  "[/tr]",
  "[/table]",
  "",
  "[quote=Ragnar]",
  "Works on my machine.",
  "[/quote]",
  "",
  "[code]",
  "character_event = {",
  "    id = my_mod.0001",
  "}",
  "[/code]",
  "",
  "[img]https://i.imgur.com/banner.png[/img]",
  "",
  "[url]https://discord.gg/example[/url]",
  "",
  "[previewyoutube=dQw4w9WgXcQ;full][/previewyoutube]",
].join("\n");

describe("round trip", () => {
  it("keeps a full description through BBCode -> Markdown -> BBCode", () => {
    expect(norm(markdownToBBCode(bbcodeToMarkdown(FULL)))).toBe(norm(FULL));
  });
});
