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
 *    `add_title_law = …`). A `<scope> = { name = { … } }` wrapper around a
 *    single such block is peeled off first; any other placeholder key rejects;
 *  - the example must open a block and its braces must balance (truncated
 *    dumps that never close are dropped);
 *  - every key must be a plain lowercase identifier, or a `a/b/c` alternation
 *    of them (this drops pseudo-key weight lists, `X1 = { … } X2 = { … } …`);
 *  - a `#` comment is read ONLY when it says the field is optional
 *    (`#Optional`, `# optional way to …`); every other comment means the
 *    example enumerates alternatives ("# or:") or explains something we cannot
 *    turn into script, and rejects the example;
 *  - `(optional)` and `...` truncate the body at that point;
 *  - `<name>` placeholders become tabstops, concrete example values become
 *    pre-filled tabstops.
 *
 * An example that marks fields optional yields TWO templates rather than none:
 * `snippet`/`plain` carry the required fields only, `full` carries every field
 * the example shows.
 *
 * Both text forms are produced at once: `snippet` for clients that declared
 * snippetSupport, `plain` (no `${`, insertable as literal text) for the rest.
 */
import type { TokenData } from "@px-lsp/protocol/types";

export interface BlockTemplate {
  /** `${n:…}` tabstop form; only for clients declaring snippetSupport. */
  snippet: string;
  /** Plain-text skeleton, free of `${`. */
  plain: string;
  /**
   * The same block with the fields the example marked `# optional` put back.
   * Present only when the example marked at least one, so `full` never repeats
   * what `snippet`/`plain` already say. Tabstops are numbered per form.
   */
  full?: { snippet: string; plain: string };
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

/** A comment the dumps use to mark a field as not required: `#Optional`,
 * `# optional way to get a reference`, `# Optional; if set, …`. Anything else
 * after a `#` is prose or an alternation and rejects the example. */
const OPTIONAL_COMMENT = /^#[ \t]*optional/i;

/** A `<placeholder> = {` scope wrapper around the example. */
const WRAPPER_HEAD = /^\s*<[^>]+>\s*=\s*\{/;

interface Leaf {
  /** Raw text as written in the example. */
  text: string;
  /** `<…>` placeholder: the inner text names what goes here. */
  placeholder: boolean;
  /** `a/b/c` alternation of identifiers. */
  alts: string[] | null;
}

type Item = ({ key: Leaf; value: Leaf | Body } | { key: null; value: Leaf }) & {
  /** The example's own `# optional` comment ended this item's line. */
  optional: boolean;
};

interface Body {
  items: Item[];
  /** A `(optional)` / `...` marker cut this body short. */
  truncated: boolean;
}

/** Pure extractor (exported for the accept/reject table in the tests). */
export function extractBlockTemplate(name: string, usage: string | undefined): BlockTemplate | null {
  if (!usage) return null;
  const stripped = stripOptionalComments(usage.replace(/\r/g, ""));
  if (!stripped) return null;
  let { text } = stripped;
  const { optionalLines } = stripped;

  // Some `usage:` blocks wrap the effect in the scope it has to run in
  // (`<founding character> = { create_cadet_branch = { … } }`; 5 effects in the
  // 1.19 dumps). The template is the inner block: the modder types it inside the
  // scope they already mean. Blanking rather than slicing keeps line numbers,
  // which the `# optional` marks are keyed on. The guards below then do the
  // rest of the work: the wrapper is unwrapped only when its ONE item is a
  // block named after the token.
  const wrapper = WRAPPER_HEAD.test(text) ? unwrap(text) : text;
  if (wrapper === null) return null;
  text = wrapper;

  const head = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\{/.exec(text);
  if (!head || head[1] !== name) return null;

  const open = text.indexOf("{");
  const close = matchingBrace(text, open);
  // Unbalanced, or something follows the block: not a template we can trust.
  if (close < 0 || text.slice(close + 1).trim() !== "") return null;

  const parser = new BodyParser(text, open + 1, optionalLines);
  const body = parser.parseBody();
  if (body === null) return null;
  // Every accepted "optional" comment must have landed on an item. One that did
  // not (a lone `# optional effects…` line, or a comment on the line that only
  // OPENS a nested block) says something about the example we cannot express.
  for (const line of optionalLines) if (!parser.markedLines.has(line)) return null;

  const minimal = { snippet: render(name, body, true, false), plain: render(name, body, false, false) };
  if (!hasOptional(body)) return minimal;
  return {
    ...minimal,
    full: { snippet: render(name, body, true, true), plain: render(name, body, false, true) },
  };
}

/**
 * Drops the `# optional` comments and reports which lines carried one; returns
 * null when any OTHER `#` comment appears, which still rejects the example.
 *
 * A comment runs to the end of its line, and a following line whose first
 * non-space character is `#` wraps the same comment (the dumps wrap long
 * `# Optional, …` notes over three lines) and is dropped with it. Dropped
 * lines are kept as empty lines so line numbers still address the example.
 */
function stripOptionalComments(text: string): { text: string; optionalLines: Set<number> } | null {
  const lines = text.split("\n");
  const out: string[] = [];
  const optionalLines = new Set<number>();
  let wrapping = false;
  for (let i = 0; i < lines.length; i++) {
    const hash = lines[i].indexOf("#");
    if (hash < 0) {
      out.push(lines[i]);
      wrapping = false;
      continue;
    }
    const before = lines[i].slice(0, hash);
    // A continuation of the optional comment above.
    if (wrapping && before.trim() === "") {
      out.push("");
      continue;
    }
    if (!OPTIONAL_COMMENT.test(lines[i].slice(hash))) return null;
    // A comment on its own line marks no item.
    if (before.trim() === "") return null;
    out.push(before.trimEnd());
    optionalLines.add(i);
    wrapping = true;
  }
  return { text: out.join("\n"), optionalLines };
}

/** True when the block, at any depth, has a field the example marked optional. */
function hasOptional(body: Body): boolean {
  return body.items.some((item) => item.optional || ("items" in item.value && hasOptional(item.value)));
}

/**
 * Blanks everything outside the wrapper's braces (newlines kept, so line
 * numbers still address the example). Null when the wrapper never closes or
 * something follows it.
 */
function unwrap(text: string): string | null {
  const open = text.indexOf("{");
  const close = matchingBrace(text, open);
  if (close < 0 || text.slice(close + 1).trim() !== "") return null;
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  return blank(text.slice(0, open + 1)) + text.slice(open + 1, close) + blank(text.slice(close));
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
  /** Lines of `optionalLines` an item actually ended on. */
  readonly markedLines = new Set<number>();
  /** Line number per character offset, so an item can be tied to its comment. */
  private readonly lineAt: number[];

  constructor(
    private readonly text: string,
    private i: number,
    private readonly optionalLines: Set<number> = new Set()
  ) {
    this.lineAt = new Array<number>(text.length);
    let line = 0;
    for (let n = 0; n < text.length; n++) {
      this.lineAt[n] = line;
      if (text[n] === "\n") line++;
    }
  }

  /** Items of the block whose `{` was just consumed; null rejects the example. */
  parseBody(): Body | null {
    const items: Item[] = [];
    const push = (item: Omit<Item, "optional">, end = this.i): void => {
      // A comment (already stripped) on the line the item ENDS on marked it
      // optional, so measure the end before any trailing whitespace is skipped.
      const line = this.lineAt[end - 1] ?? 0;
      const optional = this.optionalLines.has(line);
      if (optional) this.markedLines.add(line);
      items.push({ ...item, optional } as Item);
    };
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
      const firstEnd = this.i;
      this.skipSpace();
      if (this.text[this.i] !== "=") {
        // A bare word only makes sense as a `<effects>`-style placeholder.
        if (!first.placeholder) return null;
        push({ key: null, value: first }, firstEnd);
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
        push({ key: first, value: nested });
        continue;
      }
      const value = this.readLeaf();
      if (!value) return null;
      push({ key: first, value });
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

/** `all` = the "all fields" form; false drops what the example called optional. */
function render(name: string, body: Body, snippet: boolean, all: boolean): string {
  return `${name} = {\n${renderBody(body, "\t", snippet, { n: 0 }, all).join("")}}`;
}

function renderBody(
  body: Body,
  indent: string,
  snippet: boolean,
  counter: { n: number },
  all: boolean
): string[] {
  const lines: string[] = [];
  for (const item of body.items) {
    if (item.optional && !all) continue;
    if (item.key === null) {
      lines.push(`${indent}${leaf(item.value, snippet, counter)}\n`);
      continue;
    }
    // A key is known text, not a hole — only an `a/b/c` key is a choice.
    const key = item.key.alts ? leaf(item.key, snippet, counter) : item.key.text;
    if ("items" in item.value) {
      lines.push(`${indent}${key} = {\n`);
      lines.push(...renderBody(item.value, indent + "\t", snippet, counter, all));
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
