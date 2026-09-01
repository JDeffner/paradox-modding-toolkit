/**
 * The Wiki app: a sidebar of articles grouped by section, a search that reads
 * titles and article text alike, and one reading pane.
 *
 * Every article arrives with the content message, so typing filters in place
 * with no round trip. The markdown goes through the toolkit's own renderer
 * (webviews/markdown.ts), which escapes as it goes.
 */
import { renderMarkdown } from "../../markdown";
import { iconEl, type IconName } from "../../shared/icons";
import type { AppToHost, HostToApp, WikiArticle, WikiLauncher } from "../messages";
import { installTips } from "../../shared/tips";
import { helpDialog } from "../../shared/help";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();
const send = (m: AppToHost): void => vscode.postMessage(m);
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

installTips();

/** The launcher rows sit above the articles, under this heading. */
const LAUNCHER_SECTION = "Other views";

let launchers: WikiLauncher[] = [];
let articles: WikiArticle[] = [];
let selected: string | null = null;
let query = "";

function matchesArticle(article: WikiArticle, needle: string): boolean {
  return article.title.toLowerCase().includes(needle) || article.markdown.toLowerCase().includes(needle);
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function row(iconName: IconName, label: string, tip: string | undefined, onOpen: () => void): HTMLElement {
  const node = el("div", "px-item");
  node.setAttribute("role", "button");
  node.tabIndex = 0;
  if (tip) {
    node.setAttribute("data-tip", tip);
    node.setAttribute("data-tip-wrap", "");
  }
  node.appendChild(iconEl(iconName));
  node.appendChild(el("span", "px-item-label", label));
  node.addEventListener("click", onOpen);
  node.addEventListener("keydown", (e) => {
    const key = (e as KeyboardEvent).key;
    if (key === "Enter" || key === " ") {
      e.preventDefault();
      onOpen();
    }
  });
  return node;
}

function renderNav(): void {
  const nav = $("nav");
  nav.textContent = "";
  const needle = query.trim().toLowerCase();
  const shownLaunchers = needle ? launchers.filter((l) => l.label.toLowerCase().includes(needle)) : launchers;
  const shownArticles = needle ? articles.filter((a) => matchesArticle(a, needle)) : articles;

  /** Opens a section and returns its list box. */
  function openSection(title: string): HTMLElement {
    nav.appendChild(el("div", "px-panel-title", title));
    const list = el("div", "px-list");
    nav.appendChild(list);
    return list;
  }

  if (shownLaunchers.length > 0) {
    const list = openSection(LAUNCHER_SECTION);
    for (const launcher of shownLaunchers) {
      list.appendChild(
        row(launcher.icon, launcher.label, launcher.tip, () =>
          send({ type: "run", command: launcher.command })
        )
      );
    }
  }

  let current = "";
  let list: HTMLElement | null = null;
  for (const article of shownArticles) {
    if (article.section !== current) {
      current = article.section;
      list = openSection(current);
    }
    const node = row("fileText", article.title, undefined, () => select(article.id));
    if (article.section === "Diagnostics") node.classList.add("diag");
    if (article.badge) {
      const badge = el("span", "px-badge", article.badge);
      badge.setAttribute("data-variant", "outline");
      node.appendChild(badge);
    }
    node.setAttribute("aria-selected", String(article.id === selected));
    list?.appendChild(node);
  }

  if (shownLaunchers.length === 0 && shownArticles.length === 0) {
    const empty = el("div", undefined, "No page matches that.");
    empty.id = "navEmpty";
    nav.appendChild(empty);
  }
}

function renderPage(): void {
  const page = $("page");
  const placeholder = $("placeholder");
  const article = articles.find((a) => a.id === selected);
  if (!article) {
    page.hidden = true;
    placeholder.hidden = false;
    return;
  }
  placeholder.hidden = true;
  page.hidden = false;
  page.innerHTML = renderMarkdown(article.markdown);
  $("doc").scrollTop = 0;
}

function select(id: string): void {
  selected = id;
  renderNav();
  renderPage();
}

window.addEventListener("message", (ev: MessageEvent<HostToApp>) => {
  const msg = ev.data;
  if (msg.type === "content") {
    launchers = msg.launchers;
    articles = msg.articles;
    if (msg.select && articles.some((a) => a.id === msg.select)) selected = msg.select;
    renderNav();
    renderPage();
  } else if (msg.type === "select") {
    if (articles.some((a) => a.id === msg.id)) select(msg.id);
  }
});

const input = $<HTMLInputElement>("query");
input.addEventListener("input", () => {
  query = input.value;
  renderNav();
});

$("helpBtn").addEventListener("click", () =>
  helpDialog({
    title: "The Wiki",
    intro:
      "The reference knowledge the toolkit carries, as pages you can read in the editor: what the game expects from your art, and what each of the toolkit's diagnostics means. The pages are the toolkit's own measured documentation, so they say what this version actually does.",
    sections: [
      {
        title: "The pages",
        items: [
          {
            lead: "Art & assets",
            text: "holds the image guidelines: the sizes, formats and file names the game expects for previews, portraits, coats of arms and the rest.",
          },
          {
            lead: "Diagnostics",
            text: "has one page per problem code the toolkit reports. A page says what the code means, why the game fails on it, and how to fix it.",
          },
          {
            lead: "The badge",
            text: "on a diagnostics row is that code's severity, taken from the page itself.",
          },
        ],
      },
      {
        title: "Finding a page",
        items: [
          {
            lead: "The search box",
            text: "reads the titles and the whole text of every page, so a word from the middle of an article finds it.",
          },
          {
            lead: "It filters the rows above too,",
            text: "so a search that matches nothing at all says so.",
          },
        ],
      },
      {
        title: "Other views",
        intro: "The rows above the pages open the toolkit's other reference surfaces.",
        items: [
          {
            lead: "Examples Wiki",
            text: "is the searchable list of every trigger, effect, target, modifier and datafunction, with real examples out of the game's files.",
          },
          {
            lead: "The docs row",
            text: "opens what the game itself documents for the file you are editing: the _*.info format docs where the game ships them, otherwise the vanilla files of that folder plus a search on the game's modding wiki.",
          },
        ],
      },
    ],
  })
);

send({ type: "ready" });
