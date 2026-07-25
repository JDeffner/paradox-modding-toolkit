/**
 * The Victoria 3 game profile (preview). Cut line per PLAN.md M4: no guiDefs,
 * no data-type chains, no wiki fallback — completion/hover/definition/
 * references/structural diagnostics + tiger is the bar.
 */
import type { GameProfile } from "../profile";
import { vic3Meta } from "./meta";
import { VIC3_BLOCK_REF_FIELDS, VIC3_REF_FIELDS, VIC3_SCHEMA } from "./schema";

export const vic3Profile: GameProfile = {
  ...vic3Meta,
  schema: VIC3_SCHEMA,
  refFields: VIC3_REF_FIELDS,
  prefixRefs: {},
  blockRefFields: VIC3_BLOCK_REF_FIELDS,
  structureSources: {},
  modifierPlaceholders: {},
  // No bundled wiki tokens in the preview cut, so nothing ever renders this.
  wikiNote: "",
  diagnosticSource: "vic3-script",
};
