import { describe, expect, it } from "vitest";
import { analyzePatch, generatePatch, resolvePatchEntry } from "../src/compatch/engine";
import type {
  PatchAnalysis,
  PatchPolicy,
  PatchProject,
  PatchResolution,
  PatchSource,
} from "../src/compatch/model";

const policy: PatchPolicy = {
  revision: "test-1",
  scriptFolders: [
    { path: "common/defs", kind: "definition", fields: "direct" },
    { path: "events", kind: "event", fields: "direct" },
    { path: "common/ordered", kind: "definition", fields: "ordered" },
  ],
  localizationFolder: "localization",
  fileRules: [{ path: "gui", precedence: "first" }],
  evidence: ["Synthetic test contract"],
  eventRules: { namespaceKey: "namespace", priorityKey: "priority", defaultPriority: 0 },
};
const source = (id: string, files: Record<string, string>, replacePaths: string[] = []): PatchSource => ({
  id,
  name: id.toUpperCase(),
  files: Object.entries(files).map(([path, text]) => ({ path, text })),
  replacePaths,
  dependencies: [],
  issues: [],
});
const project = (sources: PatchSource[]): PatchProject => ({
  version: 1,
  id: "patch",
  gameId: "test",
  name: "Patch",
  inputs: sources.map(({ id, name }) => ({ id, name })),
  decisions: {},
  generated: {},
});
const analyze = (sources: PatchSource[], value = project(sources)) =>
  analyzePatch({ gameId: "test", sources }, value, policy);
const named = (analysis: PatchAnalysis, name: string) =>
  analysis.entries.find((entry) => entry.name === name)!;
async function choose(
  analysis: PatchAnalysis,
  value: PatchProject,
  name: string,
  resolution: PatchResolution
) {
  return resolvePatchEntry(analysis, value, named(analysis, name).id, resolution);
}
async function acceptOtherWinners(analysis: PatchAnalysis, value: PatchProject, except: string) {
  for (const entry of analysis.entries.filter((item) => item.name !== except && item.state !== "identical"))
    value = await resolvePatchEntry(analysis, value, entry.id, {
      mode: entry.winner || !entry.contributors.some((item) => item.active) ? "winner" : "defer",
    });
  return value;
}

describe("maintained patch composition", () => {
  it("accepts exact descriptor dependencies ordered by project inputs", async () => {
    const sources = [source("a", {}), source("b", {}), source("c", {})];
    sources[1].dependencies = ["A"];
    sources[2].dependencies = ["A", "B"];
    const value = project(sources);
    const analysis = await analyze([...sources].reverse(), value);
    expect(analysis.issues).toEqual([]);
    expect(value.inputs.map((input) => input.id)).toEqual(["a", "b", "c"]);
  });

  it("reports missing dependencies without guessing case-insensitive name matches", async () => {
    const sources = [source("a", {}), source("b", {})];
    sources[1].dependencies = ["a", "Missing"];
    const analysis = await analyze(sources);
    expect(analysis.issues).toEqual([
      'B (b): descriptor dependency "a" is missing from selected inputs.',
      'B (b): descriptor dependency "Missing" is missing from selected inputs.',
    ]);
  });

  it("reports self-dependencies and dependencies later than their dependent without blocking writes", async () => {
    const sources = [
      source("a", { "common/defs/a.txt": "x = 1" }),
      source("b", { "common/defs/a.txt": "x = 2" }),
    ];
    sources[0].dependencies = ["B"];
    sources[1].dependencies = ["B"];
    let value = project(sources);
    const analysis = await analyze(sources, value);
    expect(analysis.issues).toEqual([
      'A (a): descriptor dependency "B" appears later than its dependent in the selected launcher order.',
      'B (b): descriptor dependency "B" refers to the source itself.',
    ]);
    value = await choose(analysis, value, "x", {
      mode: "source",
      contributorId: named(analysis, "x").contributors[0].id,
    });
    expect(value.inputs.map((input) => input.id)).toEqual(["a", "b"]);
    const output = await generatePatch(analysis, value);
    expect(output.issues).toEqual([]);
    expect(output.files[0].text).toBe("\uFEFFx = 1");
  });

  it("reports ambiguous duplicate descriptor names instead of selecting a dependency target", async () => {
    const sources = [source("a", {}), source("b", {}), source("c", {})];
    sources[1].name = "A";
    sources[2].dependencies = ["A"];
    const analysis = await analyze(sources);
    expect(analysis.issues).toEqual([
      'Duplicate descriptor name "A" belongs to selected sources a, b; dependency matching by name is ambiguous.',
      'C (c): descriptor dependency "A" is ambiguous; multiple selected sources have that exact name.',
    ]);
  });

  it("limits analysis to overlaps, disappeared definitions, malformed inputs, and saved intent", async () => {
    const sources = [
      source("a", { "common/defs/a.txt": "lost = 1\nx = 1", "history/a.txt": "unaffected = 1" }),
      source("b", {
        "common/defs/a.txt": "x = 2\nunique = 1",
        "events/invalid.txt": "namespace = n\nn.1 = { priority = @unknown }",
      }),
    ];
    const analysis = await analyze(sources);
    expect(analysis.entries.map((entry) => entry.name).sort()).toEqual(["lost", "n.1", "x"]);
    expect(named(analysis, "lost").allowedModes).toContain("source");
    const value = {
      ...project(sources),
      decisions: {
        "definition:common/defs:unique": { fingerprint: "old", resolution: { mode: "winner" as const } },
      },
    };
    const withIntent = await analyze(sources, value);
    expect(named(withIntent, "unique").state).toBe("changed");
  });
  it("exposes complete file choices and gates uncertain automatic writes", async () => {
    const sources = [
      source("a", { "history/a.txt": "x = 1", "gui/a.gui": "widget = { x = 1 }" }),
      source("b", { "history/a.txt": "x = 2", "gui/a.gui": "widget = { x = 2 }" }),
    ];
    const analysis = await analyze(sources);
    expect(named(analysis, "history/a.txt").allowedModes).toEqual(["defer", "winner", "manual", "source"]);
    expect(named(analysis, "gui/a.gui").allowedModes).toEqual(["defer", "winner"]);
  });
  it("keeps binary coverage notices visible without blocking supported writes", async () => {
    const sources = [
      source("a", { "common/defs/a.txt": "x = 1" }),
      source("b", { "common/defs/a.txt": "x = 2" }),
    ];
    sources[0].issues.push("Binary assets require external review.");
    let value = project(sources);
    const analysis = await analyze(sources, value);
    expect(analysis.issues).toContain("A: Binary assets require external review.");
    value = await choose(analysis, value, "x", {
      mode: "source",
      contributorId: named(analysis, "x").contributors[0].id,
    });
    const output = await generatePatch(analysis, value);
    expect(output.issues).toEqual([]);
    expect(output.files[0].text).toBe("\uFEFFx = 1");
  });
  it("shadows whole files before definitions across three mods, and exposes disappeared unique objects", async () => {
    const sources = [
      source("a", { "common/defs/all.txt": "shared = { x = 1 }\na_only = 1" }),
      source("b", { "common/defs/all.txt": "shared = { x = 2 }\nb_only = 2" }),
      source("c", { "common/defs/all.txt": "# Keep this comment\nshared = { x = 3 }\nc_only = 3" }),
    ];
    let value = project(sources);
    const analysis = await analyze(sources, value);
    const shared = named(analysis, "shared");
    expect(shared.contributors.map((item) => item.active)).toEqual([false, false, true]);
    expect(shared.winner).toBe(shared.contributors[2].id);
    expect(shared.contributors[0].reason).toContain("Whole file");
    expect(named(analysis, "a_only").explanation).toContain("disappeared");
    value = await choose(analysis, value, "shared", {
      mode: "source",
      contributorId: shared.contributors[0].id,
    });
    value = await choose(analysis, value, "a_only", {
      mode: "source",
      contributorId: named(analysis, "a_only").contributors[0].id,
    });
    value = await choose(analysis, value, "b_only", { mode: "winner" });
    const result = await generatePatch(analysis, value);
    expect(result.issues).toEqual([]);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe("common/defs/all.txt");
    expect(result.files[0].text).toContain("# Keep this comment\nshared = { x = 1 }\nc_only = 3");
    expect(result.files[0].text).toContain("a_only = 1");
    expect(result.files[0].text).not.toContain("b_only");
    expect(result.files[0].text.startsWith("\uFEFF")).toBe(true);
    expect(await generatePatch(analysis, value)).toEqual(result);
  });

  it("distinguishes identical definitions and never emits a redundant winner file", async () => {
    const sources = [
      source("a", { "common/defs/a.txt": "x = { a = 1 }" }),
      source("b", { "common/defs/a.txt": "x = { a = 1 }" }),
    ];
    let value = project(sources);
    const analysis = await analyze(sources, value);
    expect(named(analysis, "x").state).toBe("identical");
    value = await choose(analysis, value, "x", { mode: "winner" });
    expect(await generatePatch(analysis, value)).toEqual({ files: [], issues: [] });
  });

  it("uses documented event priority across different filenames, preserving siblings and namespaces", async () => {
    const sources = [
      source("a", {
        "events/a.txt":
          "namespace = one\nnamespace = two\none.1 = { priority = 0 title = old }\ntwo.1 = { title = sibling }",
      }),
      source("b", {
        "events/b.txt":
          "namespace = one\n# Keep header comment\none.1 = { priority = 5 title = new }\none.2 = { title = other }",
      }),
      source("c", {
        "events/c.txt": "namespace = one\none.1 = { priority = 2 title = middle }\none.3 = { title = third }",
      }),
    ];
    let value = project(sources);
    const analysis = await analyze(sources, value);
    const event = named(analysis, "one.1");
    expect(event.winner).toBe(event.contributors[1].id);
    value = await choose(analysis, value, "one.1", {
      mode: "source",
      contributorId: event.contributors[0].id,
    });
    const result = await generatePatch(analysis, value);
    expect(result.issues).toEqual([]);
    expect(result.files.map((file) => file.path)).toEqual(["events/a.txt", "events/b.txt", "events/c.txt"]);
    expect(result.files[0].text).toContain("namespace = two");
    expect(result.files[0].text).toContain("two.1 = { title = sibling }");
    expect(result.files[0].text).not.toContain("one.1");
    expect(result.files[1].text).toContain("one.1 = { priority = 0 title = old }");
    expect(result.files[1].text).toContain("# Keep header comment");
    expect(result.files[1].text).toContain("one.2 = { title = other }");
    expect(result.files[2].text).not.toContain("one.1");
    expect(result.files[2].text).toContain("one.3 = { title = third }");
    expect(result.files.every((file) => file.text.startsWith("\uFEFFnamespace ="))).toBe(true);
  });

  it("does not infer event winners for equal priorities, but explicit source choice removes the duplicates", async () => {
    const sources = [
      source("a", { "events/a.txt": "namespace = n\nn.1 = { title = a }" }),
      source("b", { "events/b.txt": "namespace = n\nn.1 = { title = b }" }),
    ];
    let value = project(sources);
    const analysis = await analyze(sources, value);
    const event = named(analysis, "n.1");
    expect(event.winner).toBeUndefined();
    expect(event.issues[0]).toContain("Equal event override priorities");
    await expect(choose(analysis, value, "n.1", { mode: "winner" })).rejects.toThrow("no verified");
    value = await choose(analysis, value, "n.1", { mode: "source", contributorId: event.contributors[0].id });
    const result = await generatePatch(analysis, value);
    expect(result.issues).toEqual([]);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe("events/b.txt");
    expect(result.files[0].text).not.toContain("n.1");
  });

  it("keeps equal lower event priorities and expressions unsupported", async () => {
    const sources = [
      source("a", { "events/a.txt": "namespace = n\nn.1 = { priority = 1 }" }),
      source("b", { "events/b.txt": "namespace = n\nn.1 = { priority = 1 }" }),
      source("c", {
        "events/c.txt": "namespace = n\nn.1 = { priority = 5 }\nn.2 = { priority = @variable }",
      }),
    ];
    const analysis = await analyze(sources);
    expect(named(analysis, "n.1").winner).toBeUndefined();
    expect(named(analysis, "n.2").issues).toContain(
      "Event override priority is not one safe literal integer."
    );
  });

  it("does not infer ordinary cross-file definition precedence from launcher order", async () => {
    const sources = [
      source("a", { "common/defs/a.txt": "x = 1" }),
      source("b", { "common/defs/b.txt": "x = 2" }),
    ];
    let value = project(sources);
    const analysis = await analyze(sources, value);
    expect(named(analysis, "x").state).toBe("unsupported");
    expect(named(analysis, "x").winner).toBeUndefined();
    value = await choose(analysis, value, "x", {
      mode: "source",
      contributorId: named(analysis, "x").contributors[0].id,
    });
    const result = await generatePatch(analysis, value);
    expect(result.files).toEqual([]);
    expect(result.issues[0]).toContain("verified winner");
  });

  it("combines explicit complete direct-field groups, preserving repeated options and comments", async () => {
    const sources = [
      source("a", {
        "common/defs/a.txt":
          "x = {\n # Original options\n option = { name = a }\n option = { name = b }\n title = old\n}\nsibling = 1",
      }),
      source("b", {
        "common/defs/a.txt":
          "x = {\n option = { name = c }\n title = new\n desc = added\n}\n# Keep sibling\nsibling = 2",
      }),
    ];
    let value = project(sources);
    const analysis = await analyze(sources, value);
    const entry = named(analysis, "x");
    expect(entry.fieldsSupported).toBe(true);
    const [a, b] = entry.contributors;
    value = await choose(analysis, value, "x", {
      mode: "fields",
      fields: { option: a.id, title: b.id, desc: null },
    });
    value = await acceptOtherWinners(analysis, value, "x");
    const result = await generatePatch(analysis, value);
    expect(result.issues).toEqual([]);
    expect(result.files[0].text).toContain("# Original options");
    expect(result.files[0].text).toContain("option = { name = a }");
    expect(result.files[0].text).toContain("option = { name = b }");
    expect(result.files[0].text).toContain("title = new");
    expect(result.files[0].text).not.toContain("desc = added");
    expect(result.files[0].text).toContain("# Keep sibling\nsibling = 2");
    await expect(choose(analysis, value, "x", { mode: "fields", fields: { option: a.id } })).rejects.toThrow(
      "Every direct field group"
    );
  });

  it("blocks field mixing across local constant contexts and blocks unsafe sibling context replacement", async () => {
    const sources = [
      source("a", { "common/defs/a.txt": "@amount = 1\nx = { value = @amount }" }),
      source("b", {
        "common/defs/a.txt": "@amount = 2\nx = { value = @amount }\nsibling = { value = @amount }",
      }),
    ];
    let value = project(sources);
    const analysis = await analyze(sources, value);
    const entry = named(analysis, "x");
    expect(entry.fieldsSupported).toBe(false);
    await expect(
      choose(analysis, value, "x", { mode: "fields", fields: { value: entry.contributors[0].id } })
    ).rejects.toThrow("compatible file context");
    value = await choose(analysis, value, "x", { mode: "source", contributorId: entry.contributors[0].id });
    const result = await generatePatch(analysis, value);
    expect(result.files).toEqual([]);
    expect(result.issues[0]).toContain("conflicts with baseline declaration @amount");
  });

  it("rejects interleaved repetitions and ordered formula bodies for field combination", async () => {
    const sources = [
      source("a", {
        "common/defs/a.txt": "x = { a = 1 b = 2 a = 3 }",
        "common/ordered/a.txt": "formula = { add = 1 multiply = 2 }",
      }),
      source("b", {
        "common/defs/a.txt": "x = { a = 4 b = 5 }",
        "common/ordered/a.txt": "formula = { add = 3 multiply = 4 }",
      }),
    ];
    const analysis = await analyze(sources);
    expect(named(analysis, "x").fieldsSupported).toBe(false);
    expect(named(analysis, "formula").fieldsSupported).toBe(false);
  });

  it("reuses intent through unrelated file/definition changes and reopens exact meaningful entries", async () => {
    const sources = [
      source("a", { "common/defs/a.txt": "@value = 1\nx = { a = @value }\ny = 1" }),
      source("b", { "common/defs/a.txt": "@value = 2\nx = { a = @value }\ny = 2" }),
    ];
    let value = project(sources);
    const before = await analyze(sources, value);
    value = await choose(before, value, "x", { mode: "winner", note: "Keep upstream" });
    const unrelated = [
      sources[0],
      source("b", {
        "common/defs/a.txt": "@value = 2\nx = { a = @value }\ny = 9",
        "common/defs/unrelated.txt": "new = 1",
      }),
    ];
    const same = await analyze(unrelated, value);
    expect(named(same, "x").state).toBe("ready");
    expect(named(same, "x").fingerprint).toBe(named(before, "x").fingerprint);
    const changed = await analyze(
      [sources[0], source("b", { "common/defs/a.txt": "@value = 3\nx = { a = @value }\ny = 2" })],
      value
    );
    expect(named(changed, "x").state).toBe("changed");
    expect(named(changed, "x").decision?.resolution.note).toBe("Keep upstream");
    const reordered = { ...value, inputs: [...value.inputs].reverse() };
    expect(named(await analyze(sources, reordered), "x").state).toBe("changed");
    await expect(generatePatch(before, reordered)).rejects.toThrow("stale");
  });

  it("keeps vanished saved intent visible and supports explicit maintenance retirement", async () => {
    const sources = [
      source("a", { "common/defs/a.txt": "x = 1" }),
      source("b", { "common/defs/a.txt": "x = 3" }),
    ];
    let value = project(sources);
    const before = await analyze(sources, value);
    value = await choose(before, value, "x", { mode: "manual", text: "x = 2" });
    value.generated["common/defs/a.txt"] = { text: "\uFEFFx = 2", entries: [named(before, "x").id] };
    const after = await analyze([source("a", {}), source("b", {})], value);
    expect(after.entries[0].state).toBe("changed");
    expect(after.entries[0].decision?.resolution.text).toBe("x = 2");
    expect((await generatePatch(after, value)).issues[0]).toContain("requires review");
    value = await resolvePatchEntry(after, value, after.entries[0].id, { mode: "winner" });
    expect(await generatePatch(after, value)).toEqual({ files: [], issues: [] });
  });

  it("validates manual text against the selected identity and preserves pending decisions", async () => {
    const sources = [
      source("a", { "common/defs/a.txt": "x = 1\ny = 1" }),
      source("b", { "common/defs/a.txt": "x = 2\ny = 2" }),
    ];
    let value = project(sources);
    const analysis = await analyze(sources, value);
    await expect(choose(analysis, value, "x", { mode: "manual", text: "other = 3" })).rejects.toThrow(
      "selected definition"
    );
    await expect(choose(analysis, value, "x", { mode: "manual", text: "x = {" })).rejects.toThrow(
      "structural errors"
    );
    value = await choose(analysis, value, "x", { mode: "manual", text: "x = 3" });
    const pending = await generatePatch(analysis, value);
    expect(pending.files).toEqual([]);
    expect(pending.issues.some((issue) => issue.startsWith("y:"))).toBe(true);
  });

  it("blocks replace_path assumptions and allows explicit defer while retaining its old owned output", async () => {
    const sources = [
      source("a", { "common/defs/a.txt": "x = 1" }),
      source("b", { "common/defs/a.txt": "x = 2" }, ["common/defs"]),
    ];
    let value = project(sources);
    const analysis = await analyze(sources, value);
    const entry = named(analysis, "x");
    expect(entry.issues).toContain(
      "replace_path affects this entry; suppression of prior mod sources is unverified."
    );
    value = await choose(analysis, value, "x", { mode: "source", contributorId: entry.contributors[0].id });
    expect((await generatePatch(analysis, value)).issues[0]).toContain("replace_path");
    value = await choose(analysis, value, "x", { mode: "defer", note: "Manual handling" });
    value.generated["common/defs/old.txt"] = { text: "\uFEFFx = 4", entries: [entry.id] };
    const result = await generatePatch(analysis, value);
    expect(result.issues).toEqual([]);
    expect(result.files[0]).toEqual({
      path: "common/defs/old.txt",
      text: "\uFEFFx = 4",
      entries: [entry.id],
    });
    expect(named(await analyze(sources, value), "x").decision?.resolution.mode).toBe("defer");
  });

  it("routes explicit localization choices by language through host placement metadata", async () => {
    const sources = [
      source("a", { "localization/english/a_l_english.yml": '\uFEFFl_english:\n title:0 "Old"\n' }),
      source("b", { "localization/english/a_l_english.yml": '\uFEFFl_english:\n title:0 "New"\n' }),
    ];
    let value = project(sources);
    const analysis = await analyze(sources, value);
    const entry = named(analysis, "title");
    expect(entry.id).toBe("localization:english:title");
    value = await choose(analysis, value, "title", {
      mode: "source",
      contributorId: entry.contributors[0].id,
    });
    const result = await generatePatch(analysis, value);
    expect(result.issues).toEqual([]);
    expect(result.files[0].text).toBe('\uFEFFl_english:\n title:0 "Old"\n');
    expect(result.files[0].path).toBe("localization/replace/english/a_l_english.yml");
    expect(result.files[0].localization).toEqual({
      language: "english",
      keys: ["title"],
      override: true,
      sourcePath: "localization/english/a_l_english.yml",
    });
    const added = await analyze(
      [
        source("a", {
          "localization/english/a_l_english.yml": '\uFEFFl_english:\n unrelated:0 "Added"\n title:0 "Old"\n',
        }),
        sources[1],
      ],
      value
    );
    expect(named(added, "title").state).toBe("ready");
  });

  it("keeps earlier replace localization and first-in-wins GUI precedence honest", async () => {
    const sources = [
      source("a", {
        "localization/english/replace/a_l_english.yml": '\uFEFFl_english:\n title:0 "First"\n',
        "gui/a.gui": "widget = { a = 1 }",
      }),
      source("b", {
        "localization/english/replace/a_l_english.yml": '\uFEFFl_english:\n title:0 "Second"\n',
        "gui/a.gui": "widget = { a = 2 }",
      }),
    ];
    let value = project(sources);
    const analysis = await analyze(sources, value);
    const loc = named(analysis, "title");
    expect(loc.winner).toBe(loc.contributors[0].id);
    value = await choose(analysis, value, "title", { mode: "source", contributorId: loc.contributors[1].id });
    value = await choose(analysis, value, "gui/a.gui", { mode: "defer" });
    expect((await generatePatch(analysis, value)).issues[0]).toContain("existing replace localization");
  });
});
