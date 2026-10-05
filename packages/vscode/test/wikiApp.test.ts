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
