import type {
  AppToHost,
  HostToApp,
  SettingRow,
  SettingsState,
  SettingsTarget,
  SettingValue,
} from "../messages";
import { el } from "../../shared/dom";

interface ViewState {
  group: string;
  query: string;
  target?: SettingsTarget;
  filter?: "all" | "changed" | "drafts";
  sort?: "default" | "name" | "changed";
}
declare function acquireVsCodeApi(): {
  postMessage(message: AppToHost): void;
  getState(): ViewState | undefined;
  setState(state: ViewState): void;
};
const vscode = acquireVsCodeApi();
const send = (message: AppToHost) => vscode.postMessage(message);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ALL_SETTINGS = "All settings";
const groups = [ALL_SETTINGS, "Game & paths", "Mods", "Editor", "Validation", "Advanced"];
const intros: Record<string, string> = {
  [ALL_SETTINGS]: "Search, select a category, or show only the settings you have changed.",
  "Game & paths": "Connect the toolkit to your game. Empty paths use automatic detection when available.",
  Mods: "Choose the content you work on and the dependencies used for reference.",
  Editor: "Adjust suggestions, hover help, and the values written by visual editors.",
  Validation: "Choose when validation runs and which findings appear in Problems.",
  Advanced: "Control indexing, project tools, and troubleshooting options.",
};
const saved = vscode.getState();
let group = saved?.group && groups.includes(saved.group) ? saved.group : groups[0];
let state: SettingsState | undefined;
let sequence = 0;
let statusOpen = false;
interface Draft {
  value: string | boolean;
  stamp: string;
  error?: string;
}
const drafts = new Map<string, Draft>();
const requests = new Map<
  number,
  { kind: "save" | "browse"; key: string; target: SettingsTarget; row: SettingRow }
>();
const draftKey = (target: SettingsTarget, key: string) => `${target}\n${key}`;
const textValue = (row: SettingRow) =>
  typeof row.value === "boolean"
    ? row.value
    : Array.isArray(row.value)
      ? row.value.join("\n")
      : typeof row.value === "object"
        ? JSON.stringify(row.value, null, 2)
        : String(row.value);
// Keep wildcard examples inside inline code intact when displaying help as text.
const plain = (text: string) =>
  text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .split(/(`[^`]*`)/)
    .map((part) => (part.startsWith("`") ? part.slice(1, -1) : part.replace(/\*\*([^*]+)\*\*/g, "$1")))
    .join("")
    .replace(/\u2014/g, ", ");
const persist = () =>
  vscode.setState({
    group,
    query: $<HTMLInputElement>("query").value,
    target: state?.target,
    filter: $<HTMLSelectElement>("filter").value as ViewState["filter"],
    sort: $<HTMLSelectElement>("sort").value as ViewState["sort"],
  });

function button(label: string, action: () => void, variant = "outline"): HTMLButtonElement {
  const node = document.createElement("button");
  node.type = "button";
  node.className = "px-btn";
  node.dataset.variant = variant;
  node.textContent = label;
  node.onclick = action;
  return node;
}
function notice(text: string, error = false) {
  $("notice").textContent = text;
  $("notice").classList.toggle("error", error);
}

function save(row: SettingRow, reset = false) {
  if (!state) return;
  const key = draftKey(state.target, row.key);
  const draft = drafts.get(key) ?? { value: textValue(row), stamp: row.stamp };
  try {
    const value: SettingValue = reset
      ? null
      : row.schema.type === "array"
        ? String(draft.value)
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean)
        : row.key === "calendar"
          ? JSON.parse(String(draft.value))
          : draft.value;
    const id = ++sequence;
    requests.set(id, { kind: "save", key, target: state.target, row });
    drafts.set(key, draft);
    send({ type: "save", id, key: row.key, target: state.target, stamp: draft.stamp, value, reset });
    notice(`Saving ${row.label.toLowerCase()}…`);
    renderRows();
  } catch {
    draft.error = "Enter valid JSON, or null to use no fallback calendar.";
    drafts.set(key, draft);
    renderRows();
  }
}

function renderRow(row: SettingRow): HTMLElement {
  const target = state!.target;
  const key = draftKey(target, row.key);
  const draft = drafts.get(key);
  const busy = [...requests.values()].some((r) => r.key === key);
  const section = el("section", "setting");
  section.dataset.key = row.key;
  const head = el("div", "setting-head");
  const label = document.createElement("label");
  label.htmlFor = `setting-${row.key}`;
  label.textContent = row.label;
  head.append(
    label,
    el("span", "px-badge", row.explicit ? "Changed here" : `From ${row.source.toLowerCase()}`)
  );
  const paragraphs = plain(row.schema.markdownDescription ?? row.schema.description ?? "").split("\n\n");
  const sentenceEnd = paragraphs[0].search(/[.!?](?=\s+[A-Z])/);
  const brief = sentenceEnd > 25 ? paragraphs[0].slice(0, sentenceEnd + 1) : paragraphs[0];
  const description = el("p", "description", brief);
  description.id = `help-${row.key}`;
  section.append(head, description);
  const line = el("div", "control-line");
  let input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  const value = draft?.value ?? textValue(row);
  if (row.schema.type === "boolean") {
    input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(value);
    const toggle = el("div", "toggle");
    const switchControl = el("label", "px-switch");
    const track = el("span");
    track.setAttribute("aria-hidden", "true");
    switchControl.append(input, track);
    toggle.append(switchControl, el("span", "", value ? "On" : "Off"));
    line.append(toggle);
  } else if (row.schema.enum) {
    input = document.createElement("select");
    input.className = "px-select";
    for (const option of row.schema.enum) {
      const item = document.createElement("option");
      item.value = option;
      item.textContent =
        option === "auto" ? "Detect automatically" : option[0].toUpperCase() + option.slice(1);
      input.append(item);
    }
    input.value = String(value);
    line.append(input);
  } else if (row.schema.type === "array" || row.key === "calendar") {
    input = document.createElement("textarea");
    input.className = `px-input${row.key === "calendar" ? " calendar" : ""}`;
    input.value = String(value);
    input.spellcheck = false;
    line.append(input);
  } else {
    input = document.createElement("input");
    input.type = "text";
    input.className = "px-input";
    input.value = String(value);
    input.spellcheck = false;
    line.append(input);
  }
  input.id = label.htmlFor;
  input.setAttribute("aria-describedby", description.id);
  input.disabled = Boolean(row.disabled) || busy;
  const saveButton = button("Save", () => save(row), "secondary");
  saveButton.disabled = !draft || Boolean(row.disabled) || busy;
  const discard = button(
    "Discard draft",
    () => {
      drafts.delete(key);
      renderRows();
      notice("Current saved value loaded.");
    },
    "ghost"
  );
  discard.hidden = !draft;
  discard.disabled = busy;
  const edit = () => {
    const next = input instanceof HTMLInputElement && input.type === "checkbox" ? input.checked : input.value;
    drafts.set(key, { value: next, stamp: draft?.stamp ?? row.stamp });
    saveButton.disabled = false;
    discard.hidden = false;
    notice("Unsaved change. Save this setting to apply it.");
  };
  input.addEventListener("input", edit);
  if (row.schema.type === "boolean" || row.schema.enum) {
    input.addEventListener("change", () => {
      edit();
      save(row);
    });
    if (draft) line.append(saveButton);
  } else {
    if (row.browse) {
      const browse = button(row.schema.type === "array" ? "Add folder…" : "Browse…", () => {
        const id = ++sequence;
        requests.set(id, { kind: "browse", key, target, row });
        send({ type: "browse", id, key: row.key, target });
        renderRows();
      });
      browse.disabled = Boolean(row.disabled) || busy;
      line.append(browse);
    }
    line.append(saveButton);
  }
  if (row.explicit) {
    const reset = button("Reset", () => save(row, true), "ghost");
    reset.title = "Remove this override and use the inherited value";
    reset.disabled = busy || (target.startsWith("folder:") && row.schema.scope !== "resource");
    line.append(reset);
  }
  line.append(discard);
  section.append(line);
  if (row.schema.enumDescriptions) {
    const index = row.schema.enum!.indexOf(String(value));
    if (index >= 0) section.append(el("p", "field-note", row.schema.enumDescriptions[index]));
  }
  if (row.schema.type === "array")
    section.append(el("p", "field-note", "One entry per line. Order is preserved."));
  if (row.names) section.append(el("p", "field-note", row.names));
  if (row.pathStatus)
    section.append(
      el("p", "resolved", `Current workspace: ${row.pathStatus}${row.resolved ? ` · ${row.resolved}` : ""}`)
    );
  if (row.override) section.append(el("p", "warning", row.override));
  if (row.disabled) section.append(el("p", "field-note", row.disabled));
  if (draft && draft.stamp !== row.stamp)
    section.append(
      el("p", "warning", "Changed elsewhere. Discard this draft to load the current value before saving.")
    );
  if (draft?.error) {
    const error = el("p", "field-error", draft.error);
    error.setAttribute("role", "alert");
    section.append(error);
  }
  if (paragraphs.length > 1 || brief !== paragraphs[0]) {
    const details = document.createElement("details");
    details.append(el("summary", "", "More details"), el("p", "", paragraphs.join("\n\n")));
    section.append(details);
  }
  section.append(el("p", "setting-key", `px.${row.key}`));
  return section;
}

function renderRows() {
  if (!state) return;
  // Replies and status updates can arrive while another control is being edited.
  const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
  const focusId = active?.id;
  const selection =
    active &&
    (active instanceof HTMLTextAreaElement || (active instanceof HTMLInputElement && active.type === "text"))
      ? [active.selectionStart, active.selectionEnd]
      : undefined;
  const query = $<HTMLInputElement>("query").value.trim().toLowerCase();
  const filter = $<HTMLSelectElement>("filter").value;
  const sort = $<HTMLSelectElement>("sort").value;
  const matches = state.rows.filter(
    (r) =>
      (filter === "all" ||
        (filter === "changed" && r.explicit) ||
        (filter === "drafts" && drafts.has(draftKey(state!.target, r.key)))) &&
      (!query ||
        `${r.label} ${r.key} ${r.group} ${r.schema.markdownDescription ?? r.schema.description ?? ""}`
          .toLowerCase()
          .includes(query))
  );
  const visibleRows = matches.filter((r) => query || group === ALL_SETTINGS || r.group === group);
  if (sort === "name") visibleRows.sort((a, b) => a.label.localeCompare(b.label));
  else if (sort === "changed") visibleRows.sort((a, b) => Number(b.explicit) - Number(a.explicit));
  const nav = $("categories");
  nav.replaceChildren();
  for (const name of groups) {
    const b = button(
      name,
      () => {
        group = name;
        $<HTMLInputElement>("query").value = "";
        persist();
        renderRows();
        $("content").scrollTop = 0;
      },
      "ghost"
    );
    b.id = `category-${groups.indexOf(name)}`;
    if (group === name && !query) b.setAttribute("aria-current", "page");
    b.append(
      el(
        "span",
        "count",
        String(name === ALL_SETTINGS ? matches.length : matches.filter((r) => r.group === name).length)
      )
    );
    nav.append(b);
  }
  const root = $("rows");
  root.replaceChildren(el("h2", "", query ? "Search results" : group));
  root.append(el("p", "intro", query ? `${matches.length} settings match your search.` : intros[group]));
  if (state.target.startsWith("folder:"))
    root.append(
      el(
        "p",
        "intro",
        "Folder scope applies to character formatting. Other toolkit settings use User or Workspace scope."
      )
    );
  if (!query && (group === "Game & paths" || group === "Validation")) {
    const health = document.createElement("details");
    health.className = "health";
    health.open = statusOpen;
    health.ontoggle = () => {
      statusOpen = health.open;
    };
    health.append(el("summary", "", "Current workspace status"));
    for (const text of state.summary) health.append(el("p", "", text));
    root.append(health);
  }
  const actions = state.actions.filter((a) => a.group === group);
  if (!query && actions.length) {
    const bar = el("div", "actions");
    for (const a of actions) bar.append(button(a.label, () => send({ type: "action", command: a.command })));
    root.append(
      bar,
      el("p", "action-note", "These tools operate on the current workspace using their own prompts.")
    );
  }
  const grid = el("div", "settings-grid");
  for (const row of visibleRows) grid.append(renderRow(row));
  root.append(grid);
  if (!visibleRows.length)
    root.append(el("p", "intro", "No settings found. Try another category, filter, or search."));
  if (focusId) {
    const replacement = document.getElementById(focusId) as HTMLInputElement | HTMLTextAreaElement | null;
    replacement?.focus({ preventScroll: true });
    if (selection && replacement && typeof replacement.setSelectionRange === "function")
      replacement.setSelectionRange(selection[0], selection[1]);
  }
}

function renderState(next: SettingsState) {
  state = next;
  $("game").textContent = state.game;
  const scope = $<HTMLSelectElement>("scope");
  scope.replaceChildren();
  for (const target of state.targets) {
    const option = document.createElement("option");
    option.value = target.id;
    option.textContent = target.label;
    scope.append(option);
  }
  scope.value = state.target;
  persist();
  renderRows();
}

$("query").addEventListener("input", () => {
  persist();
  renderRows();
});
$("scope").addEventListener("change", () =>
  send({ type: "target", target: $<HTMLSelectElement>("scope").value as SettingsTarget })
);
for (const id of ["filter", "sort"]) {
  $(id).addEventListener("change", () => {
    persist();
    renderRows();
    $("content").scrollTop = 0;
  });
}
$("native").onclick = () => send({ type: "action", command: "px.openNativeSettings" });
$("refresh").onclick = () => send({ type: "refresh" });
$<HTMLInputElement>("query").value = saved?.query ?? "";
if (saved?.filter && ["all", "changed", "drafts"].includes(saved.filter))
  $<HTMLSelectElement>("filter").value = saved.filter;
if (saved?.sort && ["default", "name", "changed"].includes(saved.sort))
  $<HTMLSelectElement>("sort").value = saved.sort;
window.addEventListener("message", (event: MessageEvent<HostToApp>) => {
  const message = event.data;
  if (message.type === "state") {
    const initial = !state;
    renderState(message.state);
    if (initial)
      notice("Changes use your normal VS Code settings. Reset removes the selected scope's override.");
  } else if (message.type === "reveal") {
    $<HTMLInputElement>("query").value = message.key;
    $<HTMLSelectElement>("filter").value = "all";
    persist();
    renderRows();
  } else if (message.type === "error") notice(message.message, true);
  else if (message.type === "result") {
    const request = requests.get(message.id);
    if (!request) return;
    requests.delete(message.id);
    if (message.error) {
      const draft = drafts.get(request.key);
      if (draft) draft.error = message.error;
      notice(message.error, true);
    } else if (request.kind === "save") {
      drafts.delete(request.key);
      notice(`${request.row.label} saved.`);
    } else if (message.value !== undefined) {
      const previous = drafts.get(request.key) ?? { value: textValue(request.row), stamp: request.row.stamp };
      drafts.set(request.key, {
        ...previous,
        value:
          request.row.schema.type === "array"
            ? [previous.value, message.value].filter(Boolean).join("\n")
            : message.value,
        error: undefined,
      });
      notice("Path selected. Save this setting to apply it.");
    }
    const restoreFocus = document.activeElement === document.body;
    renderRows();
    if (restoreFocus && state?.target === request.target)
      document.getElementById(`setting-${request.row.key}`)?.focus({ preventScroll: true });
  }
});
send({ type: "ready", target: saved?.target });
