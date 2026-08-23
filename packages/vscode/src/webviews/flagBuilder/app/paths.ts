/**
 * Shortening a mod path for a menu row. The two ends are what identify a mod
 * folder — the drive or game folder it lives under, and the id folder it ends
 * in — so what goes is the middle, not the tail an end-ellipsis would eat.
 */
export function middleEllipsis(text: string, max: number): string {
  if (max <= 1 || text.length <= max) return text;
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  return text.slice(0, head) + "…" + text.slice(text.length - (keep - head));
}
