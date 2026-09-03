/**
 * The Trait Creator's app: a form over one trait definition.
 *
 * Nothing in the layout knows a trait key. `paradox/definitionForm` answers
 * what a trait may contain (60 documented keys with the game's own one-line
 * docs, the loc key patterns, the icon folder, the trait list, the modifier
 * vocabulary), traitModel.ts places those keys into sections, and this file
 * builds the widget each one asked for. A key the game adds shows up in
 * "Other keys" without a code change, and no key is ever hidden (AD-5).
 *
 * The block a save writes is not a re-serialization of the form: script.ts
 * keeps the file's own text for everything the modder did not touch, so
 * opening a vanilla trait and saving it back is a zero-line diff.
 *
 * Browser code: no vscode, no file system, no server. It asks the host.
 */
import type { DefinitionForm, EventVocabularyItem } from "@px-lsp/protocol/protocol";
import {
  boolField,
  enumField,
  iconField,
  locField,
  modifierListField,
  multiRefField,
  numberField,
  scriptField,
  textField,
  titleCaseFromName,
  type Field,
  type IconChoice,
  type ModifierRow,
} from "../../shared/fields";
import { helpDialog } from "../../shared/help";
import { iconEl } from "../../shared/icons";
import { confirmDialog, menu, toast } from "../../shared/overlay";
import { installTips } from "../../shared/tips";
import type { AppToHost, HostToApp, SaveMode, TraitCreatorInit } from "../messages";
import { baseName, writeBlock } from "../../shared/scriptBlock";
import {
  emptyState,
  fieldLines,
  loadTrait,
  locKeys,
  nameProblem,
  traitFieldSpecs,
  traitWrites,
  type FieldValue,
  type LoadedTrait,
  type SectionId,
  type TraitFieldSpec,
  type TraitState,
} from "./traitModel";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();
const post = (message: AppToHost): void => vscode.postMessage(message);

const SECTIONS: { id: SectionId; title: string; lede?: string }[] = [
  { id: "identity", title: "Identity", lede: "What the trait is and who may have it." },
  { id: "look", title: "Look", lede: "What the player reads and sees." },
  { id: "stats", title: "Stats and opinions" },
  { id: "relations", title: "Relations" },
  { id: "ai", title: "AI" },
  { id: "other", title: "Other keys", lede: "Every remaining key the game documents for a trait." },
];

const HELP = {
  title: "Trait Creator",
  intro:
    "Design a trait as a form and write it into your mod as script, localization and an icon. " +
    "Every field, its documentation and every list you can pick from come from your game files, " +
    "not from a list built into the toolkit.",
  sections: [
    {
      title: "Making one",
      items: [
        { lead: "Name it.", text: "Everything else has a default, so a new trait saves with just a name." },
        {
          lead: "Look.",
          text: "The two loc values are written into your mod's localization; the icon grid lists the game's own trait icons, and Custom image converts a PNG into the mod under the trait's name.",
        },
        {
          lead: "Modifiers.",
          text: "A trait's unknown properties are modifiers, so anything the game's modifier list knows can be added as a row.",
        },
      ],
    },
    {
      title: "Editing one that exists",
      items: [
        {
          lead: "Open.",
          text: "The folder button loads a trait of your mod, or any trait the game has.",
        },
        {
          lead: "A game trait.",
          text: "Duplicate makes your own copy under a new name. Override writes the same key into your mod, which replaces the game's whole trait and stops it receiving patch changes.",
        },
        {
          lead: "Nothing else moves.",
          text: "Keys no field can stand for (a dynamic desc, a repeated block) are written back exactly as the file has them, and are listed as kept.",
        },
        {
          lead: "A duplicate is the game's own text.",
          text: "Where that text used @values defined at the top of the game's file, copy those into your file too. ck3-tiger names each one after the save.",
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let init: TraitCreatorInit | null = null;
let form: DefinitionForm | null = null;
let specs: TraitFieldSpec[] = [];
let state: TraitState = { values: {}, modifiers: [] };
/** What the file said when it was loaded; null for a brand-new trait. */
let baseline: TraitState | null = null;
let loaded: LoadedTrait | null = null;
let mode: SaveMode = "create";
const fields = new Map<string, Field<FieldValue>>();
let locFields: { key: string; field: Field<string> }[] = [];
let modifierField: Field<ModifierRow[]> | null = null;
/** Icon thumbnails, filled as the host answers; the picker reads it live. */
const iconItems: IconChoice[] = [];
const iconAsked = new Set<string>();

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const nameInput = byId<HTMLInputElement>("name");
const sourceBadge = byId("source");
const modeButton = byId<HTMLButtonElement>("mode");
const saveButton = byId<HTMLButtonElement>("save");
const revealButton = byId<HTMLButtonElement>("reveal");
const sectionsBox = byId("sections");
const targetLabel = byId("target");
const problemBox = byId("problem");
/** The name field's own tip, restored when a typed name stops being wrong. */
const NAME_TIP = nameInput.dataset.tip ?? "";

// ---------------------------------------------------------------------------
// Building the form
// ---------------------------------------------------------------------------

function optionsFor(spec: TraitFieldSpec): EventVocabularyItem[] {
  return spec.refKind ? (form?.options[spec.refKind] ?? []) : [];
}

function buildField(spec: TraitFieldSpec): Field<FieldValue> {
  const label = spec.key;
  const shared = { label, ...(spec.doc ? { doc: spec.doc } : {}) };
  const value = state.values[spec.key];
  switch (spec.widget) {
    case "number":
      return numberField({ ...shared, value: value as number | null, step: 1 }) as Field<FieldValue>;
    case "bool":
      return boolField({ ...shared, value: value as boolean | null }) as Field<FieldValue>;
    case "enum":
      return enumField({ ...shared, values: spec.values ?? [], value: String(value) }) as Field<FieldValue>;
    case "multiRef":
      return multiRefField({
        ...shared,
        items: optionsFor(spec),
        values: value as string[],
        addLabel: "Add trait",
      }) as Field<FieldValue>;
    case "refRows":
      return modifierListField({
        ...shared,
        items: optionsFor(spec).map((item) => ({ name: item.value, ...(item.doc ? { doc: item.doc } : {}) })),
        rows: value as ModifierRow[],
        addLabel: "Add trait",
      }) as Field<FieldValue>;
    case "chips":
      return multiRefField({
        ...shared,
        items: [],
        values: value as string[],
        allowNew: true,
        addLabel: "Add flag",
      }) as Field<FieldValue>;
    case "icon":
      return iconField({
        ...shared,
        items: iconItems,
        value: String(value),
        onCustom: () => post({ type: "convertIcon", name: nameInput.value.trim() }),
      }) as Field<FieldValue>;
    case "script":
      return scriptField({ ...shared, value: String(value), rows: 4 }) as Field<FieldValue>;
    default:
      return textField({ ...shared, value: String(value) }) as Field<FieldValue>;
  }
}

function sectionEl(title: string, lede?: string): HTMLElement {
  const box = document.createElement("section");
  const head = document.createElement("div");
  head.className = "px-panel-title";
  head.textContent = title;
  box.append(head);
  if (lede) {
    const note = document.createElement("div");
    note.className = "lede";
    note.textContent = lede;
    box.append(note);
  }
  return box;
}

/** The row that names a key the file keeps the last word on. */
function keptRow(key: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "kept";
  row.append(iconEl("lock"));
  const code = document.createElement("code");
  code.textContent = key;
  row.append(code, document.createTextNode(" is kept exactly as the file writes it."));
  return row;
}

/**
 * "What does this modifier do?" is a question the toolkit already answers, so
 * the panel links into the Examples Wiki rather than repeating its article.
 */
function examplesRow(): HTMLElement {
  const button = document.createElement("button");
  button.className = "px-btn";
  button.dataset.variant = "link";
  button.dataset.size = "xs";
  button.textContent = "Look a modifier up in the Examples Wiki";
  button.onclick = () =>
    menu(
      button,
      (form?.modifiers ?? []).map((item) => ({
        value: item.name,
        label: item.name,
        ...(item.doc ? { description: item.doc } : {}),
      })),
      { search: true, width: 340, onPick: (name) => post({ type: "openExamples", name }) }
    );
  return button;
}

function render(): void {
  sectionsBox.replaceChildren();
  fields.clear();
  if (!form) return;

  const bySection = new Map<string, TraitFieldSpec[]>();
  for (const spec of specs) {
    const list = bySection.get(spec.section) ?? [];
    list.push(spec);
    bySection.set(spec.section, list);
  }

  for (const section of SECTIONS) {
    const box = sectionEl(section.title, section.lede);
    let filled = false;
    if (section.id === "look") {
      for (const entry of locFields) box.append(entry.field.el);
      filled = true;
    }
    for (const spec of bySection.get(section.id) ?? []) {
      if (loaded?.verbatim.has(spec.key)) {
        box.append(keptRow(spec.key));
        filled = true;
        continue;
      }
      const field = buildField(spec);
      field.onChange((value) => {
        state.values[spec.key] = value;
        refreshPreview();
      });
      fields.set(spec.key, field);
      box.append(field.el);
      filled = true;
    }
    if (section.id === "stats" && modifierField) {
      box.append(modifierField.el, examplesRow());
      filled = true;
    }
    if (filled) sectionsBox.append(box);
  }

  // The block that will be written, live: the one place a modder can check
  // what a form actually does before it touches a file.
  const preview = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Script";
  const pre = document.createElement("pre");
  pre.id = "preview";
  preview.append(summary, pre);
  const box = sectionEl("What gets written");
  box.append(preview);
  sectionsBox.append(box);
  refreshPreview();
}

// ---------------------------------------------------------------------------
// The block
// ---------------------------------------------------------------------------

function currentName(): string {
  return nameInput.value.trim();
}

/**
 * The block a save writes. A duplicate and an override start from the game's
 * own text too: keeping its spans is what makes a clone a clone rather than a
 * reformatted guess at one.
 */
function buildBlock(): string {
  const name = currentName() || "trait";
  return writeBlock(name, loaded?.block ?? null, traitWrites(specs, state, baseline, loaded?.verbatim));
}

function refreshPreview(): void {
  const pre = document.getElementById("preview");
  if (pre) pre.textContent = buildBlock();
  const problem = nameProblem(currentName());
  saveButton.disabled = problem !== null || init?.problem !== undefined;
  nameInput.setAttribute("aria-invalid", String(problem !== null));
  // The tip says what is wrong while it is wrong, and goes back to the rule.
  nameInput.dataset.tip = problem ?? NAME_TIP;
}

/**
 * Edit mode sends only what moved, as raw script text, so a save rewrites the
 * lines the modder touched and leaves their file alone. Null when one of the
 * changes cannot be one property (a key written twice, like `flag`): the whole
 * block goes instead, which says the same thing and is still surgical.
 */
function changedProperties(): { key: string; value: string | null }[] | null {
  if (!baseline) return null;
  const out: { key: string; value: string | null }[] = [];
  for (const spec of specs) {
    if (loaded?.verbatim.has(spec.key)) continue;
    const lines = fieldLines(spec, state.values[spec.key]);
    const was = fieldLines(spec, baseline.values[spec.key]);
    if (lines.join("\n") === was.join("\n")) continue;
    if (lines.length > 1) return null;
    out.push({ key: spec.key, value: lines.length === 0 ? null : lines[0].slice(spec.key.length + 3) });
  }
  const before = new Map(baseline.modifiers.map((row) => [row.name, row.value]));
  for (const row of state.modifiers) {
    if (row.name.trim() === "") continue;
    if (before.get(row.name) !== row.value) out.push({ key: row.name, value: String(row.value) });
    before.delete(row.name);
  }
  for (const [name] of before) out.push({ key: name, value: null });
  return out;
}

// ---------------------------------------------------------------------------
// Loading a definition
// ---------------------------------------------------------------------------

function applyForm(next: DefinitionForm, keepName?: string): void {
  form = next;
  specs = traitFieldSpecs(next);
  const modifiers = new Set(next.modifiers.map((m) => m.name));
  loaded = next.current ? loadTrait(specs, next.current.text, modifiers) : null;
  state = loaded ? loaded.state : emptyState(specs);
  baseline = loaded ? (JSON.parse(JSON.stringify(loaded.state)) as TraitState) : null;

  const name = keepName ?? (next.current ? parseName(next.current.text) : defaultName());
  nameInput.value = name;
  const source = next.current?.source;
  mode = source === "mod" ? "edit" : source ? "duplicate" : "create";
  sourceBadge.textContent = source === "mod" ? "Mod" : source ? "Game" : "New";
  modeButton.hidden = source !== "vanilla" && source !== "parent";
  paintMode();
  revealButton.hidden = !next.current;

  modifierField = modifierListField({
    label: "modifiers",
    doc: "Any property a trait does not document is read as a modifier applied while the trait is held (_traits.info).",
    items: next.modifiers,
    rows: state.modifiers,
    addLabel: "Add modifier",
  });
  modifierField.onChange((rows) => {
    state.modifiers = rows;
    refreshPreview();
  });

  buildLocFields(name);
  render();
  askForIcons(iconKeysToShow());
}

function parseName(text: string): string {
  return /^\s*([^\s{}="#]+)/.exec(text)?.[1] ?? "";
}

function defaultName(): string {
  return `${init?.prefix ?? "mymod"}_trait`;
}

/** The name the loc fields were built for, so a rename can tell a typed value
 *  from the one the panel filled in. */
let locName = "";

function buildLocFields(name: string): void {
  if (!form) return;
  locName = name;
  locFields = locKeys(form, name).map((key, index) => {
    const isDesc = index > 0;
    const field = locField({
      label: isDesc ? "Description" : "Name",
      key,
      value: titleCaseFromName(name),
      multiline: isDesc,
      doc: isDesc
        ? "What the tooltip says about the trait. Written into your mod's localization."
        : "What the player sees. Written into your mod's localization.",
    });
    if (isDesc) field.set("");
    return { key, field };
  });
}

/**
 * The loc keys follow the name, so a rename rebuilds them. Text the modder
 * typed is kept; the value the panel filled in follows the new name, which is
 * what makes a freshly named trait readable with nothing else touched.
 */
function renameLoc(): void {
  if (!form) return;
  const wasDefault = titleCaseFromName(locName);
  const typed = locFields.map((entry) => entry.field.get());
  buildLocFields(currentName());
  locFields.forEach((entry, index) => {
    if (typed[index] && typed[index] !== wasDefault) entry.field.set(typed[index]);
  });
  render();
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function iconKeysToShow(): string[] {
  const keys = init?.iconKeys ?? [];
  const wanted = new Set<string>(keys.slice(0, 200));
  const current = state.values.icon;
  if (typeof current === "string" && current) wanted.add(current);
  return [...wanted];
}

function askForIcons(keys: string[]): void {
  const fresh = keys.filter((key) => !iconAsked.has(key));
  if (fresh.length === 0) return;
  for (const key of fresh) iconAsked.add(key);
  post({ type: "icons", keys: fresh });
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

async function save(): Promise<void> {
  if (!form) return;
  const name = currentName();
  const problem = nameProblem(name);
  if (problem) {
    toast(problem, "destructive");
    return;
  }
  if (mode === "override") {
    const ok = await confirmDialog({
      title: `Override the game's ${name}?`,
      description:
        "A mod definition with the same key replaces the game's whole trait, so it stops receiving " +
        "changes from every future game patch. Partial overrides do not exist.",
      confirmLabel: "Override",
      destructive: true,
    });
    if (!ok) return;
  }
  const changed = mode === "edit" ? changedProperties() : null;
  post({
    type: "save",
    save: {
      name,
      mode,
      block: buildBlock(),
      ...(changed ? { changed } : {}),
      loc: locFields
        .map((entry) => ({ key: entry.key, value: entry.field.get().trim() }))
        .filter((pair) => pair.value !== ""),
      ...(form.current && mode === "edit" ? { sourceFile: baseName(form.current.file) } : {}),
    },
  });
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

const MODES: { value: SaveMode; label: string; description: string }[] = [
  {
    value: "duplicate",
    label: "Duplicate",
    description: "A new trait of your own, under a new key. The game's trait stays as it is.",
  },
  {
    value: "override",
    label: "Override",
    description: "Same key, in your mod. Replaces the game's whole trait, patches included.",
  },
];

function paintMode(): void {
  const chosen = MODES.find((m) => m.value === mode);
  (modeButton.firstElementChild as HTMLElement).textContent = chosen?.label ?? "Duplicate";
}

modeButton.onclick = () =>
  menu(modeButton, MODES, {
    value: mode,
    width: 320,
    onPick: (picked) => {
      mode = picked as SaveMode;
      // A duplicate needs a key of its own; an override IS the game's key.
      if (mode === "duplicate" && form?.current) {
        const original = parseName(form.current.text);
        if (currentName() === original) nameInput.value = `${init?.prefix ?? "mymod"}_${original}`;
      } else if (mode === "override" && form?.current) {
        nameInput.value = parseName(form.current.text);
      }
      paintMode();
      renameLoc();
    },
  });

nameInput.addEventListener("change", renameLoc);
nameInput.addEventListener("input", refreshPreview);

byId("open").onclick = () => {
  const items = [
    ...(form?.existing ?? []).map((def) => ({ value: def.name, label: def.name, hint: "this mod" })),
    ...(form?.options.trait ?? [])
      .filter((item) => !(form?.existing ?? []).some((def) => def.name === item.value))
      .map((item) => ({
        value: item.value,
        label: item.value,
        ...(item.hint ? { hint: item.hint } : {}),
        ...(item.doc ? { description: item.doc } : {}),
      })),
  ];
  if (items.length === 0) {
    toast("No trait is indexed yet. Wait for the index, or just make a new one.");
    return;
  }
  menu(byId("open"), items, { search: true, width: 340, onPick: (name) => post({ type: "load", name }) });
};

revealButton.onclick = () => {
  if (form?.current) post({ type: "openFile", file: form.current.file, line: form.current.line });
};

saveButton.onclick = () => void save();
byId("helpBtn").onclick = () => helpDialog(HELP);

// ---------------------------------------------------------------------------
// Host messages
// ---------------------------------------------------------------------------

window.addEventListener("message", (event: MessageEvent<HostToApp>) => {
  const message = event.data;
  switch (message.type) {
    case "init": {
      init = message.init;
      targetLabel.textContent = message.init.modLabel
        ? `Saving into ${message.init.modLabel} (${message.init.locLanguage})`
        : "";
      problemBox.hidden = message.init.problem === undefined;
      problemBox.textContent = message.init.problem ?? "";
      applyForm(message.init.form);
      break;
    }
    case "form":
      applyForm(message.form);
      break;
    case "icons":
      for (const [key, url] of Object.entries(message.urls)) {
        if (url) iconItems.push({ key, url });
      }
      break;
    case "iconWritten": {
      const field = fields.get("icon");
      if (message.url) iconItems.push({ key: message.key, url: message.url });
      // A custom image lands under the trait's own name, which is exactly the
      // path the game derives from the key: the block writes no `icon` line.
      if (field) field.set("");
      state.values.icon = "";
      refreshPreview();
      break;
    }
    case "saved":
      // The definition is now the mod's, so the form reloads from what was
      // written: the next save is an edit of real lines, not a second insert.
      if (message.ok) post({ type: "load", name: message.name });
      break;
    case "toast":
      toast(message.message, message.variant ?? "default");
      break;
  }
});

installTips();
post({ type: "ready" });
