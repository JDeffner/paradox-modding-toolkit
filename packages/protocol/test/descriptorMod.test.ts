import { describe, expect, it } from "vitest";
import {
  DESCRIPTOR_FIELDS,
  LAUNCHER_TAGS,
  parseDescriptor,
  readDescriptorBlock,
  scaffoldDescriptor,
  upsertDescriptorValue,
  validateDescriptor,
  wildcardVersion,
} from "../src/descriptorMod";

const GOOD_DESCRIPTOR = `version="0.4.38"
name="A Game of Thrones"
tags={
\t"Total Conversion"
\t"Gameplay"
}
replace_path="history/characters"
replace_path="common/landed_titles"
supported_version="1.19.0.6"
`;

describe("parseDescriptor", () => {
  it("finds top-level keys and skips block contents", () => {
    const entries = parseDescriptor(GOOD_DESCRIPTOR);
    expect(entries.map((e) => e.key)).toEqual([
      "version",
      "name",
      "tags",
      "replace_path",
      "replace_path",
      "supported_version",
    ]);
    // tag strings must NOT show up as keys
    expect(entries.some((e) => e.key.includes("Conversion"))).toBe(false);
  });

  it("records values and positions", () => {
    const [version] = parseDescriptor('version="1.0"\n');
    expect(version.value).toBe('"1.0"');
    expect(version.line).toBe(0);
    expect(version.startCol).toBe(0);
    expect(version.endCol).toBe(7);
  });

  it("ignores comments and a leading BOM", () => {
    const entries = parseDescriptor(String.fromCharCode(0xfeff) + 'name="x" # version="9"\n# path="y"\n');
    expect(entries.map((e) => e.key)).toEqual(["name"]);
  });
});

describe("validateDescriptor", () => {
  const codes = (text: string, isDescriptorFile = true) =>
    validateDescriptor(text, { isDescriptorFile }).map((i) => i.code);

  it("accepts a real-world descriptor.mod", () => {
    expect(codes(GOOD_DESCRIPTOR)).toEqual([]);
  });

  it("flags missing name and version as errors", () => {
    const issues = validateDescriptor('tags={ "Gameplay" }\n', { isDescriptorFile: true });
    const missing = issues.filter((i) => i.code === "descriptor-missing-field");
    expect(missing.filter((i) => i.severity === "error")).toHaveLength(2); // name, version
    expect(missing.filter((i) => i.severity === "warning")).toHaveLength(1); // supported_version
  });

  it("warns about path= inside descriptor.mod but not in the outer file", () => {
    const text = 'name="X"\nversion="1"\nsupported_version="1.*"\npath="mod/x"\n';
    expect(codes(text, true)).toContain("descriptor-path-ignored");
    expect(codes(text, false)).toEqual([]);
  });

  it("warns about unknown keys and duplicates, allows repeated replace_path", () => {
    const text =
      'name="X"\nversion="1"\nversion="2"\nsupported_version="1.*"\n' +
      'frobnicate="yes"\nreplace_path="a"\nreplace_path="b"\n';
    const c = codes(text);
    expect(c).toContain("descriptor-duplicate-key");
    expect(c).toContain("descriptor-unknown-key");
    expect(c.filter((x) => x === "descriptor-duplicate-key")).toHaveLength(1);
  });
});

describe("knowledge table", () => {
  it("covers the launcher's full key set with docs and snippets", () => {
    const keys = DESCRIPTOR_FIELDS.map((f) => f.key);
    expect(keys.sort()).toEqual(
      [
        "dependencies",
        "name",
        "path",
        "picture",
        "remote_file_id",
        "replace_path",
        "supported_version",
        "tags",
        "version",
      ].sort()
    );
    for (const f of DESCRIPTOR_FIELDS) {
      expect(f.summary.length, f.key).toBeGreaterThan(10);
      expect(f.doc, f.key).toContain("```");
      expect(f.snippet, f.key).toContain(f.key);
    }
  });

  it("has the 21 launcher tag categories", () => {
    expect(LAUNCHER_TAGS).toHaveLength(21);
    for (const t of ["Gameplay", "Total Conversion", "Fixes", "Sound", "Alternative History"]) {
      expect(LAUNCHER_TAGS).toContain(t);
    }
  });
});

describe("helpers", () => {
  it("wildcardVersion keeps major.minor", () => {
    expect(wildcardVersion("1.19.0.6")).toBe("1.19.*");
    expect(wildcardVersion("garbage")).toBeNull();
  });

  it("scaffoldDescriptor output validates cleanly", () => {
    const text = scaffoldDescriptor("My Mod", "1.19.*");
    expect(validateDescriptor(text, { isDescriptorFile: true })).toEqual([]);
    expect(text).toContain('name="My Mod"');
    expect(text.endsWith("\n")).toBe(true);
  });

  it("readDescriptorBlock reads quoted entries, ignoring comments", () => {
    expect(readDescriptorBlock(GOOD_DESCRIPTOR, "tags")).toEqual(["Total Conversion", "Gameplay"]);
    expect(readDescriptorBlock('tags={\n\t"Fixes" # "NotATag"\n}\n', "tags")).toEqual(["Fixes"]);
    expect(readDescriptorBlock(GOOD_DESCRIPTOR, "dependencies")).toEqual([]);
  });
});

describe("upsertDescriptorValue", () => {
  it("appends the entry when the key is absent", () => {
    const out = upsertDescriptorValue(GOOD_DESCRIPTOR, "remote_file_id", "123456");
    expect(out).toContain('remote_file_id="123456"\n');
    expect(out.startsWith(GOOD_DESCRIPTOR)).toBe(true);
  });

  it("replaces an existing value in place", () => {
    const out = upsertDescriptorValue(
      'name="X"\nremote_file_id="1" # kept\nversion="2"\n',
      "remote_file_id",
      "42"
    );
    expect(out).toBe('name="X"\nremote_file_id="42" # kept\nversion="2"\n');
  });

  it("keeps CRLF line endings and a BOM", () => {
    const out = upsertDescriptorValue('\uFEFFname="X"\r\n', "remote_file_id", "7");
    expect(out).toBe('\uFEFFname="X"\r\nremote_file_id="7"\r\n');
    const replaced = upsertDescriptorValue('\uFEFFremote_file_id="1"\r\nname="X"\r\n', "remote_file_id", "9");
    expect(replaced).toBe('\uFEFFremote_file_id="9"\r\nname="X"\r\n');
  });

  it("handles a file without a trailing newline", () => {
    expect(upsertDescriptorValue('name="X"', "remote_file_id", "5")).toBe('name="X"\nremote_file_id="5"\n');
  });

  it("does not touch block-valued keys of the same name", () => {
    const out = upsertDescriptorValue('tags={\n\t"Gameplay"\n}\n', "tags", "zzz");
    expect(out).toBe('tags={\n\t"Gameplay"\n}\ntags="zzz"\n');
  });
});
