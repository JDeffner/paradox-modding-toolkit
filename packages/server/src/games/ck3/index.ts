/**
 * The Crusader Kings III game profile: identity plus every CK3 knowledge table
 * and bundled-data import, assembled behind the GameProfile interface.
 */
import type { GameProfile } from "../profile";
import { ck3Meta } from "./meta";
import { BLOCK_REF_FIELDS, CK3_SCHEMA, PREFIX_REFS, REF_FIELDS } from "./schema";
import { STRUCTURE_SOURCES } from "./structures";
import { CK3_MODIFIER_PLACEHOLDERS } from "./modifierPlaceholders";
import { CK3_SAVE_SCHEMA } from "./saveSchema";
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
  // Events declare `scope = character|landed_title|…` and default to character
  // when the key is absent (events/_events.info); custom loc `type = all` → any
  // scope; scripted_guis declare `scope = X`.
  defRootKeys: {
    event: { key: "scope", default: "character" },
    customizable_localization: { key: "type" },
    scripted_gui: { key: "scope", default: "character" },
  },
  modifierPlaceholders: CK3_MODIFIER_PLACEHOLDERS,
  // The three triggers the measured condition shapes need. Over the game's own
  // 21 dynasty legacy tracks every `is_shown` opens with `has_dlc_feature`, and
  // over its 105 dynasty perks every `can_be_picked` is either
  // `has_dlc_feature = <feature>` (10) or `<scripted trigger> = yes` (44).
  conditionValues: {
    // triggers.log enumerates the whole set on the trigger itself.
    has_dlc_feature: { from: "docList" },
    // `has_game_rule = unrestricted_dynasty_legacies_all` names a SETTING, and
    // a setting is an inner block of a game_rule (00_game_rules.txt).
    has_game_rule: { from: "innerKeys", kind: "game_rule", except: ["categories", "default"] },
    scripted_trigger: { from: "kind", kind: "scripted_trigger" },
  },
  bundledDataTypes: BUNDLED_DATA_TYPES,
  guiSchema: GUI_SCHEMA,
  saveSchema: CK3_SAVE_SCHEMA,
  wikiNote: "Source: CK3 wiki (may lag behind the current game version)",
  diagnosticSource: "ck3-script",
};
