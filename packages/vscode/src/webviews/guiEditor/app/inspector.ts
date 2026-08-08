/**
 * Inspector rows: the widget's effective properties, each labelled with where
 * its value came from.
 *
 * The server resolves the chain (`paradox/guiWidgetInfo`, through the same def
 * store the canvas laid out with); this module only turns it into the words the
 * panel shows. PURE, so the labels are asserted without a DOM.
 *
 * A row with an EMPTY origin is authored in the widget's own body: that is the
 * one an inspector write rewrites in place. Everything else is inherited, and
 * writing it will add an override at the use site (G3.3), never touch the
 * definition's own bytes.
 *
 * The rest of the file is the arithmetic the panel's later surfaces need, all
 * of it pure for the same reason: how much of a value a display mode shows, how
 * a block value splits into rows and recomposes into one line, and which
 * property names an add-property row may offer. None of them decides anything
 * the document does not already say or the harvest did not already see.
 */
import type { GuiWidgetInfo, GuiWidgetOrigin } from "@px-lsp/protocol/protocol";
import type { GuiValueMode } from "../messages";

export interface InspectorRow {
  key: string;
  value: string;
  /** Empty for a locally authored property; else "template X", "type y in …". */
  origin: string;
  local: boolean;
}

/**
 * "template PxDeco", "type px_card", "template PxDeco in type px_card" — the
 * chain innermost first, read as "spliced from A, which came in through B".
 */
export function originLabel(origin: readonly GuiWidgetOrigin[]): string {
  return origin.map((step) => `${step.kind} ${step.name}`).join(" in ");
}

export function inspectorRows(info: GuiWidgetInfo): InspectorRow[] {
  return info.properties.map((p) => ({
    key: p.key,
    value: p.value,
    origin: originLabel(p.origin),
    local: p.origin.length === 0,
  }));
}

/** The header line: `key#name`, plus the type chain when the key resolves to one. */
export function widgetTitle(info: { key: string; name?: string }): string {
  return info.name ? `${info.key}#${info.name}` : info.key;
}

// ---- how much of a value the panel shows ------------------------------------

/** The cycle order of the value display modes, which is also the button's. */
export const VALUE_MODES: readonly GuiValueMode[] = ["full", "abbreviated", "hidden"];

/**
 * Characters an abbreviated value keeps. A UI budget, not a measurement: the
 * inspector column is ~150 px of monospace, and a `using = Very_Long_Name`
 * value past this is not read, only recognised.
 */
export const ABBREVIATED_MAX = 20;

export function nextValueMode(mode: GuiValueMode): GuiValueMode {
  return VALUE_MODES[(VALUE_MODES.indexOf(mode) + 1) % VALUE_MODES.length];
}

/** The value with an ellipsis instead of its tail; short values are untouched. */
export function abbreviate(value: string, max = ABBREVIATED_MAX): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

// ---- a block value, as rows --------------------------------------------------

/** One `key = value` inside a block-valued property. */
export interface BlockEntry {
  key: string;
  value: string;
}

/**
 * `{ using = Background_Area alpha = 0.7 }` -> its inner assignments, or null
 * when the value is not a block of them: a scalar (`0.5`), a bare pair
 * (`{ 10 10 }`), or anything this cannot recompose byte-faithfully. Null is the
 * answer that keeps the plain text row, so a value the sub-editor does not
 * fully understand is never rewritten from a partial reading of it.
 */
export function blockEntries(value: string): BlockEntry[] | null {
  const text = value.trim();
  if (!text.startsWith("{") || !text.endsWith("}")) return null;
  const body = text.slice(1, -1);
  const entries: BlockEntry[] = [];
  let at = 0;
  for (;;) {
    const key = readToken(body, at);
    if (!key) break;
    const eq = skipSpace(body, key.end);
    if (body[eq] !== "=") return null;
    const inner = readToken(body, eq + 1);
    if (!inner) return null;
    entries.push({ key: key.text, value: inner.text });
    at = inner.end;
  }
  return skipSpace(body, at) < body.length || entries.length === 0 ? null : entries;
}

/** The rows back as one line of `.gui`, which is what a write sends. */
export function composeBlock(entries: readonly BlockEntry[]): string {
  const inner = entries
    .filter((e) => e.key.trim().length > 0)
    .map((e) => `${e.key.trim()} = ${e.value.trim()}`)
    .join(" ");
  return inner.length === 0 ? "{ }" : `{ ${inner} }`;
}

function skipSpace(text: string, at: number): number {
  while (at < text.length && /\s/.test(text[at])) at++;
  return at;
}

/**
 * One token: a quoted string, a braced block (nesting counted), or a bare run.
 * A `#` starts a comment, which the sub-editor cannot place back where it was,
 * so a body carrying one reads as a token this refuses and stays plain text.
 */
function readToken(text: string, from: number): { text: string; end: number } | null {
  const start = skipSpace(text, from);
  if (start >= text.length) return null;
  const ch = text[start];
  if (ch === "#" || ch === "=") return null;
  if (ch === '"') {
    const close = text.indexOf('"', start + 1);
    return close < 0 ? null : { text: text.slice(start, close + 1), end: close + 1 };
  }
  if (ch === "{") {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}" && --depth === 0) return { text: text.slice(start, i + 1), end: i + 1 };
      else if (text[i] === '"') {
        const close = text.indexOf('"', i + 1);
        if (close < 0) return null;
        i = close;
      }
    }
    return null;
  }
  let end = start;
  while (end < text.length && !/[\s={}"#]/.test(text[end])) end++;
  return end === start ? null : { text: text.slice(start, end), end };
}

// ---- what an add-property row may offer --------------------------------------

/** How many completions the add-property row lists at once. A UI budget. */
export const PROPERTY_CHOICE_LIMIT = 8;

/**
 * The property names to offer, in order: the ones the harvest saw on THIS
 * widget's type (the chain innermost first, so the widget's own key outranks
 * the base it derives from), then the vanilla tree's overall ranking. Names the
 * widget already carries are dropped, since adding one would be an edit of the
 * row it already has.
 *
 * Nothing is invented here. Every name came off `paradox/guiVocabulary`, which
 * harvested it from the game's own `gui/` tree.
 */
export function propertyChoices(
  chain: readonly string[],
  properties: Readonly<Record<string, readonly string[]>>,
  common: readonly string[],
  taken: ReadonlySet<string>,
  query: string
): string[] {
  const needle = query.trim().toLowerCase();
  const out: string[] = [];
  const seen = new Set<string>();
  for (const source of [...chain.map((type) => properties[type.toLowerCase()] ?? []), common]) {
    for (const name of source) {
      if (seen.has(name) || taken.has(name) || !name.includes(needle)) continue;
      seen.add(name);
      out.push(name);
      if (out.length === PROPERTY_CHOICE_LIMIT) return out;
    }
  }
  return out;
}
