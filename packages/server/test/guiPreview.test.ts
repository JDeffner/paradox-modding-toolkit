/**
 * Library previews: a type declared in the document lays out through its own
 * declaration, a template previews as `widget = { using = ... }`, a raw
 * fragment lays out as is, and entries that cannot stand alone say why.
 */
import { describe, expect, it } from "vitest";
import { emptyGuiDefs } from "../src/gui/guiDefs";
import { declarationsOf, previewEntries } from "../src/gui/previewService";

const doc = `
template my_box {
	size = { 120 40 }
	color = { 1 0 0 1 }
}
types My {
	type my_button = widget {
		size = { 80 30 }
	}
}
window = {
	name = "root"
	size = { 1920 1080 }
}
`;

describe("guiPreview", () => {
  it("keeps only the declarations of the document", () => {
    const decls = declarationsOf(doc);
    expect(decls).toContain("template my_box");
    expect(decls).toContain("types My");
    expect(decls).not.toContain('name = "root"');
  });

  it("previews a local type, a template and a raw fragment at their own size", () => {
    const out = previewEntries(
      doc,
      [
        { name: "my_button", kind: "type" },
        { name: "my_box", kind: "template" },
        { name: "saved", kind: "raw", fragment: "widget = { size = { 50 60 } }" },
        { name: "nope", kind: "raw", fragment: "   " },
      ],
      emptyGuiDefs(),
      undefined
    );
    expect(out.map((p) => p.node && [p.node.rect.w, p.node.rect.h])).toEqual([
      [80, 30],
      [120, 40],
      [50, 60],
      null,
    ]);
    expect(out[3].reason).toBe("nothing to lay out");
  });
});
