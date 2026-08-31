/**
 * Victoria 3 identity and conventions. Data only — safe for the VSCode
 * client to import without pulling the knowledge tables into its bundle.
 */
import type { GameMeta } from "../profile";
import { VIC3_SCAFFOLDS } from "./scaffolds";

export const vic3Meta: GameMeta = {
  id: "vic3",
  name: "Victoria 3",
  shortName: "Vic3",
  engine: "jomini",
  // Vic3 mods carry .metadata/metadata.json instead of a launcher .mod file.
  descriptor: "metadata",
  configDirName: ".vic3modding",
  docsFolderName: "Victoria 3",
  // Vic3's `script_docs` writes to Documents/.../docs (like EU5), while
  // `dump_data_types` writes to logs/data_types — verified on a live install.
  scriptDocsSubdir: "docs",
  dataTypesCommand: "dump_data_types",
  steamAppId: 529340,
  eventNamespaces: true,
  scaffolds: VIC3_SCAFFOLDS,
  // uiFont deliberately absent: this game ships no Gitan (its fonts/ holds
  // ParadoxVictorian, EBGaramond, NotoSans), and which file `standard_font`
  // resolves to is unmeasured. The editor embeds none and the metrics below
  // carry the text boxes.
  //
  // Measured in-game 2026-08-09 (px_probe_d/e, 1920x1080 @ 100% GUI scaling;
  // docs/gui-designer/vic3/expectations.md). The measured law:
  // advance(M) = round(0.9 * fontsize), i.e. 14 @15, 15 @17 (the default
  // size), 27 @30, and line box = 1.3 * fontsize exactly (the game ceils the
  // box: 20 @15, 39 @30, 23 @17). A base-30 table + roundPerSize reproduces
  // every measured box EXACTLY: 10xM = 140 @15 / 150 @default / 270 @30,
  // "M M M M M" = 82, "MMMM MMMM" = 115, 10xi = 40. A bare textbox renders
  // at fontsize 17.
  guiTextMetrics: {
    baseFontsize: 30,
    lineHeight: 39,
    glyphs: {
      M: { adv: 27, ink: 27 },
      i: { adv: 8, ink: 8 },
      " ": { adv: 6, ink: 0 },
    },
    defaultGlyph: { adv: 18, ink: 16 }, // unmeasured average guess
    defaultFontsize: 17,
    roundPerSize: true,
  },
  // Vic3's script_docs dumps are markdown (`## name`), with modifiers as
  // `tag:` blocks carrying Mask/Name/Description lines.
  scriptDocs: { format: "markdown", modifiers: "masked-block" },
  tiger: { binaryName: "vic3-tiger", repoSlug: "amtep/tiger", confName: "vic3-tiger.conf" },
  cacheSuffix: "-vic3",
  flagBuilder: true,
};
