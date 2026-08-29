/**
 * Hover card markdown. Pure string assembly, no LSP or `vscode` types, so the
 * layout is unit-testable in plain Node.
 *
 * The card is four slots in a fixed order, and only the first is mandatory:
 *
 *   <glyph> <kind> **name** <tail>     head
 *   prose                              doc
 *   ```paradox …```                    example
 *   scope · value shape · traits       facts
 *
 * The hover then writes ONE footer line for the whole hover, never one per
 * card: the scope context with the action links on the end of it. A separate
 * action row would cost three lines (itself, a blank, and a rule above it) to
 * say what fits on a line that has to exist anyway.
 *
 * Rendering contract, three tiers, driven by client capabilities:
 *
 *   hoverIcons + hoverHtml  `<span style="color:…">$(symbol-method) trigger</span>`
 *   hoverHtml only          `<span style="color:…">■ trigger</span>`
 *   neither                 `■ trigger`
 *
 * Every span's *content* is self-sufficient plain text, so a client that strips
 * the tag keeps the meaning. The only HTML emitted is that span plus the
 * `<details>` disclosure; both are on VS Code's markdown sanitizer allowlist.
 * Do not introduce any other HTML: the sanitizer permits `style` on `<span>`
 * alone, and only `color`, `background-color` and `border-radius`.
 */

import { kindStyle } from "@px-lsp/protocol/kinds";
import { hoverHtml, hoverIcons } from "../clientMode";

/** The colour a stored value reads in: the same token a `Variable` row takes. */
const STORED = "var(--vscode-symbolIcon-variableForeground)";

/** A sanitized colored span. Content is plain text so it survives stripping. */
function span(color: string | null, text: string): string {
  if (color === null || !hoverHtml()) return text;
  return `<span style="color:${color};">${text}</span>`;
}

/** Human label for a kind badge ("scripted trigger", "trigger", "saved scope"). */
function kindLabel(kind: string): string {
  if (kind === "structure_key") return "key";
  return kind.replace(/_/g, " ");
}

/**
 * The head-line badge: glyph (or square) plus the kind word. The kind word
 * stays even once glyphs carry meaning, because a glyph alone is only legible
 * after you have learned it.
 */
export function kindBadge(kind: string, label = kindLabel(kind)): string {
  const style = kindStyle(kind);
  const mark = hoverIcons() ? `$(${style.codicon})` : "■";
  return span(style.color, `${mark} ${label}`);
}

/**
 * A scope pill: blue when it matches the current cursor scope, muted otherwise.
 * Content is the plain scope name so stripping the span leaves it legible.
 */
export function scopePill(scope: string, current: ReadonlySet<string> | null): string {
  const matches = current !== null && current.has(scope.toLowerCase());
  if (matches) return span(STORED, scope);
  if (!hoverHtml()) return scope;
  return `<span style="color:var(--vscode-descriptionForeground);">${scope}</span>`;
}

/** Blue scope-type span for the "→ character" tail on badges/pills. */
export function scopeType(type: string): string {
  return span(STORED, type);
}

/**
 * A ■ swatch in an actual game color (not a theme var): the only place an
 * inline `color:rgb(...)` is emitted, since these are literal loc colors the
 * theme must not recolor. Content is a ■ so stripping the span leaves a marker.
 */
export function colorSwatch(rgb: [number, number, number]): string {
  if (!hoverHtml()) return "■";
  const to255 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `<span style="color:rgb(${to255(rgb[0])}, ${to255(rgb[1])}, ${to255(rgb[2])});">■</span>`;
}

// ---------------------------------------------------------------------------
// Detail levels and caps
// ---------------------------------------------------------------------------

export type HoverDetail = "compact" | "standard" | "full";

/**
 * Caps per detail level. The two example caps are separate because the two
 * distributions are nothing alike, measured against a real CK3 install:
 *
 *  - engine `usage:` blocks: two thirds are 3 lines or shorter, and no block is
 *    exactly 4 lines, so 3 and 4 truncate the identical 22 tokens.
 *  - scripted definition bodies: only 11% are 3 lines or shorter, median 10,
 *    p90 32, longest 232. A 3-line cap here would truncate 89% of them, which
 *    is why the overflow goes into a `<details>` disclosure rather than being
 *    dropped.
 */
export interface HoverCaps {
  /** Cards shown before "N more meanings". */
  cards: number;
  /** Fenced lines from an engine `usage:` block. */
  exampleLines: number;
  /** Fenced lines from a definition body before the disclosure opens. */
  bodyLines: number;
  /** Lines inside the disclosure; a hover cannot grow past the viewport. */
  disclosedLines: number;
  /** Doc paragraphs. */
  docParagraphs: number;
}

export const CAPS: Record<HoverDetail, HoverCaps> = {
  compact: { cards: 1, exampleLines: 0, bodyLines: 0, disclosedLines: 0, docParagraphs: 0 },
  standard: { cards: 3, exampleLines: 3, bodyLines: 3, disclosedLines: 40, docParagraphs: 2 },
  full: { cards: 6, exampleLines: Infinity, bodyLines: 24, disclosedLines: 200, docParagraphs: 4 },
};

let detail: HoverDetail = "standard";

export function setHoverDetail(value: HoverDetail): void {
  detail = value;
}

export function hoverCaps(): HoverCaps {
  return CAPS[detail];
}

export function hoverDetail(): HoverDetail {
  return detail;
}

/** The language id our TextMate grammar registers (package.json `languages`). */
const FENCE_LANG = "paradox";

/** Strip the indentation every non-empty line shares, so a nested body reads flush. */
export function stripCommonIndent(body: string): string {
  const lines = body.split("\n");
  let common = Infinity;
  for (const line of lines) {
    if (line.trim() === "") continue;
    const indent = line.length - line.replace(/^[\t ]+/, "").length;
    if (indent < common) common = indent;
  }
  if (!isFinite(common) || common === 0) return body;
  return lines.map((l) => (l.trim() === "" ? l : l.slice(common))).join("\n");
}

/**
 * A fenced block, capped. Overflow beyond `head` goes into a `<details>`
 * disclosure when the client renders HTML.
 *
 * `<details>`/`<summary>` are on VS Code's markdown sanitizer allowlist, and
 * the hover widget really does render the twisty, expand in place and stay
 * open, verified by hand in a live editor. That is in-place hover expansion
 * without the `editorHoverVerbosityLevel` proposed API, which cannot ship to
 * the Marketplace. The one measured limit: a hover cannot grow past the editor
 * viewport, so the disclosed body is capped too.
 */
export function fencedBlock(body: string, head: number, disclosed: number): string {
  const text = stripCommonIndent(body.replace(/\s+$/, ""));
  const lines = text.split("\n");
  if (head <= 0) return "";
  if (lines.length <= head) return fence(lines);

  const shown = fence([...lines.slice(0, head), "…"]);
  if (!hoverHtml() || disclosed <= 0) return shown;

  const rest = lines.slice(head);
  const inside = rest.slice(0, disclosed);
  const hidden = rest.length - inside.length;
  const summary = `${rest.length.toLocaleString("en-US")} more line${rest.length === 1 ? "" : "s"}`;
  const body2 = hidden > 0 ? [...inside, `… and ${hidden.toLocaleString("en-US")} further`] : inside;
  return [shown, "", `<details><summary>${summary}</summary>`, "", fence(body2), "", "</details>"].join("\n");
}

function fence(lines: string[]): string {
  return `\`\`\`${FENCE_LANG}\n${lines.join("\n")}\n\`\`\``;
}

// ---------------------------------------------------------------------------
// Card model
// ---------------------------------------------------------------------------

export interface CardInput {
  kind: string;
  /** Badge label override (e.g. "scripted trigger" for a mod def). */
  badgeLabel?: string;
  name: string;
  /** Rendered inline after the name on line 1: `· mod`, `→ character`, `= 0.5`. */
  headTail?: string;
  /** Doc prose. */
  doc?: string;
  /** Already-fenced example block (build it with {@link fencedBlock}). */
  example?: string;
  /** One muted line: scopes, value shape and traits, joined with ` · `. */
  facts?: string;
  /**
   * Per-card provenance, rendered as a muted line with no rule above it. Only
   * multi-card hovers use it; a single-card hover puts its links on the shared
   * footer line instead, which is two lines cheaper.
   */
  provenance?: string;
}

/** Build one card's markdown. */
export function renderCard(card: CardInput): string {
  const badge = kindBadge(card.kind, card.badgeLabel);
  const head = card.headTail ? `${badge} **${card.name}** ${card.headTail}` : `${badge} **${card.name}**`;
  const parts: string[] = [head];
  if (card.doc) parts.push(card.doc);
  if (card.example) parts.push(card.example);
  if (card.facts) parts.push(`*${card.facts}*`);
  if (card.provenance) parts.push(card.provenance);
  return parts.join("\n\n");
}

/**
 * Join cards and append the single shared footer line. Cards are separated by a
 * rule; nothing is written above the first card or below the last one except
 * that footer, which carries the scope context and the action links.
 */
export function renderHover(cards: string[], footer: string | null): string {
  const max = hoverCaps().cards;
  const shown = cards.slice(0, max);
  const parts = [...shown];
  const extra = cards.length - shown.length;
  if (extra > 0) parts.push(`*${extra} more meaning${extra === 1 ? "" : "s"}*`);
  let md = parts.join("\n\n---\n\n");
  if (footer) md += `\n\n${footer}`;
  return md;
}

/**
 * The shared last line: scope context, then the action links. They ride here
 * rather than in a row of their own because this line always exists, so the
 * links cost nothing.
 */
export function hoverFooter(scope: string | null, actions: string[]): string | null {
  const parts: string[] = [];
  if (scope) parts.push(scope);
  parts.push(...actions);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** "Scope here: **X** (chain)" — the scope half of the footer. */
export function scopeHereLine(scopes: string, chain: string | null): string {
  return chain ? `Scope here: **${scopes}** (${chain})` : `Scope here: **${scopes}**`;
}

// ---------------------------------------------------------------------------
// PdxDoc rendering (§E3)
// ---------------------------------------------------------------------------

interface DocTagLike {
  tag: string;
  text: string;
}

export interface DocBody {
  /** Prose + structured-tag markdown for the card's `doc` slot. */
  doc?: string;
  /** `@example` body, unfenced; the caller caps and fences it. */
  example?: string;
  /** True when `@deprecated` is present. */
  deprecated?: boolean;
}

/**
 * Turn PdxDoc prose + tags (§E) into the card's `doc`/`example` slots. Prose
 * first, then structured tags compactly: `@param` as `*@param NAME — desc*`,
 * `@deprecated` as a prominent ⚠ line, other tags as compact italic lines.
 * Fail-soft: absent fields yield an empty body.
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
        tagLines.push(t.text ? `*@${t.tag} ${t.text}*` : `*@${t.tag}*`);
    }
  }
  if (tagLines.length > 0) lines.push(tagLines.join("  \n"));

  const capped = lines.slice(0, Math.max(1, hoverCaps().docParagraphs));
  if (hoverCaps().docParagraphs > 0 && capped.length > 0) out.doc = capped.join("\n\n");
  return out;
}
