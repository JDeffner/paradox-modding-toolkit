/**
 * The GUI editor's selection logic, as pure modules: hit-testing, the
 * tie-breaks, Alt-cycling, the tree rows and the positional path that carries a
 * selection across a re-parse.
 *
 * These are the click cases a mouse can produce, asserted without a mouse. The
 * jsdom smoke (guiEditorSmoke.test.ts) proves the shell wires them up; this
 * file proves they are right.
 *
 * The inspector's own arithmetic is at the end, for the same reason: how a
 * block value splits into rows and comes back as one line, how much of a value
 * a display mode shows, and which property names an add-property row may offer
 * are all decisions with a right answer and no DOM in them.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import type { GuiLayoutNode } from "@px-lsp/protocol/protocol";
import { computeGuiLayoutResult } from "../../server/src/gui/layoutService";
import { buildScene, type Scene } from "../src/webviews/guiEditor/app/scene";
import { hitRect, hitStack, marqueeHits, nextInStack } from "../src/webviews/guiEditor/app/hitTest";
import {
  indexOfSelection,
  outermost,
  selectionAt,
  toggleSelected,
} from "../src/webviews/guiEditor/app/selection";
import { ancestorKeys, rowKey, treeRows } from "../src/webviews/guiEditor/app/tree";
import {
  abbreviate,
  ABBREVIATED_MAX,
  blockEntries,
  composeBlock,
  originLabel,
  propertyChoices,
} from "../src/webviews/guiEditor/app/inspector";

const FIXTURES = path.join(__dirname, "..", "..", "server", "test", "fixtures", "gui", "layout");

function node(
  key: string,
  rect: [number, number, number, number],
  children: GuiLayoutNode[] = [],
  extra: Partial<GuiLayoutNode> = {}
): GuiLayoutNode {
  return {
    key,
    rect: { x: rect[0], y: rect[1], w: rect[2], h: rect[3] },
    clip: false,
    positioned: true,
    editable: true,
    children,
    ...extra,
  };
}

function labels(scene: Scene, stack: readonly number[]): string[] {
  return stack.map((i) => scene.items[i].name ?? scene.items[i].key);
}

describe("hit-testing: the smallest rect under the cursor wins", () => {
  const scene = buildScene([
    node(
      "widget",
      [0, 0, 400, 300],
      [
        node(
          "hbox",
          [0, 0, 400, 300],
          [
            node("icon", [10, 10, 40, 40], [], { name: "small" }),
            node("widget", [100, 10, 200, 200], [], { name: "medium" }),
          ]
        ),
      ]
    ),
  ]);

  it("nested widgets come back innermost first", () => {
    expect(labels(scene, hitStack(scene, 20, 20))).toEqual(["small", "hbox", "widget"]);
  });

  it("a point inside only the outer widget picks the outer one", () => {
    expect(labels(scene, hitStack(scene, 350, 250))).toEqual(["hbox", "widget"]);
  });

  it("an empty canvas is an empty stack, which is what clears the selection", () => {
    expect(hitStack(scene, 900, 900)).toEqual([]);
    expect(nextInStack([], 3)).toBeNull();
  });

  it("a smaller rect wins even when it is drawn under a bigger one", () => {
    // The medium widget is painted after the icon but is larger, so a click in
    // the icon still picks the icon.
    expect(labels(scene, hitStack(scene, 45, 45))[0]).toBe("small");
  });
});

describe("a marquee catches what is entirely inside it", () => {
  const scene = buildScene([
    node(
      "widget",
      [0, 0, 400, 300],
      [
        node("icon", [10, 10, 40, 40], [], { name: "inside" }),
        node("icon", [200, 10, 40, 40], [], { name: "outside" }),
        node("icon", [20, 20, 0, 0], [], { name: "empty" }),
      ]
    ),
  ]);

  it("takes the contained widgets and leaves the crossed ones", () => {
    // The band covers the first icon and cuts the second: intersection would
    // take both, and the parent that the band merely overlaps as well.
    expect(labels(scene, marqueeHits(scene, { x: 0, y: 0, w: 100, h: 100 }))).toEqual(["inside"]);
  });

  it("takes an ancestor and its children when the band holds all of them", () => {
    // Both come back; dropping the ones inside a selected ancestor is the
    // selection's own job (`outermost`), not the hit-test's.
    expect(labels(scene, marqueeHits(scene, { x: -10, y: -10, w: 500, h: 400 }))).toEqual([
      "widget",
      "inside",
      "outside",
    ]);
  });

  it("skips what the eye, the lock or the focus took out", () => {
    const skip = new Uint8Array(scene.items.length);
    skip[1] = 1;
    expect(marqueeHits(scene, { x: 0, y: 0, w: 100, h: 100 }, skip)).toEqual([]);
  });
});

describe("a selection of several widgets", () => {
  it("shift+click adds, re-clicks the primary to remove, and promotes the rest", () => {
    expect(toggleSelected([], 3)).toEqual([3]);
    expect(toggleSelected([3], 7)).toEqual([3, 7]);
    // The last entry is the primary: clicking it takes it back out.
    expect(toggleSelected([3, 7], 7)).toEqual([3]);
    // Clicking a member that is NOT the primary makes it one, because a click
    // always ends with the panels talking about the widget that was clicked.
    expect(toggleSelected([3, 7, 9], 3)).toEqual([7, 9, 3]);
  });

  it("drops a member that is inside another member", () => {
    const scene = buildScene([
      node("widget", [0, 0, 400, 300], [node("icon", [10, 10, 40, 40], [], { name: "child" })]),
    ]);
    // Moving both would shift the child twice, and deleting both is one delete.
    expect(outermost(scene, [0, 1])).toEqual([0]);
    expect(outermost(scene, [1])).toEqual([1]);
  });
});

describe("hit-testing: tree depth breaks an equal-area tie", () => {
  // The measured Studio fix: an anchored box that exactly fills its parent has
  // the same area as it, and the DEEPER one has to win or the box swallows
  // every click meant for the child that gave it that size.
  const scene = buildScene([
    node(
      "widget",
      [0, 0, 200, 100],
      [
        node("hbox", [0, 0, 200, 100], [node("vbox", [0, 0, 200, 100], [], { name: "deepest" })], {
          name: "middle",
        }),
      ]
    ),
  ]);

  it("the deepest of three identical rects is picked first", () => {
    expect(labels(scene, hitStack(scene, 50, 50))).toEqual(["deepest", "middle", "widget"]);
  });

  it("equal area AND equal depth falls back to what is painted on top", () => {
    const overlap = buildScene([
      node(
        "widget",
        [0, 0, 100, 100],
        [
          node("widget", [0, 0, 50, 50], [], { name: "under" }),
          node("widget", [0, 0, 50, 50], [], { name: "over" }),
        ]
      ),
    ]);
    expect(labels(overlap, hitStack(overlap, 10, 10))[0]).toBe("over");
  });
});

describe("Alt+click cycles the stack and wraps", () => {
  const scene = buildScene([
    node(
      "widget",
      [0, 0, 300, 300],
      [node("hbox", [0, 0, 200, 200], [node("icon", [0, 0, 100, 100], [], { name: "inner" })])]
    ),
  ]);
  const stack = hitStack(scene, 10, 10);

  it("each Alt+click steps one level out, then wraps to the innermost", () => {
    let current = nextInStack(stack, null);
    expect(scene.items[current!].name).toBe("inner");
    current = nextInStack(stack, current);
    expect(scene.items[current!].key).toBe("hbox");
    current = nextInStack(stack, current);
    expect(scene.items[current!].key).toBe("widget");
    current = nextInStack(stack, current);
    expect(scene.items[current!].name).toBe("inner");
  });

  it("a selection that is not under the cursor restarts the cycle", () => {
    expect(nextInStack(stack, 999)).toBe(stack[0]);
  });
});

describe("hit-testing respects what the canvas actually draws", () => {
  it("a clipped-away descendant is not under the cursor", () => {
    const scene = buildScene([
      node("scrollarea", [0, 0, 100, 100], [node("widget", [0, 0, 400, 400], [], { name: "long" })], {
        clip: true,
      }),
    ]);
    expect(labels(scene, hitStack(scene, 50, 50))).toEqual(["long", "scrollarea"]);
    // Past the viewport the child is clipped away, so nothing is there.
    expect(hitStack(scene, 200, 200)).toEqual([]);
  });

  it("an unmeasurable container is clicked on its L11b estimate box", () => {
    const scene = buildScene([
      node("container", [10, 10, 0, 0], [node("widget", [10, 10, 0, 0], [], { name: "kid" })], {
        name: "unmeasurable",
      }),
    ]);
    const item = scene.items[0];
    expect(hitRect(item)).toEqual({ x: 10, y: 10, w: 40, h: 40 });
    expect(labels(scene, hitStack(scene, 20, 20))).toEqual(["unmeasurable"]);
  });
});

describe("the selection is a positional path, so it survives a re-parse", () => {
  const before = buildScene([
    node(
      "widget",
      [0, 0, 300, 300],
      [
        node("icon", [0, 0, 50, 50], [], { name: "first" }),
        node("icon", [60, 0, 50, 50], [], { name: "second" }),
      ]
    ),
  ]);
  const selection = selectionAt(before, 2)!;

  it("names the widget by child indices from the root", () => {
    expect(selection).toEqual({ path: [0, 1], key: "icon", name: "second" });
  });

  it("a property edit that only moves the rect keeps the selection", () => {
    const after = buildScene([
      node(
        "widget",
        [0, 0, 300, 300],
        [
          node("icon", [0, 0, 50, 50], [], { name: "first" }),
          node("icon", [120, 40, 50, 50], [], { name: "second" }),
        ]
      ),
    ]);
    expect(indexOfSelection(after, selection)).toBe(2);
  });

  it("a rename clears it rather than risk pointing at a different widget", () => {
    // A delete leaves the next sibling at the same path with the same key, so
    // path+key alone cannot tell a rename from a delete. Clearing is the answer
    // that cannot be wrong; the case below is the one it protects.
    const after = buildScene([
      node(
        "widget",
        [0, 0, 300, 300],
        [
          node("icon", [0, 0, 50, 50], [], { name: "first" }),
          node("icon", [60, 0, 50, 50], [], { name: "renamed" }),
        ]
      ),
    ]);
    expect(indexOfSelection(after, selection)).toBeNull();
  });

  it("deleting the widget ABOVE it does not hand the selection to a stranger", () => {
    const after = buildScene([
      node("widget", [0, 0, 300, 300], [node("icon", [0, 0, 50, 50], [], { name: "second" })]),
    ]);
    // The survivor sits at path [0,0] now; key+name still name it, so the
    // sibling rule finds it and nothing else could be mistaken for it.
    expect(indexOfSelection(after, selection)).toBe(1);
  });

  it("a widget inserted ABOVE it is found again among its siblings", () => {
    const after = buildScene([
      node(
        "widget",
        [0, 0, 300, 300],
        [
          node("icon", [0, 0, 50, 50], [], { name: "inserted" }),
          node("icon", [0, 0, 50, 50], [], { name: "first" }),
          node("icon", [60, 0, 50, 50], [], { name: "second" }),
        ]
      ),
    ]);
    expect(indexOfSelection(after, selection)).toBe(3);
  });

  it("deleting the selected widget clears the selection instead of picking a stranger", () => {
    const after = buildScene([
      node("widget", [0, 0, 300, 300], [node("hbox", [0, 0, 50, 50], [], { name: "other" })]),
    ]);
    expect(indexOfSelection(after, selection)).toBeNull();
  });
});

describe("the tree is the same scene, in the same order", () => {
  const nodes = [
    node(
      "widget",
      [0, 0, 300, 300],
      [
        node("icon", [0, 0, 50, 50], [], { name: "own" }),
        node("icon", [60, 0, 50, 50], [], { name: "spliced", editable: false }),
        node("item", [0, 60, 50, 50], [], { name: "row", ghost: true }),
      ]
    ),
  ];
  const scene = buildScene(nodes);

  it("a row and a drawn rect are the same index, so selection is two-way for free", () => {
    const rows = treeRows(scene, new Set());
    expect(rows.map((r) => r.index)).toEqual([0, 1, 2, 3]);
    expect(rows.map((r) => r.name)).toEqual([undefined, "own", "spliced", "row"]);
  });

  it("template-expanded nodes are marked synthetic and ghosts are marked ghost", () => {
    const rows = treeRows(scene, new Set());
    expect(rows.map((r) => r.synthetic)).toEqual([false, false, true, false]);
    expect(rows.map((r) => r.ghost)).toEqual([false, false, false, true]);
  });

  it("a collapsed row hides its whole subtree", () => {
    const rows = treeRows(scene, new Set([rowKey([0])]));
    expect(rows).toHaveLength(1);
    expect(rows[0].collapsed).toBe(true);
    expect(rows[0].hasChildren).toBe(true);
  });

  it("ancestors of a row are the keys a selection has to expand", () => {
    expect(ancestorKeys(scene, 3)).toEqual([rowKey([0])]);
    expect(ancestorKeys(scene, 0)).toEqual([]);
  });
});

describe("over a real fixture", () => {
  const result = computeGuiLayoutResult(
    fs.readFileSync(path.join(FIXTURES, "templates-types.gui"), "utf8"),
    null,
    null
  );
  const scene = buildScene(result.nodes);

  it("clicking a type instance picks it, not the frame it sits in", () => {
    const card = scene.items.find((i) => i.name === "px_card_positioned")!;
    const stack = hitStack(scene, card.rect.x + 1, card.rect.y + 1);
    expect(scene.items[stack[0]].name).toBe("px_card_positioned");
  });

  it("a template-spliced child of a type is in the tree as synthetic", () => {
    const rows = treeRows(scene, new Set());
    const kid = rows.find((r) => r.name === "px_row_kid");
    expect(kid).toBeDefined();
    expect(kid!.synthetic).toBe(true);
  });

  it("every scene item has a path that resolves back to itself", () => {
    for (let i = 0; i < scene.items.length; i++) {
      expect(indexOfSelection(scene, selectionAt(scene, i)!)).toBe(i);
    }
  });
});

describe("origin labels read as a chain, innermost first", () => {
  it("names the definition a value was spliced through", () => {
    expect(originLabel([])).toBe("");
    expect(originLabel([{ kind: "template", name: "PxDeco" }])).toBe("template PxDeco");
    expect(
      originLabel([
        { kind: "template", name: "PxDeco" },
        { kind: "type", name: "px_card" },
      ])
    ).toBe("template PxDeco in type px_card");
  });
});

describe("a block value splits into rows and comes back as one line", () => {
  it("reads a block of assignments, quotes and nesting included", () => {
    expect(blockEntries("{ using = Background_Area_Dark alpha = 0.7 }")).toEqual([
      { key: "using", value: "Background_Area_Dark" },
      { key: "alpha", value: "0.7" },
    ]);
    expect(blockEntries('{ texture = "gfx/a b.dds" color = { 1 1 1 1 } }')).toEqual([
      { key: "texture", value: '"gfx/a b.dds"' },
      { key: "color", value: "{ 1 1 1 1 }" },
    ]);
  });

  it("refuses everything it could not put back byte for byte", () => {
    // A bare pair is the geometry rows, and they keep their plain input.
    expect(blockEntries("{ 10 10 }")).toBeNull();
    expect(blockEntries("0.5")).toBeNull();
    expect(blockEntries("{ }")).toBeNull();
    // A comment has a place in the file that a recomposed line would lose.
    expect(blockEntries("{ alpha = 0.7 # the dim one\n }")).toBeNull();
    // Half a pair is not a pair.
    expect(blockEntries("{ using = }")).toBeNull();
    expect(blockEntries("{ using }")).toBeNull();
  });

  it("recomposes the rows it was given, and only those", () => {
    const entries = blockEntries("{ using = Background_Area_Dark alpha = 0.7 }")!;
    expect(composeBlock(entries)).toBe("{ using = Background_Area_Dark alpha = 0.7 }");
    expect(composeBlock(entries.filter((e) => e.key !== "using"))).toBe("{ alpha = 0.7 }");
    expect(composeBlock([...entries, { key: "frame", value: "2" }])).toBe(
      "{ using = Background_Area_Dark alpha = 0.7 frame = 2 }"
    );
    // A row whose key was blanked is a row the user removed.
    expect(composeBlock([{ key: "  ", value: "1" }])).toBe("{ }");
  });
});

describe("what the inspector shows and offers", () => {
  it("abbreviates only what does not fit, and never silently shortens a short value", () => {
    expect(abbreviate("{ 10 10 }")).toBe("{ 10 10 }");
    const long = "{ using = Background_Area_Dark alpha = 0.7 }";
    expect(abbreviate(long)).toHaveLength(ABBREVIATED_MAX);
    expect(abbreviate(long).endsWith("…")).toBe(true);
    expect(long.startsWith(abbreviate(long).slice(0, -1))).toBe(true);
  });

  it("offers this widget's own type before the tree-wide ranking, and never a row it has", () => {
    const properties = { icon: ["texture", "frame"], widget: ["visible", "texture"] };
    const common = ["name", "tooltip", "visible"];
    const taken = new Set(["frame"]);
    // The chain innermost first: the widget's own key outranks the base.
    expect(propertyChoices(["icon", "widget"], properties, common, taken, "")).toEqual([
      "texture",
      "visible",
      "name",
      "tooltip",
    ]);
    // A type the harvest never saw still gets the fallback ranking.
    expect(propertyChoices(["px_card"], properties, common, taken, "")).toEqual([
      "name",
      "tooltip",
      "visible",
    ]);
    expect(propertyChoices(["icon"], properties, common, taken, "tex")).toEqual(["texture"]);
    expect(propertyChoices(["icon"], properties, common, new Set(["texture", "frame"]), "fra")).toEqual([]);
  });
});
