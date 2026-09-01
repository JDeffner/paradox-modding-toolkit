/**
 * Hover card layout. These pin the three-tier rendering contract (glyph, square,
 * plain), the single shared footer, the caps, and fenced-block truncation.
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
  renderHoverMarkdown,
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

  it("resolves every mapped kind to the SymbolKind drawing its own picture", () => {
    // VS Code draws SymbolKind member X with `symbol-<kebab X>`, so a non-null
    // symbolKind must kebab back to the codicon, modulo the alias pairs.
    const ALIAS: Record<string, string> = { "symbol-value": "symbol-enum", "symbol-text": "symbol-key" };
    for (const k of mappedKinds()) {
      const style = kindStyle(k);
      if (style.symbolKind === null) continue;
      const kebab = style.symbolKind.replace(/(?<!^)([A-Z])/g, "-$1").toLowerCase();
      expect(ALIAS[style.codicon] ?? style.codicon).toBe(`symbol-${kebab}`);
    }
    // The pictures no SymbolKind draws stay null rather than guessing.
    expect(kindStyle("texture").symbolKind).toBeNull();
    expect(kindStyle("define").symbolKind).toBeNull();
    // The breadcrumb mismatch this replaced: an event is a class, not a bolt.
    expect(kindStyle("event").symbolKind).toBe("Class");
  });

  it("gives the four list kinds four pictures", () => {
    // add_to_list dies with its effect block (array); the *_variable_list
    // kinds are variable storage, split by storage class: object-attached
    // (enum member), event-chain-local (plain list), game-global (globe).
    const kinds = ["list", "variable_list", "local_variable_list", "global_variable_list"];
    expect(kinds.map((k) => kindStyle(k).codicon)).toEqual([
      "symbol-array",
      "symbol-enum-member",
      "list-unordered",
      "globe",
    ]);
    // All four keep the blue enum-member row: no blue completion kind is free.
    for (const k of kinds) {
      expect(kindStyle(k).completionKind).toBe("EnumMember");
      expect(kindStyle(k).color).toBe("var(--vscode-symbolIcon-enumeratorMemberForeground)");
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
      symbolKind: "Interface",
      color: "var(--vscode-symbolIcon-classForeground)",
    });
    // texture: no completion kind draws `file-media`, so the row takes the
    // plain file glyph while the hover and the tree get the picture frame.
    expect(kindStyle("texture")).toEqual({
      codicon: "file-media",
      completionKind: "File",
      symbolKind: null,
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

describe("the one assembly path every hover surface renders through", () => {
  const trigger = { kind: "trigger", name: "is_ai", wiki: { name: "is_ai", kind: "trigger" } };

  it("lifts a single card's provenance onto the footer, so no row costs three lines", () => {
    tier("bare");
    const md = renderHoverMarkdown(
      [{ kind: "text_format", name: "#bold", provenance: "[a.gui:3](file:///a)" }],
      null
    );
    expect(md.split(NL).filter((l) => l !== "")).toEqual(["■ text format **#bold**", "[a.gui:3](file:///a)"]);
  });

  it("keeps per-card provenance on a stack, where it belongs to one meaning", () => {
    const md = renderHoverMarkdown([
      { kind: "trigger", name: "category", provenance: "P1" },
      { kind: "structure_key", name: "category", provenance: "P2" },
    ]);
    expect(md).toContain("P1");
    expect(md).toContain("P2");
    expect(md).toContain("---");
  });

  it("puts the Examples Wiki link last on the footer, after the scope and the links", () => {
    const md = renderHoverMarkdown([trigger], scopeHereLine("character", null), ["1 reference"]);
    const footer = md.split(NL).at(-1)!;
    expect(footer.startsWith("Scope here: **character** · 1 reference · [Examples Wiki](")).toBe(true);
    expect(footer).toContain(encodeURIComponent(JSON.stringify([{ name: "is_ai", kind: "trigger" }])));
  });

  it("takes the article from the first card that has one, and emits only one", () => {
    const md = renderHoverMarkdown([
      { kind: "structure_key", name: "category" },
      trigger,
      { kind: "effect", name: "category", wiki: { name: "category", kind: "effect" } },
    ]);
    expect(md.match(/Examples Wiki/g)).toHaveLength(1);
    expect(md).toContain(encodeURIComponent(JSON.stringify([{ name: "is_ai", kind: "trigger" }])));
  });

  it("emits no wiki link for a client that does not register the command", () => {
    tier("bare");
    expect(renderHoverMarkdown([trigger], scopeHereLine("character", null))).not.toContain("Examples Wiki");
  });

  it("emits no footer at all when there is nothing to put on it", () => {
    tier("bare");
    expect(renderHoverMarkdown([{ kind: "keyword", name: "base" }])).toBe("■ keyword **base**");
  });
});

describe("fenced blocks", () => {
  const body = ["a = {", "  b = 1", "  c = 2", "  d = 3", "  e = 4", "}"].join(NL);

  it("fences a short block whole, with no truncation", () => {
    const md = fencedBlock("x = yes", 3);
    expect(md).toBe(["```paradox", "x = yes", "```"].join(NL));
    expect(md).not.toContain("…");
  });

  it("truncates the overflow and says how much it dropped", () => {
    tier("vscode");
    const md = fencedBlock(body, 3);
    expect(md).toContain(["```paradox", "a = {", "  b = 1", "  c = 2", "…", "```"].join(NL));
    expect(md).toContain("*3 more lines*");
    expect(md).not.toContain("  e = 4");
  });

  it("emits no HTML at all, on any client tier", () => {
    for (const t of ["vscode", "bare"] as const) {
      tier(t);
      const md = fencedBlock(body, 3);
      expect(md).not.toContain("<");
      expect(md).toContain("…");
    }
  });

  it("strips the indentation every line shares", () => {
    expect(stripCommonIndent(["    a", "      b", "", "    c"].join(NL))).toBe(
      ["a", "  b", "", "c"].join(NL)
    );
  });

  it("shows no example at all in compact mode", () => {
    setHoverDetail("compact");
    expect(CAPS.compact.exampleLines).toBe(0);
    expect(fencedBlock(body, CAPS.compact.bodyLines)).toBe("");
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
