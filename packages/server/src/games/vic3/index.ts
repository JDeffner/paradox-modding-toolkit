/**
 * The Victoria 3 game profile (shipped, PLAN-multigame.md M7): schema verified
 * against a real install, gui widget schema harvested from vanilla, freqs from
 * the vanilla corpus; engine tokens come from the user's script_docs dumps
 * (markdown format). No wiki fallback and no structures layer — see below.
 */
import type { GameProfile } from "../profile";
import { vic3Meta } from "./meta";
import { VIC3_BLOCK_REF_FIELDS, VIC3_PREFIX_REFS, VIC3_REF_FIELDS, VIC3_SCHEMA } from "./schema";
import GUI_SCHEMA from "../../../data/vic3/guiSchema.json";

export const vic3Profile: GameProfile = {
  ...vic3Meta,
  schema: VIC3_SCHEMA,
  refFields: VIC3_REF_FIELDS,
  prefixRefs: VIC3_PREFIX_REFS,
  blockRefFields: VIC3_BLOCK_REF_FIELDS,
  guiSchema: GUI_SCHEMA,
  // guiTextMetrics live on the meta (the client reads them too, for the GUI
  // editor gate and its canvas line height).
  // Vic3 keeps an authored size on an EMPTY container (px_probe_c C5: the
  // 150x60 rendered in full, engine warning logged yet applied) where the
  // default profile measured collapse-to-0 (L25 narrow).
  guiLayoutQuirks: { emptySizedContainerKept: true },
  // No `_*.info` docs exist anywhere in the Vic3 tree (verified 2026-08-01) —
  // the structures layer has no source. The tree does ship ~75 `.md` files
  // (common/buildings/buildings.md and friends), but they are freeform prose
  // sketches of a format, not the machine-readable `.info` docs docsParser
  // reads, so they cannot feed structure/modifier placeholders either.
  structureSources: {},
  modifierPlaceholders: {},
  // No bundled wiki tokens in the preview cut, so nothing ever renders this.
  wikiNote: "",
  diagnosticSource: "vic3-script",
};
