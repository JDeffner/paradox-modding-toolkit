/**
 * The markdown subset our own generated documents use: headings, tables,
 * bullet lists, paragraphs, `code`, **bold**, *italic*. Not a markdown
 * library, on purpose: the documents are ours, the subset is known, and the
 * vsix stays dependency-free.
 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

function inline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function cells(row: string): string[] {
  return row
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
}

export function renderMarkdown(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    // A table: header row, a |---|---| separator, then body rows.
    if (line.startsWith("|")) {
      const head = cells(line);
      out.push("<table><thead><tr>", ...head.map((c) => `<th>${inline(c)}</th>`), "</tr></thead><tbody>");
      i += 2; // skip the separator row
      while (i < lines.length && lines[i].startsWith("|")) {
        out.push("<tr>", ...cells(lines[i]).map((c) => `<td>${inline(c)}</td>`), "</tr>");
        i++;
      }
      out.push("</tbody></table>");
      continue;
    }

    if (/^[-*]\s/.test(line)) {
      out.push("<ul>");
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        const item = [lines[i].slice(2)];
        i++;
        while (i < lines.length && /^\s+\S/.test(lines[i])) {
          item.push(lines[i].trim());
          i++;
        }
        out.push(`<li>${inline(item.join(" "))}</li>`);
      }
      out.push("</ul>");
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#|\||[-*]\s)/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }

  return out.join("\n");
}
