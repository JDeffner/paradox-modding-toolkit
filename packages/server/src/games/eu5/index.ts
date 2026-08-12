/**
 * The Europa Universalis V game profile (preview). Same cut line as Vic3: no
 * guiDefs, no data-type chains, no wiki fallback — completion/hover/definition/
 * references/structural diagnostics is the bar. No tiger exists for EU5.
 *
 * COMMUNITY-SOURCED AND UNVERIFIED: the schema table below is imported
 * wholesale from the community CWT rules (see schema.generated.ts for the
 * upstream, commit and license) and has NOT been checked against a live EU5
 * install. Folder→kind mappings are only as right as those rules are; report
 * gaps with the "Schema gap" issue form, and work around them locally with the
 * `<mod>/.eu5modding/schema.json` overlay.
 */
import type { GameProfile } from "../profile";
import type { RefField, SchemaEntry } from "../../schema/types";
import { JOMINI_VARIABLE_BLOCK_REFS } from "../jomini/variables";
import { eu5Meta } from "./meta";
import { EU5_SCHEMA } from "./schema.generated";

/**
 * Deliberately tiny. A wrong entry here is worse than a missing one: it turns
 * every use site into a false "unresolved reference" diagnostic. Every key
 * below is declared as a `<type>` reference by the CWT config AND confirmed by
 * EU5's own `script_docs` dumps (effects.log / triggers.log), and all but
 * `has_law` also appear in the MEIOU-and-Taxes corpus.
 *
 * Notably absent: `trigger_event`. EU5 renamed it — the engine only knows
 * `trigger_event_silently` / `trigger_event_non_silently` (effects.log), and
 * the corpus uses those two exclusively. Also absent: `add_trait` /
 * `remove_trait`, which take a trait *scope* in EU5 (`scope[trait]`), not a
 * trait definition name, so wiring them would be a pure false-positive source.
 */
const EU5_REF_FIELDS: RefField[] = [
  // Events & on_actions. Both trigger_event_* effects take either a bare event
  // id or a block (`{ id = X }` / `{ on_action = X }`); only the scalar form
  // resolves through a refField, which is the common shape in the corpus.
  { key: "trigger_event_silently", kinds: ["event"] },
  { key: "trigger_event_non_silently", kinds: ["event"] },
  { key: "has_fired_unique_event", kinds: ["event"] },
  // `events = { ... }` and `on_actions = { ... }` inside on_action definitions
  // and the trigger_event blocks are bare name lists.
  { key: "events", kinds: ["event"], form: "list" },
  { key: "on_actions", kinds: ["on_action"], form: "list" },
  // Country-scope triggers over the three biggest hand-authored databases.
  { key: "has_advance", kinds: ["advance"] },
  { key: "has_law", kinds: ["law"] },
  { key: "has_trait", kinds: ["trait"] },
];

/**
 * Hand-written rows on top of the imported table. The CWT config has no gui
 * types, so the `gui` row is added here: `type X = base { … }` /
 * `template X { … }` extraction is engine behaviour, the same in every Jomini
 * title, so it holds without a live install. Only the flat root is claimed;
 * whether EU5 also loads `<stage>/gui` is one of the open questions in the
 * calibration package (docs/gui-designer/calibration/eu5-package/).
 */
const EU5_HAND_ENTRIES: SchemaEntry[] = [
  { path: "gui", kind: "gui_type", ext: ".gui", extraction: "gui-type" },
];

export const eu5Profile: GameProfile = {
  ...eu5Meta,
  schema: [...EU5_SCHEMA, ...EU5_HAND_ENTRIES],
  refFields: EU5_REF_FIELDS,
  // No verified scalar-prefix references yet (EU5's `culture:x`-style links come
  // from the CWT scope_links table, which the importer does not read).
  prefixRefs: {},
  blockRefFields: { ...JOMINI_VARIABLE_BLOCK_REFS },
  // No `_*.info` docs ship with EU5, so the structures layer has no source.
  structureSources: {},
  modifierPlaceholders: {},
  // No bundled wiki tokens in the preview cut, so nothing ever renders this.
  wikiNote: "",
  diagnosticSource: "eu5-script",
};
