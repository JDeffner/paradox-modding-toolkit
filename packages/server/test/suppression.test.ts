import { describe, expect, it } from "vitest";
import {
  globMatch,
  isIgnoredByConfig,
  isSuppressedInline,
  sanitizeStringList,
  scanInlineSuppressions,
} from "@px-lsp/protocol/suppression";
import { LineIndex, parseScript } from "../src/parser";
import { computeScriptDiagnostics, type FileContext } from "../src/features/diagnostics";

const MOD = "C:\\mods\\my_mod";

function scriptCtx(fsPath: string): FileContext {
  return { fsPath, modPath: MOD, bomOnDisk: null };
}

/** Mirror the server's filter step so tests exercise the real predicates end-to-end. */
function diagsWithSuppression(
  text: string,
  fsPath: string,
  cfg: { ignore: string[]; ignorePatterns: string[] },
  relPath: string
) {
  const raw = computeScriptDiagnostics(parseScript(text), new LineIndex(text), scriptCtx(fsPath));
  const inline = scanInlineSuppressions(text);
  return raw.filter((d) => {
    const code = typeof d.code === "string" ? d.code : d.code !== undefined ? String(d.code) : undefined;
    if (isIgnoredByConfig(cfg, code, relPath)) return false;
    if (isSuppressedInline(inline, d.range.start.line, code)) return false;
    return true;
  });
}

describe("sanitizeStringList", () => {
  it("keeps trimmed non-empty strings and drops the rest", () => {
    expect(sanitizeStringList(["a", " b ", "", "  ", 3, null, "c"])).toEqual(["a", "b", "c"]);
  });
  it("returns [] for non-arrays (fail-soft)", () => {
    expect(sanitizeStringList(undefined)).toEqual([]);
    expect(sanitizeStringList("nope")).toEqual([]);
    expect(sanitizeStringList({})).toEqual([]);
  });
});

describe("globMatch", () => {
  it("matches * within a segment but not across /", () => {
    expect(globMatch("common/*.txt", "common/foo.txt")).toBe(true);
    expect(globMatch("common/*.txt", "common/sub/foo.txt")).toBe(false);
  });
  it("matches ** across segments", () => {
    expect(globMatch("common/**/foo.txt", "common/a/b/foo.txt")).toBe(true);
    expect(globMatch("common/**", "common/a/b/foo.txt")).toBe(true);
  });
  it("matches slash-free patterns against the basename", () => {
    expect(globMatch("*.generated.txt", "events/x.generated.txt")).toBe(true);
    expect(globMatch("descriptor.mod", "descriptor.mod")).toBe(true);
  });
  it("is case-insensitive and slash-agnostic", () => {
    expect(globMatch("Common/**/Foo.TXT", "common/a/foo.txt")).toBe(true);
    expect(globMatch("common\\*.txt", "common/foo.txt")).toBe(true);
  });
  it("returns false for empty or non-matching patterns", () => {
    expect(globMatch("", "anything")).toBe(false);
    expect(globMatch("events/*.txt", "common/foo.txt")).toBe(false);
  });
});

describe("isIgnoredByConfig", () => {
  const cfg = { ignore: ["missing-bom"], ignorePatterns: ["vendor/**"] };
  it("drops by code", () => {
    expect(isIgnoredByConfig(cfg, "missing-bom", "events/a.txt")).toBe(true);
    expect(isIgnoredByConfig(cfg, "unclosed-brace", "events/a.txt")).toBe(false);
  });
  it("drops by path glob regardless of code", () => {
    expect(isIgnoredByConfig(cfg, "unclosed-brace", "vendor/lib/a.txt")).toBe(true);
    expect(isIgnoredByConfig(cfg, "unclosed-brace", "events/a.txt")).toBe(false);
  });
  it("handles an undefined code without throwing", () => {
    expect(isIgnoredByConfig(cfg, undefined, "events/a.txt")).toBe(false);
  });
});

describe("scanInlineSuppressions", () => {
  it("suppresses the same line with matching codes only", () => {
    const map = scanInlineSuppressions("bad = { # px:ignore unclosed-brace\n");
    expect(isSuppressedInline(map, 0, "unclosed-brace")).toBe(true);
    expect(isSuppressedInline(map, 0, "stray-close")).toBe(false);
  });
  it("suppresses the next line", () => {
    const map = scanInlineSuppressions("# px:ignore-next-line unclosed-brace\nbad = {\n");
    expect(isSuppressedInline(map, 1, "unclosed-brace")).toBe(true);
    expect(isSuppressedInline(map, 0, "unclosed-brace")).toBe(false);
  });
  it("a bare ignore suppresses every code on the line", () => {
    const map = scanInlineSuppressions("bad = { # px:ignore\n");
    expect(isSuppressedInline(map, 0, "unclosed-brace")).toBe(true);
    expect(isSuppressedInline(map, 0, "anything-at-all")).toBe(true);
  });
  it("accepts multiple codes and unions merged comments", () => {
    const map = scanInlineSuppressions("x # px:ignore a b\ny # px:ignore-next-line c\nz\n");
    expect(isSuppressedInline(map, 0, "a")).toBe(true);
    expect(isSuppressedInline(map, 0, "b")).toBe(true);
    expect(isSuppressedInline(map, 2, "c")).toBe(true);
  });
  it("ignores files without the marker cheaply", () => {
    expect(scanInlineSuppressions("just = script\n").size).toBe(0);
  });
  // Writing a reason used to parse every word of it as a code, so the
  // suppression silently matched nothing.
  it("stops at a -- rationale instead of reading it as codes", () => {
    const map = scanInlineSuppressions("bad = { # px:ignore unclosed-brace -- the game tolerates it\n");
    expect(isSuppressedInline(map, 0, "unclosed-brace")).toBe(true);
    expect(isSuppressedInline(map, 0, "the")).toBe(false);
    expect(isSuppressedInline(map, 0, "stray-close")).toBe(false);
  });
  it("treats a bare ignore with only a rationale as suppress-all", () => {
    const map = scanInlineSuppressions("bad = { # px:ignore -- intentional\n");
    expect(isSuppressedInline(map, 0, "unclosed-brace")).toBe(true);
    expect(isSuppressedInline(map, 0, "anything-at-all")).toBe(true);
  });
});

describe("end-to-end: our diagnostics respect suppression", () => {
  const file = `${MOD}\\events\\my_events.txt`;
  // A stray close brace produces a `stray-close` diagnostic on line 0.
  const stray = "}\n";

  it("code filter removes the diagnostic", () => {
    const kept = diagsWithSuppression(
      stray,
      file,
      { ignore: [], ignorePatterns: [] },
      "events/my_events.txt"
    );
    expect(kept.length).toBeGreaterThan(0);
    const dropped = diagsWithSuppression(
      stray,
      file,
      { ignore: ["stray-close"], ignorePatterns: [] },
      "events/my_events.txt"
    );
    expect(dropped.length).toBe(0);
  });

  it("glob filter removes the diagnostic", () => {
    const dropped = diagsWithSuppression(
      stray,
      file,
      { ignore: [], ignorePatterns: ["events/**"] },
      "events/my_events.txt"
    );
    expect(dropped.length).toBe(0);
  });

  it("same-line inline comment removes the diagnostic", () => {
    const text = "} # px:ignore stray-close\n";
    const kept = diagsWithSuppression(text, file, { ignore: [], ignorePatterns: [] }, "events/my_events.txt");
    expect(kept.some((d) => d.code === "stray-close")).toBe(false);
  });

  it("next-line inline comment removes the diagnostic", () => {
    const text = "# px:ignore-next-line stray-close\n}\n";
    const kept = diagsWithSuppression(text, file, { ignore: [], ignorePatterns: [] }, "events/my_events.txt");
    expect(kept.some((d) => d.code === "stray-close")).toBe(false);
  });

  it("suppress-all inline comment removes the diagnostic", () => {
    const text = "} # px:ignore\n";
    const kept = diagsWithSuppression(text, file, { ignore: [], ignorePatterns: [] }, "events/my_events.txt");
    expect(kept.some((d) => d.code === "stray-close")).toBe(false);
  });
});

describe("tiger-forwarded reports respect the same predicates", () => {
  // Tiger reports carry a `key` (used as the diagnostic code) and a file/line.
  const key = "unknown-field";
  const rel = "common/traits/00_traits.txt";
  const cfg = { ignore: [key], ignorePatterns: [] as string[] };

  it("filters a tiger report by its key via ignore", () => {
    expect(isIgnoredByConfig(cfg, key, rel)).toBe(true);
    expect(isIgnoredByConfig(cfg, "other-key", rel)).toBe(false);
  });

  it("filters a tiger report by file glob", () => {
    const pcfg = { ignore: [] as string[], ignorePatterns: ["common/traits/**"] };
    expect(isIgnoredByConfig(pcfg, key, rel)).toBe(true);
    expect(isIgnoredByConfig(pcfg, key, "events/x.txt")).toBe(false);
  });

  it("filters a tiger report by inline comment on its line", () => {
    // Line 2 (0-based 1) carries an ignore for the tiger key.
    const source = "trait = {\n\tflag = x # px:ignore unknown-field\n}\n";
    const map = scanInlineSuppressions(source);
    expect(isSuppressedInline(map, 1, key)).toBe(true);
    expect(isSuppressedInline(map, 0, key)).toBe(false);
  });
});
