/**
 * Hover card layout. These pin the three-tier rendering contract (glyph, square,
 * plain), the single shared footer, the caps, and the `<details>` disclosure.
 *
 * The fixtures call `renderCard` directly, which is NOT what production does:
 * `hover.ts` builds a `CardInput` through `tokenCard`/`definitionCard` first,
 * and those filter fields out. Do not read a "what the hover looks like today"
 * claim off this file.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  CAPS,
  fencedBlock,
  hoverFooter,
  kindBadge,
  renderCard,
  renderHover,
  scopeHereLine,
  scopePill,
  scopeType,
  setHoverDetail,
  stripCommonIndent,
} from "../src/features/hoverRender";
import { resolveClientCapabilities, setClientCapabilities } from "../src/clientMode";
import { kindStyle, mappedKinds } from "@px-lsp/protocol/kinds";

const NL = String.fromCharCode(10);

/** Capability tiers, as the degradation matrix in the design sheet describes them. */
const TIERS = {
  vscode: { client: { hoverHtml: true, hoverIcons: true, commands: [] } },
  html: { client: { hoverHtml: true, hoverIcons: false, commands: [] } },
  bare: { client: { hoverHtml: false, hoverIcons: false, commands: [] } },
};
const tier = (t: keyof typeof TIERS) => setClientCapabilities(resolveClientCapabilities(TIERS[t]));

afterEach(() => {
  setClientCapabilities(resolveClientCapabilities({ clientCommands: true }));
  setHoverDetail("standard");
});

describe("kind badges: one glyph per concept, three tiers", () => {
  it("draws a codicon when the client renders theme icons", () => {
    tier("vscode");
    expect(kindBadge("trigger")).toBe(
      '<span style="color:var(--vscode-symbolIcon-methodForeground);">$(symbol-method) trigger</span>'
    );
    expect(kindBadge("effect")).toBe(
      '<span style="color:var(--vscode-symbolIcon-eventForeground);">$(symbol-event) effect</span>'
    );
    expect(kindBadge("saved_scope")).toBe(
      '<span style="color:var(--vscode-symbolIcon-fieldForeground);">$(symbol-field) saved scope</span>'
    );
  });

  it("falls back to a square when the client renders HTML but not icons", () => {
    tier("html");
    expect(kindBadge("trigger")).toBe(
      '<span style="color:var(--vscode-symbolIcon-methodForeground);">■ trigger</span>'
    );
  });

  it("falls back to plain text on a bare LSP client", () => {
    tier("bare");
    expect(kindBadge("trigger")).toBe("■ trigger");
    expect(kindBadge("structure_key", "character interaction key")).toBe("■ character interaction key");
  });

  it("emits no span at all for a kind VS Code does not tint", () => {
    tier("vscode");
    // Most of the map is grey, and grey is the editor foreground: no markup.
    expect(kindBadge("define")).toBe("$(symbol-unit) define");
    expect(kindBadge("loc_key")).toBe("$(symbol-text) loc key");
  });

  it("badge content stays legible once the tag is stripped", () => {
    tier("vscode");
    expect(kindBadge("trigger").replace(/<[^>]+>/g, "")).toBe("$(symbol-method) trigger");
  });
});

describe("the kind map", () => {
  it("never draws a condition and an action with the same glyph", () => {
    // The old map sent trigger to Function and effect to Method, which are one
    // codepoint in the codicon font, so the two opposite concepts in Paradox
    // script were drawn identically.
    expect(kindStyle("trigger").codicon).not.toBe(kindStyle("effect").codicon);
    expect(kindStyle("trigger").color).toBe("var(--vscode-symbolIcon-methodForeground)");
    expect(kindStyle("effect").color).toBe("var(--vscode-symbolIcon-eventForeground)");
  });

  it("gives the engine and mod versions of one concept the same glyph", () => {
    expect(kindStyle("scripted_trigger").codicon).toBe(kindStyle("trigger").codicon);
    expect(kindStyle("scripted_effect").codicon).toBe(kindStyle("effect").codicon);
  });

  it("keeps every mapped kind on a real codicon and a real completion kind", () => {
    for (const k of mappedKinds()) {
      const style = kindStyle(k);
      expect(style.codicon).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(style.completionKind).toMatch(/^[A-Z][A-Za-z]+$/);
    }
  });

  it("paints the badge with the completion kind's own colour token", () => {
    // The suggest widget colours a row from the CompletionItemKind we send, and
    // an extension cannot override it, so the badge takes the same token and the
    // two surfaces agree by construction. `on_action` is the one exception.
    const tinted: Record<string, string> = {
      Method: "method",
      Class: "class",
      Event: "event",
      Value: "enumerator",
      Variable: "variable",
      Field: "field",
      Interface: "interface",
      EnumMember: "enumeratorMember",
    };
    for (const k of mappedKinds()) {
      if (k === "on_action") continue;
      const style = kindStyle(k);
      const cls = tinted[style.completionKind];
      expect(style.color).toBe(cls ? `var(--vscode-symbolIcon-${cls}Foreground)` : null);
    }
  });

  it("keeps the two deliberate exceptions", () => {
    // on_action: the interface glyph, in the orange of the group it belongs to.
    // The completion row is blue anyway, because VS Code owns that colour.
    expect(kindStyle("on_action")).toEqual({
      codicon: "symbol-interface",
      completionKind: "Interface",
      color: "var(--vscode-symbolIcon-classForeground)",
    });
    // texture: no completion kind draws `file-media`, so the row takes the
    // plain file glyph while the hover and the tree get the picture frame.
    expect(kindStyle("texture")).toEqual({
      codicon: "file-media",
      completionKind: "File",
      color: null,
    });
  });

  it("falls through to a neutral style for a kind it does not name", () => {
    expect(kindStyle("something_new").codicon).toBe("go-to-file");
    expect(kindStyle("something_new").color).toBeNull();
  });
});

describe("card layout", () => {
  it("puts the badge, bold name and tail on line 1", () => {
    tier("vscode");
    const md = renderCard({
      kind: "trigger",
      name: "is_ai",
      doc: "is the character played by AI?",
      facts: "character scope · yes/no",
    });
    const lines = md.split(NL);
    expect(lines[0]).toContain("$(symbol-method) trigger");
    expect(lines[0]).toContain("**is_ai**");
    expect(md).toContain("*character scope · yes/no*");
  });

  it("writes per-card provenance with no rule above it", () => {
    const md = renderCard({
      kind: "scripted_trigger",
      badgeLabel: "scripted trigger",
      name: "is_human",
      headTail: "· mod",
      provenance: "[00_triggers.txt:1](file:///x) · 4,116 references",
    });
    expect(md).toContain("4,116 references");
    expect(md).not.toContain("---");
  });
});

describe("the shared footer", () => {
  it("puts the action links on the end of the scope line, not in a row", () => {
    const footer = hoverFooter(scopeHereLine("character", null), ["[file.txt:12](file:///x)"]);
    expect(footer).toBe("Scope here: **character** · [file.txt:12](file:///x)");
    expect(footer!.split(NL)).toHaveLength(1);
  });

  it("is null when there is nothing to say", () => {
    expect(hoverFooter(null, [])).toBeNull();
  });

  it("separates cards with a rule and appends the footer once", () => {
    const md = renderHover(["A", "B"], "Scope here: **character**");
    expect(md).toBe(["A", "", "---", "", "B", "", "Scope here: **character**"].join(NL));
  });

  it("caps the cards and says how many meanings were dropped", () => {
    const md = renderHover(["A", "B", "C", "D"], null);
    expect(md).toContain("*1 more meaning*");
    setHoverDetail("compact");
    expect(renderHover(["A", "B", "C"], null)).toContain("*2 more meanings*");
  });
});

describe("fenced blocks and the disclosure", () => {
  const body = ["a = {", "  b = 1", "  c = 2", "  d = 3", "  e = 4", "}"].join(NL);

  it("fences a short block whole, with no disclosure", () => {
    const md = fencedBlock("x = yes", 3, 40);
    expect(md).toBe(["```paradox", "x = yes", "```"].join(NL));
    expect(md).not.toContain("<details>");
  });

  it("caps the inline part and discloses the rest", () => {
    tier("vscode");
    const md = fencedBlock(body, 3, 40);
    expect(md).toContain(["```paradox", "a = {", "  b = 1", "  c = 2", "…", "```"].join(NL));
    expect(md).toContain("<details><summary>3 more lines</summary>");
    expect(md).toContain("  e = 4");
  });

  it("truncates inside the disclosure too, because a hover cannot outgrow the viewport", () => {
    tier("vscode");
    const md = fencedBlock(body, 1, 2);
    expect(md).toContain("… and 3 further");
  });

  it("drops the disclosure entirely on a client that strips HTML", () => {
    tier("bare");
    const md = fencedBlock(body, 3, 40);
    expect(md).not.toContain("<details>");
    expect(md).toContain("…");
  });

  it("strips the indentation every line shares", () => {
    expect(stripCommonIndent(["    a", "      b", "", "    c"].join(NL))).toBe(
      ["a", "  b", "", "c"].join(NL)
    );
  });

  it("shows no example at all in compact mode", () => {
    setHoverDetail("compact");
    expect(CAPS.compact.exampleLines).toBe(0);
    expect(fencedBlock(body, CAPS.compact.bodyLines, CAPS.compact.disclosedLines)).toBe("");
  });
});

describe("scope pills", () => {
  it("is blue when it matches the cursor scope and muted otherwise", () => {
    tier("vscode");
    expect(scopePill("character", new Set(["character"]))).toBe(
      '<span style="color:var(--vscode-symbolIcon-variableForeground);">character</span>'
    );
    expect(scopePill("province", new Set(["character"]))).toContain("descriptionForeground");
    expect(scopeType("character")).toContain("symbolIcon-variableForeground");
  });
});
