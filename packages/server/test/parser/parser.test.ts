import { describe, it, expect } from "vitest";
import {
  parseScript,
  LineIndex,
  walkStatements,
  nodeAtOffset,
  AssignmentNode,
  BlockNode,
  ScalarNode,
  TaggedBlockNode,
  ValueStatementNode,
} from "../../src/parser/index";

function firstAssignment(text: string): AssignmentNode {
  const { root } = parseScript(text);
  const stmt = root.statements[0];
  expect(stmt.kind).toBe("assignment");
  return stmt as AssignmentNode;
}

describe("parseScript, round-trip offsets", () => {
  it("every node range slices out exactly the source text", () => {
    const text = `# header comment
my_event = {
  type = character_event
  title = my_event.t
  trait = brave
  color = rgb { 255 0 0 }
  traits = { brave ambitious }
  limit = { age >= 18 }
  desc = "a quoted string with \\" escape"
}
`;
    const { root, errors } = parseScript(text);
    expect(errors).toHaveLength(0);

    const check = (r: { start: number; end: number }, expected: string) => {
      expect(text.slice(r.start, r.end)).toBe(expected);
    };

    const ev = root.statements[0] as AssignmentNode;
    check(ev.key.range, "my_event");
    // The event spans from `my_event` to its own closing brace (the last `}`).
    check(ev.range, text.slice(text.indexOf("my_event"), text.lastIndexOf("}") + 1));

    walkStatements(root, (stmt) => {
      if (stmt.kind === "assignment") {
        // key text matches its slice
        expect(text.slice(stmt.key.range.start, stmt.key.range.end)).toBe(
          stmt.key.quoted ? `"${stmt.key.text}"` : stmt.key.text
        );
      }
    });

    const block = ev.value as BlockNode;
    // color = rgb { 255 0 0 }
    const colorAssign = block.statements.find(
      (s) => s.kind === "assignment" && s.key.text === "color"
    ) as AssignmentNode;
    expect(colorAssign.value?.kind).toBe("tagged-block");
    const tb = colorAssign.value as TaggedBlockNode;
    check(tb.tag.range, "rgb");
    check(tb.block.range, "{ 255 0 0 }");
    check(tb.range, "rgb { 255 0 0 }");
  });
});

describe("operators", () => {
  it("parses all operators including ?=, comparisons", () => {
    const cases: Array<[string, string]> = [
      ["a = b", "="],
      ["a ?= b", "?="],
      ["a == b", "=="],
      ["a != b", "!="],
      ["a < b", "<"],
      ["a <= b", "<="],
      ["a > b", ">"],
      ["a >= b", ">="],
    ];
    for (const [src, op] of cases) {
      const a = firstAssignment(src);
      expect(a.op).toBe(op);
      expect((a.value as ScalarNode).text).toBe("b");
    }
  });

  it("parses comparisons inside a trigger block", () => {
    const a = firstAssignment("limit = { age >= 18 gold < 100 }");
    const block = a.value as BlockNode;
    const age = block.statements[0] as AssignmentNode;
    expect(age.op).toBe(">=");
    const gold = block.statements[1] as AssignmentNode;
    expect(gold.op).toBe("<");
  });
});

describe("value shapes", () => {
  it("tagged blocks: color = rgb { 255 0 0 }", () => {
    const a = firstAssignment("color = rgb { 255 0 0 }");
    expect(a.value?.kind).toBe("tagged-block");
    const tb = a.value as TaggedBlockNode;
    expect(tb.tag.text).toBe("rgb");
    expect(tb.block.statements).toHaveLength(3);
  });

  it("hsv tagged block", () => {
    const a = firstAssignment("color = hsv { 0.5 0.5 0.5 }");
    const tb = a.value as TaggedBlockNode;
    expect(tb.tag.text).toBe("hsv");
  });

  it("LIST-tagged blocks", () => {
    const a = firstAssignment("x = LIST { a b c }");
    expect(a.value?.kind).toBe("tagged-block");
  });

  it("bare lists: traits = { brave ambitious }", () => {
    const a = firstAssignment("traits = { brave ambitious }");
    const block = a.value as BlockNode;
    expect(block.statements).toHaveLength(2);
    expect(block.statements[0].kind).toBe("value");
    const v0 = block.statements[0] as ValueStatementNode;
    expect((v0.value as ScalarNode).text).toBe("brave");
  });

  it("anonymous block lists: { 1 2 } { 3 4 }", () => {
    const { root } = parseScript("{ 1 2 } { 3 4 }");
    expect(root.statements).toHaveLength(2);
    expect(root.statements[0].kind).toBe("value");
    const v0 = root.statements[0] as ValueStatementNode;
    expect(v0.value.kind).toBe("block");
  });

  it("nested blocks", () => {
    const a = firstAssignment("a = { b = { c = { d = 1 } } }");
    let block = a.value as BlockNode;
    let depth = 1;
    while (
      block.statements.length === 1 &&
      block.statements[0].kind === "assignment" &&
      (block.statements[0] as AssignmentNode).value?.kind === "block"
    ) {
      block = (block.statements[0] as AssignmentNode).value as BlockNode;
      depth++;
    }
    // a{} b{} c{} are the three nested blocks; d's value is a scalar.
    expect(depth).toBe(3);
  });
});

describe("GUI style", () => {
  it("key { } with no operator (GUI style)", () => {
    // Simple GUI form: `widget = { ... }` handled as a normal assignment,
    // and `name { ... }` (no operator) as an op-less assignment.
    const a = firstAssignment("scrollbar_vertical { size = { 10 20 } }");
    expect(a.op).toBeNull();
    expect(a.value?.kind).toBe("block");
    expect(a.key.text).toBe("scrollbar_vertical");
  });

  it("keyword name { } (e.g. `template MyT { }`) parses losslessly", () => {
    // `template` is a bare value; `MyT { }` is an op-less block assignment.
    const { root, errors } = parseScript("template MyT { size = { 10 20 } }");
    expect(errors).toHaveLength(0);
    expect(root.statements).toHaveLength(2);
    expect((root.statements[0] as ValueStatementNode).kind).toBe("value");
    const gui = root.statements[1] as AssignmentNode;
    expect(gui.key.text).toBe("MyT");
    expect(gui.op).toBeNull();
    expect(gui.value?.kind).toBe("block");
  });

  it('quoted keys: blockoverride "top" { }', () => {
    // Parses as: bare value `blockoverride`, then GUI-style `"top" { }` where
    // the quoted scalar is the key of an op-less block assignment.
    const { root, errors } = parseScript('blockoverride "top" { }');
    expect(errors).toHaveLength(0);
    expect(root.statements).toHaveLength(2);
    const bare = root.statements[0] as ValueStatementNode;
    expect(bare.kind).toBe("value");
    expect((bare.value as ScalarNode).text).toBe("blockoverride");
    const guiAssign = root.statements[1] as AssignmentNode;
    expect(guiAssign.kind).toBe("assignment");
    expect(guiAssign.op).toBeNull();
    expect(guiAssign.key.quoted).toBe(true);
    expect(guiAssign.key.text).toBe("top");
    expect(guiAssign.value?.kind).toBe("block");
  });

  it("a leading BOM does not swallow the first block", () => {
    // Callers that read bytes strip the BOM, but a text that still carries one
    // used to glue it onto the first word, so a `types MyTypes { … }` file
    // saved with a BOM lost its whole types block from the index.
    const { root, errors } = parseScript("\uFEFFtypes MyTypes {\n\ttype px_x = widget { }\n}\n");
    expect(errors).toHaveLength(0);
    expect((root.statements[0] as ValueStatementNode).kind).toBe("value");
    const types = root.statements[1] as AssignmentNode;
    expect(types.key.text).toBe("MyTypes");
    expect(types.value?.kind).toBe("block");
  });

  it("quoted value with a following block forms a tagged block", () => {
    // e.g. name = "MyName" is a plain quoted value
    const a = firstAssignment('name = "My Name"');
    expect(a.value?.kind).toBe("scalar");
    expect((a.value as ScalarNode).text).toBe("My Name");
    expect((a.value as ScalarNode).quoted).toBe(true);
  });
});

describe("special word forms", () => {
  it("@var = 1.5 and @[var*2]", () => {
    const a = firstAssignment("@my_var = 1.5");
    expect(a.key.text).toBe("@my_var");
    expect((a.value as ScalarNode).text).toBe("1.5");

    const b = firstAssignment("size = @[my_var + 1]");
    expect((b.value as ScalarNode).text).toBe("@[my_var + 1]");
  });

  it("scope:x.var:y words", () => {
    const a = firstAssignment("scope:target = scope:x.var:y");
    expect(a.key.text).toBe("scope:target");
    expect((a.value as ScalarNode).text).toBe("scope:x.var:y");
  });

  it("dates, negatives, dollar params", () => {
    expect((firstAssignment("date = 1066.9.15").value as ScalarNode).text).toBe("1066.9.15");
    expect((firstAssignment("x = -0.5").value as ScalarNode).text).toBe("-0.5");
    expect((firstAssignment("x = $PARAM$").value as ScalarNode).text).toBe("$PARAM$");
    expect((firstAssignment("x = culture:czech").value as ScalarNode).text).toBe("culture:czech");
  });

  it("apostrophe words", () => {
    const a = firstAssignment("x = 'quoted_in_apostrophes'");
    expect((a.value as ScalarNode).text).toBe("'quoted_in_apostrophes'");
    expect((a.value as ScalarNode).quoted).toBe(false);
  });

  it("comparison operator used as a value: OPERATOR = <=", () => {
    const text = "trigger = { OPERATOR = <= COUNT = 0 }";
    const { root, errors } = parseScript(text);
    expect(errors).toHaveLength(0);
    const block = (root.statements[0] as AssignmentNode).value as BlockNode;
    const op = block.statements[0] as AssignmentNode;
    expect(op.key.text).toBe("OPERATOR");
    expect((op.value as ScalarNode).text).toBe("<=");
    const count = block.statements[1] as AssignmentNode;
    expect(count.key.text).toBe("COUNT");
    expect((count.value as ScalarNode).text).toBe("0");
  });

  it("comments in awkward places", () => {
    const { root, comments, errors } = parseScript("a = # inline\n b\nc = { # inside\n d = 1 }");
    expect(errors).toHaveLength(0);
    expect(comments.length).toBe(2);
    const a = root.statements[0] as AssignmentNode;
    expect((a.value as ScalarNode).text).toBe("b");
  });
});

describe("error recovery", () => {
  it("missing } mid-file: one unclosed-brace at the right opening, later statements swallowed", () => {
    const text = "outer = {\n a = 1\n inner = {\n b = 2\nlast = 3\n";
    const { root, errors } = parseScript(text);
    const unclosed = errors.filter((e) => e.code === "unclosed-brace");
    expect(unclosed.length).toBe(2); // both `outer` and `inner` unclosed
    // report at the opening brace offsets
    const openOuter = text.indexOf("{");
    expect(unclosed.some((e) => e.range.start === openOuter)).toBe(true);
    // tree is still usable: `outer` is present with its (implicitly closed) block
    const outer = root.statements[0] as AssignmentNode;
    expect(outer.key.text).toBe("outer");
    expect((outer.value as BlockNode).closeBrace).toBeNull();
  });

  it("statements after a closed gap still parse into the tree", () => {
    const text = "a = { b = 1 }\nc = 2\nd = { e = 3 }";
    const { root, errors } = parseScript(text);
    expect(errors).toHaveLength(0);
    expect(root.statements).toHaveLength(3);
    expect((root.statements[1] as AssignmentNode).key.text).toBe("c");
  });

  it("stray } at root level", () => {
    const { root, errors } = parseScript("a = 1 } b = 2");
    const stray = errors.filter((e) => e.code === "stray-close");
    expect(stray.length).toBe(1);
    // still parses both assignments
    expect(root.statements).toHaveLength(2);
  });

  it("key = with no value → missing-value", () => {
    const { root, errors } = parseScript("a =\nb = 2");
    const mv = errors.filter((e) => e.code === "missing-value");
    expect(mv.length).toBe(1);
    const a = root.statements[0] as AssignmentNode;
    expect(a.value).toBeNull();
    expect(root.statements).toHaveLength(2);
  });

  it("key = } inside block → missing-value", () => {
    const { errors } = parseScript("outer = { a = }");
    expect(errors.some((e) => e.code === "missing-value")).toBe(true);
  });

  it("unterminated string recovers at end of line", () => {
    const { root, errors } = parseScript('a = "unterminated\nb = 2');
    expect(errors.some((e) => e.code === "unterminated-string")).toBe(true);
    expect(root.statements.length).toBeGreaterThanOrEqual(1);
  });

  // Victoria 3's gui tree writes data functions across lines and the game
  // accepts them; CK3 never does, which is why this went unnoticed. An open
  // `[` is what licenses the newline, so the case above is untouched.
  it("a [ ... ] data function may span lines", () => {
    const text = 'visible = "[And(\n\tA,\n\tB\n)]"\nnext = 2';
    const { root, errors } = parseScript(text);
    expect(errors).toHaveLength(0);
    expect(root.statements).toHaveLength(2);
    const first = root.statements[0];
    if (first.kind !== "assignment" || first.value?.kind !== "scalar") throw new Error("not a scalar");
    expect(first.value.text).toBe("[And(\n\tA,\n\tB\n)]");
  });

  it("an open [ still gives up rather than swallowing the file", () => {
    const { errors } = parseScript('a = "[Broken(\n' + "x = 1\n".repeat(40) + "b = 2\n");
    expect(errors.some((e) => e.code === "unterminated-string")).toBe(true);
  });

  it("empty file", () => {
    const { root, errors } = parseScript("");
    expect(root.statements).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it("file of only comments", () => {
    const { root, errors, comments } = parseScript("# a\n# b\n# c");
    expect(root.statements).toHaveLength(0);
    expect(errors).toHaveLength(0);
    expect(comments).toHaveLength(3);
  });

  it("pathological input does not throw", () => {
    const inputs = [
      '"{"'.repeat(1000),
      "{".repeat(1000),
      "}".repeat(1000),
      "=".repeat(1000),
      "?".repeat(1000),
      "@[".repeat(500),
    ];
    for (const inp of inputs) {
      expect(() => parseScript(inp)).not.toThrow();
    }
  });

  it("random bytes do not throw", () => {
    for (let iter = 0; iter < 50; iter++) {
      let s = "";
      const n = 200;
      for (let k = 0; k < n; k++) {
        s += String.fromCharCode(Math.floor(Math.random() * 0x2000));
      }
      expect(() => parseScript(s)).not.toThrow();
    }
  });
});

describe("LineIndex", () => {
  it("positionAt/offsetAt round-trip on LF file", () => {
    const text = "line0\nline1\nline2";
    const idx = new LineIndex(text);
    expect(idx.lineCount).toBe(3);
    for (let off = 0; off <= text.length; off++) {
      const pos = idx.positionAt(off);
      expect(idx.offsetAt(pos)).toBe(off);
    }
    expect(idx.positionAt(0)).toEqual({ line: 0, character: 0 });
    expect(idx.positionAt(6)).toEqual({ line: 1, character: 0 });
  });

  it("handles \\r\\n files", () => {
    const text = "a\r\nbb\r\nccc";
    const idx = new LineIndex(text);
    expect(idx.lineCount).toBe(3);
    // 'b' at line 1 char 0 → offset 3
    expect(idx.offsetAt({ line: 1, character: 0 })).toBe(3);
    expect(idx.positionAt(3)).toEqual({ line: 1, character: 0 });
    // round-trip every offset
    for (let off = 0; off <= text.length; off++) {
      const pos = idx.positionAt(off);
      // offsetAt should return an offset whose position is the same
      const back = idx.offsetAt(pos);
      expect(idx.positionAt(back)).toEqual(pos);
    }
  });

  it("last line and offset past end clamps", () => {
    const text = "a\nb";
    const idx = new LineIndex(text);
    expect(idx.positionAt(1000)).toEqual({ line: 1, character: 1 });
    expect(idx.offsetAt({ line: 999, character: 5 })).toBe(text.length);
    expect(idx.offsetAt({ line: 0, character: 999 })).toBe(2); // clamped to start of next line
    expect(idx.lineStart(1)).toBe(2);
  });

  it("trailing newline creates an empty last line", () => {
    const idx = new LineIndex("a\n");
    expect(idx.lineCount).toBe(2);
    expect(idx.lineStart(1)).toBe(2);
  });
});

describe("nodeAtOffset", () => {
  it("returns the innermost statement chain", () => {
    const text = "outer = { inner = { leaf = 1 } }";
    const { root } = parseScript(text);
    const off = text.indexOf("leaf");
    const res = nodeAtOffset(root, off);
    expect(res).not.toBeNull();
    const path = res!.path;
    expect(path.length).toBe(3);
    expect((path[0] as AssignmentNode).key.text).toBe("outer");
    expect((path[2] as AssignmentNode).key.text).toBe("leaf");
  });

  it("cursor between statements in a block ends at the enclosing chain", () => {
    const text = "outer = {\n  a = 1\n  \n  b = 2\n}";
    const { root } = parseScript(text);
    const off = text.indexOf("  \n") + 1; // the blank spot between a and b
    const res = nodeAtOffset(root, off);
    expect(res).not.toBeNull();
    expect((res!.path[0] as AssignmentNode).key.text).toBe("outer");
  });

  it("offset outside everything returns null", () => {
    const { root } = parseScript("a = 1");
    // there's whitespace-free tiny doc; offset past end
    expect(nodeAtOffset(root, 999)).toBeNull();
  });
});
