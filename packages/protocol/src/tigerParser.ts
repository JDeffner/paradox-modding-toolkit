/**
 * Parser for tiger `--json` reports (the Paradox script validator family).
 *
 * Kept separate from the process management in tiger.ts so it stays free of
 * `vscode` imports and defensively tolerant of format drift between tiger
 * releases: unknown fields are ignored, malformed entries are skipped.
 */

export interface TigerLocation {
  path: string;
  fullpath?: string;
  /** 1-based, may be missing for file-level reports. */
  linenr?: number;
  /** 1-based. */
  column?: number;
  length?: number;
  tag?: string;
}

export interface TigerReport {
  severity: string;
  /** tiger also rates how sure it is: weak | reasonable | strong. */
  confidence?: string;
  key: string;
  message: string;
  info?: string;
  locations: TigerLocation[];
}

/** Parse tiger's JSON output. Returns null if no JSON array can be found at all. */
export function parseTigerJson(stdout: string, options: { strict?: boolean } = {}): TigerReport[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    // tiger may print progress noise before the JSON; try from the first '['.
    const start = stdout.indexOf("[");
    if (start < 0) return null;
    try {
      raw = JSON.parse(stdout.slice(start));
    } catch {
      return null;
    }
  }
  if (!Array.isArray(raw)) return null;

  const reports: TigerReport[] = [];
  for (const entry of raw) {
    if (options.strict) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
      const row = entry as Record<string, unknown>;
      if (
        typeof row.message !== "string" ||
        typeof row.key !== "string" ||
        typeof row.severity !== "string" ||
        !Array.isArray(row.locations)
      )
        return null;
      if (!["fatal", "error", "warning", "info", "untidy", "tips"].includes(row.severity.toLowerCase()))
        return null;
      for (const location of row.locations) {
        if (typeof location !== "object" || location === null) return null;
        const loc = location as Record<string, unknown>;
        if (typeof loc.fullpath !== "string" && typeof loc.path !== "string") return null;
        // Tiger's "line" is the source text; only older numeric forms use it
        // as a fallback for linenr.
        for (const key of ["linenr", "column", "length"]) {
          if (
            loc[key] !== undefined &&
            loc[key] !== null &&
            (typeof loc[key] !== "number" || !Number.isInteger(loc[key]) || (loc[key] as number) < 0)
          )
            return null;
        }
      }
    }
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const message = typeof e.message === "string" ? e.message : null;
    const locationsRaw = Array.isArray(e.locations) ? e.locations : [];
    if (message === null) continue;
    const locations: TigerLocation[] = [];
    for (const locRaw of locationsRaw) {
      if (typeof locRaw !== "object" || locRaw === null) continue;
      const l = locRaw as Record<string, unknown>;
      const p = typeof l.fullpath === "string" ? l.fullpath : typeof l.path === "string" ? l.path : null;
      if (p === null) continue;
      const loc: TigerLocation = { path: typeof l.path === "string" ? l.path : p };
      if (typeof l.fullpath === "string") loc.fullpath = l.fullpath;
      const linenr = l.linenr ?? l.line;
      if (typeof linenr === "number") loc.linenr = linenr;
      if (typeof l.column === "number") loc.column = l.column;
      if (typeof l.length === "number") loc.length = l.length;
      if (typeof l.tag === "string") loc.tag = l.tag;
      locations.push(loc);
    }
    reports.push({
      severity: typeof e.severity === "string" ? e.severity : "warning",
      confidence: typeof e.confidence === "string" ? e.confidence : undefined,
      key: typeof e.key === "string" ? e.key : "unknown",
      message,
      info: typeof e.info === "string" ? e.info : undefined,
      locations,
    });
  }
  return reports;
}
