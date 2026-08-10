/**
 * Script properties whose right-hand side is a localization key.
 *
 * BROAD: properties that often hold a loc key; a resolved inlay hint is shown
 * when the value exists in the loc index, silence otherwise (these keys also
 * hold non-loc values, e.g. `name` on a title history entry).
 *
 * STRICT: properties that virtually always hold a loc key; an unresolved value
 * here renders a `missing loc` hint.
 */

export const STRICT_LOC_PROPERTIES = new Set<string>([
  "title",
  "desc",
  "flavor",
  "custom_tooltip",
  "confirm_text",
  "confirm_title",
  "prompt",
  "failure_desc",
  "success_desc",
]);

export const BROAD_LOC_PROPERTIES = new Set<string>([
  ...STRICT_LOC_PROPERTIES,
  "name",
  "text",
  "tooltip",
  "first_valid",
  "reason",
  "format",
  "header",
  "opinion_text",
  "what",
  "who",
]);

export function isLocProperty(prop: string): "strict" | "broad" | null {
  const p = prop.toLowerCase();
  if (STRICT_LOC_PROPERTIES.has(p)) return "strict";
  if (BROAD_LOC_PROPERTIES.has(p)) return "broad";
  return null;
}
