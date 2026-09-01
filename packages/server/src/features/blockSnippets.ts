/**
 * Block templates for engine tokens, harvested from the `usage:` example the
 * game's own script_docs dump carries (`TokenData.usage`). Completing `if` then
 * inserts `if = { limit = { … } … }` instead of the bare word.
 *
 * There is NO inference here and no curated table: the template is a rendering
 * of the shipped example, or nothing. A wrong template is worse than no
 * template — it teaches the modder a shape the engine does not accept — so
 * every guard below returns null rather than guessing:
 *
 *  - the example's leading identifier must be the token's own name (dumps
 *    routinely paste a sibling's example: `add_title_law_effects` shows
 *    `add_title_law = …`);
 *  - the example must open a block and its braces must balance (truncated
 *    dumps that never close are dropped);
 *  - every key must be a plain lowercase identifier, or a `a/b/c` alternation
 *    of them (this drops pseudo-key weight lists, `X1 = { … } X2 = { … } …`);
 *  - a `#` comment means the example enumerates alternatives ("# or:") that
 *    cannot be collapsed into one template;
 *  - `(optional)` and `...` truncate the body at that point;
 *  - `<name>` placeholders become tabstops, concrete example values become
 *    pre-filled tabstops.
 *
 * Both forms are produced at once: `snippet` for clients that declared
 * snippetSupport, `plain` (no `${`, insertable as literal text) for the rest.
 */
import type { TokenData } from "@px-lsp/protocol/types";

export interface BlockTemplate {
  /** `${n:…}` tabstop form; only for clients declaring snippetSupport. */
  snippet: string;
  /** Plain-text skeleton, free of `${`. */
  plain: string;
}

/** Keyed on the token object, so a reload or a game switch cannot serve a stale
 * template and nothing needs invalidating. The completion loop is hot enough
 * that re-parsing per keystroke per item would show. */
const memo = new WeakMap<TokenData, BlockTemplate | null>();

/** The block template for a token, or null when its example does not qualify. */
export function blockTemplateFor(token: TokenData): BlockTemplate | null {
  const hit = memo.get(token);
  if (hit !== undefined) return hit;
  const built = extractBlockTemplate(token.name, token.usage);
  memo.set(token, built);
  return built;
}

// ---- extraction ------------------------------------------------------------

/** Lowercase identifier: the only key shape a harvested template may carry. */
const KEY = /^[a-z_][a-z0-9_]*$/;
/** Everything from here on is optional or elided; the body stops. */
const TRUNCATE = ["(optional)", "..."];

interface Leaf {
  /** Raw text as written in the example. */
  text: string;
  /** `<…>` placeholder: the inner text names what goes here. */
  placeholder: boolean;
  /** `a/b/c` alternation of identifiers. */
  alts: string[] | null;
}

type Item = { key: Leaf; value: Leaf | Body } | { key: null; value: Leaf };

interface Body {
  items: Item[];
  /** A `(optional)` / `...` marker cut this body short. */
  truncated: boolean;
}

/** Pure extractor (exported for the accept/reject table in the tests). */
export function extractBlockTemplate(name: string, usage: string | undefined): BlockTemplate | null {
  if (!usage) return null;
  const text = usage.replace(/\r/g, "");
  // "# or:" style comments enumerate mutually exclusive forms: not one template.
  if (text.includes("#")) return null;

  const head = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\{/.exec(text);
  if (!head || head[1] !== name) return null;

  const open = text.indexOf("{");
  const close = matchingBrace(text, open);
  // Unbalanced, or something follows the block: not a template we can trust.
  if (close < 0 || text.slice(close + 1).trim() !== "") return null;

  const body = new BodyParser(text, open + 1).parseBody();
  if (body === null) return null;

  return { snippet: render(name, body, true), plain: render(name, body, false) };
}

/** Index of the `}` closing the `{` at `open`, or -1 when it never closes. */
function matchingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

class BodyParser {
  constructor(
    private readonly text: string,
    private i: number
  ) {}

  /** Items of the block whose `{` was just consumed; null rejects the example. */
  parseBody(): Body | null {
    const items: Item[] = [];
    for (;;) {
      this.skipSpace();
      if (this.i >= this.text.length) return null;
      if (this.text[this.i] === "}") {
        this.i++;
        return { items, truncated: false };
      }
      if (TRUNCATE.some((m) => this.text.startsWith(m, this.i))) {
        const close = matchingBrace(this.text, this.blockStart());
        if (close < 0) return null;
        this.i = close + 1;
        return { items, truncated: true };
      }
      const first = this.readLeaf();
      if (!first) return null;
      this.skipSpace();
      if (this.text[this.i] !== "=") {
        // A bare word only makes sense as a `<effects>`-style placeholder.
        if (!first.placeholder) return null;
        items.push({ key: null, value: first });
        continue;
      }
      if (first.placeholder) return null; // a key we cannot name is not a key
      if (!KEY.test(first.text) && !(first.alts && first.alts.every((a) => KEY.test(a)))) return null;
      this.i++; // `=`
      this.skipSpace();
      if (this.text[this.i] === "{") {
        this.i++;
        const nested = this.parseBody();
        if (nested === null) return null;
        items.push({ key: first, value: nested });
        continue;
      }
      const value = this.readLeaf();
      if (!value) return null;
      items.push({ key: first, value });
    }
  }

  /** Start of the innermost still-open `{` at or before the cursor. */
  private blockStart(): number {
    let depth = 0;
    for (let i = this.i - 1; i >= 0; i--) {
      if (this.text[i] === "}") depth++;
      else if (this.text[i] === "{" && depth-- === 0) return i;
    }
    return -1;
  }

  private skipSpace(): void {
    while (this.i < this.text.length && /\s/.test(this.text[this.i])) this.i++;
  }

  private readLeaf(): Leaf | null {
    if (this.text[this.i] === "<") {
      const end = this.text.indexOf(">", this.i);
      if (end < 0) return null;
      const inner = this.text.slice(this.i + 1, end);
      this.i = end + 1;
      return inner ? { text: inner, placeholder: true, alts: null } : null;
    }
    const start = this.i;
    while (this.i < this.text.length && !/[\s{}=<>]/.test(this.text[this.i])) this.i++;
    const raw = this.text.slice(start, this.i);
    if (!raw) return null;
    const parts = raw.split("/");
    return { text: raw, placeholder: false, alts: parts.length > 1 ? parts : null };
  }
}

// ---- rendering -------------------------------------------------------------

function render(name: string, body: Body, snippet: boolean): string {
  return `${name} = {\n${renderBody(body, "\t", snippet, { n: 0 }).join("")}}`;
}

function renderBody(body: Body, indent: string, snippet: boolean, counter: { n: number }): string[] {
  const lines: string[] = [];
  for (const item of body.items) {
    if (item.key === null) {
      lines.push(`${indent}${leaf(item.value, snippet, counter)}\n`);
      continue;
    }
    // A key is known text, not a hole — only an `a/b/c` key is a choice.
    const key = item.key.alts ? leaf(item.key, snippet, counter) : item.key.text;
    if ("items" in item.value) {
      lines.push(`${indent}${key} = {\n`);
      lines.push(...renderBody(item.value, indent + "\t", snippet, counter));
      lines.push(`${indent}}\n`);
      continue;
    }
    lines.push(`${indent}${key} = ${leaf(item.value, snippet, counter)}\n`);
  }
  // An empty or cut-short body leaves the cursor a place to land; in plain mode
  // there is nothing meaningful to write there.
  if ((lines.length === 0 || body.truncated) && snippet) lines.push(`${indent}$${++counter.n}\n`);
  return lines;
}

function leaf(l: Leaf, snippet: boolean, counter: { n: number }): string {
  if (!snippet) return l.placeholder ? `<${l.text}>` : l.alts ? l.alts[0] : l.text;
  if (l.alts) return `\${${++counter.n}|${l.alts.join(",")}|}`;
  return `\${${++counter.n}:${escapeSnippet(l.text)}}`;
}

function escapeSnippet(text: string): string {
  return text.replace(/[\\$}]/g, "\\$&");
}
