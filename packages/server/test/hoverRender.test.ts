/**
 * §D hover-render fixtures, derived from the three D2 mocks. These pin the card
 * structure (badge spans, scope pills, single shared footer) and the plain-text
 * fallback (span *content* stays legible when the tag is stripped).
 */
import { describe, expect, it } from "vitest";
import {
  isShortExample,
  kindBadge,
  renderCard,
  renderHover,
  scopeHereLine,
  scopePill,
  scopeType,
} from "../src/features/hoverRender";

describe("kind badges (§D2)", () => {
  it("colors each kind family per the plan", () => {
    expect(kindBadge("trigger")).toBe('<span style="color:var(--vscode-charts-purple);">■ trigger</span>');
    expect(kindBadge("effect")).toBe('<span style="color:var(--vscode-charts-red);">■ effect</span>');
    expect(kindBadge("structure_key", "character interaction key")).toBe(
      '<span style="color:var(--vscode-charts-yellow);">■ character interaction key</span>'
    );
    expect(kindBadge("scripted_trigger")).toContain("var(--vscode-charts-green)");
    expect(kindBadge("saved_scope")).toContain("var(--vscode-charts-orange)");
    expect(kindBadge("loc_key")).toContain("var(--vscode-charts-foreground)");
  });

  it("badge content is plain text so HTML stripping stays legible", () => {
    const stripped = kindBadge("trigger").replace(/<[^>]+>/g, "");
    expect(stripped).toBe("■ trigger");
  });
});

describe("scope pills (§D3)", () => {
  it("blue when the scope matches the current cursor scope, muted otherwise", () => {
    const current = new Set(["character"]);
    expect(scopePill("character", current)).toBe(
      '<span style="color:var(--vscode-charts-blue);">character</span>'
    );
    expect(scopePill("province", current)).toBe(
      '<span style="color:var(--vscode-descriptionForeground);">province</span>'
    );
  });

  it("muted when no current scope is known", () => {
    expect(scopePill("character", null)).toContain("descriptionForeground");
  });
});

describe("Mock 1 — engine trigger (is_ai-shaped)", () => {
  const md = renderCard({
    kind: "trigger",
    name: "is_ai",
    doc: "Is the character AI-controlled? A player-controlled character returns no.",
    traits: "Traits: yes/no · comparison ok",
    footer: [`Supported scopes: ${scopePill("character", new Set(["character"]))}`],
  });

  it("badge + bold name on line 1", () => {
    expect(md.startsWith('<span style="color:var(--vscode-charts-purple);">■ trigger</span> **is_ai**')).toBe(
      true
    );
  });

  it("prose, italic traits, and a --- footer with a blue scope pill", () => {
    expect(md).toContain("Is the character AI-controlled?");
    expect(md).toContain("*Traits: yes/no · comparison ok*");
    expect(md).toContain(
      '\n---\nSupported scopes: <span style="color:var(--vscode-charts-blue);">character</span>'
    );
  });
});

describe("Mock 2 — mod scripted trigger with reference count", () => {
  const md = renderCard({
    kind: "scripted_trigger",
    badgeLabel: "scripted trigger",
    name: "is_human",
    headTail: "· mod",
    example: "is_shown = { scope:secondary_recipient = { is_human = yes } }",
    footer: ["[00_agot_character_triggers.txt:1](file:///x)", "4,116 references"],
  });

  it("green badge, name, · mod on line 1", () => {
    expect(
      md.startsWith(
        '<span style="color:var(--vscode-charts-green);">■ scripted trigger</span> **is_human** · mod'
      )
    ).toBe(true);
  });

  it("fences the example with the paradox language id", () => {
    expect(md).toContain("```paradox\nis_shown = { scope:secondary_recipient = { is_human = yes } }\n```");
  });

  it("merges provenance link and reference count into one footer line", () => {
    expect(md).toContain("\n---\n[00_agot_character_triggers.txt:1](file:///x) · 4,116 references");
  });
});

describe("Mock 3 — saved scope", () => {
  const md = renderCard({
    kind: "saved_scope",
    name: "scope:secondary_recipient",
    headTail: `→ ${scopeType("character")}`,
    doc: "Saved in this file: 00_agot_bastard_interactions.txt:13",
  });

  it("orange badge, name, blue → type on line 1", () => {
    expect(md).toContain(
      '<span style="color:var(--vscode-charts-orange);">■ saved scope</span> **scope:secondary_recipient**'
    );
    expect(md).toContain('→ <span style="color:var(--vscode-charts-blue);">character</span>');
  });

  it("carries the save-site line in prose", () => {
    expect(md).toContain("Saved in this file: 00_agot_bastard_interactions.txt:13");
  });
});

describe("hover assembly (§D2)", () => {
  it("appends the scope footer exactly once, after the cards", () => {
    const md = renderHover(
      [renderCard({ kind: "trigger", name: "a" }), renderCard({ kind: "effect", name: "b" })],
      scopeHereLine("character", "root · every_vassal")
    );
    expect(md.match(/Scope here:/g)).toHaveLength(1);
    expect(md.trimEnd().endsWith("Scope here: **character** (root · every_vassal)")).toBe(true);
    // Cards are joined by the --- separator.
    expect(md).toContain("\n\n---\n\n");
  });

  it("caps at 3 cards and reports the remainder", () => {
    const cards = ["a", "b", "c", "d", "e"].map((n) => renderCard({ kind: "trigger", name: n }));
    const md = renderHover(cards, null);
    expect(md).toContain("*2 more meanings*");
    expect(md).not.toContain("**d**");
  });

  it("singular remainder wording", () => {
    const cards = ["a", "b", "c", "d"].map((n) => renderCard({ kind: "trigger", name: n }));
    expect(renderHover(cards, null)).toContain("*1 more meaning*");
  });

  it("omits the footer when scope inference is unavailable (fail-soft)", () => {
    const md = renderHover([renderCard({ kind: "trigger", name: "a" })], null);
    expect(md).not.toContain("Scope here");
  });
});

describe("isShortExample (§D2)", () => {
  it("true for bodies under 4 non-blank lines", () => {
    expect(isShortExample("is_human = yes")).toBe(true);
    expect(isShortExample("a\nb\nc")).toBe(true);
  });
  it("false for longer bodies or empty ones", () => {
    expect(isShortExample("a\nb\nc\nd")).toBe(false);
    expect(isShortExample("")).toBe(false);
  });
});
