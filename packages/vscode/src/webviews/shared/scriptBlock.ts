/**
 * The `name = { ... }` definition block a creator reads and the block it writes
 * back, for every creator panel.
 *
 * A definition is a small piece of script, so a panel reads it itself rather
 * than asking the server for a parse: a scanner that knows braces, quotes and
 * comments is enough, and it keeps the round trip inside one pure module the
 * tests can drive.
 *
 * The rule that makes this safe: **the file is the source, the form is a view
 * of part of it.** Every statement is kept with its exact source span, and a
 * statement is only rewritten when the field that owns it actually changed.
 * Everything else - a repeated `culture_modifier`, a `desc = { first_valid … }`,
 * a comment between two keys, the blank lines a modder put in - comes back
 * byte for byte, in place. That is what lets a modder open a vanilla trait,
 * change one number, and get a diff of one line.
 *
 * What is NOT here: which keys a form models, how a value is shaped for one
 * game concept, and any writer that re-serializes a whole block. Those live in
 * each creator's own `app/script.ts`.
 *
 * Browser code, no DOM: the apps import it, the tests import it directly.
 */

/** One `key = value` (or one bare token) of a block body, with its span. */
export interface ScriptItem {
  /** The key, or null for a bare token in a list (`opposites = { craven }`). */
  key: string | null;
  /** The operator as written (`=`, `>=`); null for a bare token. */
  op: string | null;
  /** The value's source text: a token, a quoted string, or a whole `{ … }`. */
  value: string;
  /** True when the value is a braced block. */
  block: boolean;
  /** Offsets into the text the items were scanned from. */
  start: number;
  end: number;
}

export interface ParsedBlock {
  name: string;
  /** Everything up to the body's first character: `name = {`. */
  head: string;
  body: string;
  /** From the body's end to the end of the text: the closing `}` and after. */
  tail: string;
  items: ScriptItem[];
  /** The line ending the source uses. */
  eol: string;
  /** The indentation the body's statements sit at, for appended statements. */
  indent: string;
}

const WORD = /[^\s{}="#]/;

/**
 * Split a block body into its statements. Whitespace, comments and blank lines
 * are NOT items: they are the gaps between spans, which is exactly what makes
 * them survive a rewrite untouched.
 */
export function scanItems(text: string): ScriptItem[] {
  const items: ScriptItem[] = [];
  let i = 0;
  const skipTrivia = (): void => {
    while (i < text.length) {
      const c = text[i];
      if (c === "#") {
        while (i < text.length && text[i] !== "\n") i++;
      } else if (c === " " || c === "\t" || c === "\r" || c === "\n") {
        i++;
      } else {
        return;
      }
    }
  };
  /** A token, a quoted string, or a balanced `{ … }`; the end offset. */
  const readValue = (): { text: string; block: boolean } | null => {
    skipTrivia();
    if (i >= text.length) return null;
    const start = i;
    if (text[i] === "{") {
      let depth = 0;
      while (i < text.length) {
        const c = text[i];
        if (c === "#") {
          while (i < text.length && text[i] !== "\n") i++;
          continue;
        }
        if (c === '"') {
          i++;
          while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
        } else if (c === "{") {
          depth++;
        } else if (c === "}") {
          depth--;
          if (depth === 0) {
            i++;
            return { text: text.slice(start, i), block: true };
          }
        }
        i++;
      }
      // Unbalanced: take what is there rather than losing it.
      return { text: text.slice(start, i), block: true };
    }
    if (text[i] === '"') {
      i++;
      while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
      i++;
      return { text: text.slice(start, i), block: false };
    }
    while (i < text.length && WORD.test(text[i])) i++;
    return i > start ? { text: text.slice(start, i), block: false } : null;
  };

  for (;;) {
    skipTrivia();
    if (i >= text.length) break;
    const start = i;
    if (text[i] === "{" || text[i] === "}") {
      // A stray brace at statement position: not something to model.
      i++;
      continue;
    }
    const first = readValue();
    if (!first) break;
    const afterKey = i;
    skipTrivia();
    const op = /^(>=|<=|!=|==|\?=|=|>|<)/.exec(text.slice(i, i + 2));
    if (!op || first.block) {
      items.push({ key: null, op: null, value: first.text, block: first.block, start, end: afterKey });
      i = afterKey;
      continue;
    }
    i += op[1].length;
    const value = readValue();
    if (!value) {
      items.push({ key: first.text, op: op[1], value: "", block: false, start, end: i });
      continue;
    }
    items.push({ key: first.text, op: op[1], value: value.text, block: value.block, start, end: i });
  }
  return items;
}

/** Read a whole `name = { … }` definition. Null when the text is not one. */
export function parseBlock(text: string): ParsedBlock | null {
  const open = /^(\s*)([^\s{}="#]+)(\s*)(=)(\s*)\{/.exec(text);
  if (!open) return null;
  const bodyStart = open[0].length;
  const close = text.lastIndexOf("}");
  if (close < bodyStart) return null;
  const body = text.slice(bodyStart, close);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  // The indentation appended statements take: the one the body already uses.
  const firstLine = /\n([ \t]+)\S/.exec(body);
  return {
    name: open[2],
    head: text.slice(0, bodyStart),
    body,
    tail: text.slice(close),
    items: scanItems(body),
    eol,
    indent: firstLine ? firstLine[1] : "\t",
  };
}

/**
 * The FIRST value written for each key. A form field binds to one statement,
 * and the first is the one the reader sees at the top of the file.
 */
export function firstValues(block: ParsedBlock): Map<string, string> {
  const values = new Map<string, string>();
  for (const item of block.items) {
    if (item.key !== null && item.op === "=" && !values.has(item.key)) values.set(item.key, item.value);
  }
  return values;
}

/** `{ craven ambitious }` -> the tokens, or null when it is not a plain list. */
export function readTokenList(blockValue: string): string[] | null {
  const inner = innerOf(blockValue);
  if (inner === null) return null;
  const items = scanItems(inner);
  if (items.some((item) => item.key !== null || item.block)) return null;
  return items.map((item) => item.value);
}

/** `{ brave = 20 }` -> the rows, or null when a value is not a plain number. */
export function readNumberRows(blockValue: string): { name: string; value: number }[] | null {
  const inner = innerOf(blockValue);
  if (inner === null) return null;
  const items = scanItems(inner);
  if (items.length === 0) return null;
  const rows: { name: string; value: number }[] = [];
  for (const item of items) {
    if (item.key === null || item.op !== "=" || item.block) return null;
    const value = readNumber(item.value);
    if (value === null) return null;
    rows.push({ name: item.key, value });
  }
  return rows;
}

/** The text between the braces of a `{ … }` value, or null when it is not one. */
export function innerOf(blockValue: string): string | null {
  const text = blockValue.trim();
  if (!text.startsWith("{") || !text.endsWith("}")) return null;
  return text.slice(1, -1);
}

/** A script number, or null: `@script_value` and `yes` are not numbers. */
export function readNumber(value: string): number | null {
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : null;
}

/** A quoted string's content, or null when the value is not quoted. */
export function readQuoted(value: string): string | null {
  const m = /^"([^"]*)"$/.exec(value.trim());
  return m ? m[1] : null;
}

/**
 * Quote a value only when it must be. The engine reads a bare token fine and
 * vanilla writes bare tokens, so quoting everything would make every save a
 * diff against the file it came from.
 */
export function quoteIfNeeded(value: string): string {
  return /^[^\s{}"#=]+$/.test(value) ? value : `"${value.replace(/"/g, '\\"')}"`;
}

/** What one field wants the block to say about its key. */
export interface BlockWrite {
  key: string;
  /**
   * The statement lines to write for the key, without indentation. Empty means
   * the key is not written at all (and any statement of it is removed).
   */
  lines: string[];
  /**
   * True when the value differs from the source. False keeps the source span
   * untouched, which is what makes an unchanged round trip byte-identical.
   */
  changed: boolean;
}

/**
 * Rebuild the definition. With a `source`, every span the writes do not claim
 * is copied verbatim and the order of the file is kept; without one, the
 * writes are laid out in the order they were given (the harvest's key order).
 */
export function writeBlock(
  name: string,
  source: ParsedBlock | null,
  writes: readonly BlockWrite[],
  fallback: { eol: string; indent: string } = { eol: "\n", indent: "\t" }
): string {
  const eol = source?.eol ?? fallback.eol;
  const indent = source?.indent ?? fallback.indent;
  const byKey = new Map<string, BlockWrite>();
  for (const write of writes) byKey.set(write.key, write);

  if (!source) {
    const body = writes
      .flatMap((write) => write.lines)
      .map((line) => indent + line)
      .join(eol);
    return body === "" ? `${name} = {${eol}}` : `${name} = {${eol}${body}${eol}}`;
  }

  const head = source.head.replace(/^(\s*)[^\s{}="#]+/, (_all, lead: string) => lead + name);
  let out = "";
  let cursor = 0;
  const seen = new Set<string>();
  for (const item of source.items) {
    const write = item.key !== null ? byKey.get(item.key) : undefined;
    if (!write || !write.changed) {
      if (item.key !== null && write) seen.add(item.key);
      continue; // the span is copied by the gap logic below
    }
    const first = !seen.has(item.key!);
    seen.add(item.key!);
    // The gap before the statement carries its indentation; reuse it so a
    // rewritten line sits exactly where the old one did.
    const gap = source.body.slice(cursor, item.start);
    const own = /(?:^|\n)([ \t]*)$/.exec(gap);
    const lead = own ? own[1] : indent;
    if (first && write.lines.length > 0) {
      out += gap + write.lines.join(eol + lead);
    } else {
      // A removed key, or the second statement of a key now written once:
      // drop the statement AND the whitespace that introduced it.
      out += gap.replace(/(\r?\n)?[ \t]*$/, "");
    }
    cursor = item.end;
  }
  out += source.body.slice(cursor);

  // Keys the block never had: appended at the end, in the writes' own order.
  const added = writes
    .filter((write) => write.changed && write.lines.length > 0 && !seen.has(write.key))
    .flatMap((write) => write.lines.map((line) => indent + line));
  if (added.length > 0) {
    const trimmed = out.replace(/[ \t]*$/, "");
    out = (trimmed.endsWith(eol) || trimmed === "" ? trimmed : trimmed + eol) + added.join(eol) + eol;
  }
  return head + out + source.tail;
}

/**
 * The keys whose value moved, as `paradox/definitionEdit`'s `setProperties`
 * wants them: a `null` value removes the key. Iterating `after` is what makes
 * a save of an untouched form report nothing at all.
 */
export function changedProperties(
  before: ReadonlyMap<string, string | null>,
  after: ReadonlyMap<string, string | null>
): { key: string; value: string | null }[] {
  const out: { key: string; value: string | null }[] = [];
  for (const [key, value] of after) {
    if (value !== (before.get(key) ?? null)) out.push({ key, value });
  }
  return out;
}

/** A loc key pattern (`$_name`) with the definition's own name filled in. */
export function locKeyFor(pattern: string, name: string): string {
  return pattern.replace(/\$/g, name);
}

/** The file name of a workspace path, for the `sourceFile` a save reports. */
export function baseName(file: string): string {
  return file.split(/[\\/]/).pop() ?? file;
}
