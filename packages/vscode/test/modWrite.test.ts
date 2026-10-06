import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { PxConfig } from "../src/config";

vi.mock("vscode", () => ({}));
import { assertModWritePath } from "../src/modWrite";

let scratch: string;
let primary: string;
let second: string;
let reference: string;
let game: string;
let cfg: PxConfig;
beforeEach(() => {
  fs.mkdirSync(".local/testing", { recursive: true });
  scratch = fs.mkdtempSync(path.resolve(".local/testing/mod-write-"));
  [primary, second, reference, game] = ["Primary", "Second", "Reference", "Vanilla"].map((name) =>
    path.join(scratch, name)
  );
  for (const root of [primary, second, reference, game]) fs.mkdirSync(root);
  cfg = {
    modPath: primary,
    workspaceMods: [second],
    parentPaths: [reference, second],
    gamePath: game,
  } as PxConfig;
});
afterEach(() => fs.rmSync(scratch, { recursive: true, force: true }));

it("allows the selected second workspace mod although it is also indexed in parentPaths", () => {
  expect(() =>
    assertModWritePath({ ...cfg, modPath: second }, path.join(second, "common/dynasties/new.txt"))
  ).not.toThrow();
});

it("recognizes the selected writable workspace mod through its physical alias", () => {
  const alias = path.join(scratch, "SecondAlias");
  fs.symlinkSync(second, alias, process.platform === "win32" ? "junction" : "dir");
  expect(() =>
    assertModWritePath({ ...cfg, modPath: alias }, path.join(alias, "localization/english/new_l_english.yml"))
  ).not.toThrow();
});

it("still rejects a selected reference root that is not a writable workspace mod", () => {
  expect(() => assertModWritePath({ ...cfg, modPath: reference }, path.join(reference, "new.txt"))).toThrow(
    "Vanilla and reference files are read-only"
  );
});

it("keeps vanilla read-only even if it is listed as a writable workspace root", () => {
  expect(() =>
    assertModWritePath({ ...cfg, modPath: game, workspaceMods: [game] }, path.join(game, "new.txt"))
  ).toThrow("Vanilla and reference files are read-only");
});

it("does not turn an explicit reference into a writable root through a workspace alias", () => {
  const alias = path.join(scratch, "ReferenceAlias");
  fs.symlinkSync(reference, alias, process.platform === "win32" ? "junction" : "dir");
  expect(() =>
    assertModWritePath(
      { ...cfg, modPath: alias, workspaceMods: [alias], parentPaths: [reference, alias] },
      path.join(alias, "new.txt")
    )
  ).toThrow("Vanilla and reference files are read-only");
});

it("rejects a descendant junction that escapes the selected workspace mod into a reference", () => {
  const link = path.join(second, "common");
  fs.symlinkSync(reference, link, process.platform === "win32" ? "junction" : "dir");
  expect(() => assertModWritePath({ ...cfg, modPath: second }, path.join(link, "new.txt"))).toThrow(
    "Write destination must stay inside the selected mod"
  );
});

it.skipIf(process.platform === "win32")("keeps distinct case-only reference roots protected on POSIX", () => {
  const lower = path.join(scratch, "reference");
  fs.mkdirSync(lower);
  expect(() =>
    assertModWritePath(
      { ...cfg, modPath: reference, workspaceMods: [lower], parentPaths: [reference, lower] },
      path.join(reference, "new.txt")
    )
  ).toThrow("Vanilla and reference files are read-only");
});
