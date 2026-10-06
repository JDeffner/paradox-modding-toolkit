import { afterEach, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { buildSync } from "esbuild";
import * as path from "node:path";
import { wikiHtml } from "../src/webviews/wiki/html";
import type { AppToHost, HostToApp, WikiArticle } from "../src/webviews/wiki/messages";

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
function boot() {
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
          acquireVsCodeApi: () => ({ postMessage: (m: AppToHost) => messages.push(m) }),
        });
      },
    }
  );
  dom.window.eval(bundle);
  const document = dom.window.document;
  const post = (m: HostToApp) =>
    dom.window.dispatchEvent(new dom.window.MessageEvent("message", { data: m }));
  post({
    type: "content",
    hub: [
      { label: "Launch Options", icon: "play", tip: "Installed options", target: { page: "launch-options" } },
    ],
    articles: [
      ...launch("-fixture_old"),
      { id: "other", title: "Other", section: "About", markdown: "# Other\n\nRetained reference" },
    ],
    games: [
      { id: "ck3", name: "CK3" },
      { id: "vic3", name: "Victoria 3" },
    ],
    game: "ck3",
    select: "launch-options",
  });
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
    content: document.getElementById("content")!,
    scroll: document.getElementById("doc")!,
  };
}

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

it("refreshes launch content and search without losing page, game, query or scroll", () => {
  const t = boot();
  expect(t.messages[0]).toEqual({ type: "ready" });
  expect(t.messages).toContainEqual({ type: "refreshLaunchOptions" });
  t.query("fixture_new");
  t.scroll.scrollTop = 180;
  t.post({ type: "launchOptions", articles: launch("-fixture_new") });
  expect(t.content.textContent).toContain("-fixture_new");
  expect(t.content.textContent).not.toContain("-fixture_old");
  expect(t.document.querySelector('#nav [aria-selected="true"]')?.textContent).toBe("Launch Options");
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

it("routes Examples Wiki to the selected game and updates its labels in cards and search", () => {
  const t = boot();
  t.post({
    type: "content",
    hub: [
      {
        label: "Examples Wiki",
        icon: "bookOpen",
        tip: "Game reference",
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
    hub: [
      {
        label: "Vic3 Mod Report (workspace)",
        icon: "activity",
        tip: "Workspace report",
        target: { page: "mod-report" },
      },
    ],
  });
  expect(t.document.getElementById("game")?.textContent).toContain("CK3");
  expect(t.content.textContent).toContain("Vic3 Mod Report (workspace)");
});
