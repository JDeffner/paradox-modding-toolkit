/**
 * The Examples Wiki app: search every name the toolkit knows, read what one
 * does, and jump to the places the game itself uses it.
 *
 * The catalog arrives once and is filtered here, so typing costs no round
 * trip; only the reading pane asks the host for more. Glyphs and colours follow
 * the one kind table the hover badge and the completion list use
 * (protocol/kinds.ts), so a trigger looks the same everywhere in the product.
 */
import type {
  ExampleWikiDetail,
  ExampleWikiEntry,
  ExampleWikiKind,
  ExampleWikiSite,
} from "@px-lsp/protocol/protocol";
import { exampleWikiVariableKinds, exampleWikiVocabularyKinds } from "@px-lsp/protocol/protocol";
import { kindStyle } from "@px-lsp/protocol/kinds";
import { CODICON_PATHS } from "../codiconGlyphs";
import { installTips } from "../../shared/tips";
import { helpDialog } from "../../shared/help";
import type { AppToHost, HostToApp } from "../messages";

interface PanelState {
  /** List pane width as a percentage of the panel, kept across reopen. */
  listWidth?: number;
  /** Whether an example shows the code around it. Absent means shown. */
  showCode?: boolean;
}

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): PanelState | undefined;
  setState(state: PanelState): void;
};
const vscode = acquireVsCodeApi();
const send = (m: AppToHost): void => vscode.postMessage(m);
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
installTips();

/** How many rows are drawn at once. Beyond this the list stops reading. */
const PAGE = 300;

/** A "usable from this scope" list this short opens with the article. */
const FOLD_OPEN_MAX = 40;

let entries: ExampleWikiEntry[] = [];
let sources: string[] = [];
let needsScriptDocs = false;
let query = "";
let filter = "all";
let selected: string | null = null;
let loading = true;
let loadError: string | null = null;
/** Whether an example carries the code around it, or collapses to one line. */
let showCode = vscode.getState()?.showCode ?? true;
/** name -> the kinds that name has an article for; the cross-link resolver. */
let byName = new Map<string, ExampleWikiKind[]>();

/** One article, the unit both the list and every cross-link navigate to. */
interface Target {
  name: string;
  kind: ExampleWikiKind;
}
let current: Target | null = null;
/** The article on screen, kept so the code toggle can redraw it without asking
 *  the host again. Null while one is still loading. */
let currentDetail: ExampleWikiDetail | null = null;
/** The reading pane's history, as a browser keeps it: articles behind, articles
 *  ahead, newest last. Session-local, like a tab. */
const behind: Target[] = [];
const ahead: Target[] = [];

const VARIABLE_KINDS = new Set<ExampleWikiKind>(exampleWikiVariableKinds);
const VOCABULARY_KINDS = new Set<ExampleWikiKind>(exampleWikiVocabularyKinds);

/** The kind table's name for a wiki kind, so both share one glyph and colour. */
function styleKind(kind: ExampleWikiKind): string {
  if (kind === "datafn_global" || kind === "datafn_member") return "datafn";
  return kind;
}

/** One parsed svg per codicon, cloned per use: a list draws up to PAGE rows,
 *  and re-parsing the markup for every one of them shows in scrolling. */
const glyphTemplates = new Map<string, SVGSVGElement>();

/** The picture the kind table gives this kind, in the editor's icon size. */
function glyphNode(codicon: string): SVGSVGElement | null {
  const paths = CODICON_PATHS[codicon];
  if (!paths) return null;
  let template = glyphTemplates.get(codicon);
  if (!template) {
    const holder = document.createElement("template");
    holder.innerHTML = `<svg class="px-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">${paths}</svg>`;
    template = holder.content.firstElementChild as SVGSVGElement;
    glyphTemplates.set(codicon, template);
  }
  return template.cloneNode(true) as SVGSVGElement;
}

/** The kind's glyph in the kind's colour, wrapped so it can carry the tip:
 *  `svg.px-icon` takes no pointer events, so the box has to be the target. */
function kindMark(kind: ExampleWikiKind): HTMLElement {
  const style = kindStyle(styleKind(kind));
  const mark = document.createElement("span");
  mark.className = "kglyph";
  if (style.color) mark.style.color = style.color;
  const glyph = glyphNode(style.codicon);
  if (glyph) mark.append(glyph);
  mark.setAttribute("data-tip", KIND_TIP[kind]);
  mark.setAttribute("data-tip-wrap", "");
  return mark;
}

const KIND_WORD: Record<ExampleWikiKind, string> = {
  trigger: "trigger",
  effect: "effect",
  event_target: "event target",
  modifier: "modifier",
  datafn_global: "datafunction",
  datafn_member: "datafunction",
  data_type: "data type",
  keyword: "keyword",
  scope_word: "scope word",
  variable: "variable",
  local_variable: "local variable",
  global_variable: "global variable",
  variable_list: "variable list",
  local_variable_list: "local variable list",
  global_variable_list: "global variable list",
  list: "list",
};

const KIND_TIP: Record<ExampleWikiKind, string> = {
  trigger: "Trigger: a question the game answers with yes or no.",
  effect: "Effect: a change to the game world.",
  event_target: "Event target: a step from this scope to another one.",
  modifier: "Modifier: a named number the game adds to something.",
  datafn_global: "Datafunction: a [ ... ] expression you can start a chain with.",
  datafn_member: "Datafunction: a [ ... ] step you can ask a value of its type for.",
  data_type: "Data type: what a [ ... ] chain holds at this step.",
  keyword: "Keyword: the script grammar around the triggers and effects.",
  scope_word: "Scope word: a name for a scope you are already standing in.",
  variable: "Variable: a value your script stores on a scope object.",
  local_variable: "Local variable: a value your script stores for the length of one effect.",
  global_variable: "Global variable: a value your script stores once for the whole game.",
  variable_list: "Variable list: several targets your script stores on a scope object.",
  local_variable_list: "Local variable list: several targets stored for the length of one effect.",
  global_variable_list: "Global variable list: several targets stored once for the whole game.",
  list: "List: targets your script gathers with add_to_list and reads back with an iterator.",
};

function matchesFilter(entry: ExampleWikiEntry): boolean {
  if (filter === "all") return true;
  if (filter === "datafn") return entry.kind === "datafn_global" || entry.kind === "datafn_member";
  // The chip is named after the commonest of the seven storage classes, so it
  // must not fall through to the exact-kind test below.
  if (filter === "variable") return VARIABLE_KINDS.has(entry.kind);
  // One chip for the whole grammar vocabulary: a reader looking for `NOT` and
  // one looking for `prev` are after the same thing.
  if (filter === "keyword") return VOCABULARY_KINDS.has(entry.kind);
  return entry.kind === filter;
}

/** Rows for the current query, best first. Substring match, ranked by how
 *  often the game itself writes the name, with a name that STARTS with the
 *  query lifted above one that merely contains it. */
function filtered(): ExampleWikiEntry[] {
  const needle = query.trim().toLowerCase();
  const hits: Array<{ entry: ExampleWikiEntry; starts: boolean }> = [];
  for (const entry of entries) {
    if (!matchesFilter(entry)) continue;
    if (needle === "") {
      hits.push({ entry, starts: true });
      continue;
    }
    const lower = entry.name.toLowerCase();
    const at = lower.indexOf(needle);
    if (at < 0) continue;
    const short = entry.owner ? lower.slice(entry.owner.length + 1) : lower;
    hits.push({ entry, starts: at === 0 || short.startsWith(needle) });
  }
  // entries arrive most-used first, so a stable sort on the start flag alone
  // keeps the usage order inside each half.
  hits.sort((a, b) => Number(b.starts) - Number(a.starts));
  return hits.map((h) => h.entry);
}

function key(entry: Target): string {
  return `${entry.kind}:${entry.name}`;
}

// ---------------------------------------------------------- navigation -----

/** Put one article on screen. The history stacks are the caller's business. */
function show(target: Target): void {
  current = target;
  selected = key(target);
  markSelectedRow();
  showLoadingDetail(target.name);
  updateNav();
  send({ type: "select", name: target.name, kind: target.kind });
}

/** Open one article: from a list row, from a chip in another article, or from
 *  a deep link the host sent. A new step from a mid-history point drops the
 *  trail ahead, the way a browser does. */
function openEntry(target: Target): void {
  if (current && key(current) !== key(target)) {
    behind.push(current);
    ahead.length = 0;
  }
  show(target);
}

function goBack(): void {
  const previous = behind.pop();
  if (!previous) return;
  if (current) ahead.push(current);
  show(previous);
}

function goForward(): void {
  const next = ahead.pop();
  if (!next) return;
  if (current) behind.push(current);
  show(next);
}

function markSelectedRow(): void {
  // Walked, not queried: a name is any text the game files contain, and a
  // selector built from one would need escaping the webview may not have.
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("#results .px-item"))) {
    if (el.dataset.key === selected) {
      el.setAttribute("aria-selected", "true");
      el.scrollIntoView({ block: "nearest" });
    } else {
      el.removeAttribute("aria-selected");
    }
  }
}

function updateNav(): void {
  $<HTMLButtonElement>("back").disabled = behind.length === 0;
  $<HTMLButtonElement>("forward").disabled = ahead.length === 0;
}

/** The article for a name, if the catalog has one. `kind` narrows it when the
 *  caller knows what it is looking for; without one the first kind wins. */
function findArticle(name: string, kind?: ExampleWikiKind): Target | null {
  const kinds = byName.get(name);
  if (!kinds || kinds.length === 0) return null;
  if (kind) return kinds.includes(kind) ? { name, kind } : null;
  return { name, kind: kinds[0] };
}

// ---------------------------------------------------------------- list -----

function renderList(): void {
  const results = $("results");
  const more = $("more");
  const note = $("listNote");
  results.textContent = "";
  more.textContent = "";
  note.textContent = "";

  if (loadError !== null) {
    note.textContent = loadError;
    return;
  }
  if (loading) {
    note.textContent = "Loading everything the toolkit knows…";
    return;
  }
  const rows = filtered();
  $("count").textContent = `${rows.length} of ${entries.length}`;
  if (rows.length === 0) {
    note.textContent =
      entries.length === 0
        ? "Nothing to show yet. Set the game folder in the settings, and run script_docs in the game console, then load this list again."
        : "No name matches that. Try a shorter piece of the word.";
    return;
  }
  const frag = document.createDocumentFragment();
  for (const entry of rows.slice(0, PAGE)) frag.append(row(entry));
  results.append(frag);
  if (rows.length > PAGE) {
    more.textContent = `Showing the first ${PAGE} of ${rows.length} matches. Type more of the name to narrow it down.`;
  }
  if (needsScriptDocs && query === "") {
    note.textContent =
      "These names come from the bundled tables. Run script_docs in the game console to get the list your own game version has.";
  }
}

function row(entry: ExampleWikiEntry): HTMLElement {
  const el = document.createElement("div");
  el.className = "px-item";
  el.setAttribute("role", "option");
  el.dataset.key = key(entry);
  if (key(entry) === selected) el.setAttribute("aria-selected", "true");

  el.append(kindMark(entry.kind));

  const name = document.createElement("span");
  name.className = "rname";
  if (entry.owner) {
    const owner = document.createElement("span");
    owner.className = "owner";
    owner.textContent = `${entry.owner}.`;
    name.append(owner, entry.name.slice(entry.owner.length + 1));
  } else {
    name.textContent = entry.name;
  }
  el.append(name);

  const doc = document.createElement("span");
  doc.className = "rdoc";
  doc.textContent = entry.shortDoc || KIND_WORD[entry.kind];
  el.append(doc);

  if (entry.count > 0) {
    const count = document.createElement("span");
    count.className = "rcount";
    count.textContent = String(entry.count);
    count.setAttribute("data-tip", `The game's own files write this ${entry.count} times.`);
    count.setAttribute("data-tip-side", "left");
    el.append(count);
  }

  el.addEventListener("click", () => openEntry({ name: entry.name, kind: entry.kind }));
  return el;
}

// -------------------------------------------------------------- detail -----

function section(title: string): HTMLElement {
  const sec = document.createElement("div");
  sec.className = "sec";
  const head = document.createElement("div");
  head.className = "px-panel-title";
  head.textContent = title;
  sec.append(head);
  return sec;
}

/** A chip row. `link` turns a chip that names another article into a way in;
 *  a chip the catalog has no article for stays inert. */
function chips(
  values: string[],
  opts: { tip?: (value: string) => string; link?: (value: string) => Target | null } = {}
): HTMLElement {
  const box = document.createElement("div");
  box.className = "chips";
  for (const value of values) {
    const target = opts.link ? opts.link(value) : null;
    const chip = document.createElement(target ? "button" : "span");
    chip.className = "px-badge";
    chip.setAttribute("data-variant", "outline");
    chip.textContent = value;
    if (opts.tip) {
      chip.classList.add("scope");
      chip.setAttribute("data-tip", opts.tip(value));
      chip.setAttribute("data-tip-wrap", "");
    }
    if (target) {
      chip.setAttribute("data-link", "");
      if (!opts.tip) chip.setAttribute("data-tip", `Read the ${KIND_WORD[target.kind]} ${target.name}`);
      chip.addEventListener("click", () => openEntry(target));
    }
    box.append(chip);
  }
  return box;
}

/** A section that holds its whole list, folded away until it is asked for: one
 *  scope can carry hundreds of names, and they must not bury the article. */
function foldSection(title: string, total: number): HTMLElement {
  const sec = document.createElement("details");
  sec.className = "sec fold";
  const head = document.createElement("summary");
  head.className = "px-panel-title";
  head.textContent = `${title} (${total})`;
  sec.append(head);
  return sec;
}

/** One "usable from this scope" list, or nothing when the docs name none. */
function fromScopeSection(
  title: string,
  names: string[],
  total: number,
  kind: ExampleWikiKind
): HTMLElement | null {
  if (names.length === 0) return null;
  const sec = foldSection(title, total);
  // A short list costs nothing to show; a scope with hundreds of names would
  // push the rest of the article off the pane.
  if (total <= FOLD_OPEN_MAX) sec.setAttribute("open", "");
  const box = chips(names, { link: (n) => findArticle(n, kind) });
  box.classList.add("scroll");
  sec.append(box);
  if (total > names.length) sec.append(noteLine(`The first ${names.length} of ${total} are shown.`));
  return sec;
}

function noteLine(text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "note";
  el.textContent = text;
  return el;
}

function showLoadingDetail(name: string): void {
  currentDetail = null;
  const body = $("detailBody");
  $("placeholder").hidden = true;
  body.hidden = false;
  body.textContent = "";
  const title = document.createElement("h1");
  title.textContent = name;
  body.append(title, noteLine("Reading the files…"));
}

function renderDetail(detail: ExampleWikiDetail | null, name: string): void {
  currentDetail = detail;
  const body = $("detailBody");
  $("placeholder").hidden = true;
  body.hidden = false;
  body.textContent = "";
  if (!detail) {
    const title = document.createElement("h1");
    title.textContent = name;
    body.append(title, noteLine("The server does not know this name anymore. Load the list again."));
    return;
  }

  const title = document.createElement("h1");
  if (detail.owner) {
    const ownerTarget = findArticle(detail.owner, "data_type");
    const owner = document.createElement(ownerTarget ? "button" : "span");
    owner.className = "owner";
    owner.textContent = `${detail.owner}.`;
    if (ownerTarget) {
      owner.setAttribute("data-link", "");
      owner.setAttribute("data-tip", `Read the data type ${detail.owner}`);
      owner.addEventListener("click", () => openEntry(ownerTarget));
    }
    title.append(owner, detail.name.slice(detail.owner.length + 1));
  } else {
    title.textContent = detail.name;
  }
  const badge = document.createElement("span");
  badge.className = "px-badge";
  badge.setAttribute("data-variant", "outline");
  badge.setAttribute("data-tip", KIND_TIP[detail.kind]);
  badge.setAttribute("data-tip-wrap", "");
  const style = kindStyle(styleKind(detail.kind));
  if (style.color) badge.style.color = style.color;
  const glyph = glyphNode(style.codicon);
  if (glyph) badge.append(glyph);
  badge.append(KIND_WORD[detail.kind]);
  title.append(badge);
  body.append(title);

  if (detail.doc.trim() !== "") {
    const doc = document.createElement("p");
    doc.textContent = detail.doc;
    body.append(doc);
  } else {
    body.append(noteLine("Nothing documents this name. The examples below are what it does in practice."));
  }

  if (detail.callKind || detail.ret || detail.args) {
    const sec = section("Signature");
    const parts: string[] = [];
    if (detail.args && detail.args.length > 0) parts.push(`${detail.name}( ${detail.args.join(", ")} )`);
    else parts.push(detail.name + (detail.callKind === "function" ? "( )" : ""));
    if (detail.ret) parts.push(`gives a ${detail.ret}`);
    const line = document.createElement("pre");
    line.textContent = parts.join("  ->  ");
    sec.append(line);
    if (detail.callKind === "promote") {
      sec.append(noteLine("Read like a field: no brackets after the name."));
    }
    if (detail.ret && findArticle(detail.ret, "data_type")) {
      sec.append(chips([detail.ret], { link: (v) => findArticle(v, "data_type") }));
    }
    body.append(sec);
  }

  if (detail.scopes.length > 0) {
    const sec = section("Scopes");
    sec.append(
      chips(detail.scopes, {
        tip: (s) => `Works when the scope is a ${s}.`,
        link: (s) => findArticle(s),
      })
    );
    body.append(sec);
  }

  for (const from of detail.fromScope ?? []) {
    const lists = [
      fromScopeSection(`Triggers in ${from.scope} scope`, from.triggers, from.triggersTotal, "trigger"),
      fromScopeSection(`Effects in ${from.scope} scope`, from.effects, from.effectsTotal, "effect"),
      fromScopeSection(`Targets from ${from.scope}`, from.targets, from.targetsTotal, "event_target"),
    ].filter((sec): sec is HTMLElement => sec !== null);
    if (lists.length === 0) continue;
    body.append(
      noteLine(`Once this puts you in a ${from.scope} scope, these are what the game's docs let you write.`),
      ...lists
    );
  }

  if (detail.usage) {
    const sec = section("How it is written");
    const pre = document.createElement("pre");
    pre.textContent = detail.usage;
    sec.append(pre);
    body.append(sec);
  }

  if (detail.traits) {
    const sec = section("More from the game's own docs");
    const pre = document.createElement("pre");
    pre.textContent = detail.traits;
    sec.append(pre);
    body.append(sec);
  }

  if (detail.valueType) {
    const sec = section("What it holds");
    const line = document.createElement("p");
    line.textContent = detail.valueType;
    sec.append(line);
    if (detail.valueType.includes("unknown")) {
      sec.append(
        noteLine(
          "The value is set from something only the running game knows, so the toolkit does not guess a type."
        )
      );
    }
    body.append(sec);
  }

  if (detail.containers && detail.containers.length > 0) {
    const sec = section("Set inside");
    sec.append(chips(detail.containers, { link: (c) => findArticle(c) }));
    const total = detail.containersTotal ?? detail.containers.length;
    if (total > detail.containers.length) {
      sec.append(noteLine(`${total - detail.containers.length} more are not shown.`));
    }
    body.append(sec);
  }

  if (detail.examples.length > 0 || detail.examplesNote) {
    const sec = section(
      VARIABLE_KINDS.has(detail.kind) ? "Where your script sets and reads it" : "Where the game uses it"
    );
    for (const site of detail.examples) sec.append(siteBlock(site));
    if (detail.examplesNote) sec.append(noteLine(detail.examplesNote));
    body.append(sec);
  }

  if (detail.literals.length > 0) {
    const sec = section("Values the game passes to it");
    sec.append(chips(detail.literals));
    if (detail.literalsTotal > detail.literals.length) {
      sec.append(noteLine(`${detail.literalsTotal - detail.literals.length} more are not shown.`));
    }
    body.append(sec);
  }

  if (detail.members.length > 0) {
    const sec = section(detail.kind === "data_type" ? "What you can ask it for" : "What comes next");
    // The members listed are those of THIS type, or of what this member gives.
    const memberOwner = detail.kind === "data_type" ? detail.name : detail.ret;
    sec.append(
      chips(detail.members, {
        link: (m) => (memberOwner ? findArticle(`${memberOwner}.${m}`, "datafn_member") : null),
      })
    );
    if (detail.membersTotal > detail.members.length) {
      sec.append(noteLine(`${detail.membersTotal - detail.members.length} more are not shown.`));
    }
    body.append(sec);
  }

  if (detail.producers.length > 0) {
    const sec = section("How to get one");
    // Producers are qualified names: `GetPlayer` or `Character.GetName`.
    sec.append(chips(detail.producers, { link: (p) => findArticle(p) }));
    if (detail.producersTotal > detail.producers.length) {
      sec.append(noteLine(`${detail.producersTotal - detail.producers.length} more are not shown.`));
    }
    body.append(sec);
  }

  if (detail.provenance) {
    const sec = section("Where this comes from");
    sec.append(noteLine(detail.provenance));
    // A variable's count is its own sites, which the sections above already
    // spell out; only the engine names carry a vanilla usage count.
    if (detail.count > 0 && !VARIABLE_KINDS.has(detail.kind)) {
      sec.append(noteLine(`The game's own files write this name ${detail.count} times.`));
    }
    body.append(sec);
  }
}

/** One example site: the lines around it, the matched line picked out, and the
 *  whole block a way into the file at that line. With the code toggle off it
 *  keeps the matched line and the file it sits in, on one row. */
function siteBlock(site: ExampleWikiSite): HTMLElement {
  const el = document.createElement("div");
  el.className = "site";
  el.setAttribute("role", "button");
  el.tabIndex = 0;

  const where = document.createElement("span");
  where.className = "where";
  where.textContent = `${fileName(site.file)}:${site.line}`;

  if (showCode) {
    const head = document.createElement("div");
    head.className = "head";
    if (site.label) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = site.label;
      head.append(tag);
    }
    head.append(where);

    const pre = document.createElement("pre");
    if (site.context && site.context.length > 0) {
      const start = site.contextStart ?? site.line;
      site.context.forEach((text, i) => {
        const line = document.createElement("span");
        line.className = start + i === site.line ? "cline hit" : "cline";
        // An empty span collapses the line away; a space keeps the shape.
        line.textContent = text === "" ? " " : text;
        pre.append(line);
      });
    } else {
      pre.textContent = site.text;
    }
    el.append(head, pre);
  } else {
    el.classList.add("compact");
    const line = document.createElement("span");
    line.className = "cline hit";
    line.textContent = site.text.trim();
    el.append(line, where);
  }

  el.setAttribute("data-tip", "Click to open in side panel");
  el.setAttribute("data-tip-wrap", "");
  const open = (): void => send({ type: "open", file: site.file, line: site.line });
  el.addEventListener("click", open);
  el.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    }
  });
  return el;
}

function fileName(file: string): string {
  const parts = file.split(/[\\/]/);
  return parts[parts.length - 1] || file;
}

// ---------------------------------------------------------------- wire -----

window.addEventListener("message", (event: MessageEvent<HostToApp>) => {
  const msg = event.data;
  switch (msg.type) {
    case "loading":
      loading = true;
      loadError = null;
      renderList();
      break;
    case "index":
      loading = false;
      loadError = null;
      entries = msg.index.entries;
      byName = new Map();
      for (const entry of entries) {
        const kinds = byName.get(entry.name);
        if (kinds) kinds.push(entry.kind);
        else byName.set(entry.name, [entry.kind]);
      }
      sources = msg.index.sources;
      needsScriptDocs = msg.index.needsScriptDocs;
      $("query").setAttribute("data-tip", sources.join(" "));
      // The provenance belongs where a reader looks first, not only in a tip.
      $("sourceLines").textContent = sources.join(" ");
      renderList();
      break;
    case "entry":
      if (selected === `${msg.kind}:${msg.name}`) renderDetail(msg.detail, msg.name);
      break;
    case "reveal": {
      // A deep link names one article; the search box and the chips are the
      // reader's, so widen them rather than leave the row hidden behind them.
      query = "";
      input.value = "";
      setFilter("all");
      renderList();
      openEntry({ name: msg.name, kind: msg.kind });
      break;
    }
    case "error":
      loading = false;
      loadError = msg.message;
      renderList();
      break;
  }
});

const input = $<HTMLInputElement>("query");
input.addEventListener("input", () => {
  query = input.value;
  renderList();
});
$("refresh").addEventListener("click", () => send({ type: "refresh" }));

const codeToggle = $<HTMLButtonElement>("codeToggle");
function setShowCode(on: boolean, remember: boolean): void {
  showCode = on;
  codeToggle.setAttribute("aria-pressed", String(on));
  codeToggle.setAttribute(
    "data-tip",
    on ? "Hide the code around each example." : "Show the code around each example."
  );
  if (remember) vscode.setState({ ...vscode.getState(), showCode: on });
}
setShowCode(showCode, false);
codeToggle.addEventListener("click", () => {
  setShowCode(!showCode, true);
  if (current && currentDetail) renderDetail(currentDetail, current.name);
});
$("back").addEventListener("click", goBack);
$("forward").addEventListener("click", goForward);

$("helpBtn").addEventListener("click", () =>
  helpDialog({
    title: "Examples Wiki",
    intro:
      "Every name this game's script knows, in one searchable list: what a name does, which scopes it works in, and the places the game's own files write it. Nothing here is hand written; it comes from your game files and your script_docs dumps.",
    sections: [
      {
        title: "Finding a name",
        items: [
          {
            lead: "Type any part of a name",
            text: "in the search box. Names that start with what you typed come first, and the most used ones lead inside each half.",
          },
          {
            lead: "The chips",
            text: "narrow the list to one kind: triggers, effects, targets, modifiers, datafunctions, variables, keywords or data types. Hover a chip to read what that kind is.",
          },
          {
            lead: "The count",
            text: "on the right of a row says how many times the game's own files write that name. It is the best measure of how normal a name is.",
          },
          {
            lead: "Reload",
            text: "asks the language server for the list again, after a game patch or a fresh script_docs dump.",
          },
        ],
      },
      {
        title: "Reading an article",
        items: [
          {
            lead: "Click a row",
            text: "to read the article: what it does, its signature, the scopes it works in, how it is written, and what your script can write once it puts you in a new scope.",
          },
          {
            lead: "Every chip in an article",
            text: "that names something with an article of its own opens it. Scopes, data types, members and producers all lead somewhere.",
          },
          {
            lead: "Long lists fold away.",
            text: "A scope can carry hundreds of names, so only short lists open with the article.",
          },
        ],
      },
      {
        title: "Examples from the game",
        items: [
          {
            lead: "Click an example",
            text: "to open that file at that line in a side panel. The matched line is the highlighted one.",
          },
          {
            lead: "Code",
            text: "turns the lines around each example off and on. With it off, an example is one line plus the file it lives in.",
          },
        ],
      },
      {
        title: "Moving around",
        intro: "The reading pane keeps a history, the way a browser tab does.",
        items: [
          {
            lead: "The divider",
            text: "between the list and the article drags. The width is remembered.",
          },
          { lead: "The mouse side buttons", text: "go back and forward too." },
        ],
        shortcuts: [
          { keys: ["Alt", "←"], does: "Back to the article you came from" },
          { keys: ["Alt", "→"], does: "Forward again" },
        ],
      },
    ],
  })
);

// Alt+arrow is the browser's history key, and it works inside a text field
// there too: an Alt combination types nothing.
document.addEventListener("keydown", (event: KeyboardEvent) => {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    goBack();
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    goForward();
  }
});

// The side buttons of a mouse: 3 is back, 4 is forward. The browser acts on
// mousedown, so both events have to be claimed for the panel to keep them.
for (const type of ["mousedown", "mouseup"] as const) {
  document.addEventListener(type, (event: MouseEvent) => {
    if (event.button !== 3 && event.button !== 4) return;
    event.preventDefault();
    if (type === "mouseup") {
      if (event.button === 3) goBack();
      else goForward();
    }
  });
}

function setFilter(kind: string): void {
  filter = kind;
  for (const chip of Array.from(document.querySelectorAll("#kinds .px-toggle"))) {
    chip.setAttribute("aria-pressed", String((chip as HTMLElement).dataset.kind === kind));
  }
}

for (const chip of Array.from(document.querySelectorAll<HTMLButtonElement>("#kinds .px-toggle"))) {
  chip.addEventListener("click", () => {
    setFilter(chip.dataset.kind ?? "all");
    renderList();
  });
}

// ------------------------------------------------------------ splitter -----

const MIN_LIST = 200;
const MIN_DETAIL = 260;

/** The list pane width, as a percentage so the split survives a resized panel. */
function setListWidth(percent: number, remember: boolean): void {
  const width = $("main").clientWidth;
  const lowest = width > 0 ? (MIN_LIST / width) * 100 : 20;
  const highest = width > 0 ? ((width - MIN_DETAIL) / width) * 100 : 80;
  const clamped = Math.min(Math.max(percent, lowest), Math.max(lowest, highest));
  document.documentElement.style.setProperty("--list-width", `${clamped}%`);
  if (remember) vscode.setState({ ...vscode.getState(), listWidth: clamped });
}

const stored = vscode.getState()?.listWidth;
if (typeof stored === "number") setListWidth(stored, false);

$("divider").addEventListener("pointerdown", (event: PointerEvent) => {
  event.preventDefault();
  const divider = $("divider");
  divider.setPointerCapture(event.pointerId);
  divider.setAttribute("data-dragging", "");
  document.body.setAttribute("data-dragging", "");
  const main = $("main");
  const move = (moved: PointerEvent): void => {
    const box = main.getBoundingClientRect();
    if (box.width <= 0) return;
    setListWidth(((moved.clientX - box.left) / box.width) * 100, false);
  };
  const stop = (): void => {
    divider.removeEventListener("pointermove", move);
    divider.removeEventListener("pointerup", stop);
    divider.removeAttribute("data-dragging");
    document.body.removeAttribute("data-dragging");
    const box = main.getBoundingClientRect();
    if (box.width > 0) setListWidth(($("listPane").clientWidth / box.width) * 100, true);
  };
  divider.addEventListener("pointermove", move);
  divider.addEventListener("pointerup", stop);
});

input.focus();
renderList();
