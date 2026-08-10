/**
 * Diagnostic suppression, shared by the server (own structural/loc diagnostics)
 * and the client (tiger-forwarded reports) so one habit works across both tools.
 *
 * No `vscode` imports: plain data in, plain predicates out. Everything here is
 * fail-soft — bad setting values or malformed comments are ignored, never thrown.
 *
 * Two mechanisms:
 *   1. Settings: the diagnostics.ignore setting (diagnostic codes) and
 *      the diagnostics.ignorePatterns setting (globs on the workspace-relative path).
 *   2. Inline comments: `# px:ignore <code…>` (same line) and
 *      `# px:ignore-next-line <code…>` (following line); a bare form with no
 *      codes suppresses every diagnostic on the target line. A trailing
 *      `-- <rationale>` is allowed and ignored.
 */

/**
 * Settings-driven filter. `ignore` matches a diagnostic's code (our stable
 * codes, or tiger's `key`); `ignorePatterns` matches globs against the
 * workspace-relative file path.
 */
export interface DiagnosticIgnoreConfig {
  /** Diagnostic codes to drop everywhere. */
  ignore: string[];
  /** Glob patterns matched against the workspace-relative (forward-slash) path. */
  ignorePatterns: string[];
}

/** Normalize a raw settings array: strings only, trimmed, empties dropped. */
export function sanitizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (t !== "") out.push(t);
  }
  return out;
}

/**
 * Tiny `*`/`**` glob matcher (no dependency). `*` matches within a path segment,
 * `**` matches across segments (including `/`). Matching is done on
 * forward-slash paths and is case-insensitive (Windows-friendly). A pattern with
 * no slash also matches against the basename, so `*.txt` works like a gitignore
 * entry. Returns false on any malformed pattern.
 */
export function globMatch(pattern: string, filePath: string): boolean {
  const p = pattern.replace(/\\/g, "/").toLowerCase();
  const f = filePath.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
  if (p === "") return false;
  try {
    const re = new RegExp("^" + globToRegExpSource(p) + "$");
    if (re.test(f)) return true;
    // Slash-free patterns also match the basename (gitignore-style convenience).
    if (!p.includes("/")) {
      const base = f.slice(f.lastIndexOf("/") + 1);
      return re.test(base);
    }
    return false;
  } catch {
    return false;
  }
}

/** Translate a glob (already lowercased, forward-slashed) into a regex source. */
function globToRegExpSource(glob: string): string {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // `**` — cross segments, optionally swallowing a trailing slash.
        i++;
        if (glob[i + 1] === "/") {
          i++;
          out += "(?:.*/)?";
        } else {
          out += ".*";
        }
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(c)) {
      out += "\\" + c;
    } else {
      out += c;
    }
  }
  return out;
}

/** True when a diagnostic with `code` in `filePath` should be dropped by settings. */
export function isIgnoredByConfig(
  cfg: DiagnosticIgnoreConfig,
  code: string | undefined,
  relPath: string
): boolean {
  if (code !== undefined && cfg.ignore.includes(code)) return true;
  for (const pattern of cfg.ignorePatterns) {
    if (globMatch(pattern, relPath)) return true;
  }
  return false;
}

/**
 * Inline suppression map for a file, keyed by 0-based line number. A `null`
 * value means "suppress every code on this line"; an array means "suppress only
 * these codes". Built by scanning comment lines once when publishing.
 */
export type InlineSuppressions = Map<number, string[] | null>;

const IGNORE_RE = /#\s*px:ignore(-next-line)?\b([^\n]*)/i;

/**
 * Scan a document's text for `# px:ignore[-next-line] <code…>` comments.
 * Cheap: only lines containing `px:ignore` are parsed. `-next-line` targets
 * the following line; the plain form targets its own line.
 */
export function scanInlineSuppressions(text: string): InlineSuppressions {
  const map: InlineSuppressions = new Map();
  if (!text.includes("px:ignore")) return map;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // A comment can trail script on the same line; only look after the `#`.
    const hash = line.indexOf("#");
    if (hash < 0) continue;
    const m = IGNORE_RE.exec(line.slice(hash));
    if (!m) continue;
    const target = m[1] ? i + 1 : i;
    const codes = parseCodes(m[2]);
    mergeSuppression(map, target, codes.length === 0 ? null : codes);
  }
  return map;
}

/**
 * The codes following the marker, stopping at a `--` rationale. Writing a
 * reason is the natural instinct, and without the cut-off every word of it
 * parsed as a code — turning a suppression that matched everything into one
 * that matched nothing, silently. Codes are kebab-case slugs
 * (`unclosed-brace`, `loc-no-header`), so a leading `-` can only be the
 * separator.
 */
function parseCodes(rest: string): string[] {
  const out: string[] = [];
  for (const token of rest.trim().split(/\s+/)) {
    if (token === "") continue;
    if (token.startsWith("-")) break; // `-- because the game allows it`
    out.push(token);
  }
  return out;
}

function mergeSuppression(map: InlineSuppressions, line: number, codes: string[] | null): void {
  const existing = map.get(line);
  if (existing === undefined) {
    map.set(line, codes);
    return;
  }
  // `null` (suppress-all) wins; otherwise union the code lists.
  if (existing === null || codes === null) {
    map.set(line, null);
    return;
  }
  map.set(line, [...existing, ...codes]);
}

/** True when line `line` has an inline suppression covering `code`. */
export function isSuppressedInline(map: InlineSuppressions, line: number, code: string | undefined): boolean {
  if (!map.has(line)) return false;
  const codes = map.get(line) ?? null;
  if (codes === null) return true; // bare `# px:ignore` suppresses all
  return code !== undefined && codes.includes(code);
}
