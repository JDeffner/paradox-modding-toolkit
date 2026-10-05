import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { devPath } from "../../../scripts/devPaths";
import { resolveProfile } from "../src/games/registry";
import { ck3FaithMigration12003 } from "../src/games/ck3/migrations/faith";
import { ck3PortraitMaskMigration12003, maskBatchKey } from "../src/games/ck3/migrations/masks";
import { inspectMigration } from "../src/migrations/engine";
import { planMigrationRoutes } from "../src/migrations/routes";
import { createMigrationSnapshot, runMigrationFixture } from "../src/migrations/testing";
import { inspectDdsResource } from "../src/dds/migrateMips";
import { parseScript } from "../src/parser/parser";
import type { AssignmentNode, BlockNode } from "../src/parser/cst";
import type { MigrationAnswers } from "../src/migrations/sdk";

describe("explicit Crozier hotfix migration routes", () => {
  it.each(["1.20.0.2", "1.20.0.3"])("offers both built-ins for exact target %s", (target) => {
    const catalog = resolveProfile("ck3").migrations!.map((entry) => entry.manifest);
    const suffix = target === "1.20.0.3" ? ".1.20.0.3" : "";
    const result = planMigrationRoutes(catalog, "ck3", "1.19.0.6", target);
    expect(result.issues).toEqual([]);
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0].transitions).toHaveLength(1);
    expect(result.routes[0].entryIds).toEqual([
      `ck3.faiths-to-rites.decisions${suffix}`,
      `ck3.portrait-mask-mips${suffix}`,
    ]);
    expect(result.routes[0].transitions[0]).toMatchObject({ fromVersion: "1.19.0.6", toVersion: target });
  });

  it("does not infer unaudited hotfixes or a transition between the two targets", () => {
    const catalog = resolveProfile("ck3").migrations!.map((entry) => entry.manifest);
    expect(planMigrationRoutes(catalog, "ck3", "1.19.0.6", "1.20.0.4").routes).toEqual([]);
    expect(planMigrationRoutes(catalog, "ck3", "1.20.0.2", "1.20.0.3").routes).toEqual([]);
  });
});

const sourcePath = devPath("compatchBasePath");
const targetPath = devPath("compatchTargetPath");
const targetLauncher = targetPath && path.join(targetPath, "..", "launcher", "launcher-settings.json");
const exactTarget =
  targetLauncher && fs.existsSync(targetLauncher)
    ? JSON.parse(fs.readFileSync(targetLauncher, "utf8")).rawVersion
    : undefined;
const sourceSchema =
  sourcePath && path.join(sourcePath, "common/religion/religion_types/_religion_types.info");
const oldSource =
  sourceSchema && fs.existsSync(sourceSchema) && /\bfaiths\s*=/.test(fs.readFileSync(sourceSchema, "utf8"));

describe.skipIf(!oldSource || exactTarget !== "1.20.0.3")(
  "real source and installed 1.20.0.3 migration evidence (requires old base and exact target launcher metadata)",
  () => {
    const read = (root: string, relative: string) => fs.readFileSync(path.join(root, relative));
    function capture(prefix: string): Record<string, Uint8Array> {
      const out: Record<string, Uint8Array> = {};
      for (const entry of fs.readdirSync(path.join(targetPath!, prefix), {
        recursive: true,
        withFileTypes: true,
      })) {
        if (!entry.isFile() || !/\.(txt|info)$/.test(entry.name)) continue;
        const full = path.join(entry.parentPath, entry.name);
        out[path.relative(targetPath!, full).replaceAll("\\", "/")] = fs.readFileSync(full);
      }
      return out;
    }

    it("converts archived Baltic communities and their exact-rite comparison through the production engine", async () => {
      const relative = "common/religion/religion_types/00_baltic.txt";
      const original = read(sourcePath!, relative)
        .toString("utf8")
        .replace(/^\uFEFF/, "");
      const religion = parseScript(original).root.statements[0] as AssignmentNode;
      const faiths = (religion.value as BlockNode).statements.find(
        (node) => node.kind === "assignment" && node.key.text === "faiths"
      ) as AssignmentNode;
      const faith = (faiths.value as BlockNode).statements.find(
        (node) => node.kind === "assignment" && node.key.text === "baltic_pagan"
      ) as AssignmentNode;
      const faithBlock = faith.value as BlockNode;
      expect(faithBlock.closeBrace).not.toBeNull();
      const body = original.slice(faithBlock.openBrace + 1, faithBlock.closeBrace!);
      const custom =
        original.slice(0, faiths.key.range.start).replace("baltic_religion", "fixture_religion") +
        `faiths = { fixture_parent = {${body}} fixture_child = {${body}} } }`;
      const target = {
        ...capture("common/religion"),
        ...capture("common/defines"),
        ...capture("history/faiths"),
        "history/_characters.info": read(targetPath!, "history/_characters.info"),
        "history/_provinces.info": read(targetPath!, "history/_provinces.info"),
      };
      const event = "events/fixture.txt";
      const snapshot = createMigrationSnapshot({
        gameId: "ck3",
        mod: {
          "common/religion/religion_types/fixture.txt": "\uFEFF" + custom,
          [event]: "\uFEFFnamespace = fixture\nfixture.1 = { trigger = { faith = faith:fixture_child } }\n",
        },
        source: {
          [relative]: read(sourcePath!, relative),
          "common/religion/religion_types/_religion_types.info": read(
            sourcePath!,
            "common/religion/religion_types/_religion_types.info"
          ),
        },
        target,
        metadata: { targetVersion: exactTarget },
      });
      const answers: MigrationAnswers = {
        "faith:fixture_parent:representation": "independent",
        "faith:fixture_child:representation": "rite",
        "faith:fixture_child:parent": "fixture_parent",
      };
      for (let pass = 0; pass < 5; pass++) {
        const result = await inspectMigration(ck3FaithMigration12003, snapshot, answers);
        for (const question of result.inspection.questions) {
          if (question.id in answers) continue;
          answers[question.id] = question.id.includes(":holy-site:")
            ? question.id.endsWith(":pokaini")
              ? "eminent"
              : "ordinary"
            : question.id.startsWith("reference:")
              ? "rite"
              : "parent";
        }
        if (result.missingAnswers.length === 0) break;
      }
      const result = await runMigrationFixture({ recipe: ck3FaithMigration12003, snapshot, answers });
      expect(result.plan.recipe.id).toBe(ck3FaithMigration12003.manifest.id);
      expect(result.plan.unresolved).toEqual([]);
      const output = new Map(
        result.snapshot.files
          .filter((file) => file.root === "mod")
          .map((file) => [file.path, Buffer.from(file.bytes).toString("utf8")])
      );
      expect(output.get("common/religion/faith_types/px_migrated_fixture_parent.txt")).toContain(
        "religion = fixture_religion"
      );
      expect(output.get("common/religion/rite_types/px_migrated_fixture_child.txt")).toContain(
        "faith = fixture_parent"
      );
      expect(output.get(event)).toContain("rite = rite:fixture_child");
      expect(result.plan.checks.some((check) => check.status === "not-run")).toBe(true);
    });

    it("losslessly trims a real clothing mask to the exact installed counterpart", async () => {
      const texture =
        "gfx/models/portraits/m_clothes/western/nob_01/m_clothes_secular_western_nob_01_masks.dds";
      const asset = texture.replace("_masks.dds", ".asset");
      const before = read(sourcePath!, texture);
      const counterpart = read(targetPath!, texture);
      const result = await runMigrationFixture({
        recipe: ck3PortraitMaskMigration12003,
        snapshot: createMigrationSnapshot({
          gameId: "ck3",
          mod: { [texture]: before },
          source: { [texture]: before },
          target: { [texture]: counterpart, [asset]: read(targetPath!, asset) },
          metadata: { targetVersion: exactTarget },
        }),
        answers: { [maskBatchKey]: "all" },
      });
      expect(result.plan.unresolved).toEqual([]);
      expect(result.plan.files).toHaveLength(1);
      const after = result.plan.files[0].after!;
      expect(inspectDdsResource(after).mipLevelCount).toBe(inspectDdsResource(counterpart).mipLevelCount);
      expect(Buffer.from(after)).toEqual(counterpart);
      expect(result.plan.checks.find((check) => check.id === "mask.render")?.status).toBe("not-run");
    });
  }
);
