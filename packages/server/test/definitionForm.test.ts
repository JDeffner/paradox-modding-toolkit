/**
 * paradox/definitionForm against the REAL bundled CK3 data: the whole point of
 * the request is that no field list is written for it, so a test with a stub
 * schema would prove nothing. These assertions are the harvest's own numbers
 * (data/ck3/structures.json) and the schema table's own rows.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { computeDefinitionForm } from "../src/creators/definitionForm";
import { loadSchema, type SchemaData } from "../src/schema/loader";
import { ServerData } from "../src/serverData";

const TRAITS_TXT = `# A mod trait.
px_stoic = {
	category = personality
	opposites = { craven }
	martial = 2
}
`;

let dir: string;
let traitsFile: string;
const data = new ServerData();
const schema: SchemaData = loadSchema(null);

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "px-form-"));
  traitsFile = path.join(dir, "px_traits.txt");
  fs.writeFileSync(traitsFile, TRAITS_TXT, "utf8");
  data.index.addAll([
    { name: "px_stoic", kind: "trait", file: traitsFile, line: 1, source: "mod" },
    { name: "brave", kind: "trait", file: "vanilla.txt", line: 0, source: "vanilla" },
    { name: "craven", kind: "trait", file: "vanilla.txt", line: 5, source: "vanilla" },
  ]);
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("computeDefinitionForm", () => {
  it("answers the trait form from the schema table and the bundled harvest", () => {
    const form = computeDefinitionForm(data, schema, { kind: "trait" })!;
    expect(form.folder).toBe("common/traits");
    // _traits.info: name key trait_<key>, desc key trait_<key>_desc, default
    // icon gfx/interface/icons/traits/<trait>.dds.
    expect(form.locPatterns).toEqual(["trait_$", "trait_$_desc"]);
    expect(form.iconFolder).toBe("gfx/interface/icons/traits");
    // The harvest's 60 documented trait keys, in its own order (most used first).
    expect(form.keys).toHaveLength(60);
    expect(form.keys.slice(0, 3).map((k) => k.key)).toEqual(["desc", "category", "culture_modifier"]);
    const category = form.keys.find((k) => k.key === "category")!;
    expect(category.doc).toContain("category");
    expect(category.freq).toBeGreaterThan(0);
  });

  it("carries the per-kind ref rows and one option list per kind they name", () => {
    const form = computeDefinitionForm(data, schema, { kind: "trait" })!;
    expect(form.keys.find((k) => k.key === "opposites")?.refKinds).toEqual(["trait"]);
    // Resolved through the index, mod entries first.
    expect(form.options.trait.map((i) => i.value)).toEqual(["px_stoic", "brave", "craven"]);
    expect(form.options.trait[0].hint).toBe("this mod");
  });

  it("lists the mod's own definitions of the kind, not vanilla's", () => {
    const form = computeDefinitionForm(data, schema, { kind: "trait" })!;
    expect(form.existing.map((d) => d.name)).toEqual(["px_stoic"]);
    expect(form.existing[0].file).toBe(traitsFile);
  });

  it("loads a named definition's block verbatim", () => {
    const form = computeDefinitionForm(data, schema, { kind: "trait", name: "px_stoic" })!;
    expect(form.current?.source).toBe("mod");
    expect(form.current?.line).toBe(1);
    expect(form.current?.text).toBe(TRAITS_TXT.split("\n").slice(1, 6).join("\n"));
  });

  it("names an unindexed definition without inventing a block", () => {
    const form = computeDefinitionForm(data, schema, { kind: "trait", name: "no_such_trait" })!;
    expect(form.current).toBeUndefined();
    expect(form.keys.length).toBe(60);
  });

  it("carries the culture ref rows the vanilla files justify", () => {
    const form = computeDefinitionForm(data, schema, { kind: "culture" })!;
    expect(form.folder).toBe("common/culture/cultures");
    expect(form.keys.find((k) => k.key === "traditions")?.refKinds).toEqual(["culture_tradition"]);
    expect(form.keys.find((k) => k.key === "parents")?.refKinds).toEqual(["culture"]);
  });

  it("answers null for a kind the active game's schema does not have", () => {
    expect(computeDefinitionForm(data, schema, { kind: "not_a_kind" })).toBeNull();
    expect(computeDefinitionForm(data, schema, { kind: "" })).toBeNull();
  });
});
