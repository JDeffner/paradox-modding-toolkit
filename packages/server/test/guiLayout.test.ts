/**
 * Golden fixtures for the PdxGui layout engine, derived from the in-game
 * calibration campaign (docs/gui-designer/calibration/). Each case cites its
 * batch: expected values are either the exact fractional model (asserted
 * tightly) or the measured on-screen pixels (asserted within the +-1px
 * raster tolerance documented in spec.md).
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { computeGuiLayout, computeNineSlice, GHOST_COUNT, type LayoutNode } from "../src/gui/layoutEngine";
import { collectGuiDefs, emptyGuiDefs, mergeGuiDefs } from "../src/gui/guiDefs";
import { devPath } from "../../../scripts/devPaths";

const ICON = (props: string) => `icon = { ${props} texture = "gfx/interface/colors/white.dds" }`;

function lay(snippet: string, w = 1000, h = 1000): LayoutNode {
  const nodes = computeGuiLayout(snippet, { viewport: { w, h } });
  expect(nodes.length).toBeGreaterThan(0);
  return nodes[0];
}

function expectRect(node: LayoutNode, x: number, y: number, w: number, h: number, tol = 0.01) {
  expect(node.rect.x).toBeCloseTo(x, tol < 0.5 ? 2 : 0);
  expect(Math.abs(node.rect.x - x)).toBeLessThanOrEqual(tol);
  expect(Math.abs(node.rect.y - y)).toBeLessThanOrEqual(tol);
  expect(Math.abs(node.rect.w - w)).toBeLessThanOrEqual(tol);
  expect(Math.abs(node.rect.h - h)).toBeLessThanOrEqual(tol);
}

describe("batch 01: anchors, position, nesting", () => {
  it("B1-B: parentanchor implies a mirroring widgetanchor", () => {
    const root = lay(`
widget = {
	size = { 300 200 }
	${ICON("size = { 20 20 }")}
	${ICON("parentanchor = top|hcenter size = { 20 20 }")}
	${ICON("parentanchor = top|right size = { 20 20 }")}
	${ICON("parentanchor = vcenter|left size = { 20 20 }")}
	${ICON("parentanchor = center size = { 20 20 }")}
	${ICON("parentanchor = vcenter|right size = { 20 20 }")}
	${ICON("parentanchor = bottom|left size = { 20 20 }")}
	${ICON("parentanchor = bottom|hcenter size = { 20 20 }")}
	${ICON("parentanchor = bottom|right size = { 20 20 }")}
}`);
    const expected: Array<[number, number]> = [
      [0, 0],
      [140, 0],
      [280, 0],
      [0, 90],
      [140, 90],
      [280, 90],
      [0, 180],
      [140, 180],
      [280, 180],
    ];
    expected.forEach(([x, y], i) => expectRect(root.children[i], x, y, 20, 20));
  });

  it("B1-C: explicit widgetanchor equals the implicit default", () => {
    const root = lay(`
widget = {
	size = { 300 200 }
	${ICON("parentanchor = center widgetanchor = center size = { 40 40 }")}
	${ICON("parentanchor = center size = { 40 40 }")}
}`);
    expectRect(root.children[0], 130, 80, 40, 40);
    expectRect(root.children[1], 130, 80, 40, 40);
  });

  it("B1-D: position is screen-space and widgets do not clip", () => {
    const root = lay(`
widget = {
	size = { 220 200 }
	${ICON("position = { 30 30 } size = { 20 20 }")}
	${ICON("parentanchor = bottom|right widgetanchor = bottom|right position = { -30 -30 } size = { 20 20 }")}
	${ICON("parentanchor = bottom|right widgetanchor = bottom|right position = { 30 30 } size = { 20 20 }")}
	${ICON("parentanchor = center position = { 40 0 } size = { 20 20 }")}
}`);
    expectRect(root.children[0], 30, 30, 20, 20);
    expectRect(root.children[1], 170, 150, 20, 20);
    expectRect(root.children[2], 230, 210, 20, 20); // outside the parent
    expectRect(root.children[3], 140, 90, 20, 20);
  });

  it("B1-H: nested offsets accumulate linearly", () => {
    const root = lay(`
widget = {
	size = { 200 110 }
	widget = {
		position = { 30 20 }
		size = { 100 60 }
		${ICON("position = { 10 10 } size = { 20 20 }")}
	}
}`);
    expectRect(root.children[0], 30, 20, 100, 60);
    expectRect(root.children[0].children[0], 40, 30, 20, 20);
  });
});

const TRIO = `
	${ICON("size = { 60 40 }")}
	${ICON("size = { 40 60 }")}
	${ICON("size = { 30 20 }")}`;

describe("batch 01: box fill + space-around", () => {
  it("B1-E1: hbox fills its widget parent, children space-around + cross-centered", () => {
    const root = lay(`widget = { size = { 180 120 } hbox = { ${TRIO} } }`);
    const box = root.children[0];
    expectRect(box, 0, 0, 180, 120);
    // free 50, side 50/6; measured 9/86/142 within raster tolerance
    expectRect(box.children[0], 50 / 6, 40, 60, 40);
    expectRect(box.children[1], 85, 30, 40, 60);
    expectRect(box.children[2], 425 / 3, 50, 30, 20);
  });

  it("B1-E2: spacing 8 adds inside the gaps", () => {
    const root = lay(`widget = { size = { 180 120 } hbox = { spacing = 8 ${TRIO} } }`);
    const box = root.children[0];
    expectRect(box.children[0], 34 / 6, 40, 60, 40);
    expectRect(box.children[1], 85, 30, 40, 60);
    expectRect(box.children[2], 433 / 3, 50, 30, 20);
  });

  it("B1-E3: margin = { 12 6 } is horizontal, vertical", () => {
    const root = lay(`widget = { size = { 180 120 } hbox = { margin = { 12 6 } ${TRIO} } }`);
    const box = root.children[0];
    expectRect(box.children[0], 12 + 26 / 6, 40, 60, 40);
    expectRect(box.children[1], 85, 30, 40, 60);
    expectRect(box.children[2], 401 / 3, 50, 30, 20);
  });

  it("B1-F1/F2: vbox mirrors the model vertically", () => {
    const plain = lay(`widget = { size = { 140 160 } vbox = { ${TRIO} } }`).children[0];
    expectRect(plain.children[0], 40, 40 / 6, 60, 40);
    expectRect(plain.children[1], 50, 60, 40, 60);
    expectRect(plain.children[2], 55, 400 / 3, 30, 20);

    const spaced = lay(`widget = { size = { 140 160 } vbox = { spacing = 8 ${TRIO} } }`).children[0];
    expectRect(spaced.children[0], 40, 4, 60, 40);
    expectRect(spaced.children[1], 50, 60, 40, 60);
    expectRect(spaced.children[2], 55, 136, 30, 20);
  });
});

describe("batch 02/03: box sizing rules", () => {
  it("B2-I1 + B3-P1: explicit size on a box is ignored, smaller or larger", () => {
    for (const size of ["{ 150 80 }", "{ 220 140 }"]) {
      const root = lay(
        `widget = { size = { 180 120 } hbox = { size = ${size} ${ICON("size = { 40 40 }")} } }`
      );
      expectRect(root.children[0], 0, 0, 180, 120);
      expectRect(root.children[0].children[0], 70, 40, 40, 40);
    }
  });

  it("B2-I2: a box inside a box hugs its content", () => {
    const root = lay(`
widget = { size = { 180 120 }
	vbox = {
		hbox = {
			${ICON("size = { 40 40 }")}
			${ICON("size = { 40 40 }")}
		}
	}
}`);
    const vbox = root.children[0];
    expectRect(vbox, 0, 0, 180, 120);
    const hbox = vbox.children[0];
    expectRect(hbox, 50, 40, 80, 40);
    expectRect(hbox.children[0], 50, 40, 40, 40); // packed, no residual gap
    expectRect(hbox.children[1], 90, 40, 40, 40);
  });

  it("B2-I3: position translates a stretched box", () => {
    const root = lay(
      `widget = { size = { 180 120 } hbox = { position = { 10 10 } ${ICON("size = { 40 40 }")} } }`
    );
    expectRect(root.children[0], 10, 10, 180, 120);
    expectRect(root.children[0].children[0], 80, 50, 40, 40);
  });

  it("B2-I4: container hugs children at the parent origin", () => {
    const root = lay(`
widget = { size = { 180 120 }
	container = {
		${ICON("position = { 10 10 } size = { 40 40 }")}
		${ICON("position = { 70 30 } size = { 40 40 }")}
	}
}`);
    const container = root.children[0];
    expectRect(container, 0, 0, 110, 70);
    expectRect(container.children[0], 10, 10, 40, 40);
    expectRect(container.children[1], 70, 30, 40, 40);
  });
});

describe("batch 02/03: layout policies", () => {
  it("B2-J1: expanding takes all free space, growing yields", () => {
    const root = lay(`
widget = { size = { 300 80 } hbox = {
	${ICON("size = { 40 40 }")}
	${ICON("layoutpolicy_horizontal = expanding size = { 40 40 }")}
	${ICON("layoutpolicy_horizontal = growing size = { 40 40 }")}
} }`);
    const box = root.children[0];
    expectRect(box.children[0], 0, 20, 40, 40);
    expectRect(box.children[1], 40, 20, 220, 40);
    expectRect(box.children[2], 260, 20, 40, 40);
  });

  it("B2-J2 + B3-P3: expanding children each get floor + free/k", () => {
    const equal = lay(`
widget = { size = { 300 80 } hbox = {
	${ICON("layoutpolicy_horizontal = expanding size = { 40 40 }")}
	${ICON("layoutpolicy_horizontal = expanding size = { 40 40 }")}
} }`).children[0];
    expectRect(equal.children[0], 0, 20, 150, 40);
    expectRect(equal.children[1], 150, 20, 150, 40);

    const uneven = lay(`
widget = { size = { 300 80 } hbox = {
	${ICON("layoutpolicy_horizontal = expanding size = { 40 40 }")}
	${ICON("layoutpolicy_horizontal = expanding size = { 100 40 }")}
} }`).children[0];
    expectRect(uneven.children[0], 0, 20, 120, 40);
    expectRect(uneven.children[1], 120, 20, 180, 40);
  });

  it("B2-J3 + B3-P4: deficit shrinks each shrinkable child by deficit/k", () => {
    const equal = lay(`
widget = { size = { 120 80 } hbox = {
	${ICON("layoutpolicy_horizontal = preferred size = { 80 40 }")}
	${ICON("layoutpolicy_horizontal = shrinking size = { 80 40 }")}
} }`).children[0];
    expectRect(equal.children[0], 0, 20, 60, 40);
    expectRect(equal.children[1], 60, 20, 60, 40);

    const uneven = lay(`
widget = { size = { 120 80 } hbox = {
	${ICON("layoutpolicy_horizontal = preferred size = { 100 40 }")}
	${ICON("layoutpolicy_horizontal = shrinking size = { 60 40 }")}
} }`).children[0];
    expectRect(uneven.children[0], 0, 20, 80, 40);
    expectRect(uneven.children[1], 80, 20, 40, 40);
  });

  it("B3-P2 + B4-T8: growing acts without expanding siblings; expand = {} spacer", () => {
    const growing = lay(`
widget = { size = { 300 80 } hbox = {
	${ICON("size = { 40 40 }")}
	${ICON("layoutpolicy_horizontal = growing size = { 40 40 }")}
} }`).children[0];
    expectRect(growing.children[0], 0, 20, 40, 40);
    expectRect(growing.children[1], 40, 20, 260, 40);

    const spacer = lay(`
widget = { size = { 200 80 } hbox = {
	${ICON("size = { 40 40 }")}
	expand = {}
	${ICON("size = { 40 40 }")}
} }`).children[0];
    expectRect(spacer.children[0], 0, 20, 40, 40);
    expectRect(spacer.children[2], 160, 20, 40, 40); // flush right
  });

  it("B4-T7: directional margin insets one side, distribution runs in the rest", () => {
    const root = lay(
      `widget = { size = { 180 120 } hbox = { margin_top = 30 ${ICON("size = { 40 40 }")} } }`
    );
    expectRect(root.children[0].children[0], 70, 55, 40, 40);
  });
});

describe("batch 02/03: flowcontainer, margin_widget, scrollarea", () => {
  const FIVE = `
	${ICON("size = { 50 30 }")}
	${ICON("size = { 50 30 }")}
	${ICON("size = { 50 30 }")}
	${ICON("size = { 50 30 }")}
	${ICON("size = { 50 30 }")}`;

  it("B2-K1 + B3-Q1: flow never wraps; explicit size only sets its own rect", () => {
    const bare = lay(`widget = { size = { 200 120 } flowcontainer = { ${FIVE} } }`).children[0];
    expectRect(bare, 0, 0, 250, 30);
    bare.children.forEach((c, i) => expectRect(c, i * 50, 0, 50, 30));

    const sized = lay(`widget = { size = { 200 120 } flowcontainer = { size = { 200 120 } ${FIVE} } }`)
      .children[0];
    expectRect(sized, 0, 0, 200, 120);
    sized.children.forEach((c, i) => expectRect(c, i * 50, 0, 50, 30)); // overflows
  });

  it("B2-K2/K3: vertical direction and spacing", () => {
    const vertical = lay(`widget = { size = { 200 120 } flowcontainer = { direction = vertical ${FIVE} } }`)
      .children[0];
    vertical.children.forEach((c, i) => expectRect(c, 0, i * 30, 50, 30));

    const spaced = lay(`widget = { size = { 200 120 } flowcontainer = { spacing = 10 ${FIVE} } }`)
      .children[0];
    spaced.children.forEach((c, i) => expectRect(c, i * 60, 0, 50, 30));
  });

  it("B3-Q2 + B4-T3: margin_widget offsets children, keeps its own rect", () => {
    const bare = lay(`
widget = { size = { 200 120 }
	margin_widget = { margin = { 20 10 } ${ICON("size = { 40 40 }")} }
}`).children[0];
    expectRect(bare.children[0], 20, 10, 40, 40);

    const full = lay(`
widget = { size = { 200 120 }
	margin_widget = { size = { 100% 100% } margin = { 20 10 } ${ICON("size = { 40 40 }")} }
}`).children[0];
    expectRect(full, 0, 0, 200, 120);
    expectRect(full.children[0], 20, 10, 40, 40);
  });

  it("B3-R1: scrollarea clips; content renders at the viewport origin", () => {
    const root = lay(`
widget = { size = { 200 120 }
	scrollarea = {
		size = { 200 120 }
		scrollwidget = {
			widget = {
				size = { 300 300 }
				${ICON("position = { 280 280 } size = { 20 20 }")}
			}
		}
	}
}`);
    const scroll = root.children[0];
    expect(scroll.clip).toBe(true);
    expectRect(scroll, 0, 0, 200, 120);
    expectRect(scroll.children[0], 0, 0, 300, 300);
    expectRect(scroll.children[0].children[0], 280, 280, 20, 20); // renderer clips it
  });
});

describe("batch 04: widget basics", () => {
  it("B4-T1: a sizeless widget has a zero rect, children still render", () => {
    const root = lay(`
widget = { size = { 180 120 }
	widget = { ${ICON("position = { 30 20 } size = { 40 40 }")} }
}`);
    expectRect(root.children[0], 0, 0, 0, 0);
    expectRect(root.children[0].children[0], 30, 20, 40, 40);
  });

  it("B4-T2: percent sizes resolve against the parent", () => {
    const root = lay(`widget = { size = { 200 120 } widget = { size = { 50% 50% } } }`);
    expectRect(root.children[0], 0, 0, 100, 60);
  });

  it("B4-T4: icon scale multiplies the rect, top-left anchored", () => {
    const root = lay(`
widget = { size = { 400 120 }
	${ICON("position = { 100 0 } size = { 40 40 } scale = 1.5")}
}`);
    expectRect(root.children[0], 100, 0, 60, 60);
  });
});

describe("text metrics (calibrated Gitan-Regular table)", () => {
  it("B1-G + B2-L: width = (n-1)*advance + ink", () => {
    const m10 = lay(`widget = { size = { 400 100 } text_single = { raw_text = "MMMMMMMMMM" } }`);
    expectRect(m10.children[0], 0, 0, 139, 21);
    const i10 = lay(`widget = { size = { 400 100 } text_single = { raw_text = "iiiiiiiiii" } }`);
    expectRect(i10.children[0], 0, 0, 40, 21);
    const m1 = lay(`widget = { size = { 400 100 } text_single = { raw_text = "M" } }`);
    expectRect(m1.children[0], 0, 0, 13, 21);
    const m2 = lay(`widget = { size = { 400 100 } text_single = { raw_text = "MM" } }`);
    expectRect(m2.children[0], 0, 0, 27, 21);
  });

  it("B3-S1: max_width clamps with elision", () => {
    const root = lay(
      `widget = { size = { 400 100 } text_single = { max_width = 60 raw_text = "MMMMMMMMMM" } }`
    );
    expect(root.children[0].rect.w).toBe(60);
  });

  it("B3-S2: multiline wraps at word boundaries, line advance 21", () => {
    const root = lay(`
widget = { size = { 400 100 }
	text_single = { multiline = yes max_width = 150 raw_text = "MMMM MMMM MMMM MMMM" }
}`);
    const t = root.children[0];
    expect(t.text?.lines).toEqual(["MMMM MMMM", "MMMM MMMM"]);
    expectRect(t, 0, 0, 115, 42);
  });

  it("B3-S3: metrics scale exactly linearly with fontsize", () => {
    const root = lay(`widget = { size = { 400 100 } text_single = { fontsize = 30 raw_text = "MMMMM" } }`);
    expectRect(root.children[0], 0, 0, 138, 42);
  });

  it("B2-L: vanilla text_multi carries its hardcoded 45x45", () => {
    const root = lay(
      `widget = { size = { 400 100 } text_multi = { max_width = 120 raw_text = "MMMM MMMM MMMM MMMM" } }`
    );
    expectRect(root.children[0], 0, 0, 45, 45);
  });

  it("B4-T6: align in a fixed box has zero padding; vcenter centers the line box", () => {
    const right = lay(`
widget = { size = { 400 100 }
	text_single = { size = { 150 40 } autoresize = no align = right|vcenter raw_text = "MM" }
}`).children[0];
    expectRect(right, 0, 0, 150, 40);
    expect(right.text?.offsetX).toBeCloseTo(123, 1); // measured ink at x 123
    expect(right.text?.offsetY).toBeCloseTo(9.5, 1);

    const center = lay(`
widget = { size = { 400 100 }
	text_single = { size = { 150 40 } autoresize = no align = center raw_text = "MM" }
}`).children[0];
    expect(center.text?.offsetX).toBeCloseTo(61.5, 1); // measured 62 (rounded)
  });
});

describe("template/type/blockoverride resolution", () => {
  it("instantiates a type with instance overrides winning", () => {
    const root = lay(`
types T {
	type my_box = widget {
		size = { 100 50 }
	}
}
widget = { size = { 300 200 }
	my_box = { position = { 10 10 } }
	my_box = { size = { 60 60 } }
}`);
    expectRect(root.children[0], 10, 10, 100, 50); // type size, instance position
    expectRect(root.children[1], 0, 0, 60, 60); // instance size wins
  });

  it("resolves type chains and inherits the base behavior class", () => {
    const root = lay(`
types T {
	type base_box = hbox {
		${ICON("size = { 40 40 }")}
	}
	type derived_box = base_box { }
}
widget = { size = { 180 120 } derived_box = {} }`);
    // derived -> base -> hbox: fills the widget parent like any box
    expectRect(root.children[0], 0, 0, 180, 120);
    expectRect(root.children[0].children[0], 70, 40, 40, 40);
  });

  it("splices templates via using =", () => {
    const root = lay(`
template Deco {
	size = { 80 40 }
	background = { texture = "bg.dds" color = { 0.2 0.2 0.2 1 } }
}
widget = { size = { 300 200 }
	widget = { using = Deco position = { 5 5 } }
}`);
    const child = root.children[0];
    expectRect(child, 5, 5, 80, 40);
    expect(child.bg?.color).toEqual([0.2, 0.2, 0.2, 1]);
  });

  it("block declares a slot, blockoverride fills or blanks it", () => {
    const root = lay(`
types T {
	type card = widget {
		size = { 200 100 }
		block "content" {
			${ICON("size = { 20 20 }")}
		}
	}
}
widget = { size = { 700 300 }
	card = {}
	card = { blockoverride "content" { ${ICON("size = { 50 50 }")} } }
	card = { blockoverride "content" {} }
}`);
    const [plain, filled, blanked] = root.children;
    expect(plain.children).toHaveLength(1);
    expectRect(plain.children[0], 0, 0, 20, 20);
    expect(filled.children).toHaveLength(1);
    expectRect(filled.children[0], 0, 0, 50, 50);
    expect(blanked.children).toHaveLength(0);
  });

  it("blockoverride reaches blocks nested deep in the type's subtree", () => {
    const root = lay(`
types T {
	type panel = widget {
		size = { 200 100 }
		widget = {
			size = { 100 100 }
			block "slot" {
				${ICON("size = { 10 10 }")}
			}
		}
	}
}
widget = { size = { 400 300 }
	panel = { blockoverride "slot" { ${ICON("size = { 30 30 }")} } }
}`);
    const inner = root.children[0].children[0];
    expectRect(inner.children[0], 0, 0, 30, 30);
  });

  it("guards against self-referencing types instead of hanging", () => {
    const root = lay(`
types T {
	type loop_box = loop_box { size = { 40 40 } }
}
widget = { size = { 200 100 } loop_box = {} }`);
    expectRect(root.children[0], 0, 0, 40, 40);
  });

  it("merges stores FIOS: first definition wins, locals stay file-local", () => {
    const first = collectGuiDefs(`
template Shared { size = { 10 10 } }
local_template Mine { size = { 1 1 } }
types A { type thing = widget { size = { 11 11 } } }`);
    const second = collectGuiDefs(`
template Shared { size = { 99 99 } }
types B { type thing = widget { size = { 99 99 } } }`);
    const store = emptyGuiDefs();
    mergeGuiDefs(store, first);
    mergeGuiDefs(store, second);
    expect(store.templates.get("Shared")!.block).toBe(first.templates.get("Shared")!.block);
    expect(store.templates.has("Mine")).toBe(false); // local never crosses files
    expect(store.types.get("thing")!.block).toBe(first.types.get("thing")!.block);

    const root = lay(`widget = { size = { 300 200 } thing = {} using = Shared }`, 300, 200);
    void root;
    const viaStore = computeGuiLayout(`widget = { size = { 300 200 } thing = {} }`, {
      defs: store,
    })[0];
    expectRect(viaStore.children[0], 0, 0, 11, 11);
  });

  it.skipIf(!devPath("gamePath"))(
    "vanilla store: text_single resolves through the real preload types",
    () => {
      const guiDir = path.join(devPath("gamePath")!, "gui");
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) walk(p);
          else if (e.name.endsWith(".gui")) files.push(p);
        }
      };
      walk(guiDir);
      files.sort();
      const store = emptyGuiDefs();
      for (const f of files) mergeGuiDefs(store, collectGuiDefs(fs.readFileSync(f, "utf8")));
      expect(store.types.has("text_single")).toBe(true);
      expect(store.templates.has("Window_Background")).toBe(true);

      // The real definitions must reproduce the calibrated measurements:
      // autoresize=yes + Font_Size_Small, NOT the template's size = { 0 23 }.
      const root = computeGuiLayout(
        `widget = { size = { 400 100 } text_single = { raw_text = "MMMMMMMMMM" } }`,
        { defs: store, viewport: { w: 400, h: 100 } }
      )[0];
      expectRect(root.children[0], 0, 0, 139, 21);
    }
  );

  it.skipIf(!devPath("gamePath"))(
    "vanilla datamodel window: ghosts appear and the node count stays bounded",
    () => {
      const guiDir = path.join(devPath("gamePath")!, "gui");
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) walk(p);
          else if (e.name.endsWith(".gui")) files.push(p);
        }
      };
      walk(guiDir);
      files.sort();
      const store = emptyGuiDefs();
      for (const f of files) mergeGuiDefs(store, collectGuiDefs(fs.readFileSync(f, "utf8")));

      // window_character.gui drives several datamodel lists (GetSkills,
      // GetTimedModifiers, portrait families) -> ghost rows must materialize.
      const text = fs.readFileSync(path.join(guiDir, "window_character.gui"), "utf8");
      const nodes = computeGuiLayout(text, { defs: store, viewport: { w: 1920, h: 1080 } });
      let total = 0;
      let ghosts = 0;
      const visit = (n: LayoutNode) => {
        total++;
        if (n.ghost) ghosts++;
        n.children.forEach(visit);
      };
      nodes.forEach(visit);
      expect(ghosts).toBeGreaterThan(0);
      // GHOST_COUNT (3) copies per list, capped, must not explode the tree even
      // with nested datamodels — guards the preview's per-keystroke budget.
      // window_character (the heaviest vanilla case) measures ~13.5k nodes.
      expect(total).toBeLessThan(20000);
    }
  );
});

// Phase 2 (Stream C): presentation / deterministic additions. These are NOT
// calibrated pixel truth — datamodel and state cases assert structure only
// (documented unmeasured in spec.md); nine-slice geometry is exact math.
describe("phase 2: datamodel list placeholders (unmeasured presentation)", () => {
  it("stamps GHOST_COUNT ghost copies of the item template, stacked per policy", () => {
    const root = lay(`
widget = { size = { 200 400 }
	vbox = {
		datamodel = "[Window.GetItems]"
		item = {
			${ICON("size = { 40 30 }")}
		}
	}
}`);
    const box = root.children[0];
    expect(box.children).toHaveLength(GHOST_COUNT);
    for (const c of box.children) {
      expect(c.ghost).toBe(true);
      expect(c.editable).toBe(false); // synthetic placeholders are never editable
    }
    // vbox stacks the ghosts along y in order (structural, not a pixel rule).
    const ys = box.children.map((c) => c.rect.y);
    expect(ys[0]).toBeLessThan(ys[1]);
    expect(ys[1]).toBeLessThan(ys[2]);
    box.children.forEach((c) => expect(c.rect.h).toBeCloseTo(30, 0));
  });

  it("caps ghosts to the container's own explicit size when known", () => {
    const root = lay(`
widget = { size = { 500 500 }
	vbox = {
		size = { 100 50 }
		datamodel = "[X]"
		item = { ${ICON("size = { 40 30 }")} }
	}
}`);
    // authored vbox height 50, item height 30 -> floor(50/30) = 1 ghost row.
    expect(root.children[0].children).toHaveLength(1);
    expect(root.children[0].children[0].ghost).toBe(true);
  });
});

describe("phase 2: nine-slice spriteborder (deterministic geometry)", () => {
  it("carries border geometry from a background block", () => {
    const root = lay(`
widget = { size = { 100 100 }
	background = { texture = "bg.dds" spriteborder = { 18 18 } }
}`);
    expect(root.bg?.border).toEqual([18, 18, 18, 18]);
  });

  it("per-side overrides win over the { x y } pair", () => {
    const root = lay(`
widget = { size = { 100 100 }
	background = { texture = "bg.dds" spriteborder = { 10 20 } spriteborder_top = 5 }
}`);
    expect(root.bg?.border).toEqual([10, 5, 10, 20]); // [l, t, r, b]
  });

  it("a widget's own textured fill carries the border", () => {
    const root = lay(`
widget = { size = { 200 100 }
	icon = { size = { 40 40 } texture = "x.dds" spriteborder = { 4 6 } }
}`);
    expect(root.children[0].fill?.border).toEqual([4, 6, 4, 6]);
  });

  it("computeNineSlice: exact 9 regions, corners 1:1, edges/center stretched", () => {
    const regions = computeNineSlice({ x: 10, y: 20, w: 200, h: 100 }, [8, 8, 8, 8], 40, 30);
    expect(regions).toHaveLength(9);
    // top-left corner drawn unscaled
    expect(regions[0]).toEqual({ sx: 0, sy: 0, sw: 8, sh: 8, dx: 10, dy: 20, dw: 8, dh: 8 });
    // center stretched on both axes (src 24x14 -> dst 184x84)
    expect(regions[4]).toEqual({ sx: 8, sy: 8, sw: 24, sh: 14, dx: 18, dy: 28, dw: 184, dh: 84 });
    // bottom-right corner unscaled, pinned to the far edge
    expect(regions[8]).toEqual({ sx: 32, sy: 22, sw: 8, sh: 8, dx: 202, dy: 112, dw: 8, dh: 8 });
  });

  it("computeNineSlice: borders clamp so opposite sides never overlap", () => {
    // border wider than half the rect: sides clamp, center collapses (dropped).
    const regions = computeNineSlice({ x: 0, y: 0, w: 10, h: 10 }, [8, 8, 8, 8], 40, 40);
    for (const r of regions) {
      expect(r.dw).toBeGreaterThan(0);
      expect(r.dh).toBeGreaterThan(0);
    }
    const totalW = regions.filter((r) => r.dy === 0).reduce((a, r) => a + r.dw, 0);
    expect(totalW).toBeLessThanOrEqual(10); // never overruns the rect
  });
});

describe("phase 2: state blocks excluded from layout", () => {
  it("base position/size win; state deltas never leak into the rect", () => {
    const root = lay(`
widget = { size = { 300 200 }
	icon = {
		position = { 10 10 }
		size = { 40 40 }
		texture = "x.dds"
		state = {
			name = hover
			position = { 999 999 }
			size = { 5 5 }
			alpha = 0
		}
	}
}`);
    const icon = root.children[0];
    expectRect(icon, 10, 10, 40, 40); // base values, not the state's 999 / 5
    expect(icon.fill?.texture).toBe("x.dds");
    expect(icon.children).toHaveLength(0); // state is not a child widget
  });
});

/**
 * `srcIndex` is the widget's index in the WRITER's sibling list
 * (`sourceModel.ts` `GuiBody.children`), which is what a reorder/insert/delete
 * op counts. The two lists are ranked from one shared marker set, so this is
 * where they are held to each other: a client that counted the widgets it can
 * see would be off by one per declaration between them.
 */
describe("source indices address the writer's own sibling list", () => {
  it("a blockoverride between two children takes a slot the preview cannot see", () => {
    const root = lay(`
widget = {
	size = { 300 200 }
	name = "px_srcindex_root"
	widget = { name = "px_first" size = { 10 10 } }
	blockoverride "slot_a" {}
	widget = { name = "px_second" size = { 10 10 } }
	blockoverride = "slot_b" {}
	widget = { name = "px_third" size = { 10 10 } }
}`);
    // 0, 2, 4: the two blockoverrides (the marker form and the tagged-block
    // form vanilla also writes) each hold a slot, and `name` / `size` do not.
    expect(root.children.map((c) => c.srcIndex)).toEqual([0, 2, 4]);
    expect(root.srcIndex).toBe(0);
  });

  it("nothing without an addressable slot carries one", () => {
    const defs = collectGuiDefs(`
types PxIdxTypes {
	type px_idx_card = widget {
		size = { 40 40 }
		widget = { name = "px_idx_spliced" size = { 5 5 } }
	}
}`);
    const nodes = computeGuiLayout(
      `
types PxIdxLocal {}
window = {
	size = { 300 200 }
	px_idx_card = { name = "px_idx_use" }
	scrollarea = {
		size = { 100 100 }
		scrollwidget = {
			widget = { name = "px_idx_scrolled" size = { 5 5 } }
		}
	}
}`,
      { viewport: { w: 1000, h: 1000 }, defs }
    );
    // The root's own list counts the `types` declaration, so the window is 1.
    expect(nodes[0].srcIndex).toBe(1);
    const [use, scroll] = nodes[0].children;
    expect(use.srcIndex).toBe(0);
    expect(scroll.srcIndex).toBe(1);
    // Spliced from the type: no statement here, so no index names it.
    expect(use.children[0].name).toBe("px_idx_spliced");
    expect(use.children[0].srcIndex).toBeUndefined();
    // Adopted from the scrollwidget: its rank counts a body the scrollarea
    // does not own, so the wire carries none rather than a wrong one.
    expect(scroll.children[0].name).toBe("px_idx_scrolled");
    expect(scroll.children[0].srcIndex).toBeUndefined();
  });
});

describe("render info", () => {
  it("extracts background and icon fills with raw color values", () => {
    const root = lay(`
widget = {
	size = { 100 100 }
	background = { texture = "gfx/interface/colors/white.dds" color = { 0.2 0.2 0.2 1 } }
	icon = { size = { 40 40 } texture = "gfx/interface/colors/white.dds" color = { 1 0 0 0.5 } }
}`);
    expect(root.bg?.color).toEqual([0.2, 0.2, 0.2, 1]);
    expect(root.children[0].fill?.color).toEqual([1, 0, 0, 0.5]);
    expect(root.children[0].fill?.texture).toBe("gfx/interface/colors/white.dds");
  });
});
