/**
 * Which perk belongs to which legacy track, read out of the game's own perk
 * files.
 *
 * The link is the perk's `legacy` key: `_dynasty_perks.info` states the body as
 * `legacy = legacy_key   # What legacy does this belong to?`, and all 105
 * vanilla perks write it (measured 2026-09-03). Nothing else in the file says
 * it, so a scan for that one key is the whole answer.
 *
 * A line scanner rather than the parser: the caller wants the names and the
 * link, never a tree, and this runs over every file of the folder on open.
 * No `vscode`, so it is unit-testable in plain Node.
 */

export interface PerkLink {
  name: string;
  track: string;
}

const OPEN = /^([A-Za-z_][\w.-]*)\s*=\s*\{/;
const LEGACY = /^\s*legacy\s*=\s*([A-Za-z_][\w.-]*)/;

/** Every `name -> legacy` pair one perk file declares, in file order. */
export function perkLinks(text: string): PerkLink[] {
  const out: PerkLink[] = [];
  let depth = 0;
  let current: string | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.split("#")[0];
    if (depth === 0) {
      const open = OPEN.exec(line.trim());
      if (open) current = open[1];
    } else if (current) {
      const legacy = LEGACY.exec(line);
      if (legacy) {
        out.push({ name: current, track: legacy[1] });
        current = null;
      }
    }
    for (const char of line) {
      if (char === "{") depth++;
      else if (char === "}") depth = Math.max(0, depth - 1);
    }
    if (depth === 0) current = null;
  }
  return out;
}

/**
 * How many perks a track has, in the files these links came from: the count
 * most tracks share. Null when there is nothing to count. Used as the number of
 * empty perk slots a fresh track opens with, so the default matches the game
 * instead of a number we made up.
 */
export function commonPerkCount(links: readonly PerkLink[]): number | null {
  const perTrack = new Map<string, number>();
  for (const link of links) perTrack.set(link.track, (perTrack.get(link.track) ?? 0) + 1);
  if (perTrack.size === 0) return null;
  const votes = new Map<number, number>();
  for (const count of perTrack.values()) votes.set(count, (votes.get(count) ?? 0) + 1);
  let best = 0;
  let bestVotes = -1;
  for (const [count, seen] of votes) {
    if (seen > bestVotes || (seen === bestVotes && count > best)) {
      best = count;
      bestVotes = seen;
    }
  }
  return best;
}

/** The perks of one track, in file order, deduplicated by name (last wins). */
export function perksOfTrack(links: readonly PerkLink[], track: string): string[] {
  const names: string[] = [];
  for (const link of links) {
    if (link.track === track && !names.includes(link.name)) names.push(link.name);
  }
  return names;
}
