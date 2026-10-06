import type { WikiArticle } from "./messages";

export interface WikiSearchResult {
  title: string;
  detail: string;
  page: string;
  anchor?: string;
}

interface ArticleSection {
  title: string;
  anchor: string;
  text: string;
}

function plainText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function parseSections(markdown: string): { preamble: string; sections: ArticleSection[] } {
  const sections: ArticleSection[] = [];
  const preamble: string[] = [];
  let fenced = false;
  for (const line of markdown.split(/\r?\n/)) {
    // Match the toolkit renderer's column-zero backtick fences and headings.
    if (line.startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    const heading = fenced ? null : /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      sections.push({
        title: plainText(heading[2]),
        anchor: `wiki-heading-${sections.length}`,
        text: "",
      });
    } else if (sections.length) {
      sections[sections.length - 1].text += `${line}\n`;
    } else {
      preamble.push(line);
    }
  }
  return { preamble: preamble.join("\n"), sections };
}

export function articleSections(markdown: string): ArticleSection[] {
  return parseSections(markdown).sections;
}

function snippet(text: string, needle: string, limit: number): string {
  const plain = plainText(text);
  if (plain.length <= limit) return plain;
  const match = plain.toLowerCase().indexOf(needle);
  const start = Math.max(0, match - Math.floor(limit / 3));
  const prefix = start ? "…" : "";
  const body = plain.slice(start, start + limit - prefix.length - 1).trim();
  return `${prefix}${body}…`;
}

/** Search only visible content, with destinations independent of view filters. */
export function searchWiki(
  articles: readonly WikiArticle[],
  game: string,
  query: string
): WikiSearchResult[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const results: { result: WikiSearchResult; rank: number }[] = [];
  const matches = (text: string): boolean => plainText(text).toLowerCase().includes(needle);

  for (const article of articles) {
    if (article.game && article.game !== game) continue;
    const context = `${article.section} · ${article.title}`;
    const add = (title: string, text: string, anchor?: string): void => {
      const normalizedTitle = plainText(title);
      const lowerTitle = normalizedTitle.toLowerCase();
      const prefix = `${context} · `;
      results.push({
        rank: lowerTitle === needle ? 0 : lowerTitle.includes(needle) ? 1 : 2,
        result: {
          title: normalizedTitle,
          detail:
            prefix.length < 100
              ? prefix + snippet(text, needle, 140 - prefix.length)
              : snippet(`${context} ${text}`, needle, 140),
          page: article.id,
          ...(anchor ? { anchor } : {}),
        },
      });
    };
    const { preamble, sections } = parseSections(article.markdown);
    const pageText = [article.summary ?? "", preamble].join("\n");
    const titleMatch = matches(article.title);
    if (titleMatch || matches(pageText)) add(article.title, pageText || article.title, "wiki-start");
    if (article.outro && matches(article.outro)) add(article.title, article.outro, "wiki-outro");
    sections.forEach((section, index) => {
      if (titleMatch && index === 0 && section.title === plainText(article.title)) return;
      if (matches(section.title) || matches(section.text)) {
        add(section.title, section.text || section.title, section.anchor);
      }
    });
    article.cards?.forEach((card, index) => {
      if (card.games && !card.games.includes(game)) return;
      const text = [
        card.text,
        card.kind,
        card.meta ?? "",
        ...(card.links ?? []).map((link) => link.label),
      ].join("\n");
      if (matches(card.title) || matches(text)) add(card.title, text, `wiki-card-${index}`);
    });
  }
  return results.sort((a, b) => a.rank - b.rank).map(({ result }) => result);
}
