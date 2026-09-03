/**
 * Definition skeletons, end to end without a game install:
 *
 *  1. the measurement (scripts/skeletonHarvest.ts): fixture files in, skeleton
 *     out, one case per rule the harvest claims (majority, median order,
 *     nesting, value vocabulary, the header key);
 *  2. the renderer (schema/skeletons.ts): both insert forms, and the header
 *     line appearing only when the document declares none;
 *  3. the placement (features/definitionSkeletons.ts + the completion provider):
 *     the definition at a file's top level, its child blocks one level in,
 *     nothing deeper, and nothing when the line tail is not blank.
 */
import { describe, expect, it } from "vitest";
import { CompletionItemKind } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { SkeletonHarvest } from "../../../scripts/skeletonHarvest";
import { parseScript } from "../src/parser";
import { renderBlockSkeleton, renderDefinitionSkeleton, type KindSkeleton } from "../src/schema/skeletons";
import { skeletonsAt } from "../src/features/definitionSkeletons";
import { CompletionFeature } from "../src/features/completion";
import { ServerData } from "../src/serverData";
import { loadSchema } from "../src/schema/loader";
import { CK3_SCHEMA } from "../src/games/ck3/schema";

/** MIN_SAMPLES is 10, so every fixture corpus has to reach it. */
function repeat(make: (i: number) => string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => make(i));
}

function harvestOf(files: string[], extraction: "top-level-key" | "event-id"): KindSkeleton | null {
  const harvest = new SkeletonHarvest();
  for (const text of files) harvest.addFile(text, extraction);
  return harvest.finish();
}

describe("skeleton harvest", () => {
  it("keeps the keys a majority carries and drops the rest, in median order", () => {
    // `always` is in every definition, `sometimes` in 6 of 12 (exactly the
    // majority), `rare` in 2. Order is deliberately scrambled per definition:
    // `always` is second as often as it is first, `common` always first.
    const files = repeat(
      (i) =>
        `d_${i} = {\n` +
        `\tcommon = a\n` +
        `\talways = b\n` +
        (i % 2 === 0 ? `\tsometimes = c\n` : "") +
        (i < 2 ? `\trare = d\n` : "") +
        `}\n`,
      12
    );
    const skel = harvestOf(files, "top-level-key")!;
    expect(skel.sampled).toBe(12);
    expect(skel.keys.map((k) => k.key)).toEqual(["common", "always", "sometimes"]);
  });

  it("refuses to publish a kind with too few definitions", () => {
    expect(
      harvestOf(
        repeat((i) => `d_${i} = { a = b }\n`, 9),
        "top-level-key"
      )
    ).toBeNull();
    expect(
      harvestOf(
        repeat((i) => `d_${i} = { a = b }\n`, 10),
        "top-level-key"
      )
    ).not.toBeNull();
  });

  it("keeps a small value vocabulary most-used first and drops a wide one", () => {
    const files = repeat(
      (i) => `d_${i} = {\n\ttype = ${i < 8 ? "alpha" : "beta"}\n\ttitle = loc_key_${i}\n}\n`,
      12
    );
    const skel = harvestOf(files, "top-level-key")!;
    expect(skel.keys.find((k) => k.key === "type")?.choices).toEqual(["alpha", "beta"]);
    // 12 distinct loc keys is not a vocabulary, so the key names itself.
    expect(skel.keys.find((k) => k.key === "title")?.choices).toBeUndefined();
  });

  it("nests one level and offers the nested block on its own", () => {
    const files = repeat(
      (i) => `d_${i} = {\n\toption = {\n\t\tname = n_${i}\n\t\tdeep = { x = 1 }\n\t}\n}\n`,
      12
    );
    const skel = harvestOf(files, "top-level-key")!;
    const option = skel.keys.find((k) => k.key === "option")!;
    expect(option.block!.map((k) => k.key)).toEqual(["name", "deep"]);
    // One level only: the second level is a block with no derived keys.
    expect(option.block!.find((k) => k.key === "deep")!.block).toEqual([]);
    expect(skel.blocks!.option.sampled).toBe(12);
    expect(skel.blocks!.option.keys.map((k) => k.key)).toEqual(["name", "deep"]);
  });

  it("reads the header key off the names, not off a table", () => {
    const files = repeat((i) => `namespace = ns\n\nns.${i} = {\n\ttype = t\n}\n`, 12);
    expect(harvestOf(files, "event-id")!.nameFromHeader).toBe("namespace");
    // Same header key, but the names are not built from it: no claim.
    const unrelated = repeat((i) => `namespace = ns\n\nother.${i} = {\n\ttype = t\n}\n`, 12);
    expect(harvestOf(unrelated, "event-id")!.nameFromHeader).toBeUndefined();
  });

  it("answers with an empty body when the kind has no shared shape", () => {
    const files = repeat((i) => `d_${i} = {\n\tkey_${i} = ${i}\n}\n`, 12);
    const skel = harvestOf(files, "top-level-key")!;
    expect(skel.keys).toEqual([]);
    expect(skel.sampled).toBe(12);
  });
});

describe("skeleton rendering", () => {
  const skel: KindSkeleton = {
    sampled: 100,
    nameFromHeader: "namespace",
    keys: [
      { key: "type", choices: ["character_event", "letter_event"] },
      { key: "title" },
      { key: "immediate", block: [] },
      { key: "option", block: [{ key: "name" }] },
    ],
    blocks: { option: { sampled: 200, keys: [{ key: "name" }] } },
  };

  it("mirrors the header value into the name when it writes the header itself", () => {
    const { snippet, plain } = renderDefinitionSkeleton("event", skel, { withHeader: true });
    expect(snippet).toBe(
      "namespace = ${1:my_namespace}\n\n" +
        "${1:my_namespace}.${2:1} = {\n" +
        "\ttype = ${3|character_event,letter_event|}\n" +
        "\ttitle = ${4:title}\n" +
        "\timmediate = {\n\t\t$5\n\t}\n" +
        "\toption = {\n\t\tname = ${6:name}\n\t}\n" +
        "}"
    );
    expect(plain).toBe(
      "namespace = my_namespace\n\nmy_namespace.1 = {\n\ttype = character_event\n\ttitle = title\n" +
        "\timmediate = {\n\t\t\n\t}\n\toption = {\n\t\tname = name\n\t}\n}"
    );
    expect(plain).not.toContain("${");
  });

  it("reuses the namespace the document already declares, and writes no second one", () => {
    const { snippet } = renderDefinitionSkeleton("event", skel, { headerValue: "intrigue" });
    expect(snippet.startsWith("intrigue.${1:1} = {")).toBe(true);
    expect(snippet).not.toContain("namespace =");
  });

  it("names a kind without a header key after the kind itself", () => {
    const flat: KindSkeleton = { sampled: 30, keys: [{ key: "category" }] };
    expect(renderDefinitionSkeleton("trait", flat, {}).snippet).toBe(
      "${1:my_trait} = {\n\tcategory = ${2:category}\n}"
    );
  });

  it("gives a kind with no measured body a place to type", () => {
    const empty: KindSkeleton = { sampled: 3465, keys: [] };
    expect(renderDefinitionSkeleton("scripted_effect", empty, {}).snippet).toBe(
      "${1:my_scripted_effect} = {\n\t$2\n}"
    );
  });

  it("renders a child block on its own", () => {
    expect(renderBlockSkeleton("option", skel.blocks!.option).snippet).toBe(
      "option = {\n\tname = ${1:name}\n}"
    );
  });
});

describe("skeleton placement", () => {
  const skeletons: Record<string, KindSkeleton> = {
    event: {
      sampled: 9791,
      nameFromHeader: "namespace",
      keys: [{ key: "type", choices: ["character_event"] }],
      blocks: { option: { sampled: 21957, keys: [{ key: "name" }] } },
    },
  };

  function at(text: string, marker = "|") {
    const offset = text.indexOf(marker);
    const parse = parseScript(text.replace(marker, ""));
    return skeletonsAt(parse, offset, "event", skeletons);
  }

  it("offers the definition at a file's top level and nothing else", () => {
    const offers = at("namespace = intrigue\n\n|\n");
    expect(offers.map((o) => o.id)).toEqual(["event"]);
    expect(offers[0].label).toBe("new event");
    expect(offers[0].detail).toBe("skeleton measured over 9,791 vanilla definitions");
    // The document's own namespace, not an invented one.
    expect(offers[0].text.snippet).toContain("intrigue.${1:1} = {");
  });

  it("offers the child blocks directly inside a definition body", () => {
    const offers = at("namespace = intrigue\n\nintrigue.1 = {\n\t|\n}\n");
    expect(offers.map((o) => o.id)).toEqual(["event.option"]);
    expect(offers[0].label).toBe("option block");
  });

  it("offers nothing deeper than a definition body", () => {
    expect(at("namespace = intrigue\n\nintrigue.1 = {\n\timmediate = {\n\t\t|\n\t}\n}\n")).toEqual([]);
  });

  it("says nothing for a kind the game has no measurement for", () => {
    const parse = parseScript("");
    expect(skeletonsAt(parse, 0, "trait", skeletons)).toEqual([]);
    expect(skeletonsAt(parse, 0, "event", undefined)).toEqual([]);
  });
});

describe("skeleton completion items", () => {
  const schema = loadSchema(null);
  const eventEntry = CK3_SCHEMA.find((e) => e.kind === "event")!;
  let counter = 0;
  const doc = (text: string) =>
    TextDocument.create(`file:///mod/events/skel-${counter++}.txt`, "paradox", 1, text);

  function completeAt(text: string, marker = "|") {
    const offset = text.indexOf(marker);
    const feature = new CompletionFeature(new ServerData(), () => schema);
    return feature.provide(doc(text.replace(marker, "")), offset, null, eventEntry).items;
  }

  it("ranks the definition skeleton first at a file's top level", () => {
    const items = completeAt("namespace = intrigue\n\n|\n");
    expect(items[0].label).toBe("new event");
    expect(items[0].kind).toBe(CompletionItemKind.Snippet);
    expect(String(items[0].insertText)).toContain("intrigue.${1:1} = {");
  });

  it("ranks child-block skeletons after the block's structure keys", () => {
    const items = completeAt("namespace = intrigue\n\nintrigue.1 = {\n\t|\n}\n");
    const block = items.findIndex((i) => i.label === "option block");
    const structural = items.findIndex((i) => i.label === "option");
    expect(structural).toBeGreaterThanOrEqual(0);
    expect(block).toBeGreaterThan(structural);
  });

  it("offers nothing where the line already carries a statement", () => {
    // What every rank-eval sample looks like: the key stripped, `= …` kept.
    const items = completeAt("namespace = intrigue\n\nintrigue.1 = {\n\t| = { }\n}\n");
    expect(items.some((i) => i.kind === CompletionItemKind.Snippet)).toBe(false);
  });
});
