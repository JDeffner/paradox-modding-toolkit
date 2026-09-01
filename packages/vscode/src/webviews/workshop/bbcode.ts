/**
 * Steam BBCode -> HTML, for the Workshop panel's description preview. A small
 * stack parser over the tag set Steam's Workshop renders: text is always
 * HTML-escaped first, only whitelisted tags become elements, URLs are limited
 * to http(s). Unknown or unbalanced markup falls back to literal text - the
 * preview must never look "more broken" than Steam would.
 *
 * Pure string -> string (no DOM), so it unit-tests in plain Node; the page
 * styles the emitted `bb-*` classes.
 */

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const safeUrl = (raw: string): string | null => {
  const url = raw.trim();
  return /^https?:\/\//i.test(url) ? url : null;
};

interface TagSpec {
  open: (param: string | null) => string;
  close: string;
  /** Content is taken raw (escaped, no tag parsing) until the closing tag. */
  verbatim?: boolean;
  /** Newlines inside do not become <br> (structural containers). */
  structural?: boolean;
}

const simple = (tag: string, cls: string): TagSpec => ({
  open: () => `<${tag} class="${cls}">`,
  close: `</${tag}>`,
});

const TAGS: Record<string, TagSpec> = {
  b: simple("strong", "bb-b"),
  i: simple("em", "bb-i"),
  u: simple("span", "bb-u"),
  strike: simple("s", "bb-s"),
  s: simple("s", "bb-s"),
  spoiler: simple("span", "bb-spoiler"),
  h1: simple("div", "bb-h1"),
  h2: simple("div", "bb-h2"),
  h3: simple("div", "bb-h3"),
  quote: {
    open: (p) =>
      `<blockquote class="bb-quote">` +
      (p ? `<div class="bb-quote-author">Originally posted by ${esc(p)}:</div>` : ""),
    close: "</blockquote>",
  },
  url: {
    // Non-http(s) targets render as plain text: the preview never links them.
    open: (p) => {
      const url = p ? safeUrl(p) : null;
      return url ? `<a class="bb-url" href="${esc(url)}" title="${esc(url)}">` : `<span class="bb-url">`;
    },
    close: "</a>",
  },
  img: { open: () => "", close: "", verbatim: true },
  code: { open: () => `<pre class="bb-code">`, close: "</pre>", verbatim: true },
  noparse: { open: () => "", close: "", verbatim: true },
  list: { open: () => `<ul class="bb-list">`, close: "</ul>", structural: true },
  olist: { open: () => `<ol class="bb-list">`, close: "</ol>", structural: true },
  table: { open: () => `<table class="bb-table">`, close: "</table>", structural: true },
  tr: { open: () => "<tr>", close: "</tr>", structural: true },
  th: { open: () => "<th>", close: "</th>" },
  td: { open: () => "<td>", close: "</td>" },
};

const TOKEN = /\[(\/?)([a-z1-6*]+)(?:=([^\]]*))?\]/gi;

export function bbcodeToHtml(src: string): string {
  const out: string[] = [];
  /** Open tags, innermost last. `<li>` items are tracked as "*". */
  const stack: { name: string; spec: TagSpec | null }[] = [];
  const inStructural = (): boolean => stack.some((s) => s.spec?.structural && s.name !== "table");
  let pos = 0;

  const text = (raw: string): void => {
    if (!raw) return;
    let t = esc(raw);
    // Structural containers swallow the newlines between their child tags;
    // everywhere else a newline is a line break, like on Steam.
    const top = stack[stack.length - 1];
    if (top && top.spec?.structural) t = t.replace(/\r?\n/g, "");
    else t = t.replace(/\r?\n/g, "<br>");
    out.push(t);
  };

  // Steam swallows the newline that ends a list item; so does the preview.
  const trimBr = (): void => {
    const last = out.length - 1;
    if (last >= 0 && out[last].endsWith("<br>")) out[last] = out[last].slice(0, -4);
  };
  const closeItem = (): void => {
    const top = stack[stack.length - 1];
    if (top && top.name === "*") {
      trimBr();
      out.push("</li>");
      stack.pop();
    }
  };

  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(src))) {
    const [token, slash, rawName, param] = m;
    const name = rawName.toLowerCase();
    text(src.slice(pos, m.index));
    pos = m.index + token.length;

    if (name === "*" && !slash) {
      if (stack.some((s) => s.name === "list" || s.name === "olist")) {
        closeItem();
        out.push(`<li class="bb-li">`);
        stack.push({ name: "*", spec: null });
      } else {
        out.push(esc(token));
      }
      continue;
    }
    if (name === "hr") {
      // Steam writes [hr][/hr]; both halves map to one rule.
      if (!slash) out.push(`<hr class="bb-hr">`);
      continue;
    }
    const spec = TAGS[name];
    if (!spec) {
      out.push(esc(token));
      continue;
    }
    if (slash) {
      const idx = stack.map((s) => s.name).lastIndexOf(name);
      if (idx < 0) {
        out.push(esc(token));
        continue;
      }
      // Close whatever the sloppy markup left open inside.
      while (stack.length > idx) {
        const top = stack.pop()!;
        if (top.name === "*") trimBr();
        out.push(top.name === "*" ? "</li>" : (top.spec?.close ?? ""));
      }
      continue;
    }
    if (spec.verbatim) {
      const end = src.toLowerCase().indexOf(`[/${name}]`, pos);
      const body = end < 0 ? src.slice(pos) : src.slice(pos, end);
      pos = end < 0 ? src.length : end + name.length + 3;
      TOKEN.lastIndex = pos;
      if (name === "img") {
        const url = safeUrl(body);
        if (url) out.push(`<img class="bb-img" src="${esc(url)}" alt="">`);
      } else if (name === "code") {
        out.push(spec.open(null), esc(body.replace(/^\r?\n/, "")), spec.close);
      } else {
        text(body);
      }
      continue;
    }
    if ((name === "list" || name === "olist") && inStructural()) closeItem();
    out.push(spec.open(param ?? null));
    stack.push({ name, spec });
  }
  text(src.slice(pos));
  while (stack.length) {
    const top = stack.pop()!;
    out.push(top.name === "*" ? "</li>" : (top.spec?.close ?? ""));
  }
  return out.join("");
}
