/**
 * PdxDoc doc comments (§E): block attach/detach, separator skipping, tag
 * parsing, prose cap, BOM/CRLF handling, and the three surfacing paths
 * (hover render, completion documentation, signature-help param alignment).
 */
import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { docForDefinition, parseDocBlock, PROSE_CAP } from "../src/index/docComments";
import { extractDefinitions } from "../src/index/extract";
import { renderDocBody } from "../src/features/hoverRender";
import { provideHover } from "../src/features/hover";
import { provideSignatureHelp } from "../src/features/signatureHelp";
import { CompletionFeature } from "../src/features/completion";
import { loadSchema } from "../src/schema/loader";
import { ServerData } from "../src/serverData";
import type { SchemaEntry } from "../src/schema/types";

const EFFECT_ENTRY: SchemaEntry = {
  path: "common/scripted_effects",
  kind: "scripted_effect",
  extraction: "top-level-key",
};

function extract(content: string) {
  return extractDefinitions(content, EFFECT_ENTRY, "F:/mod/common/scripted_effects/x.txt", "mod");
}

describe("docForDefinition — attach / detach", () => {
  it("attaches a contiguous block directly above the definition", () => {
    const lines = ["# Does a thing.", "# Second line.", "my_effect = {", "}"];
    const b = docForDefinition(lines, 2);
    expect(b).not.toBeNull();
    expect(b!.doc).toBe("Does a thing. Second line.");
  });

  it("a blank line between the block and the definition detaches it", () => {
    const lines = ["# Not mine.", "", "my_effect = {", "}"];
    expect(docForDefinition(lines, 2)).toBeNull();
  });

  it("a code line above the definition detaches", () => {
    const lines = ["other = { }", "my_effect = {", "}"];
    expect(docForDefinition(lines, 1)).toBeNull();
  });

  it("returns null when there is nothing above", () => {
    expect(docForDefinition(["my_effect = {"], 0)).toBeNull();
  });
});

describe("docForDefinition — separator skipping (§E2)", () => {
  it("a divider directly above (####) detaches", () => {
    const lines = ["####################", "my_effect = {", "}"];
    expect(docForDefinition(lines, 1)).toBeNull();
  });

  it("bounds the block at a separator above the prose", () => {
    const lines = ["### Kingsguard section", "# Real doc.", "my_effect = {"];
    // `### Kingsguard section` has letters → it is prose, not a separator.
    const b = docForDefinition(lines, 2);
    expect(b!.doc).toBe("Kingsguard section Real doc.");
  });

  it("skips a pure separator line inside the block", () => {
    const lines = ["# Real doc.", "# ------------", "# More doc.", "my_effect = {"];
    // The middle divider stops the upward walk when adjacent; here it is between
    // two prose lines, so the walk bounds at it — collected = ['# More doc.'].
    const b = docForDefinition(lines, 3);
    expect(b!.doc).toBe("More doc.");
  });

  it("leading ### is stripped down to prose", () => {
    const b = parseDocBlock(["### Legitimize a bastard."]);
    expect(b!.doc).toBe("Legitimize a bastard.");
  });
});

describe("parseDocBlock — tag parsing (§E1)", () => {
  it("parses all six recognized tags", () => {
    const b = parseDocBlock([
      "# Prose one.",
      "# @scope character — root is the bastard",
      "# @param DYNASTY_HOUSE the house",
      "# @saves scope:legitimized_child (character)",
      "# @returns a number",
      "# @example my_effect = { DYNASTY_HOUSE = house:x }",
      "# @deprecated use new_effect instead",
    ])!;
    expect(b.doc).toBe("Prose one.");
    const byTag = Object.fromEntries(b.tags.map((t) => [t.tag, t.text]));
    expect(byTag.scope).toBe("character — root is the bastard");
    expect(byTag.param).toBe("DYNASTY_HOUSE the house");
    expect(byTag.saves).toBe("scope:legitimized_child (character)");
    expect(byTag.returns).toBe("a number");
    expect(byTag.example).toContain("DYNASTY_HOUSE");
    expect(byTag.deprecated).toBe("use new_effect instead");
  });

  it("renders an unknown @tag as prose (format can grow)", () => {
    const b = parseDocBlock(["# Prose.", "# @author joel"])!;
    // @author is not recognized → folds into prose.
    expect(b.tags.length).toBe(0);
    expect(b.doc).toBe("Prose. @author joel");
  });

  it("caps prose at PROSE_CAP", () => {
    const long = "x".repeat(PROSE_CAP + 500);
    const b = parseDocBlock([`# ${long}`])!;
    expect(b.doc.length).toBe(PROSE_CAP);
  });
});

describe("extractDefinitions — BOM + CRLF handling", () => {
  it("captures doc through CRLF line endings", () => {
    const content = "# Does a thing.\r\n# @scope character\r\nmy_effect = {\r\n}\r\n";
    const [def] = extract(content);
    expect(def.doc).toBe("Does a thing.");
    expect(def.tags?.find((t) => t.tag === "scope")?.text).toBe("character");
  });

  it("captures doc on a definition when a BOM precedes the first comment", () => {
    const content = "﻿# Docd.\nmy_effect = {\n}\n";
    const [def] = extract(content);
    expect(def.doc).toBe("Docd.");
  });

  it("harvests $PARAM$ and doc together", () => {
    const content =
      "# Legitimize.\n# @param DYNASTY_HOUSE the house\nmy_effect = {\n\tset_house = $DYNASTY_HOUSE$\n}\n";
    const [def] = extract(content);
    expect(def.params).toEqual(["DYNASTY_HOUSE"]);
    expect(def.doc).toBe("Legitimize.");
    expect(def.tags?.find((t) => t.tag === "param")?.text).toContain("DYNASTY_HOUSE");
  });

  it("leaves undocumented definitions without doc/tags (lean index)", () => {
    const [def] = extract("my_effect = {\n}\n");
    expect(def.doc).toBeUndefined();
    expect(def.tags).toBeUndefined();
  });
});

describe("renderDocBody — hover render (§E3)", () => {
  it("renders prose, params, deprecated and example", () => {
    const body = renderDocBody({
      doc: "Legitimizes a bastard.",
      tags: [
        { tag: "param", text: "DYNASTY_HOUSE the target house" },
        { tag: "deprecated", text: "use new_legitimize" },
        { tag: "example", text: "my_effect = { DYNASTY_HOUSE = house:x }" },
      ],
    });
    expect(body.doc).toContain("Legitimizes a bastard.");
    expect(body.doc).toContain("*@param DYNASTY_HOUSE — the target house*");
    expect(body.doc).toContain("⚠ **Deprecated**");
    expect(body.deprecated).toBe(true);
    expect(body.example).toBe("my_effect = { DYNASTY_HOUSE = house:x }");
  });

  it("empty for an undocumented def (fail-soft)", () => {
    expect(renderDocBody({})).toEqual({});
  });
});

describe("hover — documented definition card", () => {
  const data = new ServerData();
  data.index.addAll([
    {
      name: "my_legitimize_effect",
      kind: "scripted_effect",
      file: "F:/mod/common/scripted_effects/x.txt",
      line: 5,
      source: "mod",
      doc: "Legitimizes the bastard.",
      tags: [
        { tag: "param", text: "DYNASTY_HOUSE the house" },
        { tag: "deprecated", text: "use v2" },
        { tag: "example", text: "my_legitimize_effect = { DYNASTY_HOUSE = house:x }" },
      ],
    },
  ]);

  it("shows prose, param, deprecated strike, and a fenced example", () => {
    const text = "immediate = { my_legitimize_effect = { } }";
    const doc = TextDocument.create("file:///mod/events/hover.txt", "paradox", 1, text);
    const at = text.indexOf("my_legitimize_effect") + 3;
    const hover = provideHover(data, doc, { line: 0, character: at }, new Set(["character"]), null);
    const value = (hover!.contents as { value: string }).value;
    expect(value).toContain("Legitimizes the bastard.");
    expect(value).toContain("@param DYNASTY_HOUSE");
    expect(value).toContain("~~my_legitimize_effect~~");
    expect(value).toContain("```paradox");
    expect(value).toContain("DYNASTY_HOUSE = house:x");
  });
});

describe("completion — documentation on documented defs", () => {
  const schema = loadSchema(null);
  const data = new ServerData();
  data.index.addAll([
    {
      name: "agot_do_effect",
      kind: "scripted_effect",
      file: "F:/mod/common/scripted_effects/x.txt",
      line: 1,
      source: "mod",
      doc: "Does the AGOT thing.",
      tags: [{ tag: "param", text: "TARGET who to affect" }],
    },
  ]);
  const completion = new CompletionFeature(data, () => schema);

  it("attaches markdown documentation on resolve (prose + params)", () => {
    const text = "immediate = {\n\tagot_\n}";
    const doc = TextDocument.create("file:///mod/events/compl.txt", "paradox", 1, text);
    const offset = text.indexOf("agot_") + "agot_".length;
    const { items } = completion.provide(doc, offset, new Set(["character"]), null);
    const item = items.find((i) => i.label === "agot_do_effect");
    expect(item).toBeDefined();
    // Docs are lazy (completionItem/resolve) since completion v3.
    const resolved = completion.resolve(item!);
    const documentation = resolved.documentation as { kind: string; value: string };
    expect(documentation.value).toContain("Does the AGOT thing.");
    expect(documentation.value).toContain("@param TARGET — who to affect");
  });
});

describe("signature help — @param alignment (§E3)", () => {
  const data = new ServerData();
  data.index.addAll([
    {
      name: "agot_param_effect",
      kind: "scripted_effect",
      file: "F:/mod/common/scripted_effects/x.txt",
      line: 1,
      source: "mod",
      params: ["DYNASTY_HOUSE", "TARGET"],
      doc: "Legitimizes.",
      tags: [
        { tag: "param", text: "DYNASTY_HOUSE the house" },
        { tag: "param", text: "TARGET the character" },
      ],
    },
  ]);

  it("aligns each param's documentation by NAME and marks the active one", () => {
    const text = "immediate = {\n\tagot_param_effect = {\n\t\tTARGET = scope:x\n\t}\n}";
    const doc = TextDocument.create("file:///mod/events/sighelp.txt", "paradox", 1, text);
    const line = text.split("\n").findIndex((l) => l.includes("TARGET ="));
    const character = text.split("\n")[line].indexOf("TARGET") + "TARGET".length;
    const help = provideSignatureHelp(data, doc, { line, character });
    expect(help).not.toBeNull();
    const sig = help!.signatures[0];
    expect(sig.parameters![0].documentation).toBe("the house");
    expect(sig.parameters![1].documentation).toBe("the character");
    expect(help!.activeParameter).toBe(1);
  });
});
