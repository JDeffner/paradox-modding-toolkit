/**
 * The Wiki app: a front page of hub cards, a table of contents on the left,
 * one reading pane, and a search that reads titles and page text alike.
 *
 * Pages are of three kinds: articles the host read from files, the two
 * built-in pages (the Diagnostics index over the diagnostic articles, the
 * Mod Report the host builds when the page opens), and the hub itself. Cards
 * and rows that point at another view run a command through the host.
 *
 * Every article arrives with the content message, so typing filters in place
 * with no round trip. The markdown goes through the toolkit's own renderer
 * (webviews/markdown.ts), which escapes as it goes.
 */
import { renderMarkdown } from "../../markdown";
import { iconEl, type IconName } from "../../shared/icons";
import type { AppToHost, HostToApp, WikiArticle, WikiHubEntry } from "../messages";
import { installTips } from "../../shared/tips";
import { helpDialog } from "../../shared/help";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();
const send = (m: AppToHost): void => vscode.postMessage(m);
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

installTips();

const DIAGNOSTICS = "diagnostics";
const MOD_REPORT = "mod-report";
const DIAG_SECTION = "Diagnostics";

let hub: WikiHubEntry[] = [];
let articles: WikiArticle[] = [];
/** null = the front page. */
let selected: string | null = null;
let query = "";
let diagOpen = false;
/** The last report the host sent; null while one is being built. */
let report: string | null = null;

const diagnostics = (): WikiArticle[] => articles.filter((a) => a.section === DIAG_SECTION);
const isDiagnostic = (id: string | null): boolean => diagnostics().some((a) => a.id === id);

function matchesArticle(article: WikiArticle, needle: string): boolean {
  return article.title.toLowerCase().includes(needle) || article.markdown.toLowerCase().includes(needle);
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function pressable(node: HTMLElement, onOpen: () => void): void {
  node.setAttribute("role", "button");
  node.tabIndex = 0;
  node.addEventListener("click", onOpen);
  node.addEventListener("keydown", (e) => {
    const key = (e as KeyboardEvent).key;
    if (key === "Enter" || key === " ") {
      e.preventDefault();
      onOpen();
    }
  });
}

function open(entry: WikiHubEntry): void {
  if ("command" in entry.target) send({ type: "run", command: entry.target.command });
  else select(entry.target.page);
}

function row(iconName: IconName, label: string, tip: string | undefined, onOpen: () => void): HTMLElement {
  const node = el("div", "px-item");
  if (tip) {
    node.setAttribute("data-tip", tip);
    node.setAttribute("data-tip-wrap", "");
  }
  node.appendChild(iconEl(iconName));
  node.appendChild(el("span", "px-item-label", label));
  pressable(node, onOpen);
  return node;
}

/**
 * The severity as one coloured symbol with the word on hover: a row that
 * opened with a file icon and closed with a text badge spent its width on
 * two things that said nothing about the code.
 */
function severityMark(badge: string | undefined): HTMLElement {
  const level = (badge ?? "").toLowerCase().split("/")[0];
  const glyph: IconName = level === "error" ? "circleX" : level === "warning" ? "alert" : "info";
  const mark = el("span", "sev");
  mark.setAttribute("data-level", level || "info");
  mark.setAttribute("data-tip", badge ?? "Severity unknown");
  mark.appendChild(iconEl(glyph));
  return mark;
}

function diagRow(article: WikiArticle): HTMLElement {
  const node = el("div", "px-item diag");
  node.appendChild(severityMark(article.badge));
  node.appendChild(el("span", "px-item-label", article.title));
  pressable(node, () => select(article.id));
  node.setAttribute("aria-selected", String(article.id === selected));
  return node;
}

/** The table of contents: the hub sections, Diagnostics folding its codes. */
function renderToc(nav: HTMLElement): void {
  nav.appendChild(el("div", "px-panel-title", "Contents"));
  const list = el("div", "px-list");
  nav.appendChild(list);

  const home = row("library", "Home", "The front page.", () => select(null));
  home.setAttribute("aria-selected", String(selected === null));
  list.appendChild(home);

  for (const entry of hub) {
    const node = row(entry.icon, entry.label, entry.tip, () => open(entry));
    const page = "page" in entry.target ? entry.target.page : null;
    node.setAttribute("aria-selected", String(page !== null && page === selected));
    list.appendChild(node);
    if (page !== DIAGNOSTICS) continue;

    // A span, not the svg itself: px-icon svgs are pointer-events: none, so
    // a listener on the icon never fires and the row's open() wins.
    const twist = el("span", "twist");
    twist.appendChild(iconEl(diagOpen ? "chevronDown" : "chevronRight"));
    twist.setAttribute("data-tip", diagOpen ? "Fold the codes" : "List the codes");
    twist.addEventListener("click", (e) => {
      e.stopPropagation();
      diagOpen = !diagOpen;
      renderNav();
    });
    node.appendChild(twist);
    if (diagOpen) for (const article of diagnostics()) list.appendChild(diagRow(article));
  }
}

/** Search results: matching hub entries, then matching pages, flat. */
function renderSearch(nav: HTMLElement, needle: string): void {
  const entries = hub.filter((e) => e.label.toLowerCase().includes(needle));
  const pages = articles.filter((a) => matchesArticle(a, needle));
  if (entries.length === 0 && pages.length === 0) {
    const empty = el("div", undefined, "No page matches that.");
    empty.id = "navEmpty";
    nav.appendChild(empty);
    return;
  }
  if (entries.length > 0) {
    nav.appendChild(el("div", "px-panel-title", "Hub"));
    const list = el("div", "px-list");
    for (const entry of entries) list.appendChild(row(entry.icon, entry.label, entry.tip, () => open(entry)));
    nav.appendChild(list);
  }
  if (pages.length > 0) {
    nav.appendChild(el("div", "px-panel-title", "Pages"));
    const list = el("div", "px-list");
    for (const article of pages) {
      const node =
        article.section === DIAG_SECTION
          ? diagRow(article)
          : row("fileText", article.title, undefined, () => select(article.id));
      node.classList.remove("diag");
      node.setAttribute("aria-selected", String(article.id === selected));
      list.appendChild(node);
    }
    nav.appendChild(list);
  }
}

function renderNav(): void {
  const nav = $("nav");
  nav.textContent = "";
  const needle = query.trim().toLowerCase();
  if (needle) renderSearch(nav, needle);
  else renderToc(nav);
}

/** "Wiki › Diagnostics › code": every part but the last goes back up. */
function renderCrumbs(trail: { label: string; to: string | null }[], leaf: string): void {
  const crumbs = $("crumbs");
  crumbs.textContent = "";
  crumbs.hidden = false;
  for (const part of trail) {
    const crumb = el("span", "crumb", part.label);
    pressable(crumb, () => select(part.to));
    crumbs.appendChild(crumb);
    crumbs.appendChild(iconEl("chevronRight"));
  }
  crumbs.appendChild(el("span", "crumb", leaf));
}

function renderHub(content: HTMLElement): void {
  $("crumbs").hidden = true;
  content.appendChild(el("h1", undefined, "Wiki"));
  content.appendChild(
    el(
      "p",
      "lede",
      "Everything the toolkit knows, from one place: the game's script vocabulary, the file formats, the art rules, what each problem code means, and the state of your mod."
    )
  );
  const cards = el("div", "cards");
  for (const entry of hub) {
    const card = el("button", "card");
    card.setAttribute("type", "button");
    const head = el("div", "head");
    head.appendChild(iconEl(entry.icon));
    head.appendChild(el("span", undefined, entry.label));
    card.appendChild(head);
    card.appendChild(el("div", "tip", entry.tip));
    card.addEventListener("click", () => open(entry));
    cards.appendChild(card);
  }
  content.appendChild(cards);
}

function renderDiagnosticsIndex(content: HTMLElement): void {
  renderCrumbs([{ label: "Home", to: null }], "Diagnostics");
  content.appendChild(el("h1", undefined, "Diagnostics"));
  content.appendChild(
    el(
      "p",
      "lede",
      "One page per problem code the toolkit reports. A page says what the code means, why the game fails on it, and how to fix it. The severity is the one the code is reported with."
    )
  );
  const codes = diagnostics();
  if (codes.length === 0) {
    content.appendChild(el("p", undefined, "No diagnostic pages shipped with this build."));
    return;
  }
  const table = el("table");
  const head = el("thead");
  const hr = el("tr");
  for (const label of ["Code", "Severity", "What breaks"]) hr.appendChild(el("th", undefined, label));
  head.appendChild(hr);
  table.appendChild(head);
  const body = el("tbody");
  for (const article of codes) {
    const tr = el("tr", "link");
    tr.appendChild(el("td", undefined, article.title));
    const sev = el("td", "sevcell");
    sev.appendChild(severityMark(article.badge));
    sev.appendChild(el("span", undefined, article.badge ?? ""));
    tr.appendChild(sev);
    tr.appendChild(el("td", undefined, article.summary ?? ""));
    pressable(tr, () => select(article.id));
    body.appendChild(tr);
  }
  table.appendChild(body);
  content.appendChild(table);
}

function renderModReport(content: HTMLElement): void {
  renderCrumbs([{ label: "Home", to: null }], "Mod Report");
  if (report === null) {
    const pending = el("div", undefined, "Building the report from the live index…");
    pending.id = "pending";
    content.appendChild(pending);
    return;
  }
  const body = el("div");
  body.innerHTML = renderMarkdown(report);
  content.appendChild(body);
  const again = el("button", "px-btn", "Rebuild");
  again.setAttribute("data-variant", "outline");
  again.setAttribute("data-size", "sm");
  again.setAttribute("data-tip", "Build the report again from the index as it is now.");
  again.addEventListener("click", () => {
    report = null;
    send({ type: "modReport" });
    renderPage();
  });
  content.appendChild(again);
}

function renderArticle(content: HTMLElement, article: WikiArticle): void {
  const trail = [{ label: "Home", to: null as string | null }];
  if (article.section === DIAG_SECTION) trail.push({ label: DIAG_SECTION, to: DIAGNOSTICS });
  renderCrumbs(trail, article.title);
  content.innerHTML = renderMarkdown(article.markdown);
}

function renderPage(): void {
  const content = $("content");
  content.textContent = "";
  if (selected === null) renderHub(content);
  else if (selected === DIAGNOSTICS) renderDiagnosticsIndex(content);
  else if (selected === MOD_REPORT) renderModReport(content);
  else {
    const article = articles.find((a) => a.id === selected);
    if (article) renderArticle(content, article);
    else renderHub(content);
  }
}

function select(id: string | null): void {
  selected = id;
  if (isDiagnostic(id)) diagOpen = true;
  if (id === MOD_REPORT) {
    report = null;
    send({ type: "modReport" });
  }
  renderNav();
  renderPage();
  $("doc").scrollTop = 0;
}

const known = (id: string): boolean =>
  id === DIAGNOSTICS || id === MOD_REPORT || articles.some((a) => a.id === id);

window.addEventListener("message", (ev: MessageEvent<HostToApp>) => {
  const msg = ev.data;
  if (msg.type === "content") {
    hub = msg.hub;
    articles = msg.articles;
    select(msg.select && known(msg.select) ? msg.select : selected);
  } else if (msg.type === "select") {
    if (known(msg.id)) select(msg.id);
  } else if (msg.type === "modReport") {
    report = msg.markdown;
    if (selected === MOD_REPORT) renderPage();
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
      "The hub for the reference knowledge the toolkit carries. The front page is one card per destination; the list on the left is the same set as a table of contents, with the page you are reading marked.",
    sections: [
      {
        title: "The pages",
        items: [
          {
            lead: "Image Guidelines",
            text: "holds the sizes, formats and file names the game expects for previews, portraits, coats of arms and the rest.",
          },
          {
            lead: "Diagnostics",
            text: "lists every problem code the toolkit reports with its severity. Each code has a page: what it means, why the game fails on it, how to fix it. The chevron on the row folds the codes out into the contents.",
          },
          {
            lead: "Mod Report",
            text: "is built when you open it, from the live index of the focused mod: content counts, problems, localization coverage and overrides. Rebuild makes a fresh one.",
          },
        ],
      },
      {
        title: "Other views",
        intro: "These cards open a view of their own.",
        items: [
          {
            lead: "Examples Wiki",
            text: "is the searchable list of every trigger, effect, target, modifier and datafunction, with real examples out of the game's files.",
          },
          {
            lead: "Steam Error Codes",
            text: "lists every result code a Workshop upload can fail with, the number other tools print, and what to do.",
          },
          { lead: "Credits", text: "names every project the toolkit builds on." },
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
            lead: "The breadcrumb",
            text: "above a page leads back to the section and the front page.",
          },
        ],
      },
    ],
  })
);

send({ type: "ready" });
