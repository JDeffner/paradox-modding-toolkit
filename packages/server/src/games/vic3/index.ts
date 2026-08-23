/**
 * The Victoria 3 game profile (shipped, PLAN-multigame.md M7): schema verified
 * against a real install, gui widget schema harvested from vanilla, freqs from
 * the vanilla corpus; engine tokens come from the user's script_docs dumps
 * (markdown format). No wiki fallback and no structures layer, see below.
 */
import type { GameProfile } from "../profile";
import { vic3Meta } from "./meta";
import { VIC3_BLOCK_REF_FIELDS, VIC3_PREFIX_REFS, VIC3_REF_FIELDS, VIC3_SCHEMA } from "./schema";
import { VIC3_STRUCTURES, VIC3_STRUCTURE_SOURCES } from "./structures";
import { VIC3_SAVE_SCHEMA } from "./saveSchema";
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
  // Structure layer, fully harvested (games/vic3/structures.ts). The 2026-08-01
  // note here claimed the Vic3 tree had no source for it: wrong. Vic3 ships no
  // `_*.info`, but it does ship 91 `*.md` docs next to its data, and 71 of them
  // are `key = value  # doc` listings in the same shape as CK3's `.info` files,
  // machine-readable after all. Those, cross-checked against real vanilla usage,
  // are the source.
  structures: VIC3_STRUCTURES,
  structureSources: VIC3_STRUCTURE_SOURCES,
  // Vic3 events carry no `scope` key: the root scope comes from `type`
  // (measured over vanilla + three workshop mods, 2026-08-15: country_event
  // 2533, state_event 14, nothing else at a definition's top level). Assuming
  // CK3's `scope = character` spelling here put EVERY Vic3 event in a character
  // scope, which demoted every country effect/trigger to "other scope" and sank
  // it to the bottom of completion, the measured cause of the flat effect-block
  // ranking. scripted_guis do declare `scope = X`, with no default.
  defRootKeys: {
    event: { key: "type", default: "country", values: { country_event: "country", state_event: "state" } },
    customizable_localization: { key: "type" },
    scripted_gui: { key: "scope" },
  },
  modifierPlaceholders: {},
  saveSchema: VIC3_SAVE_SCHEMA,
  // No bundled wiki tokens in the preview cut, so nothing ever renders this.
  wikiNote: "",
  diagnosticSource: "vic3-script",
};
