/**
 * Hover markdown builders (§D). Pure string assembly, no LSP or `vscode` types,
 * so the card layout is unit-testable in plain Node against the D2 mocks.
 *
 * Rendering contract (§D1): the only HTML emitted is sanitized
 * `<span style="color:var(--vscode-*)">…</span>` — VS Code renders the color
 * when `supportHtml` is on and strips the tag (keeping the plain text) when it
 * is not. Every span's *content* is therefore self-sufficient plain text (a
 * "■ trigger" badge, a scope name), so older clients degrade to markdown with
 * no loss of meaning. Do not introduce any other HTML here.
 */

/** `--vscode-charts-*` / semantic color slot per kind family (§D2). */
type ChartColor = "purple" | "red" | "yellow" | "green" | "orange" | "blue" | "foreground";

import { commandCapableClient } from "../clientMode";

function colorVar(c: ChartColor): string {
  return c === "foreground" ? "var(--vscode-charts-foreground)" : `var(--vscode-charts-${c})`;
}

/** A sanitized colored span. Content is plain text so it survives HTML stripping.
 * Plain-markdown clients (no clientCommands declared) get the bare text. */
function span(color: ChartColor, text: string): string {
  if (!commandCapableClient()) return text;
  return `<span style="color:${colorVar(color)};">${text}</span>`;
}

/** Kind → badge color (fixed per kind family, §D2). Definition kinds default green. */
function badgeColor(kind: string): ChartColor {
  switch (kind) {
    case "trigger":
      return "purple";
    case "effect":
      return "red";
    case "structure_key":
    case "keyword":
    case "text_format":
      return "yellow";
    case "define":
      return "blue";
    case "saved_scope":
    case "scope_word":
    case "macro_param":
      return "orange";
    case "loc_key":
      return "foreground";
    default:
      // Definition kinds (scripted_effect/trigger/modifier, script_value, event,
      // decision, …) all read green.
      return "green";
  }
}

/** Human label for a kind badge ("scripted trigger", "trigger", "saved scope"). */
function kindLabel(kind: string): string {
  if (kind === "structure_key") return "key";
  return kind.replace(/_/g, " ");
}

/** `■ kind` badge, colored per family. */
export function kindBadge(kind: string, label = kindLabel(kind)): string {
  return span(badgeColor(kind), `■ ${label}`);
}

/**
 * A scope pill: blue when it matches the current cursor scope, muted otherwise
 * (§D3). Content is the plain scope name so stripping the span leaves it legible.
 */
export function scopePill(scope: string, current: ReadonlySet<string> | null): string {
  const matches = current !== null && current.has(scope.toLowerCase());
  if (matches) return span("blue", scope);
  if (!commandCapableClient()) return scope;
  return `<span style="color:var(--vscode-descriptionForeground);">${scope}</span>`;
}

/** Blue scope-type span for the "→ character" tail on badges/pills. */
export function scopeType(type: string): string {
  return span("blue", type);
}

/**
 * A ■ swatch in an actual game color (not a theme var): the only place an
 * inline `color:rgb(...)` is emitted, since these are literal loc colors the
 * theme must not recolor. Content is a ■ so stripping the span leaves a marker.
 */
export function colorSwatch(rgb: [number, number, number]): string {
  if (!commandCapableClient()) return "■";
  const to255 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `<span style="color:rgb(${to255(rgb[0])}, ${to255(rgb[1])}, ${to255(rgb[2])});">■</span>`;
}

// ---------------------------------------------------------------------------
// Card model
// ---------------------------------------------------------------------------

export interface CardInput {
  kind: string;
  /** Badge label override (e.g. "scripted trigger" for a mod def). */
  badgeLabel?: string;
  name: string;
  /** Rendered inline after the name on line 1: pills, `· mod`, `→ character`. */
  headTail?: string;
  /** Doc prose (blank slot workstream E extends). */
  doc?: string;
  /** Italic traits line ("*Traits: yes/no · comparison ok*"). */
  traits?: string;
  /** A fenced example body (rendered ```paradox); short bodies only (§D2 mock 2). */
  example?: string;
  /** Footer fragments merged into one compact line (provenance, refs). */
  footer?: string[];
}

/** The language id our TextMate grammar registers (package.json `languages`). */
const FENCE_LANG = "paradox";

/** Build one card's markdown per the D2 layout. */
export function renderCard(card: CardInput): string {
  const badge = kindBadge(card.kind, card.badgeLabel);
  const head = card.headTail ? `${badge} **${card.name}** ${card.headTail}` : `${badge} **${card.name}**`;
  const lines: string[] = [head];

  if (card.doc) lines.push(card.doc);
  if (card.example) lines.push(`\`\`\`${FENCE_LANG}\n${card.example}\n\`\`\``);
  if (card.traits) lines.push(`*${card.traits}*`);

  let md = lines.join("\n\n");
  if (card.footer && card.footer.length > 0) {
    md += `\n\n---\n${card.footer.join(" · ")}`;
  }
  return md;
}

/**
 * Join up to `MAX_CARDS` cards, appending "*n more meanings*" when capped, then
 * the single shared scope-context footer line (§D2: scope context always last,
 * once per hover).
 */
export const MAX_CARDS = 3;

export function renderHover(cards: string[], scopeFooter: string | null): string {
  const shown = cards.slice(0, MAX_CARDS);
  const parts = [...shown];
  const extra = cards.length - shown.length;
  if (extra > 0) parts.push(`*${extra} more meaning${extra === 1 ? "" : "s"}*`);
  let md = parts.join("\n\n---\n\n");
  if (scopeFooter) md += `\n\n${scopeFooter}`;
  return md;
}

/** "Scope here: **X** (chain)" — the shared footer line appended once (§D2). */
export function scopeHereLine(scopes: string, chain: string | null): string {
  return chain ? `Scope here: **${scopes}** (${chain})` : `Scope here: **${scopes}**`;
}

/** True when a definition body is short enough to inline as an example (§D2). */
export function isShortExample(body: string): boolean {
  const lines = body.split("\n").filter((l) => l.trim() !== "");
  return lines.length > 0 && lines.length < 4;
}

// ---------------------------------------------------------------------------
// PdxDoc rendering (§E3)
// ---------------------------------------------------------------------------

interface DocTagLike {
  tag: string;
  text: string;
}

export interface DocBody {
  /** Prose + structured-tag markdown for the card's `doc` slot. Empty → undefined. */
  doc?: string;
  /** `@example` body for the card's fenced `example` slot. */
  example?: string;
  /** True when `@deprecated` is present — the card renders the name prominently. */
  deprecated?: boolean;
}

/**
 * Turn PdxDoc prose + tags (§E) into the card's `doc`/`example` slots.
 * Prose renders first, then structured tags compactly (§E3): `@param` as
 * `*@param NAME — desc*` lines, `@deprecated` as a prominent ⚠ line, other
 * recognized/unknown tags as compact italic lines. `@example` fills the fenced
 * slot. Fail-soft: absent fields yield an empty body.
 */
export function renderDocBody(def: { doc?: string; tags?: DocTagLike[] }): DocBody {
  const out: DocBody = {};
  const lines: string[] = [];
  if (def.doc) lines.push(def.doc);

  const tagLines: string[] = [];
  for (const t of def.tags ?? []) {
    switch (t.tag) {
      case "example":
        if (t.text && !out.example) out.example = t.text;
        break;
      case "deprecated":
        out.deprecated = true;
        tagLines.push(t.text ? `⚠ **Deprecated** — ${t.text}` : `⚠ **Deprecated**`);
        break;
      case "param": {
        // `@param NAME desc` → `*@param NAME — desc*`.
        const m = /^(\S+)\s*(.*)$/.exec(t.text);
        if (m) {
          const desc = m[2].trim();
          tagLines.push(desc ? `*@param ${m[1]} — ${desc}*` : `*@param ${m[1]}*`);
        } else {
          tagLines.push(`*@param*`);
        }
        break;
      }
      default:
        // @scope, @saves, @returns, and unknown tags: compact italic line.
        tagLines.push(t.text ? `*@${t.tag} ${t.text}*` : `*@${t.tag}*`);
    }
  }
  if (tagLines.length > 0) lines.push(tagLines.join("  \n"));

  if (lines.length > 0) out.doc = lines.join("\n\n");
  return out;
}
