import { describe, expect, it } from "vitest";
import { extractReferences, ReferenceIndex } from "../src/index/references";
import { DefinitionIndex } from "../src/index/indexer";
import { loadSchema } from "../src/schema/loader";
import type { Definition } from "@px-lsp/protocol/types";

const schema = loadSchema(null);

function refs(content: string) {
  return extractReferences(content, "C:\\mod\\events\\e.txt", "mod", schema);
}

describe("extractReferences", () => {
  it("records trigger_event scalar references", () => {
    const r = refs("my.1 = {\n\timmediate = {\n\t\ttrigger_event = other.42\n\t}\n}\n");
    const ev = r.references.find((x) => x.name === "other.42");
    expect(ev).toBeDefined();
    expect(ev!.kinds).toContain("event");
    expect(ev!.line).toBe(2);
  });

  it("records list-form references (events = { ... })", () => {
    const r = refs("on_birth_mod = {\n\tevents = {\n\t\tmy.1\n\t\tmy.2\n\t}\n}\n");
    expect(r.references.filter((x) => x.kinds.includes("event")).map((x) => x.name)).toEqual([
      "my.1",
      "my.2",
    ]);
  });

  it("records scope:x usages with the range of the name only", () => {
    const text = "e = {\n\tscope:my_target = { add_gold = 5 }\n\tdeath = { killer = scope:my_target }\n}\n";
    const r = refs(text);
    const uses = r.references.filter((x) => x.name === "my_target");
    expect(uses).toHaveLength(2);
    expect(uses[0].kinds).toEqual(["saved_scope"]);
    // range covers just the name (after "scope:")
    expect(uses[0].startChar).toBe(text.split("\n")[1].indexOf("my_target"));
  });

  it("records save_scope_as as an implicit definition with its container", () => {
    const r = refs("my.1 = {\n\timmediate = {\n\t\tsave_scope_as = duel_target\n\t}\n}\n");
    expect(r.implicitDefs).toHaveLength(1);
    expect(r.implicitDefs[0]).toMatchObject({ name: "duel_target", kind: "saved_scope", container: "my.1" });
  });

  it("records set_variable block and scalar forms plus var: usages", () => {
    const r = refs(
      "e = {\n\tset_variable = { name = my_var value = 3 }\n\tset_local_variable = quick\n\tx = var:my_var\n}\n"
    );
    expect(r.implicitDefs.map((d) => d.name).sort()).toEqual(["my_var", "quick"]);
    const use = r.references.find((x) => x.name === "my_var" && x.kinds.includes("variable"));
    expect(use).toBeDefined();
  });

  it("records culture:/faith: prefixed references", () => {
    const r = refs("e = {\n\tculture = culture:czech\n\tfaith = faith:catholic.religion\n}\n");
    expect(r.references.find((x) => x.name === "czech")?.kinds).toEqual(["culture"]);
    // dotted chain cut at the first dot
    expect(r.references.find((x) => x.name === "catholic")?.kinds).toEqual(["faith"]);
  });

  it("records loc-key-valued properties, quoted or not", () => {
    const r = refs('d = {\n\ttitle = my_title_key\n\tdesc = "my_desc_key"\n}\n');
    const locRefs = r.references.filter((x) => x.kinds.includes("loc_key")).map((x) => x.name);
    expect(locRefs).toContain("my_title_key");
    expect(locRefs).toContain("my_desc_key");
  });

  it("collects namespace declarations", () => {
    const r = refs('namespace = my\nnamespace = other\nmy.1 = { desc = "x" }\n');
    expect(r.namespaces).toEqual(["my", "other"]);
  });

  it("never records yes/no or quoted values as references", () => {
    const r = refs("e = {\n\ttrigger_event = yes\n}\n");
    expect(r.references.filter((x) => x.kinds.includes("event"))).toHaveLength(0);
  });

  it("indexes call sites of conventionally named scripted triggers/effects (#5)", () => {
    // *_trigger / on_* keys match classifyKeyword's naming-convention buckets,
    // but as CALL keys they reference the scripted definition all the same.
    const r = refs(
      "my.1 = {\n\ttrigger = { my_can_pay_trigger = yes }\n\timmediate = { on_pay_effect = yes }\n}\n"
    );
    const call = r.references.find((x) => x.name === "my_can_pay_trigger");
    expect(call).toBeDefined();
    expect(call!.call).toBe(true);
    expect(call!.kinds).toContain("scripted_trigger");
    expect(r.references.find((x) => x.name === "on_pay_effect")).toBeDefined();
    // Structural grammar keys stay out.
    expect(r.references.find((x) => x.name === "trigger")).toBeUndefined();
    expect(r.references.find((x) => x.name === "immediate")).toBeUndefined();
  });
});

describe("ReferenceIndex", () => {
  it("removeFile drops that file's references only", () => {
    const idx = new ReferenceIndex();
    const a = refs("e = { trigger_event = ns.1 }").references;
    const b = extractReferences(
      "f = { trigger_event = ns.1 }",
      "C:\\mod\\events\\other.txt",
      "mod",
      schema
    ).references;
    idx.addAll(a);
    idx.addAll(b);
    expect(idx.lookup("ns.1")).toHaveLength(2);
    idx.removeFile("C:\\mod\\events\\e.txt");
    expect(idx.lookup("ns.1")).toHaveLength(1);
  });

  /** §B2 grouped removeFile: one rebuild per NAME, not per occurrence. */
  it("removeFile drops every occurrence of a name it contributed, and only those", () => {
    const idx = new ReferenceIndex();
    const mine = extractReferences(
      "a = { trigger_event = ns.1 }\nb = { trigger_event = ns.1 }\nc = { trigger_event = ns.1 }",
      "C:\\mod\\events\\mine.txt",
      "mod",
      schema
    ).references;
    const theirs = extractReferences(
      "d = { trigger_event = ns.1 }\ne = { trigger_event = ns.1 }",
      "C:\\mod\\events\\theirs.txt",
      "mod",
      schema
    ).references;
    idx.addAll(mine);
    idx.addAll(theirs);
    expect(idx.lookup("ns.1")).toHaveLength(5);
    expect(idx.usageCount("ns.1")).toBe(5);
    idx.removeFile("C:\\mod\\events\\mine.txt");
    expect(idx.lookup("ns.1")).toHaveLength(2);
    expect(idx.usageCount("ns.1")).toBe(2);
    expect(idx.inFile("C:\\mod\\events\\mine.txt")).toHaveLength(0);
    idx.removeFile("C:\\mod\\events\\theirs.txt");
    expect(idx.lookup("ns.1")).toHaveLength(0);
    expect(idx.usageCount("ns.1")).toBe(0);
  });
});

describe("DefinitionIndex source priority", () => {
  const def = (source: Definition["source"], file: string): Definition => ({
    name: "x",
    kind: "trait",
    file,
    line: 0,
    source,
  });

  it("mod shadows parent shadows vanilla", () => {
    const idx = new DefinitionIndex();
    idx.addAll([def("vanilla", "v.txt"), def("parent", "p.txt"), def("mod", "m.txt")]);
    expect(idx.lookup("x").map((d) => d.source)).toEqual(["mod"]);
    idx.removeFile("m.txt");
    expect(idx.lookup("x").map((d) => d.source)).toEqual(["parent"]);
    idx.removeFile("p.txt");
    expect(idx.lookup("x").map((d) => d.source)).toEqual(["vanilla"]);
  });
});
