/**
 * Crusader Kings III identity and conventions. Data only — safe for the VSCode
 * client to import without pulling the knowledge tables into its bundle.
 */
import type { GameMeta } from "../profile";

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
  tiger: { binaryName: "ck3-tiger", repoSlug: "amtep/tiger", confName: "ck3-tiger.conf" },
  // "" keeps the pre-profile cache filenames (docsCache.json, vanillaIndex-*.json)
  // so existing users' caches survive the M2 restructure.
  cacheSuffix: "",
};
