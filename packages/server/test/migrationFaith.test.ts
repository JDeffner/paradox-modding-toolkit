import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  ck3FaithMigration,
  ck3FaithMigration12003,
  faithDecisionKey,
  faithParentKey,
} from "../src/games/ck3/migrations/faith";
import { resolveProfile } from "../src/games/registry";
import { inspectMigration, prepareMigration } from "../src/migrations/engine";
import type {
  MigrationAnswers,
  MigrationContext,
  MigrationRoot,
  MigrationSnapshot,
} from "../src/migrations/sdk";
import { devPath } from "../../../scripts/devPaths";

const R = "common/religion/religion_types",
  F = "common/religion/faith_types",
  T = "common/religion/rite_types",
  D = "common/religion/doctrine_types",
  N = "common/religion/tenet_types";
// Authored schema fragments reflect the documented boundaries, not shipped definitions.
const DOCS: Record<string, string> = {
  [`${R}/_religion_types.info`]:
    "example = { religion_details = { family = f graphical_faith = g piety_icon_group = p tenet_background_icon = b theocracy_government_type = t } doctrine = d traits = {} reserved_male_names = {} reserved_female_names = {} localization = {} holy_order_names = {} holy_order_maa = {} pagan_roots = yes custom_faith_icons = {} main_holy_site = x holy_sites_max = 9 eminent_holy_sites_max = 3 holy_sites_min = 1 eminent_holy_sites_min = 1 }",
  [`${F}/_faith_types.info`]:
    "example = { faith_details = { religion = r color = {} icon = x reformed_icon = x religious_head = t head_of_rite = t graphical_faith = g theocracy_government_type = t } origin = x holy_sites = {} eminent_holy_sites = {} tenets = {} doctrines = {} tenet_selection_pair = {} reserved_male_names = {} reserved_female_names = {} cultures = {} historical = no main_rite = x localization = {} holy_order_names = {} }",
  [`${T}/_rite_types.info`]:
    "example = { name = {} desc = {} icon = x color = {} founder = t faith = x cultures = {} convert = yes create = yes tenets = {} doctrines = {} tenet_selection_pair = {} }",
  [`${N}/_tenet_types.info`]:
    "example = { icon = {} name = {} desc = {} visible = yes requires_dlc_flag = x parameters = {} piety_cost = {} is_shown = {} can_pick = {} character_modifier = {} traits = {} special_parameters = {} }",
  [`${D}/doctrines.txt`]: "group = { doctrine_one = {} doctrine_two = {} }",
  [`${N}/tenets.txt`]: "tenet_one = {} tenet_two = {} tenet_fallback = {}",
  "common/defines/religion.txt":
    "NFaith = { FAITH_EMINENT_HOLY_SITES_MAX_DEFAULT = 3 FAITH_HOLY_SITES_MAX_DEFAULT = 9 FAITH_EMINENT_HOLY_SITES_MIN_DEFAULT = 1 FAITH_HOLY_SITES_MIN_DEFAULT = 1 }",
  "history/_characters.info": "character = { faith = key religion = key rite = key }",
  "history/_provinces.info": "faith = key rite = key",
  "history/faiths/_faith_history.info":
    "date = { main_rite = key religious_head = key rite = { rite = key } }",
};
const SOURCE = { [`${R}/_religion_types.info`]: "religion = { family = f faiths = { faith = {} } }" };
function context(
  mod: Record<string, string>,
  target: Record<string, string> = DOCS,
  source: Record<string, string> = SOURCE
): MigrationContext {
  const files: Record<MigrationRoot, Record<string, string>> = { mod, target, source };
  return {
    gameId: "ck3",
    list(root, prefix = "") {
      return Object.keys(files[root]).filter((p) => !prefix || p === prefix || p.startsWith(prefix + "/"));
    },
    readText(root, p) {
      return Object.hasOwn(files[root], p) ? files[root][p] : undefined;
    },
    readBytes(root, p) {
      const t = this.readText(root, p);
      return t === undefined ? undefined : new TextEncoder().encode(t);
    },
    fileInfo(root, p) {
      const bytes = this.readBytes(root, p);
      return bytes ? { size: bytes.length } : undefined;
    },
  };
}
function output(
  proposal: Awaited<ReturnType<typeof ck3FaithMigration.prepare>>,
  mod: Record<string, string>
): Record<string, string> {
  const result = { ...mod };
  for (const change of proposal.groups.flatMap((g) => g.changes)) {
    if (change.kind === "create" || change.kind === "replace")
      result[change.path] = new TextDecoder("utf-8", { ignoreBOM: true }).decode(change.bytes);
    else if (change.kind === "text") {
      let text = result[change.path];
      for (const edit of [...change.edits].sort((a, b) => b.start - a.start))
        text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
      result[change.path] = text;
    } else delete result[change.path];
  }
  return result;
}
const baseAnswers = {
  [faithDecisionKey("parent")]: "independent",
  [faithDecisionKey("child")]: "rite",
  [faithParentKey("child")]: "parent",
};
async function answerAll(
  c: MigrationContext,
  initial: MigrationAnswers,
  choose?: (id: string) => string | undefined
): Promise<MigrationAnswers> {
  const answers = { ...initial };
  for (let pass = 0; pass < 4; pass++) {
    const i = await ck3FaithMigration.inspect(c, answers);
    let changed = false;
    for (const q of i.questions)
      if (!Object.hasOwn(answers, q.id)) {
        answers[q.id] =
          choose?.(q.id) ??
          (q.id.includes(":holy-site:")
            ? "eminent"
            : q.id.startsWith("reference:")
              ? "rite"
              : q.options![0].value);
        changed = true;
      }
    if (!changed) break;
  }
  return answers;
}

describe("faith and rite conversion", () => {
  it("preserves file-local constants when splitting faith definitions", async () => {
    const p = `${R}/constants.txt`;
    const mod = {
      [p]: "@red = 0.25\nreligion = { family = f faiths = { parent = { color = { @red 0 0 } } } }\n# untouched\n",
    };
    const c = context(mod);
    const plan = await ck3FaithMigration.prepare(c, { [faithDecisionKey("parent")]: "independent" });
    expect(plan.unresolved).toEqual([]);
    const result = output(plan, mod);
    expect(result[`${F}/px_migrated_parent.txt`]).toContain("color = { 0.25 0 0 }");
    expect(result[p]).toContain("@red = 0.25");
    expect(result[p]).toContain("# untouched");
  });
  it("keeps an existing rite's parent reference typed as a faith", async () => {
    const mod = {
      [`${R}/custom.txt`]: "religion = { family = f faiths = { parent = {} child = {} } }",
      [`${T}/existing.txt`]: "existing = { faith = child }",
    };
    const c = context(mod);
    const inspection = await ck3FaithMigration.inspect(c, baseAnswers);
    expect(
      inspection.questions.find((q) => q.id.startsWith("reference:"))?.options?.map((option) => option.value)
    ).toEqual(["faith"]);
    const answers = await answerAll(c, baseAnswers, (id) =>
      id.startsWith("reference:") ? "faith" : undefined
    );
    const plan = await ck3FaithMigration.prepare(c, answers);
    expect(plan.unresolved).toEqual([]);
    expect(output(plan, mod)[`${T}/existing.txt`]).toContain("faith = parent");
    expect(output(plan, mod)[`${T}/existing.txt`]).not.toContain("rite = child");
    const invalid = {
      ...answers,
      [inspection.questions.find((q) => q.id.startsWith("reference:"))!.id]: "rite",
    };
    expect((await ck3FaithMigration.prepare(c, invalid)).groups).toEqual([]);
  });
  it("keeps same-named constants separate across moved files and ignores quoted prose", async () => {
    const mod = {
      [`${R}/one.txt`]:
        '@color = 0.2\n@alias = @color\none = { family = f faiths = { first = { color = { @alias 0 0 } localization = { god = "@color" } } } }',
      [`${R}/two.txt`]: "@color = 0.8\ntwo = { family = f faiths = { second = { color = { @color 0 0 } } } }",
    };
    const plan = await ck3FaithMigration.prepare(context(mod), {
      [faithDecisionKey("first")]: "independent",
      [faithDecisionKey("second")]: "independent",
    });
    expect(plan.unresolved).toEqual([]);
    const result = output(plan, mod);
    expect(result[`${F}/px_migrated_first.txt`]).toContain("color = { 0.2 0 0 }");
    expect(result[`${F}/px_migrated_second.txt`]).toContain("color = { 0.8 0 0 }");
    expect(result[`${F}/px_migrated_first.txt`]).toContain('god = "@color"');
  });
  it.each([
    "",
    "@color = 0.1\n@color = 0.2\n",
    "@color = @other\n@other = @color\n",
    "@color = @[ 1 + 2 ]\n",
  ])("blocks unresolved or ambiguous moved bindings (%s)", async (declarations) => {
    const mod = {
      [`${R}/custom.txt`]:
        declarations + "religion = { family = f faiths = { parent = { color = { @color 0 0 } } } }",
    };
    const plan = await ck3FaithMigration.prepare(context(mod), {
      [faithDecisionKey("parent")]: "independent",
    });
    expect(plan.groups).toEqual([]);
    expect(plan.unresolved.some((finding) => finding.severity === "error")).toBe(true);
  });
  it("resolves target-file bindings before rebasing unchanged faith fields", async () => {
    const p = `${R}/religion.txt`;
    const source = {
      ...SOURCE,
      [p]: "@color = 0.2\nreligion = { family = f faiths = { parent = { color = { @color 0 0 } } } }",
    };
    const target = {
      ...DOCS,
      [p]: "religion = { religion_details = { family = f } }",
      [`${F}/parent.txt`]:
        "@color = 0.7\nparent = { faith_details = { religion = religion color = { @color 0 0 } } }",
    };
    const c = context({ [p]: source[p] }, target, source);
    const plan = await ck3FaithMigration.prepare(
      c,
      await answerAll(c, { [faithDecisionKey("parent")]: "independent" })
    );
    expect(plan.unresolved).toEqual([]);
    expect(output(plan, { [p]: source[p] })[`${F}/px_migrated_parent.txt`]).toContain("color = { 0.7 0 0 }");
  });
  it("compares binding values when both mod and target changed a faith field", async () => {
    const p = `${R}/religion.txt`;
    const definition = "religion = { family = f faiths = { parent = { color = { @color 0 0 } } } }";
    const source = { ...SOURCE, [p]: "@color = 0.1\n" + definition };
    const mod = { [p]: "@color = 0.2\n" + definition };
    const target = {
      ...DOCS,
      [p]: "religion = { religion_details = { family = f } }",
      [`${F}/parent.txt`]:
        "@color = 0.7\nparent = { faith_details = { religion = religion color = { @color 0 0 } } }",
    };
    const c = context(mod, target, source);
    const inspection = await ck3FaithMigration.inspect(c, { [faithDecisionKey("parent")]: "independent" });
    expect(inspection.questions.some((q) => q.id === "faith:parent:conflict:color")).toBe(true);
    const plan = await ck3FaithMigration.prepare(
      c,
      await answerAll(c, {
        [faithDecisionKey("parent")]: "independent",
        "faith:parent:conflict:color": "mod",
      })
    );
    expect(plan.unresolved).toEqual([]);
    expect(output(plan, mod)[`${F}/px_migrated_parent.txt`]).toContain("color = { 0.2 0 0 }");
  });
  it("preserves local cost bindings while moving and rewriting a custom tenet", async () => {
    const mod = {
      [`${R}/custom.txt`]: "religion = { faiths = { parent = { doctrine = custom_tenet } } }",
      [`${D}/custom.txt`]:
        "@cost = 100\ncustom_tenet = { parameters = { enabled = yes } piety_cost = { value = @cost if = { limit = { has_doctrine = tenet_one } multiply = 2 } } }\nunrelated = { keep = yes }",
      "gfx/interface/icons/faith_doctrines/custom_tenet.dds": "icon bytes",
    };
    const c = context(mod);
    const plan = await ck3FaithMigration.prepare(
      c,
      await answerAll(c, {
        [faithDecisionKey("parent")]: "independent",
        "doctrine:custom_tenet:database": "tenet",
      })
    );
    expect(plan.unresolved).toEqual([]);
    const result = output(plan, mod);
    expect(result[`${N}/px_migrated_custom_tenet.txt`]).toContain("value = 100");
    expect(result[`${N}/px_migrated_custom_tenet.txt`]).toContain("rite_has_tenet = tenet_one");
    expect(result[`${D}/custom.txt`]).toContain("@cost = 100");
    expect(result[`${D}/custom.txt`]).toContain("unrelated = { keep = yes }");
  });
  it("registers a versioned recipe with stable author decision keys", () => {
    expect(ck3FaithMigration.manifest).toMatchObject({
      id: "ck3.faiths-to-rites.decisions",
      revision: "2",
      kind: "recipe",
      fromVersion: "1.19.0.6",
      toVersion: "1.20.0.2",
    });
    expect(
      resolveProfile("ck3").migrations.some((r) => r.manifest.id === ck3FaithMigration.manifest.id)
    ).toBe(true);
    expect(resolveProfile("vic3").migrations).toEqual([]);
    expect(resolveProfile("eu5").migrations).toEqual([]);
  });
  it("converts two communities, preserves inheritance, comments, BOM, DLC and unrelated content", async () => {
    const p = `${R}/custom.txt`;
    const mod = {
      [p]: "\uFEFF# file\r\ncustom = {\r\n family = rf\r\n doctrine_background_icon = frame\r\n doctrine = doctrine_one\r\n traits = { virtues = { brave } }\r\n reserved_male_names = { Name }\r\n localization = { god = custom_god }\r\n holy_order_names = { { name = order } }\r\n faiths = {\r\n # parent comment\r\n parent = { color = { 1 0 0 } doctrine = tenet_one doctrine = doctrine_two holy_site = site_one doctrine_selection_pair = { requires_dlc_flag = dlc doctrine = tenet_two fallback_doctrine = tenet_fallback } }\r\n child = { color = { 0 1 0 } doctrine = tenet_two cultures = { c } }\r\n }\r\n}\r\nunrelated = { keep = yes }\r\n",
    };
    const c = context(mod);
    const answers = await answerAll(c, baseAnswers);
    const plan = await ck3FaithMigration.prepare(c, answers);
    expect(plan.unresolved).toEqual([]);
    expect(plan.groups).toHaveLength(1);
    const result = output(plan, mod);
    expect(result[p]).toContain("religion_details");
    expect(result[p]).toContain("tenet_background_icon = frame");
    expect(result[p]).toContain("traits = { virtues = { brave } }");
    expect(result[p]).toContain("localization = { god = custom_god }");
    expect(result[p]).toContain("holy_order_names");
    expect(result[p]).toContain("# parent comment");
    expect(result[p].endsWith("unrelated = { keep = yes }\r\n")).toBe(true);
    expect(result[p].charCodeAt(0)).toBe(0xfeff);
    const parent = result[`${F}/px_migrated_parent.txt`];
    expect(parent).toContain("religion = custom");
    expect(parent).toMatch(/tenets\s*=\s*\{\s*tenet_one/);
    expect(parent).toMatch(/doctrines\s*=\s*\{\s*doctrine_two/);
    expect(parent).toContain("eminent_holy_sites");
    expect(parent).not.toContain("main_rite");
    expect(parent).toContain("tenet_selection_pair");
    expect(parent).toContain("fallback_tenet = tenet_fallback");
    expect(result[`${T}/px_migrated_child.txt`]).toContain("faith = parent");
    expect(result[`${T}/px_migrated_child.txt`].charCodeAt(0)).toBe(0xfeff);
    expect((await ck3FaithMigration.inspect(context(result), {})).applicability).toBe("not-applicable");
    expect((await ck3FaithMigration.prepare(context(result), {})).groups).toEqual([]);
    expect(plan.checks.find((c) => c.id === "faith-target-game")).toMatchObject({
      necessity: "advisory",
      status: "not-run",
    });
  });
  it("rebases a vanilla religion on new upstream defaults and offers genuine conflicts", async () => {
    const p = `${R}/vanilla.txt`;
    const source = {
      ...SOURCE,
      [p]: "religion = { family = old traits = { virtues = { brave } } localization = { god = old } faiths = { parent = {} } }",
    };
    const mod = {
      [p]: "religion = { family = old traits = { virtues = { generous } } localization = { god = mod } faiths = { parent = {} } }",
    };
    const target = {
      ...DOCS,
      [p]: "religion = { religion_details = { family = new } traits = { virtues = { brave } } localization = { god = target } holy_sites_max = 12 }",
    };
    const c = context(mod, target, source);
    const answers = await answerAll(c, { [faithDecisionKey("parent")]: "independent" });
    expect(answers["religion:religion:conflict:localization"]).toBe("mod");
    const plan = await ck3FaithMigration.prepare(c, answers);
    expect(plan.unresolved).toEqual([]);
    const result = output(plan, mod)[p];
    expect(result).toContain("family = new");
    expect(result).toContain("virtues = { generous }");
    expect(result).toContain("god = mod");
    expect(result).toContain("holy_sites_max = 12");
  });
  it("requires a deliberate decision for faith-only child fields and refuses conflicting transfers", async () => {
    const mod = {
      [`${R}/custom.txt`]:
        "religion = { family = f faiths = { parent = { religious_head = parent_head } child = { religious_head = child_head reserved_male_names = { N } } } }",
    };
    const c = context(mod);
    const i = await ck3FaithMigration.inspect(c, baseAnswers);
    expect(i.questions.map((q) => q.id)).toContain("faith:child:field:religious_head");
    const answers = await answerAll(c, baseAnswers, (id) =>
      id === "faith:child:field:religious_head" ? "transfer" : undefined
    );
    const plan = await ck3FaithMigration.prepare(c, answers);
    expect(plan.groups).toEqual([]);
    expect(plan.unresolved.some((f) => f.id === "transfer-conflict:child:religious_head")).toBe(true);
    answers["faith:child:field:religious_head"] = "parent";
    answers["faith:child:field:reserved_male_names"] = "transfer";
    const fixed = await ck3FaithMigration.prepare(c, answers);
    expect(fixed.unresolved).toEqual([]);
    expect(output(fixed, mod)[`${F}/px_migrated_parent.txt`]).toContain("reserved_male_names = { N }");
  });
  it("validates ordinary and eminent choices against captured target limits", async () => {
    const mod = {
      [`${R}/custom.txt`]: "religion = { family = f faiths = { parent = { holy_site = a holy_site = b } } }",
    };
    const target = {
      ...DOCS,
      "common/defines/religion.txt":
        "X = { FAITH_EMINENT_HOLY_SITES_MAX_DEFAULT = 1 FAITH_HOLY_SITES_MAX_DEFAULT = 9 FAITH_EMINENT_HOLY_SITES_MIN_DEFAULT = 1 FAITH_HOLY_SITES_MIN_DEFAULT = 1 }",
    };
    const c = context(mod, target);
    const answers = await answerAll(c, { [faithDecisionKey("parent")]: "independent" });
    let plan = await ck3FaithMigration.prepare(c, answers);
    expect(plan.unresolved.some((f) => f.id.endsWith(":eminent_holy_sites_max"))).toBe(true);
    answers["faith:parent:holy-site:b"] = "ordinary";
    plan = await ck3FaithMigration.prepare(c, answers);
    expect(plan.unresolved).toEqual([]);
    expect(output(plan, mod)[`${F}/px_migrated_parent.txt`]).toMatch(/holy_sites = \{ b \}/);
  });
  it("updates exact versus broad references and history assignments without changing comments or strings", async () => {
    const events = "events/custom.txt",
      chars = "history/characters/custom.txt",
      provinces = "history/provinces/1.txt";
    const mod = {
      [`${R}/custom.txt`]: "religion = { faiths = { parent = {} child = {} } }",
      [events]:
        '\uFEFFnamespace = custom\n# faith:child\ncustom.1 = { trigger = { faith = faith:child } title = "faith:child is prose" }',
      [chars]: "1 = { religion = child 1000.1.1 = { faith = parent } }",
      [provinces]: "faith = child",
    };
    const c = context(mod);
    const answers = await answerAll(c, baseAnswers, (id) =>
      id.startsWith(`reference:${events}:`) ? "faith" : undefined
    );
    const plan = await ck3FaithMigration.prepare(c, answers);
    expect(plan.unresolved).toEqual([]);
    const out = output(plan, mod);
    expect(out[events]).toContain("faith = faith:parent");
    expect(out[events]).toContain("# faith:child");
    expect(out[events]).toContain('"faith:child is prose"');
    expect(out[chars]).toContain("rite = child");
    expect(out[chars]).toContain("1000.1.1 = { faith = parent }");
    expect(out[provinces]).toContain("faith = parent\nrite = child");
  });
  it("keeps independent faith history dated ownership and blocks conflicting child history", async () => {
    const p = "history/faiths/child.txt";
    const mod = {
      [`${R}/custom.txt`]: "religion = { faiths = { parent = {} child = {} } }",
      [p]: "1000.1.1 = { main_rite = child religious_head = title }",
    };
    const c = context(mod);
    const answers = await answerAll(c, baseAnswers);
    const plan = await ck3FaithMigration.prepare(c, answers);
    expect(plan.unresolved).toEqual([]);
    const out = output(plan, mod);
    expect(out["history/faiths/parent.txt"]).toContain(
      "1000.1.1 = { main_rite = child religious_head = title }"
    );
    const conflicting = context({ ...mod, "history/faiths/parent.txt": "900.1.1 = { main_rite = prior }" });
    expect(
      (await ck3FaithMigration.prepare(conflicting, answers)).unresolved.some(
        (f) => f.id === "history-collision:child"
      )
    ).toBe(true);
  });
  it("blocks unconverted grouped history owned by a community becoming a rite", async () => {
    const mod = {
      [`${R}/custom.txt`]: "religion = { faiths = { parent = {} child = {} } }",
      "history/faiths/00_custom.txt": "child = { 1000.1.1 = { religious_head = title } }",
    };
    const c = context(mod);
    const plan = await ck3FaithMigration.prepare(c, await answerAll(c, baseAnswers));
    expect(plan.groups).toEqual([]);
    expect(plan.unresolved.some((finding) => finding.path === "history/faiths/00_custom.txt")).toBe(true);
  });
  it("does not claim a dynamic main rite while effective dated history selects a scripted rite", async () => {
    const p = `${R}/custom.txt`;
    const mod = { [p]: "religion = { faiths = { parent = { doctrine = tenet_one } } }" };
    const source = { ...SOURCE, ...mod };
    const target = {
      ...DOCS,
      [p]: "religion = { religion_details = {} }",
      [`${F}/parent.txt`]: "parent = { faith_details = { religion = religion } main_rite = scripted }",
      [`${T}/scripted.txt`]: "scripted = { faith = parent tenets = { tenet_two } }",
      "history/faiths/00_custom.txt": "parent = { 1000.1.1 = { main_rite = scripted } }",
    };
    const c = context(mod, target, source);
    const plan = await ck3FaithMigration.prepare(
      c,
      await answerAll(c, { [faithDecisionKey("parent")]: "independent", "faith:parent:main-rite": "dynamic" })
    );
    expect(plan.groups).toEqual([]);
    expect(plan.unresolved.some((finding) => finding.message.includes("main"))).toBe(true);
    const retained = await ck3FaithMigration.prepare(
      c,
      await answerAll(c, { [faithDecisionKey("parent")]: "independent", "faith:parent:main-rite": "target" })
    );
    expect(retained.unresolved).toEqual([]);
    expect(output(retained, mod)[`${F}/px_migrated_parent.txt`]).toContain("main_rite = scripted");
  });
  it("keeps converted core tenets and DLC pairs when choosing a dynamic main rite", async () => {
    const p = `${R}/custom.txt`;
    const mod = {
      [p]: "religion = { faiths = { parent = { doctrine = tenet_one doctrine_selection_pair = { requires_dlc_flag = dlc doctrine = tenet_two fallback_doctrine = tenet_fallback } } } }",
    };
    const source = { ...SOURCE, ...mod };
    const target = {
      ...DOCS,
      [p]: "religion = { religion_details = {} }",
      [`${F}/parent.txt`]: "parent = { faith_details = { religion = religion } main_rite = scripted }",
      [`${T}/scripted.txt`]: "scripted = { faith = parent tenets = { tenet_two } }",
    };
    const c = context(mod, target, source);
    const plan = await ck3FaithMigration.prepare(
      c,
      await answerAll(c, { [faithDecisionKey("parent")]: "independent", "faith:parent:main-rite": "dynamic" })
    );
    expect(plan.unresolved).toEqual([]);
    const text = output(plan, mod)[`${F}/px_migrated_parent.txt`];
    expect(text).toMatch(/tenets\s*=\s*\{\s*tenet_one/);
    expect(text).toContain("tenet_selection_pair");
    expect(text).toContain("fallback_tenet = tenet_fallback");
    expect(text).not.toContain("main_rite");
  });
  it("blocks a filename-owned history transfer into an existing grouped parent history", async () => {
    const mod = {
      [`${R}/custom.txt`]: "religion = { faiths = { parent = {} child = {} } }",
      "history/faiths/child.txt": "1000.1.1 = { religious_head = title }",
    };
    const target = {
      ...DOCS,
      "history/faiths/00_custom.txt": "parent = { 900.1.1 = { main_rite = scripted } }",
    };
    const c = context(mod, target);
    const plan = await ck3FaithMigration.prepare(c, await answerAll(c, baseAnswers));
    expect(plan.groups).toEqual([]);
    expect(
      plan.unresolved.some(
        (finding) => finding.id === "history-collision:child" && finding.message.includes("00_custom.txt")
      )
    ).toBe(true);
  });
  it("converts custom tenet flags, UI selection and unambiguous Rite cost scope", async () => {
    const mod = {
      "gfx/interface/icons/faith_doctrines/icon.dds": "DDS icon bytes",
      [`${R}/custom.txt`]: "religion = { faiths = { parent = { doctrine = custom_tenet } } }",
      [`${D}/custom.txt`]:
        "# keep\ncustom_tenet = { icon = icon parameters = { first = yes second = yes } piety_cost = { value = 100 if = { limit = { religion_tag = religion has_doctrine = tenet_one } multiply = 2 } } can_pick = { NOT = { doctrine:tenet_one = { is_in_list = selected_doctrines } } } }\nunrelated = { group = yes }",
    };
    const c = context(mod);
    const answers = await answerAll(c, {
      [faithDecisionKey("parent")]: "independent",
      "doctrine:custom_tenet:database": "tenet",
    });
    const plan = await ck3FaithMigration.prepare(c, answers);
    expect(plan.unresolved).toEqual([]);
    const out = output(plan, mod);
    const tenet = out[`${N}/px_migrated_custom_tenet.txt`];
    expect(tenet).toContain("parameters = { first second }");
    expect(tenet).toContain("faith = { religion = religion:religion }");
    expect(tenet).toContain("rite_has_tenet = tenet_one");
    expect(tenet).toContain("flag:tenet_one");
    expect(tenet).toContain("selected_tenets");
    expect(out["gfx/interface/icons/faith_tenets/icon.dds"]).toBe("DDS icon bytes");
    expect(await ck3FaithMigration.discover(c)).toEqual([
      { root: "mod", path: "gfx/interface/icons/faith_doctrines/icon.dds" },
    ]);
    expect(out[`${D}/custom.txt`]).toContain("# keep");
    expect(out[`${D}/custom.txt`]).toContain("unrelated = { group = yes }");
  });
  it("preserves new target faith defaults while retaining an intentional override", async () => {
    const p = `${R}/vanilla.txt`;
    const source = {
      ...SOURCE,
      [p]: "religion = { family = f faiths = { parent = { color = { 1 0 0 } doctrine = tenet_one } } }",
    };
    const mod = {
      [p]: "religion = { family = f faiths = { parent = { color = { 0 1 0 } doctrine = tenet_one } } }",
    };
    const target = {
      ...DOCS,
      [p]: "religion = { religion_details = { family = f } }",
      [`${F}/vanilla.txt`]:
        "parent = { faith_details = { religion = religion color = { 1 0 0 } head_of_rite = new_head } tenets = { tenet_two } historical = yes }",
    };
    const c = context(mod, target, source);
    const answers = await answerAll(c, { [faithDecisionKey("parent")]: "independent" });
    const proposal = await ck3FaithMigration.prepare(c, answers);
    expect(proposal.unresolved).toEqual([]);
    const faith = output(proposal, mod)[`${F}/px_migrated_parent.txt`];
    expect(faith).toContain("color = { 0 1 0 }");
    expect(faith).toContain("head_of_rite = new_head");
    expect(faith).toContain("tenets = { tenet_two }");
    expect(faith).toContain("historical = yes");
  });
  it("changes the typed operations inside an exact rite scope", async () => {
    const p = "events/scopes.txt";
    const mod = {
      [`${R}/custom.txt`]: "religion = { faiths = { parent = {} child = {} } }",
      [p]: "namespace = scope_test\nscope_test.1 = { trigger = { faith:child = { has_doctrine = doctrine_one NOT = { has_doctrine = tenet_one } } } }",
    };
    const c = context(mod);
    const proposal = await ck3FaithMigration.prepare(c, await answerAll(c, baseAnswers));
    expect(proposal.unresolved).toEqual([]);
    const text = output(proposal, mod)[p];
    expect(text).toContain("rite:child");
    expect(text).toContain("rite_has_doctrine = doctrine_one");
    expect(text).toContain("rite_has_tenet = tenet_one");
  });
  it.each(["parameters = { numeric = 2 }", "piety_cost = { scripted_unknown_cost = yes }"])(
    "blocks unsupported custom-tenet behavior: %s",
    async (body) => {
      const c = context({
        [`${R}/custom.txt`]: "religion = { faiths = { parent = { doctrine = custom_tenet } } }",
        [`${D}/custom.txt`]: `custom_tenet = { ${body} }`,
      });
      const answers = await answerAll(c, {
        [faithDecisionKey("parent")]: "independent",
        "doctrine:custom_tenet:database": "tenet",
      });
      const p = await ck3FaithMigration.prepare(c, answers);
      expect(p.groups).toEqual([]);
      expect(p.unresolved.some((f) => f.path === `${D}/custom.txt`)).toBe(true);
    }
  );
  it.each([
    "trigger = { faith = faith:$which$ }",
    "trigger = { unsupported_effect = faith:child }",
    "list = { child }",
    "trigger = { faith = faith:child.religious_head }",
    "list = { faith:child }",
  ])("reports unsupported consumers with a path: %s", async (consumer) => {
    const c = context({
      [`${R}/custom.txt`]: "religion = { faiths = { parent = {} child = {} } }",
      "events/unsafe.txt": consumer,
    });
    const a = await answerAll(c, baseAnswers);
    const p = await ck3FaithMigration.prepare(c, a);
    expect(p.groups).toEqual([]);
    expect(p.unresolved.some((f) => f.path === "events/unsafe.txt")).toBe(true);
  });
  it("rejects duplicate IDs, destination collisions, parse errors and unreadable inputs", async () => {
    const p = `${R}/custom.txt`;
    const initial = { [p]: "religion = { faiths = { parent = {} } }" };
    for (const mod of [
      { ...initial, [`${R}/other.txt`]: "other = { faiths = { parent = {} } }" },
      { ...initial, [`${F}/px_migrated_parent.txt`]: "existing = {}" },
      { [p]: "religion = { faiths = { parent = {}" },
    ]) {
      const c = context(mod);
      const plan = await ck3FaithMigration.prepare(
        c,
        await answerAll(c, { [faithDecisionKey("parent")]: "independent" })
      );
      expect(plan.groups).toEqual([]);
      expect(plan.unresolved.length, JSON.stringify(mod)).toBeGreaterThan(0);
    }
    const c = context(initial);
    c.readText = () => undefined;
    expect(
      (await ck3FaithMigration.prepare(c, {})).unresolved.some((f) => f.id.startsWith("unreadable:"))
    ).toBe(true);
  });
  it("requires complete target schema evidence and valid parent choices", async () => {
    const mod = { [`${R}/custom.txt`]: "religion = { faiths = { child = {} } }" };
    expect((await ck3FaithMigration.inspect(context(mod, {}), {})).applicability).toBe("unknown");
    const i = await ck3FaithMigration.inspect(context(mod), { [faithDecisionKey("child")]: "rite" });
    expect(i.questions.some((q) => q.id === faithParentKey("child"))).toBe(false);
    expect(i.findings.some((f) => f.id === "missing-parent-faith:child")).toBe(true);
  });
  it("handles prototype-like IDs and checks the actual migration engine entry point", async () => {
    const mod = { [`${R}/custom.txt`]: "religion = { faiths = { __proto__ = {} constructor = {} } }" };
    const c = context(mod);
    const a = await answerAll(c, {
      [faithDecisionKey("__proto__")]: "independent",
      [faithDecisionKey("constructor")]: "rite",
      [faithParentKey("constructor")]: "__proto__",
    });
    const snapshot: MigrationSnapshot = {
      gameId: "ck3",
      metadata: {},
      files: (["mod", "source", "target"] as const).flatMap((root) =>
        c.list(root).map((path) => ({ root, path, bytes: c.readBytes(root, path)! }))
      ),
    };
    const inspected = await inspectMigration(ck3FaithMigration, snapshot, a);
    expect(inspected.invalidAnswers).toEqual([]);
    expect(inspected.missingAnswers).toEqual([]);
    const plan = await prepareMigration(ck3FaithMigration, snapshot, a, "test-recipe");
    expect(plan.files.length).toBe(3);
  });
});

const sourcePath = devPath("compatchBasePath"),
  targetPath = devPath("compatchTargetPath");
const sourceSchema = sourcePath && path.join(sourcePath, R, "_religion_types.info");
const targetLauncher = targetPath && path.join(targetPath, "..", "launcher", "launcher-settings.json");
const targetBuild =
  targetLauncher && fs.existsSync(targetLauncher)
    ? JSON.parse(fs.readFileSync(targetLauncher, "utf8")).rawVersion
    : undefined;
const applicableSources =
  sourceSchema &&
  fs.existsSync(sourceSchema) &&
  /\bfaiths\s*=/.test(fs.readFileSync(sourceSchema, "utf8")) &&
  targetPath &&
  ["1.20.0.2", "1.20.0.3"].includes(targetBuild) &&
  fs.existsSync(path.join(targetPath, F, "_faith_types.info")) &&
  fs.existsSync(path.join(targetPath, T, "_rite_types.info"));
it.skipIf(!applicableSources)(
  "converts custom communities against real schemas (requires nested-faith source and verified Crozier target)",
  async () => {
    function capture(root: string, prefix: string): Record<string, string> {
      const out: Record<string, string> = {};
      const folder = path.join(root, prefix);
      if (!fs.existsSync(folder)) return out;
      for (const entry of fs.readdirSync(folder, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || !/\.(txt|info)$/.test(entry.name)) continue;
        const full = path.join(entry.parentPath, entry.name);
        out[path.relative(root, full).replaceAll("\\", "/")] = fs.readFileSync(full, "utf8");
      }
      return out;
    }
    const source = capture(sourcePath!, "common/religion"),
      target = {
        ...capture(targetPath!, "common/religion"),
        ...capture(targetPath!, "common/defines"),
        ...capture(targetPath!, "history"),
      };
    const mod = {
      [`${R}/custom.txt`]:
        "custom_religion = { family = rf_pagan doctrine = doctrine_pluralism_pluralistic traits = { virtues = { brave } } faiths = { parent = { color = { 0.2 0.3 0.4 } doctrine = tenet_ritual_celebrations holy_site = rome } child = { color = { 0.4 0.3 0.2 } doctrine = tenet_ritual_celebrations } } }",
    };
    const c = context(mod, target, source);
    const a = await answerAll(c, baseAnswers);
    const recipe = targetBuild === "1.20.0.3" ? ck3FaithMigration12003 : ck3FaithMigration;
    const plan = await recipe.prepare(c, a);
    expect(plan.unresolved).toEqual([]);
    expect(plan.groups).toHaveLength(1);
  }
);
