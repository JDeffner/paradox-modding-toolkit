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
  // Verified on the 1.19 install: dlc_001.dds .. dlc_029.dds.
  dlcIconDir: "gfx/interface/icons/dlc",
  eventNamespaces: true,
  // The engine's own default metrics: they were measured on this game's font,
  // and the layout engine reuses them for games whose probe has not run.
  uiFont: "fonts/Gitan/GitanLatin-Regular.otf",
  guiTextMetrics: GITAN_MEASURED_METRICS,
  scaffolds: CK3_SCAFFOLDS,
  tiger: { binaryName: "ck3-tiger", repoSlug: "amtep/tiger", confName: "ck3-tiger.conf" },
  // Visual creators. Every row is backed by a folder the schema table already
  // indexes and a shape read out of the game's own files:
  //   trait          common/traits, documented by common/traits/_traits.info
  //   dynasty_legacy common/dynasty_legacies, per _dynasty_legacies.info
  //                  ("Dynasty Legacies are containers for perks"); the perks
  //                  themselves live in common/dynasty_perks (`legacy = <track>`)
  //   culture        common/culture/cultures (00_arabic.txt: color, ethos,
  //                  heritage, language, traditions, name_list, parents…)
  //   dynasty_tree   NOT a definition kind: history/characters linked by
  //                  father/mother/dynasty/house (history/characters/*.txt)
  creators: [
    {
      kind: "trait",
      label: "Trait Creator",
      icon: "sparkles",
      tip: "Design a character trait and write it into the mod.",
    },
    {
      kind: "dynasty_legacy",
      label: "Dynasty Legacy Creator",
      icon: "layers",
      tip: "Build a legacy track and its perks.",
    },
    {
      kind: "culture",
      label: "Culture Creator",
      icon: "globe",
      tip: "Compose a culture from the game's own pillars and traditions.",
    },
    {
      kind: "dynasty_tree",
      label: "Dynasty Tree",
      icon: "users",
      tip: "See and edit a dynasty's characters across history.",
    },
  ],
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
  // flags (8.0%) carried something the model dropped, 387 of those 399 keys
  // being `depth` on an instance, which the model now carries; Vic3, which has
  // shipped the builder since 0.3.2, drops something on 8.3% of its flags, so
  // CK3 is no worse off.
  flagBuilder: true,
  // Measured on this install (1.19.0.6, 2026-09-03): the in-game designer's
  // own files are all present and parse - 38 visible patterns of 42 rows in
  // gfx/coat_of_arms/patterns/50_coa_designer_patterns.txt, 1576 visible
  // emblems of 1578 rows in 13 categories in
  // colored_emblems/50_coa_designer_emblems.txt, 13 palette colors in
  // color_palettes/50_coa_designer_palettes.txt, 35 whole layouts in
  // emblem_layouts/50_coa_designer_emblem_layouts.txt, the
  // `coa_designer_blank_default` template in
  // common/coat_of_arms/coat_of_arms/99_coa_designer_templates.txt and 35
  // preview frames under gfx/interface/coat_of_arms. Victoria 3 ships no
  // gfx/coat_of_arms/color_palettes or emblem_layouts at all, and EU5 no coa
  // designer either, so neither sets this.
  coaDesigner: true,
};
