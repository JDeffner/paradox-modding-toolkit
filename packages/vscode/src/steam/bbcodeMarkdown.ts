/**
 * Steam BBCode <-> Markdown, both directions, for Workshop listing text.
 *
 * Steam's formatting help (https://steamcommunity.com/comment/Guide/formattinghelp)
 * documents exactly this tag set: [h1] [h2] [h3], [b], [u], [i], [strike],
 * [spoiler], [noparse], [hr][/hr], [url=link]text[/url], [list] and [olist]
 * with [*] items, [quote=author], [code], and [table] built from [tr] [th]
 * [td] (with the optional noborder=1 / equalcells=1 table attributes). The
 * page does not list [img] or [previewyoutube], but the Workshop renders
 * both, so [img] is mapped and everything else is carried across as literal
 * text. Nothing is ever refused: a round trip keeps every character.
 *
 * Two differences a modder can see, both unavoidable:
 * - Steam breaks a line on every newline; Markdown joins soft-wrapped lines.
 *   The text survives either way, but VS Code's own Markdown preview shows
 *   the joined form. The Workshop panel's preview converts to BBCode first,
 *   so it shows what Steam will show.
 * - A quote whose first Markdown line is entirely bold reads back as
 *   [quote=that text]: that is how the author line is written.
 *
 * No vscode import: unit-tested in plain Node, and bundled into the Workshop
 * webview, which needs the Markdown -> BBCode direction for its preview.
 */

// ---------------------------------------------------------------------------
// BBCode -> Markdown
// ---------------------------------------------------------------------------

interface TagNode {
  kind: "tag";
  name: string;
  param: string | null;
  children: Node[];
}
interface TextNode {
  kind: "text";
  text: string;
}
type Node = TagNode | TextNode;

/** Tags with a Markdown counterpart. Anything else stays literal text. */
const KNOWN = new Set([
  "h1",
  "h2",
  "h3",
  "b",
  "i",
  "u",
  "strike",
  "spoiler",
  "noparse",
  "hr",
  "url",
  "img",
  "list",
  "olist",
  "*",
  "quote",
  "code",
  "table",
  "tr",
  "th",
  "td",
]);
/** Their content is text, never markup. */
const VERBATIM = new Set(["code", "noparse", "img"]);

const TOKEN = /\[(\/?)([a-z1-6*]+)(?:=([^\]]*))?\]/gi;

function parse(src: string): Node[] {
  const root: Node[] = [];
  const open: TagNode[] = [];
  const current = (): Node[] => (open.length ? open[open.length - 1].children : root);
  const text = (s: string): void => {
    if (!s) return;
    const list = current();
    const last = list[list.length - 1];
    if (last && last.kind === "text") last.text += s;
    else list.push({ kind: "text", text: s });
  };
  let pos = 0;
  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(src))) {
    const [token, slash, rawName, param] = m;
    const name = rawName.toLowerCase();
    text(src.slice(pos, m.index));
    pos = m.index + token.length;
    if (!KNOWN.has(name)) {
      text(token);
      continue;
    }
    if (name === "hr") {
      if (!slash) current().push({ kind: "tag", name, param: null, children: [] });
      continue;
    }
    if (name === "*") {
      // An item runs until the next [*] or the end of its list.
      if (slash) continue;
      while (open.length && open[open.length - 1].name === "*") open.pop();
      const node: TagNode = { kind: "tag", name, param: null, children: [] };
      current().push(node);
      open.push(node);
      continue;
    }
    if (slash) {
      const idx = open.map((o) => o.name).lastIndexOf(name);
      if (idx < 0) text(token);
      // Closes whatever sloppy markup left open inside, like Steam does.
      else open.length = idx;
      continue;
    }
    const node: TagNode = { kind: "tag", name, param: param ?? null, children: [] };
    current().push(node);
    if (VERBATIM.has(name)) {
      const end = src.toLowerCase().indexOf(`[/${name}]`, pos);
      node.children.push({ kind: "text", text: end < 0 ? src.slice(pos) : src.slice(pos, end) });
      pos = end < 0 ? src.length : end + name.length + 3;
      TOKEN.lastIndex = pos;
      continue;
    }
    open.push(node);
  }
  text(src.slice(pos));
  return root;
}

const rawText = (nodes: Node[]): string =>
  nodes.map((n) => (n.kind === "text" ? n.text : rawText(n.children))).join("");

const tagsNamed = (nodes: Node[], ...names: string[]): TagNode[] =>
  nodes.filter((n): n is TagNode => n.kind === "tag" && names.includes(n.name));

/** A fence long enough to hold `body` (Markdown needs more backticks than it contains). */
function fenceFor(body: string): string {
  const longest = Math.max(0, ...[...body.matchAll(/`+/g)].map((m) => m[0].length));
  return "`".repeat(Math.max(3, longest + 1));
}

export function bbcodeToMarkdown(src: string): string {
  return render(parse(src))
    .replace(/[ \t]+$/gm, "")
    .trim();
}

function render(nodes: Node[]): string {
  let out = "";
  /** Plain text, with the blank lines at a block boundary capped at one. */
  const text = (s: string): void => {
    if (out.endsWith("\n")) {
      const lead = /^\n*/.exec(s)![0].length;
      const have = /\n*$/.exec(out)![0].length;
      s = s.slice(Math.min(lead, Math.max(0, have + lead - 2)));
    }
    out += s;
  };
  /** A block starts on its own line and ends with one. */
  const block = (body: string): void => {
    if (out !== "" && !out.endsWith("\n")) out += "\n";
    out += body.replace(/\n+$/, "") + "\n";
  };
  for (const n of nodes) {
    if (n.kind === "text") {
      text(n.text);
      continue;
    }
    switch (n.name) {
      case "h1":
      case "h2":
      case "h3":
        block(`${"#".repeat(Number(n.name[1]))} ${oneLine(render(n.children))}`);
        break;
      case "b":
        out += `**${render(n.children)}**`;
        break;
      case "i":
        out += `*${render(n.children)}*`;
        break;
      case "u":
        // Markdown has no underline; the HTML renders in every Markdown preview.
        out += `<u>${render(n.children)}</u>`;
        break;
      case "strike":
        out += `~~${render(n.children)}~~`;
        break;
      case "spoiler": {
        const body = render(n.children).trim();
        out += body.includes("\n")
          ? `<details><summary>Spoiler</summary>\n${body}\n</details>`
          : `<details><summary>Spoiler</summary>${body}</details>`;
        break;
      }
      case "noparse": {
        const body = rawText(n.children);
        // A code span cannot hold a newline or a backtick; that content stays
        // as the literal tag, which converts back unchanged.
        out += /[\n`]/.test(body) ? `[noparse]${body}[/noparse]` : `\`${body}\``;
        break;
      }
      case "hr":
        // `---` right under a line of text would be a setext heading instead.
        if (out !== "" && !out.endsWith("\n")) out += "\n";
        if (out !== "" && !out.endsWith("\n\n")) out += "\n";
        out += "---\n";
        break;
      case "url":
        out += n.param
          ? `[${oneLine(render(n.children))}](${n.param.trim()})`
          : `<${rawText(n.children).trim()}>`;
        break;
      case "img":
        out += `![](${rawText(n.children).trim()})`;
        break;
      case "list":
      case "olist":
        block(renderList(n));
        break;
      case "quote": {
        const body = (n.param ? `**${n.param}**\n` : "") + render(n.children).trim();
        block(
          body
            .split("\n")
            .map((l) => (l === "" ? ">" : `> ${l}`))
            .join("\n")
        );
        break;
      }
      case "code": {
        const body = rawText(n.children)
          .replace(/^\r?\n/, "")
          .replace(/\s+$/, "");
        const fence = fenceFor(body);
        block(`${fence}\n${body}\n${fence}`);
        break;
      }
      case "table":
        block(renderTable(n));
        break;
      default:
        // A stray [*], [tr], [th] or [td] outside its container: keep the text.
        out += render(n.children);
    }
  }
  return out;
}

const oneLine = (s: string): string => s.replace(/\s*\n\s*/g, " ").trim();

function renderList(node: TagNode): string {
  const items = tagsNamed(node.children, "*");
  return items
    .map((item, i) => {
      const marker = node.name === "olist" ? `${i + 1}. ` : "- ";
      const pad = " ".repeat(marker.length);
      const lines = render(item.children)
        .replace(/^[ \t]+/, "")
        .trim()
        .split("\n");
      return lines.map((l, j) => (j === 0 ? marker + l : l === "" ? "" : pad + l)).join("\n");
    })
    .join("\n");
}

/**
 * A Markdown table needs a header row, so a [table] with no [th] anywhere
 * gets an empty one (which converts back to empty [th] cells).
 */
function renderTable(node: TagNode): string {
  const rows = tagsNamed(node.children, "tr").map((tr) => ({
    header: tagsNamed(tr.children, "th").length > 0,
    cells: tagsNamed(tr.children, "th", "td").map((c) => oneLine(render(c.children)).replace(/\|/g, "\\|")),
  }));
  if (!rows.length) return "";
  const width = Math.max(...rows.map((r) => r.cells.length));
  const line = (cells: string[]): string =>
    `| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`;
  const body = rows[0].header ? rows.slice(1) : rows;
  return [
    line(rows[0].header ? rows[0].cells : []),
    `| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
    ...body.map((r) => line(r.cells)),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Markdown -> BBCode
// ---------------------------------------------------------------------------

/**
 * Markdown -> Steam BBCode: what Steam is sent on upload, and what the
 * Workshop panel previews. Markdown with no BBCode counterpart (HTML other
 * than <u>/<details>, footnotes, task lists) passes through as text, which
 * Steam then shows literally rather than breaking on.
 */
export function markdownToBBCode(text: string): string {
  const src = text.replace(
    /<details>[ \t]*(?:<summary>[\s\S]*?<\/summary>)?[ \t]*([\s\S]*?)[ \t]*<\/details>/gi,
    (_m, body: string) => `[spoiler]${body.replace(/^\n|\n$/g, "")}[/spoiler]`
  );
  const out: string[] = [];
  const lines = src.split(/\r?\n/);
  const lists: { kind: "list" | "olist"; indent: number }[] = [];
  const closeLists = (): void => {
    while (lists.length) out.push(`[/${lists.pop()!.kind}]`);
  };
  let fence: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceStart = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence !== null) {
      if (fenceStart && line.trim().startsWith(fence)) {
        out.push("[/code]");
        fence = null;
      } else out.push(line);
      continue;
    }
    if (fenceStart) {
      closeLists();
      out.push("[code]");
      fence = fenceStart[1];
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>[ \t]?/, ""));
      i--;
      const author = /^\*\*(.+)\*\*$/.exec(body[0]?.trim() ?? "");
      if (author) body.shift();
      closeLists();
      out.push(author ? `[quote=${author[1]}]` : "[quote]");
      out.push(markdownToBBCode(body.join("\n")));
      out.push("[/quote]");
      continue;
    }
    if (isTableRow(line) && isTableSeparator(lines[i + 1] ?? "")) {
      closeLists();
      out.push("[table]", row(splitCells(line), "th"));
      let j = i + 2;
      while (j < lines.length && isTableRow(lines[j])) out.push(row(splitCells(lines[j++]), "td"));
      out.push("[/table]");
      i = j - 1;
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      closeLists();
      // Steam stops at [h3]; deeper Markdown headings land there.
      const level = Math.min(h[1].length, 3);
      out.push(`[h${level}]${inlineMd(h[2])}[/h${level}]`);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      closeLists();
      out.push("[hr][/hr]");
      continue;
    }
    const li = /^(\s*)(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (li) {
      const indent = li[1].length;
      const kind = li[2] ? "list" : "olist";
      while (lists.length && lists[lists.length - 1].indent > indent) out.push(`[/${lists.pop()!.kind}]`);
      const top = lists[lists.length - 1];
      if (!top || top.indent < indent) {
        out.push(`[${kind}]`);
        lists.push({ kind, indent });
      } else if (top.kind !== kind) {
        out.push(`[/${top.kind}]`, `[${kind}]`);
        lists[lists.length - 1] = { kind, indent };
      }
      out.push(`[*] ${inlineMd(li[4])}`);
      continue;
    }
    closeLists();
    out.push(inlineMd(line));
  }
  closeLists();
  if (fence !== null) out.push("[/code]");
  return out.join("\n");
}

const isTableRow = (line: string): boolean => /^\s*\|.*\|\s*$/.test(line);
const isTableSeparator = (line: string): boolean =>
  isTableRow(line) && /-{3,}/.test(line) && /^[\s|:-]+$/.test(line);

function splitCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, "|").trim());
}

const row = (cells: string[], cell: "th" | "td"): string =>
  ["[tr]", ...cells.map((c) => `[${cell}]${inlineMd(c)}[/${cell}]`), "[/tr]"].join("\n");

/**
 * Inline Markdown of one line. Code spans are lifted out first, behind a
 * private-use character no description holds, so their content is never read
 * as markup.
 */
function inlineMd(s: string): string {
  const spans: string[] = [];
  return s
    .replace(/`([^`]*)`/g, (_m, code: string) => `\uE000${spans.push(code) - 1}\uE000`)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, "[img]$2[/img]")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "[url=$2]$1[/url]")
    .replace(/<(https?:\/\/[^>\s]+)>/g, "[url]$1[/url]")
    .replace(/<u>([\s\S]*?)<\/u>/gi, "[u]$1[/u]")
    .replace(/\*\*([^*]+)\*\*/g, "[b]$1[/b]")
    .replace(/__([^_]+)__/g, "[b]$1[/b]")
    .replace(/(^|\W)\*([^*\s][^*]*)\*/g, "$1[i]$2[/i]")
    .replace(/(^|\W)_([^_\s][^_]*)_(?=\W|$)/g, "$1[i]$2[/i]")
    .replace(/~~([^~]+)~~/g, "[strike]$1[/strike]")
    .replace(/\uE000(\d+)\uE000/g, (_m, i: string) => `[noparse]${spans[Number(i)]}[/noparse]`);
}
