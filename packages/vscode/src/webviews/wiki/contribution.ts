import type { WikiArticle, WikiHubEntry } from "./messages";

/** Only known reference pages can supply context for the fixed issue form. */
export function contributionUrl(
  game: string,
  article: string | undefined,
  games: { id: string; name: string }[],
  articles: WikiArticle[],
  hub: WikiHubEntry[]
): string | undefined {
  const selectedGame = games.find((candidate) => candidate.id === game);
  if (!selectedGame) return undefined;
  let title: string | undefined;
  if (article !== undefined) {
    const page = articles.find(
      (candidate) => candidate.id === article && (!candidate.game || candidate.game === game)
    );
    const entry = hub.find((candidate) => "page" in candidate.target && candidate.target.page === article);
    title = page?.title ?? entry?.label;
    if (!title) return undefined;
  }
  const params = new URLSearchParams({ template: "wiki_content.yml" });
  params.set("context", title ? `${title} (${article}), ${selectedGame.name}` : selectedGame.name);
  if (title) params.set("title", `Improve ${title}`);
  return `https://github.com/JDeffner/paradox-modding-toolkit/issues/new?${params}`;
}
