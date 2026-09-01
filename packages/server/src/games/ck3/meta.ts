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
  // Flags verified as literals in ck3.exe (2026-09-01); semantics per the
  // game's documented launch options (-mapeditor is issue #26). -skip has no
  // greppable literal but is the documented lobby-skip option.
  launchPresets: [
    { id: "mapeditor", label: "Map Editor", args: ["-mapeditor"] },
    {
      id: "continue",
      label: "Continue Last Save (debug mode)",
      args: ["-debug_mode", "-develop", "-continuelastsave"],
    },
    { id: "skip", label: "Skip to 1066 Lobby (debug mode)", args: ["-debug_mode", "-develop", "-skip"] },
    { id: "benchmark", label: "Benchmark (automated 1.5y run)", args: ["-benchmark"] },
  ],
  // "" keeps the pre-profile cache filenames (docsCache.json, vanillaIndex-*.json)
  // so existing users' caches survive the M2 restructure.
  cacheSuffix: "",
};
