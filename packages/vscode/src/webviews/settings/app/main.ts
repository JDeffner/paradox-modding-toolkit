import type {
  AppToHost,
  HostToApp,
  SettingRow,
  SettingsState,
  SettingsSave,
  SettingsTarget,
  SettingValue,
} from "../messages";
import { el } from "../../shared/dom";
import { menu, closePopover, type MenuItem } from "../../shared/overlay";
import { iconEl } from "../../shared/icons";
import { installTips } from "../../shared/tips";

function dropdown(control: HTMLButtonElement, items: MenuItem[], value: string): void {
  control.type = "button";
  control.className = "px-btn px-dropdown";
  control.dataset.variant = "outline";
  control.setAttribute("aria-haspopup", "listbox");
  control.value = value;
  control.replaceChildren(
    el("span", "px-truncate", items.find((item) => item.value === value)?.label ?? value),
    iconEl("chevronDown")
  );
  control.onclick = () =>
    menu(control, items, {
      value: control.value,
      onPick: (picked) => {
        dropdown(control, items, picked);
        control.dispatchEvent(new Event("change", { bubbles: true }));
      },
    });
}

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
  context: SettingsTarget;
  row: SettingRow;
}
const drafts = new Map<string, Draft>();
const expandedRows = new Set<string>();
const expandedHelp = new Set<string>();
const requests = new Map<
  number,
  {
    kind: "save" | "browse";
    key: string;
    context: SettingsTarget;
    target: SettingsTarget;
    row: SettingRow;
    draft?: Draft;
  }
>();
const draftKey = (context: SettingsTarget, target: SettingsTarget, key: string) =>
  `${context}\n${target}\n${key}`;
const rowDrafts = (row: SettingRow) =>
  [...drafts.values()].filter((draft) => draft.context === state?.target && draft.row.key === row.key);
const textValue = (row: SettingRow) =>
  typeof row.value === "boolean"
    ? row.value
    : Array.isArray(row.value)
      ? row.value.join("\n")
      : typeof row.value === "object"
        ? JSON.stringify(row.value, null, 2)
        : String(row.value);
const displayValue = (value: SettingValue): string =>
  typeof value === "boolean"
    ? value
      ? "On"
      : "Off"
    : value === ""
      ? "Not set"
      : value === null
        ? "None"
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
const newDraft = (row: SettingRow, context = state!.target): Draft => ({
  value: textValue(row),
  stamp: row.stamp,
  context,
  row,
});
/** Only trusted schema formatting, built as DOM nodes so help never becomes executable HTML. */
function help(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const part of text.replace(/\u2014/g, ", ").split(/(`[^`]+`|\*\*[^*]+\*\*)/g)) {
    if (part.startsWith("`")) fragment.append(el("code", "", part.slice(1, -1)));
    else if (part.startsWith("**")) fragment.append(el("strong", "", part.slice(2, -2)));
    else fragment.append(document.createTextNode(part.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")));
  }
  return fragment;
}
const persist = () =>
  vscode.setState({
    group,
    query: $<HTMLInputElement>("query").value,
    target: state?.target,
    filter: $<HTMLButtonElement>("filter").value as ViewState["filter"],
    sort: $<HTMLButtonElement>("sort").value as ViewState["sort"],
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

function prepareSave(row: SettingRow, reset = false, context = state?.target): SettingsSave | undefined {
  if (!context) return;
  const key = draftKey(context, row.target, row.key);
  const draft = drafts.get(key) ?? newDraft(row, context);
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
    requests.set(id, { kind: "save", key, context, target: row.target, row, draft });
    drafts.set(key, draft);
    notice(`Saving ${row.label.toLowerCase()}…`);
    return { id, context, key: row.key, target: row.target, stamp: draft.stamp, value, reset };
  } catch {
    draft.error = "Enter valid JSON, or null to use no fallback calendar.";
    drafts.set(key, draft);
  }
}

function save(row: SettingRow, reset = false, context = state?.target) {
  const change = prepareSave(row, reset, context);
  if (change) send({ type: "save", ...change });
  renderRows();
}

function renderRow(row: SettingRow): HTMLElement {
  const context = state!.target;
  const target = row.target;
  const key = draftKey(context, target, row.key);
  const draft = drafts.get(key);
  const busy = [...requests.values()].some((r) => r.key === key);
  const expanded = expandedRows.has(row.key);
  const section = el("section", "setting");
  section.dataset.key = row.key;
  section.classList.toggle("is-disabled", Boolean(row.disabled));
  section.classList.toggle("has-draft", rowDrafts(row).length > 0);
  section.classList.toggle("is-expanded", expanded);
  const copy = el("div", "setting-copy");
  const editor = el("div", "setting-editor");
  const copyDetails = el("div", "setting-details");
  copyDetails.id = `details-${row.key}`;
  copyDetails.hidden = !expanded;
  const editorDetails = el("div", "setting-details");
  editorDetails.id = `notes-${row.key}`;
  editorDetails.hidden = !expanded;
  const expand = (open: boolean) => {
    if (open) expandedRows.add(row.key);
    else expandedRows.delete(row.key);
    renderRows();
  };
  const disclosure = button("", () => expand(!expanded), "ghost");
  disclosure.id = `expand-${row.key}`;
  disclosure.classList.add("row-expander");
  disclosure.setAttribute("aria-label", `${expanded ? "Hide" : "Show"} details for ${row.label}`);
  disclosure.setAttribute("aria-expanded", String(expanded));
  disclosure.setAttribute("aria-controls", `${copyDetails.id} ${editorDetails.id}`);
  disclosure.append(iconEl(expanded ? "chevronDown" : "chevronRight"));
  const head = el("div", "setting-head");
  const label = document.createElement("label");
  label.htmlFor = `setting-${row.key}`;
  label.id = `label-${row.key}`;
  label.textContent = row.label;
  head.append(label);
  const destinationLabel = el("span", "px-badge setting-destination", row.targetLabel);
  destinationLabel.dataset.tip = `Changes save to ${row.targetLabel.toLowerCase()}. Open Details to choose another destination.`;
  destinationLabel.dataset.tipWrap = "";
  head.append(destinationLabel, el("span", "draft-badge", "Unsaved"));
  if (row.disabled) {
    const unavailable = el("span", "px-badge", "Unavailable");
    unavailable.tabIndex = 0;
    unavailable.dataset.tip = row.disabled;
    unavailable.dataset.tipWrap = "";
    head.append(unavailable);
  }
  const paragraphs = (row.schema.markdownDescription ?? row.schema.description ?? "").split("\n\n");
  const sentenceEnd = paragraphs[0].search(/[.!?](?=\s+[A-Z])/);
  const brief = sentenceEnd > 25 ? paragraphs[0].slice(0, sentenceEnd + 1) : paragraphs[0];
  const description = el("p", "description");
  description.append(help(brief));
  description.id = `help-${row.key}`;
  const helpButton = document.createElement("button");
  helpButton.type = "button";
  helpButton.className = "px-btn setting-help";
  helpButton.dataset.variant = "ghost";
  helpButton.setAttribute("aria-label", `Help for ${row.label}`);
  helpButton.setAttribute("aria-describedby", description.id);
  const shortHelp = help(brief).textContent ?? "";
  helpButton.dataset.tip =
    shortHelp.length > 260 ? `${shortHelp.slice(0, 257).replace(/\s+\S*$/, "")}…` : shortHelp;
  helpButton.dataset.tipWrap = "";
  helpButton.dataset.tipWide = "";
  helpButton.append(iconEl("circleHelp"));
  label.after(helpButton);
  copyDetails.append(description);
  copy.append(
    head,
    el("p", "setting-source", `Active from ${row.effectiveSource.toLowerCase()}`),
    copyDetails
  );
  section.append(disclosure, copy, editor);
  if (JSON.stringify(row.value) !== JSON.stringify(row.effectiveValue))
    editor.append(
      el(
        "p",
        "active-value",
        `Active here: ${displayValue(row.effectiveValue)}. Editing ${row.targetLabel.toLowerCase()} below.`
      )
    );
  const line = el("div", "control-line");
  let input: HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement;
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
    input = document.createElement("button");
    const options = row.schema.enum.map((option, index) => ({
      value: option,
      label: option === "auto" ? "Detect automatically" : option[0].toUpperCase() + option.slice(1),
      description: row.schema.enumDescriptions?.[index],
    }));
    if (expanded && options.length <= 3) {
      const choices = el("div", "setting-choices");
      choices.setAttribute("role", "radiogroup");
      choices.setAttribute("aria-labelledby", label.id);
      choices.setAttribute("aria-describedby", description.id);
      input.value = String(value);
      const selected = input;
      const buttons = options.map((option) => {
        const choice = option.value === String(value) ? selected : document.createElement("button");
        choice.type = "button";
        choice.className = "setting-choice";
        choice.disabled = Boolean(row.disabled) || busy;
        choice.setAttribute("role", "radio");
        choice.setAttribute("aria-checked", String(option.value === String(value)));
        choice.tabIndex = option.value === String(value) ? 0 : -1;
        choice.append(el("span", "choice-label", option.label));
        if (option.description) choice.append(el("span", "choice-description", option.description));
        choice.onclick = () => {
          selected.value = option.value;
          selected.dispatchEvent(new Event("change", { bubbles: true }));
        };
        return choice;
      });
      for (const [index, choice] of buttons.entries()) {
        choice.onkeydown = (event) => {
          const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
          if (step === undefined && event.key !== "Home" && event.key !== "End") return;
          event.preventDefault();
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? buttons.length - 1
                : (index + step! + buttons.length) % buttons.length;
          buttons[next].click();
          document.getElementById(label.htmlFor)?.focus({ preventScroll: true });
        };
      }
      choices.append(...buttons);
      line.append(choices);
    } else {
      dropdown(input, options, String(value));
      line.append(input);
    }
  } else if (row.schema.type === "array" || row.key === "calendar") {
    input = document.createElement("textarea");
    input.className = `px-input${row.key === "calendar" ? " calendar" : ""}`;
    input.value = String(value);
    input.spellcheck = false;
    input.hidden = !expanded;
    if (!expanded) {
      const count = String(value)
        .split(/\r?\n/)
        .filter((entry) => entry.trim()).length;
      const summary = button(
        row.key === "calendar"
          ? String(value) === "null"
            ? "No fallback calendar"
            : "Custom calendar"
          : `${count} ${count === 1 ? "entry" : "entries"}`,
        () => {
          expand(true);
          document.getElementById(`setting-${row.key}`)?.focus({ preventScroll: true });
        }
      );
      summary.id = `summary-${row.key}`;
      summary.classList.add("value-summary");
      summary.setAttribute("aria-label", `${row.label}: ${summary.textContent}. Expand to edit.`);
      summary.append(iconEl("chevronRight"));
      line.append(summary);
      label.htmlFor = summary.id;
    }
    line.append(input);
  } else {
    input = document.createElement("input");
    input.type = "text";
    input.className = "px-input";
    input.value = String(value);
    input.spellcheck = false;
    line.append(input);
  }
  input.id = `setting-${row.key}`;
  input.setAttribute("aria-labelledby", label.id);
  input.setAttribute("aria-describedby", description.id);
  input.disabled = Boolean(row.disabled) || busy;
  const saveButton = button("Save", () => save(row), "secondary");
  saveButton.title = "Save this setting (Ctrl+Enter)";
  saveButton.disabled = !draft || Boolean(row.disabled) || busy;
  saveButton.hidden = !draft;
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
    drafts.set(key, { ...(draft ?? newDraft(row, context)), value: next });
    saveButton.disabled = false;
    saveButton.hidden = false;
    discard.hidden = false;
    section.classList.add("has-draft");
    updateDraftActions();
    notice("Unsaved change. Save this setting to apply it.");
  };
  input.addEventListener("input", edit);
  input.addEventListener("keydown", (rawEvent) => {
    const event = rawEvent as KeyboardEvent;
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !saveButton.disabled) {
      event.preventDefault();
      save(row);
    }
  });
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
        requests.set(id, { kind: "browse", key, context, target, row });
        send({ type: "browse", id, context, key: row.key, target });
        renderRows();
      });
      browse.disabled = Boolean(row.disabled) || busy;
      line.append(browse);
    }
    line.append(saveButton);
  }
  if (row.explicit) {
    const reset = button(row.resetLabel, () => save(row, true), "ghost");
    reset.title =
      row.resetValue === undefined
        ? "Remove this saved value and use the inherited value"
        : `Will use: ${displayValue(row.resetValue)}`;
    reset.disabled = busy;
    line.append(reset);
  }
  line.append(discard);
  editor.append(line, editorDetails);
  for (const other of rowDrafts(row).filter((draft) => draft.row.target !== target)) {
    const resume = button(
      `Resume draft: ${other.row.targetLabel}`,
      () =>
        send({
          type: "destination",
          context,
          key: row.key,
          target: other.row.target,
        }),
      "ghost"
    );
    resume.disabled = busy || !row.targets.some((item) => item.id === other.row.target);
    resume.classList.add("resume-draft");
    editor.append(resume);
  }
  if (row.targets.length > 1) {
    const destination = document.createElement("button");
    destination.id = `destination-${row.key}`;
    dropdown(
      destination,
      row.targets.map((item) => ({ value: item.id, label: item.label })),
      row.target
    );
    destination.disabled = busy;
    destination.setAttribute("aria-label", `Save ${row.label.toLowerCase()} to`);
    destination.addEventListener("change", () =>
      send({
        type: "destination",
        context,
        key: row.key,
        target: destination.value as SettingsTarget,
      })
    );
    const destinationRow = el("div", "destination-row");
    const destinationTitle = document.createElement("label");
    destinationTitle.textContent = "Save changes to";
    destinationTitle.htmlFor = destination.id;
    destinationRow.append(destinationTitle, destination);
    editorDetails.append(destinationRow);
  }
  if (row.explicit && row.resetValue !== undefined)
    editorDetails.append(
      el("p", "field-note", `After removing this override: ${displayValue(row.resetValue)}.`)
    );
  if (row.schema.enumDescriptions && row.schema.enum!.length > 3) {
    const index = row.schema.enum!.indexOf(String(value));
    if (index >= 0) editorDetails.append(el("p", "field-note", row.schema.enumDescriptions[index]));
  }
  if (row.schema.type === "array")
    editorDetails.append(el("p", "field-note", "One entry per line. Order is preserved."));
  if (row.names) editorDetails.append(el("p", "field-note", row.names));
  if (row.pathStatus)
    editorDetails.append(
      el("p", "resolved", `Path: ${row.pathStatus}${row.resolved ? ` · ${row.resolved}` : ""}`)
    );
  if (row.override) editor.append(el("p", "warning", row.override));
  if (row.disabled) editorDetails.append(el("p", "field-note", row.disabled));
  if (draft && draft.stamp !== row.stamp)
    editor.append(
      el("p", "warning", "Changed elsewhere. Discard this draft to load the current value before saving.")
    );
  if (draft?.error) {
    const error = el("p", "field-error", draft.error);
    error.setAttribute("role", "alert");
    error.id = `error-${row.key}`;
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", `${description.id} ${error.id}`);
    editor.append(error);
  }
  if (paragraphs.length > 1 || brief !== paragraphs[0]) {
    const details = document.createElement("details");
    details.className = "extra-help";
    details.open = expandedHelp.has(row.key);
    details.ontoggle = () => {
      if (details.open) expandedHelp.add(row.key);
      else expandedHelp.delete(row.key);
    };
    const more = [paragraphs[0].slice(brief.length).trim(), ...paragraphs.slice(1)].filter(Boolean);
    const summary = el("summary", "", "More help");
    summary.prepend(iconEl("circleHelp"));
    summary.dataset.tip = help(more.join("\n\n")).textContent ?? "";
    summary.dataset.tipWrap = "";
    summary.dataset.tipWide = "";
    details.append(summary);
    for (const paragraph of more) {
      const p = el("p");
      p.append(help(paragraph));
      details.append(p);
    }
    copyDetails.append(details);
  }
  copyDetails.append(el("p", "setting-key", `px.${row.key}`));
  return section;
}

function updateDraftActions() {
  const count = [...drafts.keys()].filter((key) => key.startsWith(`${state?.target}\n`)).length;
  $("draft-count").textContent = count ? `${count} unsaved ${count === 1 ? "setting" : "settings"}` : "";
  $("save-drafts").hidden = count === 0;
  $<HTMLButtonElement>("save-drafts").disabled = requests.size > 0;
}

function renderRows() {
  if (!state) return;
  closePopover();
  // Replies and status updates can arrive while another control is being edited.
  const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
  const focusId = active?.id;
  const selection =
    active &&
    (active instanceof HTMLTextAreaElement || (active instanceof HTMLInputElement && active.type === "text"))
      ? [active.selectionStart, active.selectionEnd]
      : undefined;
  const query = $<HTMLInputElement>("query").value.trim().toLowerCase();
  const filter = $<HTMLButtonElement>("filter").value;
  const sort = $<HTMLButtonElement>("sort").value;
  const matches = state.rows.filter(
    (r) =>
      (filter === "all" ||
        (filter === "changed" && r.explicit) ||
        (filter === "drafts" && rowDrafts(r).length > 0)) &&
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
  if (state.scopeDescription) root.append(el("p", "intro", state.scopeDescription));
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
  if (sort === "default" && !query && group === ALL_SETTINGS) {
    for (const name of groups.slice(1)) {
      const rows = visibleRows.filter((row) => row.group === name);
      if (!rows.length) continue;
      const heading = el("div", "group-heading");
      heading.append(el("h3", "", name), el("span", "", `${rows.length} settings`));
      const grid = el("div", "settings-grid");
      grid.append(...rows.map(renderRow));
      root.append(heading, grid);
    }
  } else {
    const grid = el("div", "settings-grid");
    grid.append(...visibleRows.map(renderRow));
    root.append(grid);
  }
  updateDraftActions();
  const detailsToggle = $<HTMLInputElement>("show-details");
  const expandedCount = state.rows.filter((row) => expandedRows.has(row.key)).length;
  detailsToggle.checked = expandedCount === state.rows.length;
  detailsToggle.indeterminate = expandedCount > 0 && !detailsToggle.checked;
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
  const scope = $<HTMLButtonElement>("scope");
  dropdown(
    scope,
    state.targets.map((target) => ({ value: target.id, label: target.label })),
    state.target
  );
  scope.disabled = state.targets.length < 2;
  persist();
  renderRows();
}

$("query").addEventListener("input", () => {
  persist();
  renderRows();
});
$("scope").addEventListener("change", () =>
  send({ type: "target", target: $<HTMLButtonElement>("scope").value as SettingsTarget })
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
$("show-details").addEventListener("change", () => {
  const show = $<HTMLInputElement>("show-details").checked;
  expandedRows.clear();
  if (show) for (const row of state?.rows ?? []) expandedRows.add(row.key);
  renderRows();
});
$("save-drafts").onclick = () => {
  const changes: SettingsSave[] = [];
  for (const draft of [...drafts.values()]) {
    const current = state?.rows.find((row) => row.key === draft.row.key);
    if (
      draft.context === state?.target &&
      current &&
      !current.disabled &&
      current.targets.some((target) => target.id === draft.row.target)
    ) {
      const change = prepareSave(draft.row, false, draft.context);
      if (change) changes.push(change);
    }
  }
  if (changes.length) {
    notice(`Saving ${changes.length} drafts…`);
    send({ type: "saveBatch", changes });
  }
  renderRows();
};
$<HTMLInputElement>("query").value = saved?.query ?? "";
const filters = [
  { value: "all", label: "All settings" },
  { value: "changed", label: "Customized" },
  { value: "drafts", label: "Unsaved drafts" },
];
const sorts = [
  { value: "default", label: "Default order" },
  { value: "name", label: "Name" },
  { value: "changed", label: "Changed first" },
];
dropdown(
  $<HTMLButtonElement>("filter"),
  filters,
  filters.some((item) => item.value === saved?.filter) ? saved!.filter! : "all"
);
dropdown(
  $<HTMLButtonElement>("sort"),
  sorts,
  sorts.some((item) => item.value === saved?.sort) ? saved!.sort! : "default"
);
window.addEventListener("message", (event: MessageEvent<HostToApp>) => {
  const message = event.data;
  if (message.type === "state") {
    const initial = !state;
    renderState(message.state);
    if (initial)
      notice("Each setting shows where changes are saved. Open Details to choose another destination.");
  } else if (message.type === "reveal") {
    $<HTMLInputElement>("query").value = message.key;
    dropdown($<HTMLButtonElement>("filter"), filters, "all");
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
      if (drafts.get(request.key) === request.draft) drafts.delete(request.key);
      notice(`${request.row.label} saved to ${request.row.targetLabel.toLowerCase()}.`);
    } else if (message.value !== undefined) {
      const previous = drafts.get(request.key) ?? newDraft(request.row, request.context);
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
    if (
      restoreFocus &&
      state?.target === request.context &&
      state.rows.find((row) => row.key === request.row.key)?.target === request.target
    ) {
      const input = document.getElementById(`setting-${request.row.key}`);
      const control = input?.hidden ? document.getElementById(`summary-${request.row.key}`) : input;
      control?.focus({ preventScroll: true });
    }
  }
});
installTips();
send({ type: "ready", target: saved?.target });
