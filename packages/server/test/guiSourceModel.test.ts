// Implements the source-writer design of Sage's Clausewitz Studio; behavior contract in docs/gui-designer/parity-checklist.md. GPL-3.0-or-later.
/**
 * G1 stage 1: the span-recording .gui source model.
 *
 * Rows owned here: W01 (the spans land on the right bytes), S01 (every
 * recorded span re-tokenizes to its model value, over the fixture corpus AND
 * the vanilla tree) and S06 (every body's recorded braces land on braces). The
 * block-structure facts the later stages consume (W12 blank ownership, W13
 * comment attachment, W14/S03 interleaving, W24 the append point, W06 newline
 * and indent unit) are asserted as MODEL facts here; their operations land with
 * the stages that own those rows.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { decode, parseScript, type ValueNode } from "../src/parser";
import {
  bodyIndent,
  findEntry,
  findWidgetAtLine,
  normalizeValue,
  parseGuiSource,
  type GuiBody,
  type GuiEntry,
  type GuiSourceFile,
} from "../src/gui/sourceModel";
import { devPath } from "../../../scripts/devPaths";

const CORPUS = path.join(__dirname, "fixtures", "gui");

function read(rel: string): string {
  return fs.readFileSync(path.join(CORPUS, rel), "utf8");
}

function load(rel: string): GuiSourceFile {
  return parseGuiSource(read(rel));
}

function corpusFiles(): string[] {
  const out: string[] = [];
  for (const group of fs.readdirSync(CORPUS, { withFileTypes: true })) {
    if (!group.isDirectory()) continue;
    for (const f of fs.readdirSync(path.join(CORPUS, group.name)).sort()) {
      if (f.endsWith(".gui")) out.push(`${group.name}/${f}`);
    }
  }
  return out.sort();
}

function widget(file: GuiSourceFile, name: string): GuiEntry {
  const found = file.entries.find((e) => e.body !== null && findEntry(e.body, "name")?.value === name);
  if (!found) throw new Error(`no widget named ${name}`);
  return found;
}

function slice(file: GuiSourceFile, span: { start: number; end: number }): string {
  return file.text.slice(span.start, span.end);
}

// ---------------------------------------------------------------------------
// S01: the span invariant, as a reusable sweep
// ---------------------------------------------------------------------------

/**
 * Re-tokenize a recorded value span ON ITS OWN and normalize the result the
 * same way the model did. Equality means the span covers the value's bytes
 * exactly: a byte short and it lexes differently or unbalances, a byte long and
 * it picks up a neighbouring token.
 */
function retokenizeValue(raw: string): string | null {
  const statements = parseScript(raw).root.statements;
  if (statements.length !== 1) return null;
  const stmt = statements[0];
  let value: ValueNode;
  if (stmt.kind === "value") {
    value = stmt.value;
  } else if (stmt.op === null && stmt.value) {
    // `widget { ... }`: the tagged-block form of a `type` value re-parses as
    // an operator-less assignment; both render the same, from the raw bytes.
    return `${raw.slice(stmt.key.range.start, stmt.key.range.end)} ${normalizeValue(raw, stmt.value)}`;
  } else {
    return null;
  }
  return normalizeValue(raw, value);
}

interface SweepCounts {
  files: number;
  entries: number;
  widgets: number;
  bodies: number;
  mismatches: string[];
}

function sweep(named: { name: string; text: string }[]): SweepCounts {
  const counts: SweepCounts = { files: 0, entries: 0, widgets: 0, bodies: 0, mismatches: [] };
  for (const { name, text } of named) {
    const file = parseGuiSource(text);
    counts.files++;
    for (const entry of file.entries) {
      counts.entries++;
      if (entry.kind !== "property") counts.widgets++;
      const where = `${name}:${entry.line + 1} ${entry.key}`;

      // The span covers key then value, in order, and nothing else.
      if (entry.span.start > entry.keySpan.start) counts.mismatches.push(`${where}: key before span`);
      if (slice(file, entry.keySpan) !== (entry.keyQuoted ? `"${entry.key}"` : entry.key)) {
        counts.mismatches.push(`${where}: key span`);
      }
      if (entry.opSpan && slice(file, entry.opSpan) !== entry.op) {
        counts.mismatches.push(`${where}: operator span`);
      }
      if (entry.valueSpan) {
        if (entry.valueSpan.start < entry.keySpan.end) counts.mismatches.push(`${where}: value before key`);
        if (entry.valueSpan.end !== entry.span.end) counts.mismatches.push(`${where}: span end`);
        const raw = slice(file, entry.valueSpan);
        if (entry.valueQuoted) {
          if (raw !== `"${entry.value}"`) counts.mismatches.push(`${where}: quoted value span`);
        } else if (retokenizeValue(raw) !== entry.value) {
          counts.mismatches.push(`${where}: re-tokenized to ${JSON.stringify(retokenizeValue(raw))}`);
        }
      }

      // S06: the recorded braces land on braces.
      if (entry.body) {
        counts.bodies++;
        if (file.text[entry.body.open] !== "{") counts.mismatches.push(`${where}: open brace`);
        if (entry.body.close !== null && file.text[entry.body.close] !== "}") {
          counts.mismatches.push(`${where}: close brace`);
        }
      }
    }
  }
  return counts;
}

// ---------------------------------------------------------------------------

describe("gui source model: spans (W01)", () => {
  const file = load("writer/tabs-comments.gui");

  it("the key span points at the key and the header at the declaration", () => {
    const header = widget(file, "px_header");
    expect(slice(file, header.keySpan)).toBe("widget");
    expect(header.span.start).toBe(header.keySpan.start);
    expect(file.text.slice(header.span.end - 1, header.span.end)).toBe("}");
    expect(header.kind).toBe("widget");
  });

  it("body open and close land on the braces", () => {
    const header = widget(file, "px_header");
    expect(file.text[header.body!.open]).toBe("{");
    expect(file.text[header.body!.close!]).toBe("}");
    expect(slice(file, header.body!.inner)).toContain('name = "px_header"');
  });

  it("a quoted value's span includes the quotes and its model value does not", () => {
    const name = findEntry(widget(file, "px_header").body!, "name")!;
    expect(slice(file, name.valueSpan!)).toBe('"px_header"');
    expect(name.value).toBe("px_header");
    expect(name.valueQuoted).toBe(true);
  });

  it("a block value's span is the raw block text, braces and interior spacing included", () => {
    const size = findEntry(file.root.entries[0].body!, "size")!;
    expect(slice(file, size.valueSpan!)).toBe("{ 100 200 }");
    expect(size.value).toBe("{ 100 200 }");
    expect(size.kind).toBe("property");
  });

  it("the operator span is the operator's own bytes", () => {
    const name = findEntry(widget(file, "px_header").body!, "name")!;
    expect(slice(file, name.opSpan!)).toBe("=");
    expect(name.keySpan.end).toBeLessThan(name.opSpan!.start);
  });

  it("a compound a|b value is one value whose span covers both sides of the pipe (W08)", () => {
    const dup = parseGuiSource(read("writer/duplicate-keys.gui"));
    const anchor = findEntry(dup.root.entries[0].body!, "parentanchor")!;
    expect(slice(dup, anchor.valueSpan!)).toBe("top|left");
    expect(anchor.value).toBe("top|left");
  });

  it("a duplicate key resolves to the LAST occurrence, case-insensitively (W02, W07)", () => {
    const dup = parseGuiSource(read("writer/duplicate-keys.gui"));
    const size = findEntry(dup.root.entries[0].body!, "SiZe")!;
    expect(slice(dup, size.keySpan)).toBe("SIZE");
    expect(size.value).toBe("{ 3 3 }");
  });

  it("a declaration's header starts at its marker word", () => {
    const tpl = parseGuiSource(read("writer/template-use-site.gui")).root.children[0];
    expect(tpl.kind).toBe("decl");
    expect(tpl.marker).toBe("template");
    expect(tpl.key).toBe("PxRow");
    expect(
      slice(parseGuiSource(read("writer/template-use-site.gui")), tpl.span).startsWith("template ")
    ).toBe(true);
  });

  it("a type definition records its base and its own body (W18)", () => {
    const refusal = parseGuiSource(read("writer/refusal-shapes.gui"));
    const types = refusal.root.children[0];
    expect(types.marker).toBe("types");
    const def = types.body!.children[0];
    expect(def.marker).toBe("type");
    expect(def.key).toBe("px_type_definition");
    expect(def.base).toBe("widget");
    expect(slice(refusal, def.valueSpan!).startsWith("widget {")).toBe(true);
  });

  it("a widget's line is the line the layout engine reports for it", () => {
    const header = widget(file, "px_header");
    expect(findWidgetAtLine(file, header.line)).toBe(header);
    expect(findWidgetAtLine(file, header.line + 1)).toBe(null);
  });
});

describe("gui source model: block structure", () => {
  it("blank separators below a block belong to it (W12)", () => {
    const file = load("writer/blank-separators.gui");
    const [a, b, c, d] = file.root.children[0].body!.children;
    expect(slice(file, a.blockSpan).endsWith("}\n\n")).toBe(true);
    expect(slice(file, b.blockSpan).endsWith("}\n\n\n")).toBe(true);
    expect(slice(file, c.blockSpan).endsWith("}\n")).toBe(true);
    // The extents tile, which is what makes a move a pure permutation.
    expect(a.blockSpan.end).toBe(b.blockSpan.start);
    expect(b.blockSpan.end).toBe(c.blockSpan.start);
    expect(c.blockSpan.end).toBe(d.blockSpan.start);
    expect(file.root.children[0].body!.contiguous).toBe(true);
  });

  it("an attached comment belongs to its widget, a separated header does not (W13)", () => {
    const file = load("writer/comment-runs.gui");
    const body = file.root.children[0].body!;
    const [a, b] = body.children;
    expect(slice(file, a.commentSpan!)).toBe("\t# the A widget\n");
    expect(slice(file, a.lineSpan).startsWith("\t# the A widget")).toBe(true);
    expect(slice(file, b.commentSpan!)).toBe("\t# the B widget\n");
    // The section header is separated by a blank line, so it stays put: it is
    // in nobody's extent.
    expect(file.text.indexOf("# section header")).toBeLessThan(a.lineSpan.start);
  });

  it("the append point is the last child's own lines, above a trailing comment run (W24)", () => {
    const file = load("writer/comment-runs.gui");
    const withChildren = file.root.children[0].body!;
    const last = withChildren.children[1];
    expect(withChildren.appendAfter).toBe(last.lineSpan.end);
    expect(file.text.slice(withChildren.appendAfter)).toMatch(/^\n\t# trailing run/);

    const noChildren = file.root.children[1].body!;
    expect(noChildren.children).toEqual([]);
    expect(file.text.slice(noChildren.appendAfter)).toMatch(/^\t# nothing but a comment run/);
  });

  it("the root backs up over a trailing comment run as well (W24)", () => {
    const file = parseGuiSource("@px_unit = 5\n\n# commented out\n# widget = {}\n");
    expect(file.root.children).toEqual([]);
    expect(file.text.slice(file.root.appendAfter)).toBe("# commented out\n# widget = {}\n");
  });

  it("an interleaved body is not contiguous, a plain one is (W14, S03)", () => {
    const interleaved = load("writer/interleaved-children.gui").root.children[0].body!;
    expect(interleaved.children.map((c) => findEntry(c.body!, "name")?.value)).toEqual([
      "px_inter_a",
      "px_inter_b",
      "px_inter_c",
    ]);
    expect(interleaved.contiguous).toBe(false);

    const plain = load("writer/reorder-siblings.gui").root.children[0].body!;
    expect(plain.children).toHaveLength(3);
    expect(plain.contiguous).toBe(true);
  });

  it("a line-sharing declaration owns no lines but keeps its exact span (W14, W16, W19)", () => {
    const file = load("writer/line-sharing.gui");
    const body = file.root.children[0].body!;
    const [a, b, , , own] = body.children;
    expect(a.ownLine).toBe(false);
    expect(b.ownLine).toBe(false);
    expect(slice(file, b.span)).toBe('widget = { name = "px_share_b" }');
    expect(slice(file, b.lineSpan)).toBe(slice(file, b.span));
    expect(own.ownLine).toBe(true);
    expect(body.contiguous).toBe(false);
  });

  it("a trailing comment marks a line that still carries information (W04)", () => {
    const file = load("writer/tabs-comments.gui");
    const size = findEntry(file.root.entries[0].body!, "size")!;
    expect(slice(file, size.trailingComment!)).toBe("# the window's own frame");
    expect(size.ownLine).toBe(true);
  });

  it("single-line and empty bodies are marked as such (W06, W15, W25)", () => {
    const file = load("writer/single-line-bodies.gui");
    const body = file.root.children[0].body!;
    const [vbox, sized, emptyBody, hbox] = body.children;
    expect(vbox.body!.singleLine).toBe(true);
    expect(vbox.body!.empty).toBe(false);
    expect(emptyBody.body!.singleLine).toBe(true);
    expect(emptyBody.body!.empty).toBe(true);
    expect(emptyBody.body!.indent).toBe(null);
    expect(sized.body!.closeOwnLine).toBe(false);
    expect(hbox.body!.children).toHaveLength(1);
    // A single-line body has no indent of its own, so a write goes one unit
    // deeper than the declaration.
    expect(bodyIndent(file, vbox.body!, vbox)).toBe("\t\t");
  });

  it("a nested selection is detectable by span containment (W23)", () => {
    const file = load("writer/nested-selection.gui");
    const outer = widget(file, "px_outer");
    const inner = widget(file, "px_inner_one");
    expect(inner.parent).toBe(outer);
    expect(outer.blockSpan.start).toBeLessThan(inner.blockSpan.start);
    expect(outer.blockSpan.end).toBeGreaterThan(inner.blockSpan.end);
  });

  it("a template's children are not source siblings of the use site's (W09)", () => {
    const file = load("writer/template-use-site.gui");
    const [tpl, use] = file.root.children;
    expect(tpl.body!.children.map((c) => c.key)).toEqual(["widget"]);
    expect(use.body!.children.map((c) => findEntry(c.body!, "name")?.value)).toEqual(["px_real_child"]);
    // `using = PxRow` is an ordinary scalar property at the use site: the
    // template's own `size` has no entry here, so a write must add a local one.
    expect(findEntry(use.body!, "using")!.value).toBe("PxRow");
    expect(findEntry(use.body!, "size")).toBe(null);
  });

  it("the document root is a body whose children are the file's roots", () => {
    const file = load("writer/reorder-siblings.gui");
    expect(file.root.open).toBe(-1);
    expect(file.root.close).toBe(null);
    expect(file.root.children).toHaveLength(2);
    expect(file.root.contiguous).toBe(true);
  });
});

describe("gui source model: formatting facts (W06, W15, W20)", () => {
  it("a CRLF file reports CRLF and its line spans keep the \\r", () => {
    const file = load("writer/crlf.gui");
    expect(file.newline).toBe("\r\n");
    const vbox = file.root.children[0].body!.children[0];
    expect(slice(file, vbox.lineSpan).endsWith("}\r\n")).toBe(true);
  });

  it("a space-indented file reports its own unit and per-body indent", () => {
    const file = load("writer/spaces-indent.gui");
    expect(file.indentUnit).toBe("    ");
    expect(file.newline).toBe("\n");
    const window = file.root.children[0];
    expect(window.body!.indent).toBe("    ");
    expect(window.body!.children[0].body!.indent).toBe("        ");
  });

  it("mixed bodies each keep their own indent string, tabs never counted as columns", () => {
    const file = load("writer/mixed-indent.gui");
    expect(file.indentUnit).toBe("\t");
    const [tabbed, spaced, both] = file.root.children[0].body!.children;
    expect(tabbed.body!.indent).toBe("\t\t");
    expect(spaced.indent).toBe("    ");
    expect(spaced.body!.indent).toBe("        ");
    // px_mixed_both's body starts tabbed; the space-indented entry inside it
    // keeps its own string and does not redefine the body's.
    expect(both.body!.indent).toBe("\t\t");
    expect(findEntry(both.body!, "size")!.indent).toBe("        ");
  });

  it("a fragment file reports the common leading indent of its roots (W20)", () => {
    const file = load("writer/paste-fragment.gui");
    expect(file.root.indent).toBe("\t");
    expect(file.root.children.map((c) => c.indent)).toEqual(["\t", "\t"]);
    expect(slice(file, file.root.children[0].lineSpan).startsWith("\t# the A widget")).toBe(true);
  });
});

describe("gui source model: sweeps (S01, S06)", () => {
  const files = corpusFiles();

  it("the corpus is the size the baseline was recorded at", () => {
    // A drop here means a fixture stopped being exercised (checklist §G).
    expect(files.length).toBe(39);
  });

  it("every recorded span re-tokenizes to its model value, over the whole corpus", () => {
    const counts = sweep(files.map((name) => ({ name, text: read(name) })));
    expect(counts.mismatches).toEqual([]);
    // Baseline recorded 2026-08-01; see docs/gui-designer/parity-checklist.md §G.
    expect(counts).toMatchObject({ files: 39, entries: 1308, widgets: 402, bodies: 788 });
  });

  it("every fixture parses cleanly, so every span is trustworthy", () => {
    const bad = files.filter((f) => parseGuiSource(read(f)).errors.length > 0);
    expect(bad).toEqual([]);
  });

  it("every body's braces land on braces, and a body's entries are inside it", () => {
    for (const name of files) {
      const file = parseGuiSource(read(name));
      for (const entry of file.entries) {
        if (!entry.body) continue;
        expect(file.text[entry.body.open]).toBe("{");
        expect(file.text[entry.body.close!]).toBe("}");
        for (const child of entry.body.entries) {
          expect(child.span.start).toBeGreaterThan(entry.body.open);
          expect(child.span.end).toBeLessThanOrEqual(entry.body.close!);
        }
      }
    }
  });
});

describe("gui source model: vanilla sweep (S01, S06)", () => {
  const gamePath = devPath("gamePath");
  const guiDir = gamePath ? path.join(gamePath, "gui") : null;

  it.skipIf(!guiDir)("every recorded span re-tokenizes to its model value over the vanilla gui tree", () => {
    const paths: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".gui")) paths.push(p);
      }
    };
    walk(guiDir!);
    paths.sort();
    const named = paths.map((p) => ({ name: path.basename(p), text: decode(fs.readFileSync(p)).text }));
    const counts = sweep(named);
    expect(counts.mismatches).toEqual([]);
    // Baseline recorded 2026-08-01 on the current CK3 install (checklist §G).
    // A materially different total means a game patch added or removed files.
    expect(counts.files).toBe(373);
    expect(counts.entries).toBeGreaterThan(90_000);
    expect(counts.bodies).toBeGreaterThan(30_000);
    console.log(
      `vanilla span sweep: ${counts.files} files, ${counts.entries} entries, ` +
        `${counts.widgets} declarations, ${counts.bodies} bodies`
    );
  });

  it.skipIf(!guiDir)("every vanilla file parses cleanly", () => {
    const paths: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".gui")) paths.push(p);
      }
    };
    walk(guiDir!);
    const bad = paths.filter((p) => parseGuiSource(decode(fs.readFileSync(p)).text).errors.length > 0);
    expect(bad.map((p) => path.basename(p))).toEqual([]);
  });
});

// A body is reachable from its entry, so this is the only place that needs a
// body-first helper: the sweep counts bodies through their entries instead.
function bodyCount(body: GuiBody): number {
  return body.entries.reduce((n, e) => n + (e.body ? 1 + bodyCount(e.body) : 0), 0);
}

describe("gui source model: internal consistency", () => {
  it("the flat entry list and the tree agree", () => {
    const file = load("writer/tabs-comments.gui");
    expect(file.entries.filter((e) => e.body).length).toBe(bodyCount(file.root));
    for (const entry of file.entries) {
      if (entry.parent) expect(entry.parent.body!.entries).toContain(entry);
    }
  });
});
