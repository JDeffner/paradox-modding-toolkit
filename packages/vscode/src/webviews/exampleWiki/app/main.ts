/**
 * The Examples Wiki app: search every name the toolkit knows, read what one
 * does, and jump to the places the game itself uses it.
 *
 * The catalog arrives once and is filtered here, so typing costs no round
 * trip; only the reading pane asks the host for more. Colours follow the one
 * kind table the hover badge and the completion list use (protocol/kinds.ts),
 * so a trigger is the same colour everywhere in the product.
 */
import type { ExampleWikiDetail, ExampleWikiEntry, ExampleWikiKind } from "@px-lsp/protocol/protocol";
import { kindStyle } from "@px-lsp/protocol/kinds";
import type { AppToHost, HostToApp } from "../messages";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();
const send = (m: AppToHost): void => vscode.postMessage(m);
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/** How many rows are drawn at once. Beyond this the list stops reading. */
const PAGE = 300;

let entries: ExampleWikiEntry[] = [];
let sources: string[] = [];
let needsScriptDocs = false;
let query = "";
let filter = "all";
let selected: string | null = null;
let loading = true;
let loadError: string | null = null;

/** The kind table's name for a wiki kind, so both share one colour. */
function styleKind(kind: ExampleWikiKind): string {
  if (kind === "datafn_global" || kind === "datafn_member") return "datafn";
  return kind;
}

const KIND_WORD: Record<ExampleWikiKind, string> = {
  trigger: "trigger",
  effect: "effect",
  event_target: "event target",
  modifier: "modifier",
  datafn_global: "datafunction",
  datafn_member: "datafunction",
  data_type: "data type",
};

const KIND_TIP: Record<ExampleWikiKind, string> = {
  trigger: "Trigger: a question the game answers with yes or no.",
  effect: "Effect: a change to the game world.",
  event_target: "Event target: a step from this scope to another one.",
  modifier: "Modifier: a named number the game adds to something.",
  datafn_global: "Datafunction: a [ ... ] expression you can start a chain with.",
  datafn_member: "Datafunction: a [ ... ] step you can ask a value of its type for.",
  data_type: "Data type: what a [ ... ] chain holds at this step.",
};

function matchesFilter(entry: ExampleWikiEntry): boolean {
  if (filter === "all") return true;
  if (filter === "datafn") return entry.kind === "datafn_global" || entry.kind === "datafn_member";
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

function key(entry: ExampleWikiEntry): string {
  return `${entry.kind}:${entry.name}`;
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

  const dot = document.createElement("span");
  dot.className = "kdot";
  const color = kindStyle(styleKind(entry.kind)).color;
  if (color) dot.style.setProperty("--kind-color", color);
  dot.setAttribute("data-tip", KIND_TIP[entry.kind]);
  dot.setAttribute("data-tip-wrap", "");
  el.append(dot);

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

  el.addEventListener("click", () => {
    selected = key(entry);
    for (const other of Array.from(document.querySelectorAll("#results .px-item[aria-selected]"))) {
      other.removeAttribute("aria-selected");
    }
    el.setAttribute("aria-selected", "true");
    showLoadingDetail(entry);
    send({ type: "select", name: entry.name, kind: entry.kind });
  });
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

function chips(values: string[], tip?: (value: string) => string): HTMLElement {
  const box = document.createElement("div");
  box.className = "chips";
  for (const value of values) {
    const chip = document.createElement("span");
    chip.className = "px-badge";
    chip.setAttribute("data-variant", "outline");
    chip.textContent = value;
    if (tip) {
      chip.classList.add("scope");
      chip.setAttribute("data-tip", tip(value));
      chip.setAttribute("data-tip-wrap", "");
    }
    box.append(chip);
  }
  return box;
}

function noteLine(text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "note";
  el.textContent = text;
  return el;
}

function showLoadingDetail(entry: ExampleWikiEntry): void {
  const body = $("detailBody");
  $("placeholder").hidden = true;
  body.hidden = false;
  body.textContent = "";
  const title = document.createElement("h1");
  title.textContent = entry.name;
  body.append(title, noteLine("Reading the game files…"));
}

function renderDetail(detail: ExampleWikiDetail | null, name: string): void {
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
    const owner = document.createElement("span");
    owner.className = "owner";
    owner.textContent = `${detail.owner}.`;
    title.append(owner, detail.name.slice(detail.owner.length + 1));
  } else {
    title.textContent = detail.name;
  }
  const badge = document.createElement("span");
  badge.className = "px-badge";
  badge.setAttribute("data-variant", "outline");
  badge.setAttribute("data-tip", KIND_TIP[detail.kind]);
  badge.setAttribute("data-tip-wrap", "");
  const color = kindStyle(styleKind(detail.kind)).color;
  if (color) badge.style.color = color;
  badge.textContent = KIND_WORD[detail.kind];
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
    body.append(sec);
  }

  if (detail.scopes.length > 0) {
    const sec = section("Scopes");
    sec.append(
      chips(detail.scopes, (s) => `Works where the scope is a ${s}. Scope means "what the block is about".`)
    );
    body.append(sec);
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

  if (detail.examples.length > 0 || detail.examplesNote) {
    const sec = section("Where the game uses it");
    for (const site of detail.examples) {
      const button = document.createElement("button");
      button.className = "site";
      const code = document.createElement("code");
      code.textContent = site.text;
      const where = document.createElement("span");
      where.className = "where";
      where.textContent = `${fileName(site.file)}:${site.line}`;
      button.append(code, where);
      button.setAttribute("data-tip", `Open ${site.file} at line ${site.line}`);
      button.setAttribute("data-tip-wrap", "");
      button.addEventListener("click", () => send({ type: "open", file: site.file, line: site.line }));
      sec.append(button);
    }
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
    sec.append(chips(detail.members));
    if (detail.membersTotal > detail.members.length) {
      sec.append(noteLine(`${detail.membersTotal - detail.members.length} more are not shown.`));
    }
    body.append(sec);
  }

  if (detail.producers.length > 0) {
    const sec = section("How to get one");
    sec.append(chips(detail.producers));
    if (detail.producersTotal > detail.producers.length) {
      sec.append(noteLine(`${detail.producersTotal - detail.producers.length} more are not shown.`));
    }
    body.append(sec);
  }

  if (detail.provenance) {
    const sec = section("Where this comes from");
    sec.append(noteLine(detail.provenance));
    if (detail.count > 0) {
      sec.append(noteLine(`The game's own files write this name ${detail.count} times.`));
    }
    body.append(sec);
  }
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
for (const chip of Array.from(document.querySelectorAll<HTMLButtonElement>("#kinds .px-toggle"))) {
  chip.addEventListener("click", () => {
    filter = chip.dataset.kind ?? "all";
    for (const other of Array.from(document.querySelectorAll("#kinds .px-toggle"))) {
      other.setAttribute("aria-pressed", String(other === chip));
    }
    renderList();
  });
}
input.focus();
renderList();
