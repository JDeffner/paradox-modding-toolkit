/**
 * The Crusader Kings III game profile: identity plus every CK3 knowledge table
 * and bundled-data import, assembled behind the GameProfile interface.
 */
import type { GameProfile } from "../profile";
import { ck3Meta } from "./meta";
import { BLOCK_REF_FIELDS, CK3_SCHEMA, PREFIX_REFS, REF_FIELDS } from "./schema";
import { STRUCTURE_SOURCES } from "./structures";
import { CK3_MODIFIER_PLACEHOLDERS } from "./modifierPlaceholders";
// Bundled baseline data (packages/server/data/ck3/), imported at build time so
// completion/hover work without gamePath set. See scripts/build-data-types-json.ts
// and scripts/build-gui-schema.ts for regeneration.
import BUNDLED_DATA_TYPES from "../../../data/ck3/dataTypes.json";
import GUI_SCHEMA from "../../../data/ck3/guiSchema.json";

export const ck3Profile: GameProfile = {
  ...ck3Meta,
  schema: CK3_SCHEMA,
  refFields: REF_FIELDS,
  prefixRefs: PREFIX_REFS,
  blockRefFields: BLOCK_REF_FIELDS,
  structureSources: STRUCTURE_SOURCES,
  modifierPlaceholders: CK3_MODIFIER_PLACEHOLDERS,
  bundledDataTypes: BUNDLED_DATA_TYPES,
  guiSchema: GUI_SCHEMA,
  wikiNote: "Source: CK3 wiki (may lag behind the current game version)",
  diagnosticSource: "ck3-script",
};
