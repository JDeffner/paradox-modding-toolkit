/**
 * GUI widget tree (ck3.showGuiTree): PdxGui hierarchy extraction — widgets vs
 * attribute blocks, template/type declaration headers, names, using refs,
 * states — plus a vanilla-gated sweep over the real hud.gui.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { buildGuiTree } from "../src/features/guiTree";
import { devPath } from "../../../scripts/devPaths";

const FIXTURE = `
widget = {
	size = { 100% 100% }
	name = "meta_info"
	visible = "[IsDefaultGUIMode]"
	using = Animation_ShowHide_Standard

	flowcontainer = {
		name = "observer_status"
		position = { 180 -110 }

		background = {
			using = Background_Area_Dark
		}
		text_single = {
			name = "global_observer_indication"
		}
		icon_observer = {
			size = { 30 30 }
		}
		state = {
			name = _show
			duration = 0.2
		}
	}
}

template MyTemplate {
	icon = {
		size = { 10 10 }
	}
}

types MyTypes {
	type my_button = button {
		name = "b"
	}
}
`;

describe("buildGuiTree", () => {
  const tree = buildGuiTree(FIXTURE);

  it("extracts the widget hierarchy with names and using refs", () => {
    const root = tree.nodes[0];
    expect(root.key).toBe("widget");
    expect(root.name).toBe("meta_info");
    expect(root.using).toEqual(["Animation_ShowHide_Standard"]);
    const flow = root.children[0];
    expect(flow.key).toBe("flowcontainer");
    expect(flow.name).toBe("observer_status");
    expect(flow.children.map((c) => c.key)).toEqual(["background", "text_single", "icon_observer", "state"]);
  });

  it("attribute blocks (size, position) are not nodes; custom types are", () => {
    const flow = tree.nodes[0].children[0];
    expect(flow.children.some((c) => c.key === "position")).toBe(false);
    const custom = flow.children.find((c) => c.key === "icon_observer")!;
    expect(custom.kind).toBe("widget");
    expect(custom.children).toHaveLength(0); // its size block is an attribute
  });

  it("states render as state nodes", () => {
    const state = tree.nodes[0].children[0].children.find((c) => c.key === "state")!;
    expect(state.kind).toBe("state");
    expect(state.name).toBe("_show");
  });

  it("template/types/type headers become declarations", () => {
    const tpl = tree.nodes.find((n) => n.key === "template MyTemplate")!;
    expect(tpl.kind).toBe("decl");
    expect(tpl.children.map((c) => c.key)).toEqual(["icon"]);
    const types = tree.nodes.find((n) => n.key === "types MyTypes")!;
    expect(types.kind).toBe("decl");
    const typeDecl = types.children[0];
    expect(typeDecl.key).toBe("type my_button");
    expect(typeDecl.base).toBe("button");
    expect(typeDecl.name).toBe("b");
  });

  it("lines point at the widget keys", () => {
    expect(tree.nodes[0].line).toBe(1);
    const flow = tree.nodes[0].children[0];
    expect(FIXTURE.split("\n")[flow.line]).toContain("flowcontainer");
  });

  it("counts every node", () => {
    // widget, flowcontainer, background, text_single, icon_observer, state,
    // template, icon, types, type = 10
    expect(tree.count).toBe(10);
  });
});

describe.skipIf(!devPath("gamePath"))("buildGuiTree on vanilla hud.gui", () => {
  it("parses the real HUD without errors and finds a substantial tree", () => {
    const file = path.join(devPath("gamePath")!, "gui", "hud.gui");
    const text = fs.readFileSync(file, "utf8");
    const tree = buildGuiTree(text);
    expect(tree.count).toBeGreaterThan(50);
    // Every node's line must be within the file.
    const lines = text.split("\n").length;
    const check = (nodes: typeof tree.nodes) => {
      for (const n of nodes) {
        expect(n.line).toBeGreaterThanOrEqual(0);
        expect(n.line).toBeLessThan(lines);
        check(n.children);
      }
    };
    check(tree.nodes);
  });
});
