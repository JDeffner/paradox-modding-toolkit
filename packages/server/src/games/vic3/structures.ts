/**
 * The Victoria 3 block-schema `structure` layer (update plan v1.1 §B2): the
 * document shape of each definition kind, the structural keys every modder
 * types most, which come from neither script_docs tokens nor the definition
 * index. Without this layer, typing at a definition's top level offered only
 * the flat engine-token soup, which is why Vic3 completion ranked far below
 * CK3's before 0.3.2.
 *
 * SOURCE: fully harvested, no hand curation. scripts/build-structures-json.ts
 * reads the 91 `*.md` schema docs Victoria 3 ships next to its data
 * (common/buildings/buildings.md and friends, the same `key = value  # doc`
 * shape as CK3's `_*.info`) and cross-checks every key against real depth-1
 * usage in the vanilla corpus, which also supplies the `freq` counts that drive
 * completion ranking and the vocabulary for the folders that ship no doc at all
 * (events and decisions among them).
 *
 * Static bundled JSON on purpose: users may not have gamePath set, so nothing is
 * harvested at runtime. Regenerate per game patch with:
 *   node dist/build-structures-json.cjs --game vic3
 */
import type { KeySpec, StructureSpec } from "../../schema/types";
import HARVESTED_JSON from "../../../data/vic3/structures.json";

interface HarvestedShape {
  sources: Record<string, string>;
  kinds: Record<string, { topLevel: KeySpec[]; blocks?: Record<string, KeySpec[]> }>;
}
const HARVESTED = HARVESTED_JSON as unknown as HarvestedShape;

/** Provenance shown in hover, keyed by schema kind (the doc folder's name). */
export const VIC3_STRUCTURE_SOURCES: Record<string, string> = HARVESTED.sources;

export const VIC3_STRUCTURES: Record<string, StructureSpec> = HARVESTED.kinds;
