/**
 * paradox/guiWidgetEdit backend: DEPRECATED, kept for hosts already wired to
 * it. It is a thin alias over the `paradox/guiSourceEdit` core
 * (`sourceEditService.ts`): the same span model, the same refusal guards, the
 * same edits, narrowed to the one gesture this request can express (set
 * `position` or `size` on the widget whose statement starts on a given line).
 *
 * What the narrow shape costs the caller: it returns ONE edit or null, so a
 * refusal arrives as a bare null with its reason dropped, and a batch has to be
 * several round trips. New hosts should send `paradox/guiSourceEdit` with a
 * `setProperties` op instead.
 */
import type { GuiDefs } from "./guiDefs";
import { emptyGuiDefs } from "./guiDefs";
import { computeGuiSourceEdit } from "./sourceEditService";

export interface WidgetTextEdit {
  /** UTF-16 offsets into the request's text. */
  start: number;
  end: number;
  newText: string;
}

const PAIR_PROPERTIES = new Set(["position", "size"]);

export function computeGuiWidgetEdit(
  text: string,
  line: number,
  property: string,
  values: [number, number],
  defs: GuiDefs = emptyGuiDefs()
): WidgetTextEdit | null {
  if (!PAIR_PROPERTIES.has(property)) return null;
  const result = computeGuiSourceEdit(
    text,
    {
      kind: "setProperties",
      line,
      properties: [{ key: property, value: `{ ${fmt(values[0])} ${fmt(values[1])} }` }],
    },
    defs
  );
  // One edit is all this shape can carry, and a batch of one is what it asks
  // for; a refusal (and its reason) collapses to null.
  const edits = result?.edits;
  return edits?.length === 1 ? edits[0] : null;
}

function fmt(v: number): string {
  const rounded = Math.round(v);
  return Math.abs(v - rounded) < 0.005 ? String(rounded) : v.toFixed(1);
}
