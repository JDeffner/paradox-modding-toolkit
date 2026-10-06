import { afterEach, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { buildSync } from "esbuild";
import * as path from "node:path";
import { wikiHtml } from "../src/webviews/wiki/html";
import type { AppToHost, HostToApp, WikiArticle } from "../src/webviews/wiki/messages";
import { initialWikiState, parseWikiState, positionKey } from "../src/webviews/wiki/navigation";

const bundle = buildSync({
  entryPoints: [path.join(__dirname, "../src/webviews/wiki/app/main.ts")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
}).outputFiles[0].text;
let dom: JSDOM;
afterEach(() => dom?.window.close());
const launch = (flag: string): WikiArticle[] => [
  {
    id: "launch-options",
    title: "Launch Options",
    section: "Game reference",
    game: "ck3",
    markdown: `# Launch Options\n\n${flag}`,
  },
  {
    id: "launch-options",
    title: "Launch Options",
    section: "Game reference",
    game: "vic3",
    markdown: "No installed launch-options reference has been verified for Victoria 3.",
  },
];
const tools: WikiArticle = {
  id: "tools",
  title: "Modding Tools",
  section: "Community",
  markdown: "# Modding Tools\n\nChoose a tool.",
  cards: [
    { title: "Other tool", kind: "Other", icon: "info", url: "https://example.com", text: "Shared tool." },
    {
      title: "Vicky-Mapgen",
      kind: "Maps",
      icon: "info",
      url: "https://example.com",
      text: "Map tool.",
      games: ["vic3"],
    },
  ],
};
type ContentMessage = Extract<HostToApp, { type: "content" }>;
function boot(overrides: Partial<ContentMessage> = {}) {
  const messages: AppToHost[] = [];
  dom = new JSDOM(
    wikiHtml({ scriptSrc: "app.js", nonce: "test", csp: "" }).replace(
      '<script nonce="test" src="app.js"></script>',
      ""
    ),
    {
      runScripts: "dangerously",
      beforeParse(window) {
        window.HTMLElement.prototype.scrollIntoView = () => {};
        Object.assign(window, {
          structuredClone,
          acquireVsCodeApi: () => ({ postMessage: (m: AppToHost) => messages.push(structuredClone(m)) }),
        });
      },
    }
  );
  dom.window.eval(bundle);
  const document = dom.window.document;
  const post = (m: HostToApp) =>
    dom.window.dispatchEvent(new dom.window.MessageEvent("message", { data: m }));
  const initial: ContentMessage = {
    type: "content",
    hub: [
      {
        label: "Launch Options",
        icon: "play",
        tip: "Installed options",
        group: "Script reference",
        target: { page: "launch-options" },
      },
      { label: "Modding Tools", icon: "info", tip: "Tools", group: "Community", target: { page: "tools" } },
      {
        label: "Examples Wiki",
        icon: "search",
        tip: "Examples",
        group: "Script reference",
        selectedGame: true,
        target: { command: "px.showExamplesWiki" },
      },
      {
        label: "Mod Report",
        icon: "activity",
        tip: "Workspace report",
        group: "More",
        workspace: true,
        target: { page: "mod-report" },
      },
    ],
    articles: [
      ...launch("-fixture_old"),
      { id: "other", title: "Other", section: "About", markdown: "# Other\n\nRetained reference" },
      tools,
    ],
    games: [
      { id: "ck3", name: "CK3" },
      { id: "vic3", name: "Victoria 3" },
    ],
    game: "ck3",
    select: "launch-options",
    ...overrides,
  };
  post(initial);
  const query = (value: string) => {
    const input = document.getElementById("query") as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new dom.window.Event("input"));
  };
  return {
    document,
    post,
    query,
    messages,
    initial,
    pickGame: (label: string) => {
      document.getElementById("game")!.click();
      [...document.querySelectorAll<HTMLElement>('[role="option"]')]
        .find((option) => option.textContent === label)!
        .click();
    },
    open: (label: string) => {
      [...document.querySelectorAll<HTMLElement>('#nav [role="button"]')]
        .find((row) => row.querySelector(".px-item-label")?.firstChild?.textContent === label)!
        .click();
    },
    filter: (label: string) => {
      [...document.querySelectorAll<HTMLButtonElement>(".filters button")]
        .find((button) => button.textContent === label)!
        .click();
    },
    content: document.getElementById("content")!,
    scroll: document.getElementById("doc")!,
  };
}

it("refreshes launch content and search without losing page, game, query or scroll", () => {
  const t = boot();
  expect(t.messages[0]).toEqual({ type: "ready" });
  expect(t.messages).toContainEqual({ type: "refreshLaunchOptions" });
  t.query("fixture_new");
  t.scroll.scrollTop = 180;
  t.post({ type: "launchOptions", articles: launch("-fixture_new") });
  expect(t.content.textContent).toContain("-fixture_new");
  expect(t.content.textContent).not.toContain("-fixture_old");
  expect(
    t.document.querySelector('#nav [aria-selected="true"] .px-item-label')?.firstChild?.textContent
  ).toBe("Launch Options");
  expect((t.document.getElementById("query") as HTMLInputElement).value).toBe("fixture_new");
  expect(t.document.getElementById("game")?.textContent).toContain("CK3");
  expect(t.scroll.scrollTop).toBe(180);
  t.query("fixture_old");
  expect(t.document.getElementById("navEmpty")).not.toBeNull();
  t.query("Retained reference");
  (t.document.querySelector('#nav [role="button"]') as HTMLElement).click();
  t.scroll.scrollTop = 85;
  t.post({ type: "launchOptions", articles: launch("-fixture_latest") });
  expect(t.content.textContent).toContain("Retained reference");
  expect(t.scroll.scrollTop).toBe(85);
});

it("searches the selected game's specific card and clears a category filter before its jump", () => {
  const t = boot({ select: "tools" });
  t.query("Vicky-Mapgen");
  expect(t.document.querySelector(".search-result")).toBeNull();
  t.pickGame("Victoria 3");
  t.filter("Other");
  expect(t.document.getElementById("wiki-card-1")).toBeNull();
  const results = t.document.querySelectorAll<HTMLElement>(".search-result");
  expect(results).toHaveLength(1);
  expect(results[0].querySelector(".px-item-label")?.firstChild?.textContent).toBe("Vicky-Mapgen");
  results[0].click();
  const target = t.document.getElementById("wiki-card-1")!;
  expect(target.classList.contains("search-target")).toBe(true);
  expect(t.document.activeElement).toBe(target);
  expect(t.document.querySelector('.filters [aria-pressed="true"]')?.textContent).toBe("All");
});

it("Back and Forward restore page, game, query, scroll and category", () => {
  const t = boot({ select: "tools" });
  t.filter("Other");
  t.query("shared");
  t.scroll.scrollTop = 140;
  t.pickGame("Victoria 3");
  t.filter("Maps");
  t.query("vicky");
  t.scroll.scrollTop = 220;
  t.query("Retained reference");
  t.open("Other");
  t.query("other");
  t.scroll.scrollTop = 45;

  t.document.getElementById("wikiBack")!.click();
  expect(t.content.querySelector("h1")?.textContent).toBe("Modding Tools");
  expect(t.document.getElementById("game")?.textContent).toContain("Victoria 3");
  expect((t.document.getElementById("query") as HTMLInputElement).value).toBe("Retained reference");
  expect(t.scroll.scrollTop).toBe(220);
  expect(t.document.querySelector('.filters [aria-pressed="true"]')?.textContent).toBe("Maps");
  t.document.getElementById("wikiBack")!.click();
  expect(t.document.getElementById("game")?.textContent).toContain("CK3");
  expect((t.document.getElementById("query") as HTMLInputElement).value).toBe("shared");
  expect(t.scroll.scrollTop).toBe(140);
  expect(t.document.querySelector('.filters [aria-pressed="true"]')?.textContent).toBe("Other");
  t.document.getElementById("wikiForward")!.click();
  expect(t.document.getElementById("game")?.textContent).toContain("Victoria 3");
  expect(t.scroll.scrollTop).toBe(220);
  t.document.getElementById("wikiForward")!.click();
  expect(t.content.querySelector("h1")?.textContent).toBe("Other");
  expect((t.document.getElementById("query") as HTMLInputElement).value).toBe("other");
  expect(t.scroll.scrollTop).toBe(45);
});

it("restores stored reading state and falls home for an unknown saved page", () => {
  const state = initialWikiState("vic3");
  state.current = { game: "vic3", page: "tools", query: "vicky" };
  state.positions[positionKey(state.current)] = { scroll: 95, cardKind: "Maps" };
  const t = boot({ select: null, state });
  expect(t.content.querySelector("h1")?.textContent).toBe("Modding Tools");
  expect(t.document.getElementById("game")?.textContent).toContain("Victoria 3");
  expect((t.document.getElementById("query") as HTMLInputElement).value).toBe("vicky");
  expect(t.scroll.scrollTop).toBe(95);
  expect(t.document.querySelector('.filters [aria-pressed="true"]')?.textContent).toBe("Maps");
  dom.window.close();
  state.current.page = "removed-page";
  const missing = boot({ select: null, state });
  expect(missing.content.querySelector("h1")?.textContent).toBe("Wiki");
  expect(missing.document.getElementById("improvePage")!.hidden).toBe(true);
  expect(missing.messages.at(-1)).toMatchObject({ type: "saveState", state: { current: { page: null } } });
});

it("keeps the reading game on host content updates while changing workspace labels", () => {
  const t = boot({ select: null });
  t.pickGame("Victoria 3");
  t.post({ ...t.initial, select: null, game: "vic3" });
  t.pickGame("CK3");
  t.post({ ...t.initial, select: null, game: "vic3" });
  expect(t.document.getElementById("game")?.textContent).toContain("CK3");
  expect(t.content.textContent).toContain("Workspace: Victoria 3");
  t.query("missing word");
  expect(t.document.getElementById("searchExamples")?.textContent).toContain("Reference: CK3");
});

it("sends contribution context and the current query to Examples search", () => {
  const t = boot({ select: "tools" });
  t.pickGame("Victoria 3");
  t.document.getElementById("suggestContent")!.click();
  t.document.getElementById("improvePage")!.click();
  t.query("  setup guide  ");
  t.document.getElementById("searchExamples")!.click();
  expect(t.messages).toContainEqual({ type: "contribute", game: "vic3" });
  expect(t.messages).toContainEqual({ type: "contribute", game: "vic3", article: "tools" });
  expect(t.messages).toContainEqual({ type: "searchExamples", query: "  setup guide  ", game: "vic3" });
});

it("shows the selected game's unsupported reference and keeps that game after updates", () => {
  const t = boot();
  t.document.getElementById("game")!.click();
  [...t.document.querySelectorAll<HTMLElement>('[role="option"]')]
    .find((e) => e.textContent === "Victoria 3")!
    .click();
  expect(t.content.textContent).toContain("No installed launch-options reference");
  expect(t.content.textContent).not.toContain("-fixture_old");
  t.post({ type: "launchOptions", articles: launch("-fixture_new") });
  expect(t.document.getElementById("game")?.textContent).toContain("Victoria 3");
  expect(t.content.textContent).toContain("No installed launch-options reference");
  t.query("fixture_new");
  expect(t.document.getElementById("navEmpty")).not.toBeNull();
});

it.each([
  [{ lastEdited: "2026-09-24T23:15:00+02:00", uncommitted: false }, "Last edited: 2026-09-24"],
  [
    { lastEdited: "2026-09-24T23:15:00+02:00", uncommitted: true },
    "Last committed edit: 2026-09-24 · Uncommitted changes",
  ],
  [{ uncommitted: false }, "Edit date unavailable"],
  [{ uncommitted: true }, "Edit date unavailable · Uncommitted changes"],
] as const)("shows article source history without inventing dates: %j", (revision, expected) => {
  const t = boot();
  t.post({
    type: "content",
    hub: [],
    articles: [
      { id: "article", title: "Article", section: "About", markdown: "# Article\n\nBody", revision },
      ...launch("-fixture_current"),
    ],
    games: [{ id: "ck3", name: "CK3" }],
    game: "ck3",
    select: "article",
  });
  const metadata = t.content.querySelector(".article-revision")!;
  expect(metadata.textContent).toBe(expected);
  expect(metadata.previousElementSibling?.tagName).toBe("H1");
  expect(metadata.querySelector("time")?.getAttribute("datetime")).toBe(
    "lastEdited" in revision ? revision.lastEdited : undefined
  );
  t.post({ type: "select", id: "launch-options" });
  expect(t.content.querySelector(".article-revision")).toBeNull();
});

it("routes Examples Wiki to the selected game and updates its labels in cards and search", () => {
  const t = boot();
  t.post({
    type: "content",
    hub: [
      {
        label: "Examples Wiki",
        icon: "bookOpen",
        tip: "Game reference",
        group: "Script reference",
        selectedGame: true,
        target: { command: "px.showExamplesWiki" },
      },
    ],
    articles: launch("-fixture_old"),
    games: [
      { id: "ck3", name: "CK3" },
      { id: "vic3", name: "Victoria 3" },
      { id: "eu5", name: "EU5" },
    ],
    game: "ck3",
    select: null,
  });
  [...t.document.querySelectorAll<HTMLElement>('#nav [role="button"]')]
    .find((node) => node.textContent === "Home")!
    .click();
  for (const [id, name] of [
    ["vic3", "Victoria 3"],
    ["eu5", "EU5"],
    ["ck3", "CK3"],
  ]) {
    t.document.getElementById("game")!.click();
    [...t.document.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((node) => node.textContent === name)!
      .click();
    const card = t.document.querySelector<HTMLButtonElement>("#content .card")!;
    expect(card.textContent).toContain(`${name} Examples Wiki`);
    card.click();
    expect(t.messages.at(-1)).toEqual({ type: "run", command: "px.showExamplesWiki", game: id });
    t.query(name);
    const row = t.document.querySelector<HTMLElement>('#nav [role="button"]')!;
    expect(row.textContent).toBe(`${name} Examples Wiki`);
    expect(row.getAttribute("data-tip")).toContain(name);
    t.query("");
  }
  t.post({
    type: "hub",
    game: "vic3",
    hub: [
      {
        label: "Vic3 Mod Report (workspace)",
        icon: "activity",
        tip: "Workspace report",
        group: "More",
        target: { page: "mod-report" },
      },
    ],
  });
  expect(t.document.getElementById("game")?.textContent).toContain("CK3");
  expect(t.content.textContent).toContain("Vic3 Mod Report (workspace)");
});

it("keeps long input within the saved-history and Examples query limit", () => {
  const t = boot();
  t.query("x".repeat(2100));
  expect((t.document.getElementById("query") as HTMLInputElement).value).toHaveLength(2000);
  t.post({ type: "select", id: "other" });
  const saved = [...t.messages].reverse().find((msg) => msg.type === "saveState");
  expect(saved?.type === "saveState" && parseWikiState(saved.state)).toBeTruthy();
  t.document.getElementById("searchExamples")!.click();
  expect(t.messages.at(-1)).toEqual({ type: "searchExamples", query: "x".repeat(2000), game: "ck3" });
});

it("restores distinct same-page search destinations and their scroll positions", () => {
  const t = boot({
    select: null,
    articles: [
      {
        id: "guide",
        title: "Guide",
        section: "About",
        markdown: "# Guide\n## Setup one\nFirst.\n## Setup two\nSecond.",
      },
    ],
  });
  t.query("setup");
  t.open("Setup one");
  t.scroll.scrollTop = 40;
  t.open("Setup two");
  t.scroll.scrollTop = 90;
  t.document.getElementById("wikiBack")!.click();
  expect(t.scroll.scrollTop).toBe(40);
  const saved = [...t.messages].reverse().find((msg) => msg.type === "saveState");
  expect(saved?.type === "saveState" && saved.state.current.anchor).toBe("wiki-heading-1");
  t.document.getElementById("wikiForward")!.click();
  expect(t.scroll.scrollTop).toBe(90);
});

it("opens title and outro matches at their destination instead of a saved page position", () => {
  const state = initialWikiState("ck3");
  state.current.page = "guide";
  state.positions[positionKey(state.current)] = { scroll: 700, cardKind: null };
  const t = boot({
    select: "guide",
    state,
    articles: [
      { id: "guide", title: "Guide", section: "About", markdown: "# Guide\nBody.", outro: "Footer needle." },
    ],
  });
  expect(t.scroll.scrollTop).toBe(700);
  t.query("guide");
  t.open("Guide");
  expect(t.content.querySelector(".search-target")?.id).toBe("wiki-start");
  t.query("footer needle");
  t.open("Guide");
  expect(t.content.querySelector(".search-target")?.id).toBe("wiki-outro");
});

it("keeps rendered section destinations aligned after fenced heading examples", () => {
  const t = boot({
    select: null,
    articles: [
      {
        id: "guide",
        title: "Guide",
        section: "About",
        markdown: "# Guide\n```text\n## Fake heading\n```\n## Right target\nBody.",
      },
    ],
  });
  t.query("right target");
  t.open("Right target");
  expect(t.content.querySelector(".search-target")?.textContent).toBe("Right target");
  expect(t.content.querySelector("pre code")?.textContent).toBe("## Fake heading");
  expect(t.content.querySelector("pre h2")).toBeNull();
});
