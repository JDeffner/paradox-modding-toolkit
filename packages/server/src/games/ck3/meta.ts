/**
 * Crusader Kings III identity and conventions. Data only — safe for the VSCode
 * client to import without pulling the knowledge tables into its bundle.
 */
import type { GameMeta } from "../profile";
import { GITAN_MEASURED_METRICS } from "../../gui/measuredMetrics";
import { CK3_SCAFFOLDS } from "./scaffolds";

export const ck3Meta: GameMeta = {
  id: "ck3",
  name: "Crusader Kings III",
  shortName: "CK3",
  engine: "jomini",
  descriptor: "mod",
  configDirName: ".ck3modding",
  docsFolderName: "Crusader Kings III",
  steamAppId: 1158310,
  eventNamespaces: true,
  // The engine's own default metrics: they were measured on this game's font,
  // and the layout engine reuses them for games whose probe has not run.
  uiFont: "fonts/Gitan/GitanLatin-Regular.otf",
  guiTextMetrics: GITAN_MEASURED_METRICS,
  scaffolds: CK3_SCAFFOLDS,
  tiger: { binaryName: "ck3-tiger", repoSlug: "amtep/tiger", confName: "ck3-tiger.conf" },
  // "" keeps the pre-profile cache filenames (docsCache.json, vanillaIndex-*.json)
  // so existing users' caches survive the M2 restructure.
  cacheSuffix: "",
};
