/**
 * The Wiki app: grouped reference pages, direct section/card search, and
 * workspace-persisted reading history.
 *
 * Pages are of three kinds: articles the host read from files, the two
 * built-in pages (the Diagnostics index over the diagnostic articles, the
 * Mod Report the host builds when the page opens), and the hub itself. Cards
 * and rows that point at another view run a command through the host.
 *
 * The switch at the top of the sidebar picks the game the pages are for. An
 * article that names a game shows only for that one, so a page id resolves to
 * the selected game's alternate: every read of `articles` goes through
 * `visible()`.
 *
 * Every article arrives with the content message, so typing filters in place
 * with no round trip. The markdown goes through the toolkit's own renderer
 * (webviews/markdown.ts), which escapes as it goes.
 */
import { el } from "../../shared/dom";
import { renderMarkdown } from "../../markdown";
import { iconEl, type IconName } from "../../shared/icons";
import type { AppToHost, HostToApp, WikiArticle, WikiCard, WikiHubEntry } from "../messages";
import { installTips } from "../../shared/tips";
import { helpDialog } from "../../shared/help";
import { menu } from "../../shared/overlay";
import { articleSections, searchWiki } from "../search";
import {
  initialWikiState,
  parseWikiState,
  positionKey,
  rememberPosition,
  travel,
  visit,
} from "../navigation";
import type { WikiLocation } from "../messages";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();
const send = (m: AppToHost): void => vscode.postMessage(m);
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

installTips();

const DIAGNOSTICS = "diagnostics";
const MOD_REPORT = "mod-report";
const LAUNCH_OPTIONS = "launch-options";
const DIAG_SECTION = "Diagnostics";

let hub: WikiHubEntry[] = [];
let articles: WikiArticle[] = [];
let games: { id: string; name: string; shortName?: string }[] = [];
/** The game the pages are shown for; the workspace's until the switch moves. */
let game = "";
let workspaceGame = "";
let reading = initialWikiState("");
let initialized = false;
let restoring = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
/** null = the front page. */
let selected: string | null = null;
let query = "";
let diagOpen = false;
/** The last report the host sent; null while one is being built. */
let report: string | null = null;
/** The kind filter restored for the current page and reference game. */
let cardKind: string | null = null;

/** The articles of the selected game: one without a game belongs to all. */
const visible = (): WikiArticle[] => articles.filter((a) => !a.game || a.game === game);
const diagnostics = (): WikiArticle[] => visible().filter((a) => a.section === DIAG_SECTION);
const isDiagnostic = (id: string | null): boolean => diagnostics().some((a) => a.id === id);

const gameName = (id: string): string => games.find((item) => item.id === id)?.name ?? id;
const groups: WikiHubEntry["group"][] = [
  "Script reference",
  "Images & formats",
  "Troubleshooting",
  "Community",
  "More",
];

function pressable(node: HTMLElement, onOpen: () => void): void {
  node.setAttribute("role", "button");
  node.tabIndex = 0;
  node.addEventListener("click", onOpen);
  node.addEventListener("keydown", (e) => {
    if (e.target !== node) return;
    const key = (e as KeyboardEvent).key;
    if (key === "Enter" || key === " ") {
      e.preventDefault();
      onOpen();
    }
  });
}

function open(entry: WikiHubEntry): void {
  if ("command" in entry.target)
    send({ type: "run", command: entry.target.command, ...(entry.selectedGame ? { game } : {}) });
  else select(entry.target.page);
}

/** Resolve every hub surface against the same selected reference game. */
function hubEntries(): WikiHubEntry[] {
  const meta = games.find((candidate) => candidate.id === game);
  return hub.map((entry) =>
    entry.selectedGame
      ? {
          ...entry,
          label: `${meta?.shortName ?? meta?.name ?? game} ${entry.label}`,
          tip: `${meta?.name ?? game}. ${entry.tip}`,
        }
      : entry
  );
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

  for (const group of groups) {
    const entries = hubEntries().filter((entry) => entry.group === group);
    if (!entries.length) continue;
    list.appendChild(el("div", "px-panel-title", group));
    for (const entry of entries) {
      const node = row(entry.icon, entry.label, entry.tip, () => open(entry));
      if (entry.workspace)
        node
          .querySelector(".px-item-label")!
          .appendChild(el("small", "workspace", `Workspace: ${workspaceGame.toUpperCase()}`));
      const page = "page" in entry.target ? entry.target.page : null;
      node.setAttribute("aria-selected", String(page !== null && page === selected));
      list.appendChild(node);
      if (page !== DIAGNOSTICS) continue;

      const twist = el("button", "twist");
      twist.setAttribute("aria-label", "Show diagnostic codes");
      twist.setAttribute("aria-expanded", String(diagOpen));
      twist.appendChild(iconEl(diagOpen ? "chevronDown" : "chevronRight"));
      twist.setAttribute("data-tip", diagOpen ? "Fold the codes" : "List the codes");
      twist.addEventListener("click", (e) => {
        e.stopPropagation();
        diagOpen = !diagOpen;
        renderNav();
        persist();
      });
      node.appendChild(twist);
      if (diagOpen) for (const article of diagnostics()) list.appendChild(diagRow(article));
    }
  }
}

/** Matching sections and cards link to their location in the reading pane. */
function renderSearch(nav: HTMLElement, needle: string): void {
  const results = searchWiki(articles, game, needle);
  const entries = hubEntries().filter(
    (entry) =>
      ("command" in entry.target || [DIAGNOSTICS, MOD_REPORT].includes(entry.target.page)) &&
      entry.label.toLowerCase().includes(needle)
  );
  if (entries.length === 0 && results.length === 0) {
    const empty = el("div", undefined, `No reference matches for ${gameName(game)}.`);
    empty.id = "navEmpty";
    nav.appendChild(empty);
  }
  const list = el("div", "px-list");
  for (const entry of entries) list.appendChild(row(entry.icon, entry.label, entry.tip, () => open(entry)));
  for (const result of results) {
    const node = row("fileText", result.title, undefined, () => select(result.page, result.anchor));
    node.classList.add("search-result");
    node.setAttribute("aria-selected", String(result.page === selected));
    node.querySelector(".px-item-label")!.appendChild(el("small", "search-detail", result.detail));
    list.appendChild(node);
  }
  nav.appendChild(list);
  const examples = row("search", "Search in Examples Wiki", undefined, () =>
    send({ type: "searchExamples", query, game })
  );
  examples.id = "searchExamples";
  examples
    .querySelector(".px-item-label")!
    .appendChild(el("small", "workspace", `Reference: ${gameName(game)}`));
  nav.appendChild(examples);
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
      "Script reference, file formats and practical help for modding. Choose a topic or search for what you need."
    )
  );
  for (const group of groups) {
    const entries = hubEntries().filter((entry) => entry.group === group);
    if (!entries.length) continue;
    content.appendChild(el("h2", "hub-group", group));
    const cards = el("div", group === "More" ? "secondary-links" : "cards hub-cards");
    for (const entry of entries) {
      if (group === "More") {
        const button = el("button", "px-btn", entry.label);
        button.dataset.variant = "outline";
        button.prepend(iconEl(entry.icon));
        if (entry.workspace)
          button.appendChild(el("small", "workspace", `Workspace: ${gameName(workspaceGame)}`));
        button.addEventListener("click", () => open(entry));
        cards.appendChild(button);
        continue;
      }
      const card = el("button", "card");
      card.setAttribute("type", "button");
      const head = el("div", "head");
      head.appendChild(iconEl(entry.icon));
      head.appendChild(el("span", undefined, entry.label));
      card.appendChild(head);
      card.appendChild(el("div", "tip", entry.tip));
      if (entry.workspace)
        card.appendChild(el("small", "workspace", `Workspace: ${gameName(workspaceGame)}`));
      card.addEventListener("click", () => open(entry));
      cards.appendChild(card);
    }
    content.appendChild(cards);
  }
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
  renderCrumbs(
    [{ label: "Home", to: null }],
    hubEntries().find((entry) => "page" in entry.target && entry.target.page === MOD_REPORT)?.label ??
      "Mod Report"
  );
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
    capturePosition();
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
  const start = el("div");
  start.id = "wiki-start";
  content.prepend(start);
  const sections = articleSections(article.markdown);
  const headings = Array.from(content.querySelectorAll<HTMLElement>("h1, h2, h3"));
  for (const [index, heading] of headings.entries()) heading.id = sections[index]?.anchor ?? "";
  const listed = headings.filter((heading) => heading.tagName !== "H1");
  if (listed.length >= 3) {
    const contents = el("details", "article-contents");
    contents.appendChild(el("summary", undefined, "On this page"));
    const links = el("div");
    for (const heading of listed) {
      const link = el("button", "contents-link", heading.textContent ?? "");
      link.addEventListener("click", () => {
        select(selected, heading.id);
      });
      links.appendChild(link);
    }
    contents.appendChild(links);
    if (headings[0]) headings[0].after(contents);
    else content.prepend(contents);
  }
  if (article.revision) {
    const { lastEdited, uncommitted } = article.revision;
    const revision = el("p", "article-revision");
    if (lastEdited) {
      revision.append(uncommitted ? "Last committed edit: " : "Last edited: ");
      const date = el("time", undefined, lastEdited.slice(0, 10));
      date.setAttribute("datetime", lastEdited);
      date.title = `Last committed change to this article's source: ${lastEdited}`;
      revision.append(date);
    } else {
      revision.append("Edit date unavailable");
      revision.title = "This build has no complete Git history for the article's source.";
    }
    if (uncommitted) revision.append(" · Uncommitted changes");
    const heading = content.querySelector("h1");
    if (heading) heading.after(revision);
    else content.prepend(revision);
  }
  if (article.cards) renderCards(content, article.cards);
  if (article.outro) {
    const outro = el("div");
    outro.id = "wiki-outro";
    outro.innerHTML = renderMarkdown(article.outro);
    content.append(outro);
  }
}

/**
 * The cards of a reference page as ONE grid, the way the front page lays out
 * its destinations, so a long list of projects or tools uses the pane's
 * width. Only the cards for the game the switch is on are drawn. Each card
 * wears its kind as an icon; the kinds are the filter chips above the grid.
 */
function renderCards(content: HTMLElement, cards: WikiCard[]): void {
  const link = (label: string, url: string): HTMLAnchorElement => {
    const a = el("a", undefined, label) as HTMLAnchorElement;
    a.href = url;
    return a;
  };
  const distinct = <T>(values: T[]): T[] => [...new Set(values)];
  const filterRow = (
    options: { value: string; icon?: IconName }[],
    current: string | null,
    pick: (value: string | null) => void
  ): HTMLElement => {
    const row = el("div", "filters");
    const chip = (label: string, value: string | null, icon?: IconName): void => {
      const button = el("button", "px-badge", label);
      button.dataset.variant = "outline";
      button.setAttribute("aria-pressed", String(value === current));
      if (icon) button.prepend(iconEl(icon));
      button.addEventListener("click", () => pick(value));
      row.appendChild(button);
    };
    chip("All", null);
    for (const option of options) chip(option.value, option.value, option.icon);
    return row;
  };
  const forGame = cards.filter((c) => !c.games || c.games.includes(game));
  const kinds = distinct(forGame.map((c) => c.kind)).map((kind) => ({
    value: kind,
    icon: forGame.find((c) => c.kind === kind)!.icon,
  }));
  const filters = el("div", "filterbar");
  filters.appendChild(
    filterRow(kinds, cardKind, (value) => {
      cardKind = value;
      renderPage();
      persist();
    })
  );
  content.appendChild(filters);

  const grid = el("div", "cards");
  const shown = forGame.filter((c) => cardKind === null || c.kind === cardKind);
  for (const card of shown) {
    const node = el("div", "card info");
    node.id = `wiki-card-${cards.indexOf(card)}`;
    const head = el("div", "head");
    const icon = iconEl(card.icon);
    icon.setAttribute("data-tip", card.kind);
    head.appendChild(icon);
    head.appendChild(link(card.title, card.url));
    node.appendChild(head);
    if (card.meta) node.appendChild(el("div", "meta", card.meta));
    node.appendChild(el("div", "tip", card.text));
    if (card.links?.length) {
      const row = el("div", "links");
      for (const entry of card.links) row.appendChild(link(entry.label, entry.url));
      node.appendChild(row);
    }
    grid.appendChild(node);
  }
  if (shown.length === 0) grid.appendChild(el("div", "px-muted", "Nothing of this kind for this game."));
  content.appendChild(grid);
}

function renderPage(): void {
  const content = $("content");
  content.textContent = "";
  if (selected === null) renderHub(content);
  else if (selected === DIAGNOSTICS) renderDiagnosticsIndex(content);
  else if (selected === MOD_REPORT) renderModReport(content);
  else {
    const article = visible().find((a) => a.id === selected);
    if (article) renderArticle(content, article);
    else renderHub(content);
  }
  $("improvePage").hidden = !visible().some((article) => article.id === selected);
}

function capturePosition(): void {
  if (initialized && !restoring && !(selected === MOD_REPORT && report === null)) {
    rememberPosition(reading, $("doc").scrollTop, cardKind);
  }
}

function persist(): void {
  if (!initialized) return;
  clearTimeout(saveTimer);
  capturePosition();
  reading.current.query = query;
  reading.diagOpen = diagOpen;
  send({ type: "saveState", state: reading });
}

function jump(anchor: string): void {
  const target = document.getElementById(anchor);
  if (!target) return;
  document.querySelector(".search-target")?.classList.remove("search-target");
  target.classList.add("search-target");
  target.tabIndex = -1;
  target.scrollIntoView({ block: "start" });
  target.focus({ preventScroll: true });
}

function showLocation(anchor?: string): void {
  const location = reading.current;
  game = games.some((item) => item.id === location.game) ? location.game : workspaceGame;
  selected = location.page !== null && known(location.page) ? location.page : null;
  query = location.query;
  reading.current = { ...location, page: selected, game, query };
  const destination = anchor ?? location.anchor;
  const position = reading.positions[positionKey(reading.current)];
  cardKind = anchor ? null : (position?.cardKind ?? null);
  if (isDiagnostic(selected)) diagOpen = true;
  input.value = query;
  renderGames();
  renderNav();
  restoring = true;
  renderPage();
  $("doc").scrollTop = position?.scroll ?? 0;
  if (destination && (anchor || !position)) jump(destination);
  restoring = false;
  $<HTMLButtonElement>("wikiBack").disabled = reading.back.length === 0;
  $<HTMLButtonElement>("wikiForward").disabled = reading.forward.length === 0;
  if (selected === MOD_REPORT && report === null) send({ type: "modReport" });
  if (selected === LAUNCH_OPTIONS) send({ type: "refreshLaunchOptions" });
  persist();
}

function navigate(location: WikiLocation, anchor?: string): void {
  capturePosition();
  visit(reading, location);
  showLocation(anchor);
}

function select(id: string | null, anchor?: string): void {
  if (id === MOD_REPORT) {
    capturePosition();
    report = null;
  }
  navigate({ page: id, game, query, ...(anchor ? { anchor } : {}) }, anchor);
}

function history(direction: "back" | "forward"): void {
  capturePosition();
  if (travel(reading, direction)) showLocation();
}

const known = (id: string): boolean =>
  id === DIAGNOSTICS || id === MOD_REPORT || visible().some((a) => a.id === id);

/** The switch shows the selected game; the menu it opens lists the rest. */
function renderGames(): void {
  $("game").querySelector(".px-truncate")!.textContent = games.find((g) => g.id === game)?.name ?? game;
}

window.addEventListener("message", (ev: MessageEvent<HostToApp>) => {
  const msg = ev.data;
  if (msg.type === "content") {
    if (workspaceGame !== msg.game) report = null;
    hub = msg.hub;
    articles = msg.articles;
    games = msg.games;
    workspaceGame = msg.game;
    if (!initialized) {
      reading = parseWikiState(msg.state) ?? initialWikiState(workspaceGame);
      diagOpen = reading.diagOpen;
      initialized = true;
    } else capturePosition();
    if (msg.select)
      visit(reading, { page: msg.select, game: reading.current.game, query: reading.current.query });
    showLocation();
  } else if (msg.type === "select") {
    if (known(msg.id)) select(msg.id);
  } else if (msg.type === "hub") {
    capturePosition();
    report = null;
    workspaceGame = msg.game;
    hub = msg.hub;
    showLocation();
  } else if (msg.type === "launchOptions") {
    articles = [...articles.filter((article) => article.id !== LAUNCH_OPTIONS), ...msg.articles];
    renderNav();
    if (selected === LAUNCH_OPTIONS) {
      const scroll = $("doc").scrollTop;
      renderPage();
      $("doc").scrollTop = scroll;
    }
  } else if (msg.type === "modReport") {
    report = msg.markdown;
    if (selected === MOD_REPORT) {
      renderPage();
      $("doc").scrollTop = reading.positions[positionKey(reading.current)]?.scroll ?? 0;
    }
  }
});

const input = $<HTMLInputElement>("query");
input.addEventListener("input", () => {
  query = input.value.slice(0, 2000);
  input.value = query;
  renderNav();
  persist();
});

$("game").addEventListener("click", () =>
  menu(
    $("game"),
    games.map((g) => ({ value: g.id, label: g.name })),
    {
      value: game,
      onPick: (value) => {
        navigate({ page: selected, game: value, query });
      },
    }
  )
);

$("wikiBack").addEventListener("click", () => history("back"));
$("wikiForward").addEventListener("click", () => history("forward"));
$("suggestContent").addEventListener("click", () => send({ type: "contribute", game }));
$("improvePage").addEventListener("click", () => {
  if (selected) send({ type: "contribute", game, article: selected });
});
$("doc").addEventListener("scroll", () => {
  clearTimeout(saveTimer);
  capturePosition();
  saveTimer = setTimeout(persist, 150);
});
window.addEventListener("beforeunload", persist);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) persist();
});
document.addEventListener("keydown", (event) => {
  if (event.altKey && !event.ctrlKey && !event.metaKey && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
    event.preventDefault();
    history(event.key === "ArrowLeft" ? "back" : "forward");
  }
});

$("helpBtn").addEventListener("click", () =>
  helpDialog({
    title: "The Wiki",
    intro:
      "Modding references grouped by topic. Search opens matching article sections, tools and guides. Back and Forward return to pages you have read, with their scroll positions and filters.",
    sections: [
      {
        title: "The pages",
        items: [
          {
            lead: "Launch Options",
            text: "reads launch flags, descriptions and warnings from the installed game's documentation. The page updates when the source file changes and when you open it again.",
          },
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
          {
            lead: "Modding Guides",
            text: "lists the game wiki's modding pages for the game the switch is on, one card per page with a line on what it covers, grouped the way the wiki groups them. The chips filter by group.",
          },
          {
            lead: "Modding Tools",
            text: "lists tools other modders built for the game the switch is on: map editors, translators, audio tools, history converters. Each card wears its type as an icon; the chips above the cards filter by type.",
          },
        ],
      },
      {
        title: "The game switch",
        items: [
          {
            lead: "The select at the top of the sidebar",
            text: "picks the game the wiki shows pages for, so you can read another game's pages without changing the workspace. The toolkit itself keeps working on the workspace's game.",
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
            text: "finds pages, article sections, tools and guides for the reference game. Search in Examples Wiki carries your query into the selected reference game's script reference.",
          },
          {
            lead: "The breadcrumb",
            text: "above a page leads back to the section and the front page.",
          },
          {
            lead: "Suggest content and Improve this page",
            text: "open a GitHub form for your title and the content you want added or changed. The toolkit fills in the game and page. Toolkit help opens the usage documentation on the website.",
          },
        ],
      },
    ],
  })
);

send({ type: "ready" });
