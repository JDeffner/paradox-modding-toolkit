import { afterEach, describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CompletionFeature } from "../src/features/completion";
import { activeProfile, setActiveProfile } from "../src/games/active";
import { resolveProfile } from "../src/games/registry";
import { loadSchema } from "../src/schema/loader";
import { ServerData } from "../src/serverData";
import type { Definition } from "@px-lsp/protocol/types";

const originalProfile = activeProfile();
afterEach(() => setActiveProfile(originalProfile));
let documentId = 0;

function environment(game = "ck3", definitions: Definition[] = []) {
  setActiveProfile(resolveProfile(game));
  const schema = loadSchema(null);
  const data = new ServerData();
  data.index.addAll(definitions);
  const completion = new CompletionFeature(data, () => schema);
  completion.setSettings({
    gamePath: null,
    logsPath: null,
    modPath: null,
    parentPaths: [],
    locLanguage: "english",
    scopeInlayHints: false,
    diagnosticsIgnore: [],
    diagnosticsIgnorePatterns: [],
    diagnosticsVanilla: false,
  });
  function complete(text: string, kind = "event") {
    const offset = text.indexOf("|");
    const document = TextDocument.create(
      `file:///mod/events/localization-${documentId++}.txt`,
      "paradox",
      1,
      text.replace("|", "")
    );
    const entry = schema.entries.find((entry) => entry.kind === kind) ?? null;
    return completion.provide(document, offset, null, entry).items;
  }
  return { data, completion, complete };
}

function loc(name: string, source: Definition["source"] = "mod"): Definition {
  return {
    name,
    kind: "loc_key",
    file: "/mod/localization/english/test_l_english.yml",
    line: 1,
    source,
    value: "Existing text",
  };
}

describe("event localization completion", () => {
  it.each([
    ["title", "story.001.t"],
    ["desc", "story.001.desc"],
  ])("proposes a new %s key before localization exists", (field, expected) => {
    const env = environment();
    const item = env.complete(`namespace = story\nstory.001 = {\n ${field} = |\n}`)[0];
    expect(item.label).toBe(expected);
    expect(item.detail).toContain("New localization key");
    expect(item.additionalTextEdits).toBeUndefined();
    expect(item.command).toBeUndefined();
    expect(env.data.index.lookup(expected)).toEqual([]);
  });

  it("uses the current event and preserves zero-padded IDs in incomplete text", () => {
    const env = environment();
    const items = env.complete("story.1 = { desc = story.1.desc }\nstory.002 = {\n desc = story.00|");
    expect(items.map((item) => item.label)).toEqual(["story.002.desc"]);
  });

  it("completes a quoted partial key", () => {
    const items = environment().complete('story.001 = {\n desc = "story.001.d|"\n}');
    expect(items[0].label).toBe("story.001.desc");
  });

  it.each(["s", "story.", "story.004.d"])(
    "offers the description from the first typed prefix %s",
    (prefix) => {
      const items = environment().complete(
        `namespace = story\nstory.004 = {\n title = story.004.t\n # Keep this note\n desc = ${prefix}|\n option = { name = custom_choice }\n}\n`
      );
      expect(items.map((item) => item.label)).toContain("story.004.desc");
    }
  );

  it("accepts the same event IDs as the definition index", () => {
    expect(environment().complete("story-part_2.001 = {\n desc = |\n}")[0].label).toBe(
      "story-part_2.001.desc"
    );
  });

  it("offers successive option keys and avoids keys used by another option", () => {
    const env = environment();
    expect(env.complete("story.1 = { option = {\n name = |\n} }")[0].label).toBe("story.1.a");
    expect(
      env.complete("story.1 = { option = { name = story.1.a } option = {\n name = |\n} }")[0].label
    ).toBe("story.1.b");
    expect(
      env.complete("story.1 = { option = { name = story.1.b } option = {\n name = |\n} }")[0].label
    ).toBe("story.1.c");
  });

  it.each(["mod", "vanilla"] as const)("keeps an existing %s key as a single real definition", (source) => {
    const env = environment("ck3", [loc("story.1.desc", source), loc("other_text")]);
    const items = env.complete("story.1 = {\n desc = |\n}");
    expect(items[0].label).toBe("story.1.desc");
    expect(items.filter((item) => item.label === "story.1.desc")).toHaveLength(1);
    expect(items[0].detail).not.toContain("New localization key");
    expect(items.map((item) => item.label)).toContain("other_text");
    expect(env.completion.resolve(items[0]).documentation).toBeDefined();
  });

  it.each([
    "story.1 = {\n # desc = |\n}",
    "story.1 = { immediate = {\n name = |\n} }",
    "story.1 = { immediate = {\n title = |\n} }",
    "namespace = story\n desc = |",
    "story.1 = {\n de|\n}",
  ])("does not propose new keys outside an event text field: %s", (text) => {
    expect(
      environment()
        .complete(text)
        .some((item) => item.detail?.includes("New localization key"))
    ).toBe(false);
  });

  it("does not treat another definition kind as an event", () => {
    expect(
      environment()
        .complete("story.1 = {\n desc = |\n}", "decision")
        .some((item) => item.detail?.includes("New localization key"))
    ).toBe(false);
  });

  it.each([
    ["title", "story.1.t"],
    ["desc", "story.1.d"],
    ["flavor", "story.1.f"],
  ])("uses Victoria 3's %s convention", (field, expected) => {
    expect(environment("vic3").complete(`story.1 = {\n ${field} = |\n}`)[0].label).toBe(expected);
  });

  it("offers no invented convention for an unverified game", () => {
    expect(
      environment("eu5")
        .complete("story.1 = {\n desc = |\n}")
        .some((item) => item.detail?.includes("New localization key"))
    ).toBe(false);
  });
});
