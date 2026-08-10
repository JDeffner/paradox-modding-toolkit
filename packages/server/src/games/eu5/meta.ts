/**
 * Europa Universalis V identity and conventions. Data only — safe for the
 * VSCode client to import without pulling the knowledge tables into its
 * bundle. Community-sourced support: the schema table derives from
 * cwtools-eu5-config (see schema.generated.ts) and is not yet verified
 * against a live install.
 */
import type { GameMeta } from "../profile";

export const eu5Meta: GameMeta = {
  id: "eu5",
  name: "Europa Universalis V",
  shortName: "EU5",
  engine: "jomini",
  // EU5 mods carry .metadata/metadata.json (plus a required thumbnail.png);
  // descriptor.mod is at most a vestigial launcher artifact.
  descriptor: "metadata",
  configDirName: ".eu5modding",
  docsFolderName: "Europa Universalis V",
  // EU5's `script_docs` console command writes to Documents/.../docs, not logs/.
  scriptDocsSubdir: "docs",
  dataTypesCommand: "dump_data_types",
  steamAppId: 3450310,
  eventNamespaces: true,
  // All EU5 content sits under one of three load-stage folders at the mod
  // root; gameplay script lives under in_game/. Schema paths carry the
  // prefix; this list drives mod detection.
  stageRoots: ["in_game", "main_menu", "loading_screen"],
  // Database entry modes: `REPLACE:key = { ... }` etc. are legal top-level
  // definition keys in most common/ folders (not on_action or defines).
  entryModes: ["INJECT", "REPLACE", "TRY_INJECT", "TRY_REPLACE", "INJECT_OR_CREATE", "REPLACE_OR_CREATE"],
  // EU5's script_docs dumps are markdown (`## name`), with modifiers as
  // `Tag: name, Categories: ...` lines.
  scriptDocs: { format: "markdown", modifiers: "tag-line" },
  // No eu5-tiger exists (amtep/tiger covers ck3/vic3/imperator only).
  cacheSuffix: "-eu5",
};
