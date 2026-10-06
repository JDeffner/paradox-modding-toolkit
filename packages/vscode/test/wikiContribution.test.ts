import { expect, it } from "vitest";
import { contributionUrl } from "../src/webviews/wiki/contribution";
import type { WikiArticle, WikiHubEntry } from "../src/webviews/wiki/messages";

const games = [
  { id: "ck3", name: "Crusader Kings III" },
  { id: "vic3", name: "Victoria 3" },
];
const articles: WikiArticle[] = [
  { id: "test", title: "Quotes & brackets [test]", section: "Reference", game: "ck3", markdown: "" },
];
const hub: WikiHubEntry[] = [
  { label: "Diagnostics", icon: "alert", tip: "", group: "Troubleshooting", target: { page: "diagnostics" } },
];

it("encodes only known page/game context and uses the normal issue title", () => {
  const url = new URL(contributionUrl("ck3", "test", games, articles, hub)!);
  expect([...url.searchParams.keys()]).toEqual(["template", "context", "title"]);
  expect(url.searchParams.get("context")).toBe("Quotes & brackets [test] (test), Crusader Kings III");
  expect(url.searchParams.get("title")).toBe("Improve Quotes & brackets [test]");
  const fresh = new URL(contributionUrl("vic3", undefined, games, articles, hub)!);
  expect(fresh.searchParams.has("title")).toBe(false);
  expect(fresh.searchParams.get("context")).toBe("Victoria 3");
  expect(
    new URL(contributionUrl("ck3", "diagnostics", games, articles, hub)!).searchParams.get("context")
  ).toContain("Diagnostics");
});

it("rejects unknown games, unknown pages and pages for another game", () => {
  expect(contributionUrl("other", undefined, games, articles, hub)).toBeUndefined();
  expect(contributionUrl("ck3", "https://external.test", games, articles, hub)).toBeUndefined();
  expect(contributionUrl("vic3", "test", games, articles, hub)).toBeUndefined();
});
