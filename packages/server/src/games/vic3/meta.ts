/**
 * Victoria 3 identity and conventions. Data only — safe for the VSCode
 * client to import without pulling the knowledge tables into its bundle.
 */
import type { GameMeta } from "../profile";

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
  // Vic3's script_docs dumps are markdown (`## name`), with modifiers as
  // `tag:` blocks carrying Mask/Name/Description lines.
  scriptDocs: { format: "markdown", modifiers: "masked-block" },
  tiger: { binaryName: "vic3-tiger", repoSlug: "amtep/tiger", confName: "vic3-tiger.conf" },
  cacheSuffix: "-vic3",
};
