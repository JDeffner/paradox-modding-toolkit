import type { MigrationRecipe } from "../../../migrations/sdk";
import { buildFaithMigration } from "./faithConversion";
import { discoverFaithIcons } from "./faithTenets";

/** Stable author decisions survive unrelated source changes. */
export function faithDecisionKey(id: string): string {
  return `faith:${id}:representation`;
}
export function faithParentKey(id: string): string {
  return `faith:${id}:parent`;
}

const COVERAGE = [
  "Converts nested faiths, religion inheritance, doctrine and tenet lists, holy sites and supported static consumers as one coordinated change. Unsupported consumers block the proposal with their file and location.",
  "Only captured mod, source and target files are inspected. Dependencies outside these roots, computed identifiers, saved scopes, bookmarks and existing saves need separate review.",
  "Target-game validation is not run by this recipe. Test effective doctrines, tenets, religious heads, holy sites and assignments at every supported bookmark in the target game.",
  "The exact archived source build was not independently verified. The recipe checks captured target schemas instead of assuming that a version label establishes compatibility.",
];

export const ck3FaithMigration = {
  manifest: {
    id: "ck3.faiths-to-rites.decisions",
    revision: "2",
    sdkVersion: 2,
    gameId: "ck3",
    fromVersion: "1.19.0.6",
    toVersion: "1.20.0.2",
    kind: "recipe",
    detection: "script",
    requirement: "required",
    title: "Convert faiths and rites",
    description:
      "Convert nested communities into independent faiths or rites and update their supported consumers.",
    guidance:
      "Choose representations, parents, holy-site roles and reference intent. Review the coordinated source preview, then validate the result in the target game.",
    limitations: COVERAGE,
    dependsOn: [],
    evidence: [
      "common/religion/religion_types/_religion_types.info",
      "common/religion/faith_types/_faith_types.info",
      "common/religion/rite_types/_rite_types.info",
      "common/religion/tenet_types/_tenet_types.info",
      "history/_characters.info",
      "history/_provinces.info",
      "history/faiths/_faith_history.info",
    ],
    inputs: [
      ...["common", "events", "history", "decisions", "gui", "localization"].map((path) => ({
        root: "mod" as const,
        path,
        extensions: [".txt", ".gui", ".asset", ".yml"],
      })),
      { root: "source", path: "common/religion" },
      { root: "target", path: "common/religion" },
      { root: "target", path: "common/defines" },
      { root: "mod", path: "gfx/interface/icons/faith_doctrines", extensions: [".dds"], capture: "listing" },
      { root: "mod", path: "gfx/interface/icons/faith_tenets", extensions: [".dds"], capture: "listing" },
      { root: "target", path: "gfx/interface/icons/faith_tenets", extensions: [".dds"], capture: "listing" },
      { root: "target", path: "history/faiths" },
      { root: "target", path: "history/_characters.info" },
      { root: "target", path: "history/_provinces.info" },
    ],
  },
  discover: discoverFaithIcons,
  async inspect(context, answers) {
    return (await buildFaithMigration(context, answers, COVERAGE)).inspection;
  },
  async prepare(context, answers) {
    return (await buildFaithMigration(context, answers, COVERAGE)).proposal;
  },
} satisfies MigrationRecipe;

/** Target schemas and Baltic faith/rite output source-checked on 1.20.0.3. */
export const ck3FaithMigration12003 = {
  ...ck3FaithMigration,
  manifest: {
    ...ck3FaithMigration.manifest,
    id: "ck3.faiths-to-rites.decisions.1.20.0.3",
    toVersion: "1.20.0.3",
  },
} satisfies MigrationRecipe;
