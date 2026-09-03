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
  configDirName: ".px-toolkit",
  legacyConfigDirName: ".ck3modding",
  docsFolderName: "Crusader Kings III",
  steamAppId: 1158310,
  eventNamespaces: true,
  // The engine's own default metrics: they were measured on this game's font,
  // and the layout engine reuses them for games whose probe has not run.
  uiFont: "fonts/Gitan/GitanLatin-Regular.otf",
  guiTextMetrics: GITAN_MEASURED_METRICS,
  scaffolds: CK3_SCAFFOLDS,
  tiger: { binaryName: "ck3-tiger", repoSlug: "amtep/tiger", confName: "ck3-tiger.conf" },
  // Date-format keys verified in ck3.exe 1.19 (the gamedate.cpp string block);
  // formats mirror game/localization/english/core_l_english.yml. Vanilla
  // appends $ERA$/$ERA_BCE$ itself - dropped here, the {era} slot replaces it.
  // Month keys from clausewitz/localization/cw_date_l_english.yml; May has no
  // separate abbreviated key.
  calendarLoc: {
    dateFormats: {
      GAME_DATE_STRING: "$DAY$ $MONTH$, {year} {era}",
      GAME_DATE_STRING_SHORT: "$DAY$ $MONTH_SHORT$ {year} {era}",
      GAME_DATE_STRING_LONG: "$DAY|O$ of $MONTH$, {year} {era}",
    },
    monthKeys: [
      ["CW_DATE_January", "CW_DATE_Jan"],
      ["CW_DATE_February", "CW_DATE_Feb"],
      ["CW_DATE_March", "CW_DATE_Mar"],
      ["CW_DATE_April", "CW_DATE_Apr"],
      ["CW_DATE_May", "CW_DATE_May"],
      ["CW_DATE_June", "CW_DATE_Jun"],
      ["CW_DATE_July", "CW_DATE_Jul"],
      ["CW_DATE_August", "CW_DATE_Aug"],
      ["CW_DATE_September", "CW_DATE_Sep"],
      ["CW_DATE_October", "CW_DATE_Oct"],
      ["CW_DATE_November", "CW_DATE_Nov"],
      ["CW_DATE_December", "CW_DATE_Dec"],
    ],
  },
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
  // Coat-of-arms coverage measured against this install (1.19.0.6, 2026-09-03):
  // parseCoaFile reads all 2992 vanilla definitions in the 10 files of
  // common/coat_of_arms/coat_of_arms with 0 parse errors, and 100% of both the
  // 7800 texture references (1629 files, every one decoding) and the 15327
  // colors resolve, the named ones out of the 112 in common/named_colors. 239
  // flags (8.0%) carry something the model drops, 387 of those 399 keys being
  // `depth` on an instance; Vic3, which has shipped the builder since 0.3.2,
  // drops something on 8.3% of its flags, so CK3 is no worse off.
  flagBuilder: true,
};
