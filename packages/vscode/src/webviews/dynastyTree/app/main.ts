/**
 * The Dynasty Tree app: the dynasty picker, the family-tree canvas and the
 * inspector that edits or adds a character. Browser code only. It never reads a
 * file, never calls the language server and never writes script: it fills a
 * form and hands it to the host (messages.ts), which turns it into a block.
 *
 * Where a node sits is app/layout.ts, which is pure and tested separately; this
 * file draws what that says and wires the gestures.
 */
import type { DynastyCharacter, DynastySummary, EventVocabularyItem } from "@px-lsp/protocol/protocol";
import { isValidScriptDate, parseScriptDate } from "@px-lsp/protocol/calendar";
import type { AppToHost, CharacterForm, HostToApp, ModTarget, OptionSets, TreeData } from "../messages";
import { iconEl, type IconName } from "../../shared/icons";
import { confirmDialog, menu, toast, type MenuItem } from "../../shared/overlay";
import { sidePanel } from "../../shared/sidePanel";
import { installTips } from "../../shared/tips";
import { layoutTree, NODE_H, NODE_W, type Layout, type LayoutCharacter } from "./layout";

declare function acquireVsCodeApi(): { postMessage(msg: AppToHost): void };
const vscode = acquireVsCodeApi();
const post = (msg: AppToHost): void => vscode.postMessage(msg);

/**
 * The engine's own calendar: twelve months, no leap years. The user's display
 * calendar (px.calendar) maps how a date READS; what a history file may hold
 * is this, so validation uses it.
 */
const ENGINE_CALENDAR = { epoch: 1, after: "AD" };
/** Years between a parent's birth and a prefilled child's. */
const CHILD_OFFSET = 20;
const SVG_NS = "http://www.w3.org/2000/svg";

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const $query = el<HTMLInputElement>("query");
const $queryGroup = el("queryGroup");
const $picker = el("picker");
const $pickerPane = el("pickerPane");
const $pickerNote = el("pickerNote");
const $canvasWrap = el("canvasWrap");
const $canvas = document.getElementById("canvas") as unknown as SVGSVGElement;
const $scene = document.getElementById("scene") as unknown as SVGGElement;
const $empty = el("empty");
const $side = el("side");
const $sideBody = el("sideBody");
const $title = el("title");
const $banner = el("banner");
const $back = el<HTMLButtonElement>("back");

interface State {
  supported: boolean;
  dynasties: DynastySummary[];
  tree: TreeData | null;
  options: OptionSets;
  nextDynastyId: string;
  nextCharacterId: string;
  mods: ModTarget[];
  setupProblem?: string;
  gameName: string;
  /** The character the inspector shows, or null for the dynasty itself. */
  selected: string | null;
  /** A form being filled: a new character, or an edit of an existing one. */
  draft: CharacterForm | null;
  /** The file the drafted character already lives in (an edit, not an add). */
  draftFile?: string;
  layout: Layout | null;
}

const state: State = {
  supported: true,
  dynasties: [],
  tree: null,
  options: { culture: [], religion: [], trait: [] },
  nextDynastyId: "1",
  nextCharacterId: "1",
  mods: [],
  gameName: "the game",
  selected: null,
  draft: null,
  layout: null,
};

sidePanel($side, { width: 320 });
installTips();

// ---------------------------------------------------------------------------
// small DOM helpers
// ---------------------------------------------------------------------------

function node(tag: string, className?: string, text?: string): HTMLElement {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function button(label: string, glyph?: IconName, variant = "outline"): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "px-btn";
  btn.dataset.variant = variant;
  btn.dataset.size = "sm";
  if (glyph) btn.append(iconEl(glyph));
  btn.append(document.createTextNode(label));
  return btn;
}

function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  return element;
}

/** A labelled row of the inspector. */
function field(label: string, control: HTMLElement): HTMLElement {
  const row = node("div", "px-field");
  const caption = node("span", "px-label", label);
  row.append(caption, control);
  return row;
}

function textInput(value: string, onChange: (v: string) => void, disabled = false): HTMLInputElement {
  const input = document.createElement("input");
  input.className = "px-input";
  input.dataset.size = "sm";
  input.value = value;
  input.disabled = disabled;
  input.addEventListener("input", () => onChange(input.value));
  return input;
}

/** A value picked from a list; a list the server could not fill stays typable. */
function picker(
  value: string,
  items: EventVocabularyItem[],
  onPick: (v: string) => void,
  disabled: boolean
): HTMLElement {
  if (items.length === 0) return textInput(value, onPick, disabled);
  const btn = document.createElement("button");
  btn.className = "px-btn pick";
  btn.dataset.variant = "outline";
  btn.dataset.size = "sm";
  btn.disabled = disabled;
  const val = node("span", "val", value || "none");
  btn.append(val, iconEl("chevronsUpDown"));
  btn.addEventListener("click", () => {
    const list: MenuItem[] = [
      { value: "", label: "none" },
      ...items.map((i) => ({ value: i.value, label: i.value, hint: i.hint })),
    ];
    menu(btn, list, {
      value,
      search: true,
      onPick: (picked) => {
        val.textContent = picked || "none";
        onPick(picked);
      },
    });
  });
  return btn;
}

function chip(text: string, onRemove?: () => void): HTMLElement {
  const badge = node("span", "px-badge", text);
  badge.dataset.variant = "secondary";
  if (onRemove) {
    const x = document.createElement("button");
    x.className = "px-btn";
    x.dataset.variant = "ghost";
    x.dataset.size = "icon-sm";
    x.append(iconEl("x"));
    x.addEventListener("click", onRemove);
    badge.append(x);
  }
  return badge;
}

function year(date: string | undefined): string {
  return date ? date.split(".")[0] : "";
}

/** A date the engine can read; empty is allowed (the game fills it in). */
function dateProblem(value: string): string | null {
  if (value.trim() === "") return null;
  const parsed = parseScriptDate(value.trim());
  if (!parsed) return "A date reads Y.M.D, like 1066.9.28.";
  return isValidScriptDate(ENGINE_CALENDAR, parsed.y, parsed.m, parsed.d)
    ? null
    : "That month or day does not exist.";
}

function sanitizeKey(raw: string): string {
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "") || "new"
  );
}

// ---------------------------------------------------------------------------
// the picker
// ---------------------------------------------------------------------------

function renderPicker(): void {
  const q = $query.value.trim().toLowerCase();
  const matches = state.dynasties.filter(
    (d) =>
      q === "" ||
      d.name.toLowerCase().includes(q) ||
      d.id.toLowerCase().includes(q) ||
      d.nameKey.toLowerCase().includes(q)
  );
  const shown = matches.slice(0, 400);
  $picker.replaceChildren();
  for (const dynasty of shown) {
    const row = node("div", "px-item");
    row.setAttribute("role", "button");
    row.tabIndex = 0;
    const name = node("span", "dname", dynasty.name || dynasty.nameKey);
    const key = node("span", "dkey", `${dynasty.id}${dynasty.culture ? ` · ${dynasty.culture}` : ""}`);
    const count = node(
      "span",
      "dcount",
      `${dynasty.characterCount} character${dynasty.characterCount === 1 ? "" : "s"}` +
        (dynasty.houseCount ? `, ${dynasty.houseCount} house${dynasty.houseCount === 1 ? "" : "s"}` : "")
    );
    if (dynasty.source === "mod") row.append(chip("this mod"));
    row.append(name, key, count);
    row.addEventListener("click", () => post({ type: "open", dynasty: dynasty.id }));
    row.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") post({ type: "open", dynasty: dynasty.id });
    });
    $picker.append(row);
  }
  $pickerNote.textContent = !state.supported
    ? `${state.gameName} has no dynasties in its files, so there is no family tree to draw.`
    : matches.length === 0
      ? state.dynasties.length === 0
        ? "No dynasties found. The game path and your mod both feed this list."
        : "Nothing matches that search."
      : matches.length > shown.length
        ? `Showing ${shown.length} of ${matches.length}. Keep typing to narrow it down.`
        : `${matches.length} ${matches.length === 1 ? "dynasty" : "dynasties"}.`;
}

// ---------------------------------------------------------------------------
// the canvas
// ---------------------------------------------------------------------------

const view = { x: 0, y: 0, scale: 1 };

function applyView(): void {
  $scene.setAttribute("transform", `translate(${view.x},${view.y}) scale(${view.scale})`);
}

function zoomAt(cx: number, cy: number, factor: number): void {
  const next = Math.min(2.5, Math.max(0.1, view.scale * factor));
  view.x = cx - (cx - view.x) * (next / view.scale);
  view.y = cy - (cy - view.y) * (next / view.scale);
  view.scale = next;
  applyView();
}

function fit(): void {
  const layout = state.layout;
  const rect = $canvas.getBoundingClientRect();
  if (!layout || layout.nodes.length === 0 || rect.width === 0) return;
  const pad = 40;
  view.scale = Math.min(
    1.2,
    Math.max(
      0.1,
      Math.min(
        (rect.width - pad) / Math.max(1, layout.width),
        (rect.height - pad) / Math.max(1, layout.height)
      )
    )
  );
  view.x = (rect.width - layout.width * view.scale) / 2;
  view.y = (rect.height - layout.height * view.scale) / 2;
  applyView();
}

function drawTree(): void {
  const tree = state.tree;
  $scene.replaceChildren();
  if (!tree) return;
  const input: LayoutCharacter[] = tree.characters.map((c) => ({
    id: c.id,
    father: c.father,
    mother: c.mother,
    spouses: c.spouses,
    birth: c.birth,
    external: c.external,
  }));
  const layout = layoutTree(input);
  state.layout = layout;
  const at = new Map(layout.nodes.map((n) => [n.id, n]));
  const byId = new Map(tree.characters.map((c) => [c.id, c]));

  const edges = document.createElementNS(SVG_NS, "g");
  for (const edge of layout.edges) {
    const from = at.get(edge.from);
    const to = at.get(edge.to);
    if (!from || !to) continue;
    const path =
      edge.kind === "spouse"
        ? `M ${from.x} ${from.y} L ${to.x} ${to.y}`
        : `M ${from.x} ${from.y + NODE_H / 2} C ${from.x} ${from.y + NODE_H}, ${to.x} ${to.y - NODE_H}, ${to.x} ${to.y - NODE_H / 2}`;
    const line = svg("path", { class: "edge", d: path });
    line.setAttribute("data-kind", edge.kind);
    edges.append(line);
  }
  $scene.append(edges);

  for (const spot of layout.nodes) {
    const char = byId.get(spot.id);
    if (!char) continue;
    const card = document.createElementNS(SVG_NS, "g");
    card.setAttribute("class", "card");
    card.setAttribute("transform", `translate(${spot.x - NODE_W / 2},${spot.y - NODE_H / 2})`);
    card.setAttribute("data-source", char.source);
    if (char.external) card.setAttribute("data-external", "");
    if (state.selected === char.id) card.setAttribute("data-selected", "");
    card.append(svg("rect", { width: NODE_W, height: NODE_H, rx: 6 }));
    const name = svg("text", { class: "cname", x: 10, y: 20 });
    name.textContent = `${char.female ? "♀" : "♂"} ${char.name}`;
    const dates = svg("text", { class: "cdates", x: 10, y: 36 });
    dates.textContent = `${year(char.birth) || "?"}–${year(char.death) || ""}  ${char.id}`;
    card.append(name, dates);
    const houseName = char.house ? (tree.houses.find((h) => h.id === char.house)?.name ?? char.house) : "";
    if (houseName) {
      const house = svg("text", { class: "chouse", x: 10, y: 49 });
      house.textContent = houseName;
      card.append(house);
    }
    card.addEventListener("click", () => select(char.id));
    $scene.append(card);
  }
  $empty.hidden = tree.characters.length > 0;
  if (tree.characters.length === 0) {
    $empty.replaceChildren(
      node("div", undefined, "This dynasty has no characters yet."),
      node("div", "note", "Use New character to write the first one into your mod.")
    );
  }
}

// ---------------------------------------------------------------------------
// the inspector
// ---------------------------------------------------------------------------

function select(id: string | null): void {
  state.selected = id;
  state.draft = null;
  state.draftFile = undefined;
  drawTree();
  renderInspector();
}

function characterItems(exclude?: string): MenuItem[] {
  const tree = state.tree;
  if (!tree) return [];
  return tree.characters
    .filter((c) => c.id !== exclude)
    .map((c) => ({ value: c.id, label: `${c.name} (${c.id})`, hint: year(c.birth) }));
}

function renderInspector(): void {
  $sideBody.replaceChildren();
  if (state.draft) {
    renderForm($sideBody, state.draft);
    return;
  }
  const tree = state.tree;
  if (!tree) return;
  const char = state.selected ? tree.characters.find((c) => c.id === state.selected) : undefined;
  if (char) renderCharacter($sideBody, char);
  else renderDynasty($sideBody, tree);
}

function renderDynasty(root: HTMLElement, tree: TreeData): void {
  const dynasty = tree.dynasty;
  root.append(node("h2", undefined, dynasty.name || dynasty.nameKey));
  root.append(
    node("div", "note", `Dynasty ${dynasty.id} · ${dynasty.source === "mod" ? "your mod" : dynasty.source}`)
  );
  const actions = node("div", "actions");
  const coa = button("Design coat of arms", "flag");
  coa.addEventListener("click", () => post({ type: "coa", name: dynasty.id }));
  const open = button("Open file", "folderOpen", "ghost");
  open.addEventListener("click", () => post({ type: "reveal", file: dynasty.file, line: dynasty.line }));
  actions.append(coa, open);
  root.append(actions);

  const houses = node("div", "sec");
  houses.append(node("div", "px-panel-title", `Houses (${tree.houses.length})`));
  for (const house of tree.houses) {
    const row = node("div", "px-item");
    row.append(node("span", "px-grow", house.name || house.nameKey));
    const flag = document.createElement("button");
    flag.className = "px-btn";
    flag.dataset.variant = "ghost";
    flag.dataset.size = "icon-sm";
    flag.dataset.tip = "Design this house's coat of arms";
    flag.append(iconEl("flag"));
    flag.addEventListener("click", () => post({ type: "coa", name: house.id }));
    const goto = document.createElement("button");
    goto.className = "px-btn";
    goto.dataset.variant = "ghost";
    goto.dataset.size = "icon-sm";
    goto.dataset.tip = "Open the house's file";
    goto.append(iconEl("folderOpen"));
    goto.addEventListener("click", () => post({ type: "reveal", file: house.file, line: house.line }));
    row.append(flag, goto);
    houses.append(row);
  }
  if (tree.houses.length === 0) houses.append(node("div", "note", "This dynasty has no houses."));
  root.append(houses);
  root.append(node("div", "note", "Pick a character in the tree to read or change them."));
}

function renderCharacter(root: HTMLElement, char: DynastyCharacter): void {
  const editable = char.source === "mod";
  root.append(node("h2", undefined, char.name));
  root.append(
    node(
      "div",
      "note",
      `${char.id} · ${char.female ? "female" : "male"} · ${char.source === "mod" ? "your mod" : char.source}` +
        (char.external ? " · another dynasty" : "")
    )
  );
  if (!editable) {
    root.append(
      node(
        "div",
        "note",
        "This character comes from the game files, so the panel does not change them. Add child and Add spouse write a new character into your mod that points at this one."
      )
    );
  }
  const facts = node("div", "sec");
  const line = (label: string, value: string | undefined): void => {
    if (!value) return;
    facts.append(field(label, node("span", "px-sm", value)));
  };
  line(
    "House",
    char.house ? (state.tree?.houses.find((h) => h.id === char.house)?.name ?? char.house) : undefined
  );
  line("Dynasty", char.dynasty);
  line("Born", char.birth);
  line("Died", char.death);
  line("Culture", char.culture);
  line("Faith", char.religion);
  line("Father", char.father);
  line("Mother", char.mother);
  if (char.traits.length > 0) {
    const chips = node("div", "chips");
    for (const trait of char.traits) chips.append(chip(trait));
    facts.append(field("Traits", chips));
  }
  root.append(facts);

  const actions = node("div", "actions");
  if (editable) {
    const edit = button("Edit", "pencil", "default");
    edit.addEventListener("click", () => startEdit(char));
    actions.append(edit);
  }
  const child = button("Add child", "plus");
  child.addEventListener("click", () => startChild(char));
  const spouse = button("Add spouse", "plus");
  spouse.addEventListener("click", () => startSpouse(char));
  const open = button("Open file", "folderOpen", "ghost");
  open.addEventListener("click", () => post({ type: "reveal", file: char.file, line: char.line }));
  actions.append(child, spouse, open);
  root.append(actions);
}

// ---------------------------------------------------------------------------
// the character form
// ---------------------------------------------------------------------------

function blankForm(): CharacterForm {
  const tree = state.tree;
  return {
    id: state.tree?.nextCharacterId ?? state.nextCharacterId,
    name: "",
    female: false,
    dynasty: tree && tree.houses.length === 0 ? tree.dynasty.id : undefined,
    house: tree && tree.houses.length > 0 ? tree.houses[0].id : undefined,
    culture: tree?.dynasty.culture,
    traits: [],
    spouses: [],
  };
}

function shiftYears(date: string | undefined, years: number): string | undefined {
  const parsed = date ? parseScriptDate(date) : null;
  return parsed ? `${parsed.y + years}.${parsed.m}.${parsed.d}` : undefined;
}

function startEdit(char: DynastyCharacter): void {
  state.draft = {
    id: char.id,
    name: char.name,
    female: char.female,
    dynasty: char.dynasty,
    house: char.house,
    father: char.father,
    mother: char.mother,
    culture: char.culture,
    religion: char.religion,
    birth: char.birth,
    death: char.death,
    traits: [...char.traits],
    spouses: [...char.spouses],
  };
  state.draftFile = char.file;
  renderInspector();
}

/** A new child of `parent`, prefilled with everything the parent already says. */
function startChild(parent: DynastyCharacter): void {
  const form = blankForm();
  form.house = parent.house ?? form.house;
  form.dynasty = parent.house ? undefined : (parent.dynasty ?? form.dynasty);
  if (parent.female) form.mother = parent.id;
  else form.father = parent.id;
  form.culture = parent.culture ?? form.culture;
  form.religion = parent.religion ?? form.religion;
  form.birth = shiftYears(parent.birth, CHILD_OFFSET);
  state.draft = form;
  state.draftFile = undefined;
  renderInspector();
}

/** A new spouse of `partner`: same generation, married into the dynasty. */
function startSpouse(partner: DynastyCharacter): void {
  const form = blankForm();
  form.female = !partner.female;
  form.house = undefined;
  form.dynasty = undefined;
  form.culture = partner.culture ?? form.culture;
  form.religion = partner.religion ?? form.religion;
  form.birth = partner.birth;
  form.spouses = [partner.id];
  form.marriageDate = shiftYears(partner.birth, CHILD_OFFSET);
  state.draft = form;
  state.draftFile = undefined;
  renderInspector();
}

function renderForm(root: HTMLElement, form: CharacterForm): void {
  const tree = state.tree;
  root.append(node("h2", undefined, state.draftFile ? `Edit ${form.id}` : `New character ${form.id}`));
  if (state.setupProblem) root.append(node("div", "note", state.setupProblem));

  const body = node("div", "sec");
  body.append(
    field(
      "Name",
      textInput(form.name, (v) => (form.name = v))
    )
  );

  const sex = document.createElement("label");
  sex.className = "px-switch";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = form.female;
  box.addEventListener("change", () => (form.female = box.checked));
  sex.append(box, node("span"), node("span", undefined, "Female"));
  body.append(field("Sex", sex));

  if (tree) {
    const houseItems: EventVocabularyItem[] = tree.houses.map((h) => ({ value: h.id, hint: h.name }));
    if (houseItems.length > 0) {
      body.append(
        field(
          "House",
          picker(
            form.house ?? "",
            houseItems,
            (v) => {
              form.house = v || undefined;
              if (v) form.dynasty = undefined;
              else form.dynasty = tree.dynasty.id;
            },
            false
          )
        )
      );
    }
    body.append(
      field(
        "Dynasty",
        textInput(form.dynasty ?? "", (v) => (form.dynasty = v.trim() || undefined), Boolean(form.house))
      )
    );
  }

  body.append(
    field(
      "Culture",
      picker(form.culture ?? "", state.options.culture, (v) => (form.culture = v || undefined), false)
    )
  );
  body.append(
    field(
      "Faith",
      picker(form.religion ?? "", state.options.religion, (v) => (form.religion = v || undefined), false)
    )
  );

  const dateField = (
    label: string,
    get: () => string | undefined,
    set: (v: string | undefined) => void
  ): void => {
    const input = textInput(get() ?? "", () => undefined);
    input.placeholder = "1066.9.28";
    input.addEventListener("input", () => {
      const problem = dateProblem(input.value);
      input.setAttribute("aria-invalid", problem ? "true" : "false");
      input.title = problem ?? "";
      set(input.value.trim() || undefined);
    });
    body.append(field(label, input));
  };
  dateField(
    "Born",
    () => form.birth,
    (v) => (form.birth = v)
  );
  dateField(
    "Died",
    () => form.death,
    (v) => (form.death = v)
  );

  const parentField = (
    label: string,
    get: () => string | undefined,
    set: (v: string | undefined) => void
  ): void => {
    const items: EventVocabularyItem[] = characterItems(form.id).map((i) => ({
      value: i.value,
      hint: i.label,
    }));
    body.append(
      field(
        label,
        picker(get() ?? "", items, (v) => set(v || undefined), false)
      )
    );
  };
  parentField(
    "Father",
    () => form.father,
    (v) => (form.father = v)
  );
  parentField(
    "Mother",
    () => form.mother,
    (v) => (form.mother = v)
  );

  const traits = node("div", "chips");
  const drawTraits = (): void => {
    traits.replaceChildren();
    for (const trait of form.traits) {
      traits.append(
        chip(trait, () => {
          form.traits = form.traits.filter((t) => t !== trait);
          drawTraits();
        })
      );
    }
    const add = button("Add", "plus", "ghost");
    add.addEventListener("click", () => {
      const items = state.options.trait
        .filter((t) => !form.traits.includes(t.value))
        .map((t) => ({ value: t.value, label: t.value, hint: t.hint }));
      if (items.length === 0) {
        toast("No trait list is available here; type the trait into the file after saving.");
        return;
      }
      menu(add, items, {
        search: true,
        onPick: (value) => {
          form.traits.push(value);
          drawTraits();
        },
      });
    });
    traits.append(add);
  };
  drawTraits();
  body.append(field("Traits", traits));

  const spouses = node("div", "chips");
  const drawSpouses = (): void => {
    spouses.replaceChildren();
    for (const id of form.spouses) {
      const label = tree?.characters.find((c) => c.id === id)?.name ?? id;
      spouses.append(
        chip(`${label} (${id})`, () => {
          form.spouses = form.spouses.filter((s) => s !== id);
          drawSpouses();
        })
      );
    }
    const add = button("Add", "plus", "ghost");
    add.addEventListener("click", () => {
      const items = characterItems(form.id).filter((i) => !form.spouses.includes(i.value));
      if (items.length === 0) {
        toast("There is nobody else in this tree to marry.");
        return;
      }
      menu(add, items, {
        search: true,
        onPick: (value) => {
          form.spouses.push(value);
          drawSpouses();
        },
      });
    });
    spouses.append(add);
  };
  drawSpouses();
  body.append(field("Spouses", spouses));
  if (form.spouses.length > 0) {
    const married = textInput(form.marriageDate ?? "", (v) => (form.marriageDate = v.trim() || undefined));
    married.placeholder = "1066.9.28";
    body.append(field("Married", married));
  }
  root.append(body);

  const actions = node("div", "actions");
  const save = button(state.draftFile ? "Save" : "Create", "save", "default");
  save.addEventListener("click", () => {
    const problems = [dateProblem(form.birth ?? ""), dateProblem(form.death ?? "")].filter(
      (p): p is string => p !== null
    );
    if (form.name.trim() === "") problems.push("A character needs a name.");
    if (problems.length > 0) {
      toast(problems[0], "destructive");
      return;
    }
    post({ type: "saveCharacter", form, file: state.draftFile });
    state.draft = null;
    state.draftFile = undefined;
    renderInspector();
  });
  const cancel = button("Cancel", "x", "ghost");
  cancel.addEventListener("click", () => {
    state.draft = null;
    state.draftFile = undefined;
    renderInspector();
  });
  actions.append(save, cancel);
  root.append(actions);
}

// ---------------------------------------------------------------------------
// new dynasty / new house
// ---------------------------------------------------------------------------

async function newDynasty(): Promise<void> {
  const form = node("div", "sec");
  const name = textInput("", () => undefined);
  name.placeholder = "Karling";
  const id = textInput(state.nextDynastyId, () => undefined);
  const culture = textInput(state.tree?.dynasty.culture ?? "", () => undefined);
  form.append(field("Name", name), field("Id", id), field("Culture", culture));
  const ok = await confirmDialog({
    title: "New dynasty",
    description: "The name is written to your mod's localization; the block goes into common/dynasties.",
    content: form,
    confirmLabel: "Create",
    wide: true,
  });
  if (!ok || name.value.trim() === "") return;
  const nameKey = `dynn_${sanitizeKey(name.value)}`;
  post({
    type: "saveDynasty",
    form: { id: id.value.trim() || state.nextDynastyId, nameKey, culture: culture.value.trim() || undefined },
    name: name.value.trim(),
    openTree: true,
  });
}

async function newHouse(): Promise<void> {
  const tree = state.tree;
  if (!tree) return;
  const form = node("div", "sec");
  const name = textInput("", () => undefined);
  name.placeholder = "Jerome-Karling";
  const key = textInput("", () => undefined);
  key.placeholder = "house_jerome_karling";
  name.addEventListener("input", () => {
    if (!key.dataset.touched) key.value = `house_${sanitizeKey(name.value)}`;
  });
  key.addEventListener("input", () => (key.dataset.touched = "1"));
  form.append(field("Name", name), field("Key", key));
  const ok = await confirmDialog({
    title: `New house of ${tree.dynasty.name || tree.dynasty.id}`,
    description: "The name is written to your mod's localization; the block goes into common/dynasty_houses.",
    content: form,
    confirmLabel: "Create",
    wide: true,
  });
  if (!ok || name.value.trim() === "") return;
  post({
    type: "saveHouse",
    form: {
      id: key.value.trim() || `house_${sanitizeKey(name.value)}`,
      nameKey: `dynn_${sanitizeKey(name.value)}`,
      dynasty: tree.dynasty.id,
    },
    name: name.value.trim(),
  });
}

// ---------------------------------------------------------------------------
// wiring
// ---------------------------------------------------------------------------

function showPicker(): void {
  state.tree = null;
  state.selected = null;
  state.draft = null;
  state.layout = null;
  $pickerPane.hidden = false;
  $canvasWrap.hidden = true;
  $side.hidden = true;
  $back.hidden = true;
  $queryGroup.hidden = false;
  $title.textContent = "";
  for (const id of ["newHouse", "newCharacter", "fit", "zoomIn", "zoomOut"]) el(id).hidden = true;
  renderPicker();
}

function showTree(): void {
  $pickerPane.hidden = true;
  $canvasWrap.hidden = false;
  $side.hidden = false;
  $back.hidden = false;
  $queryGroup.hidden = true;
  for (const id of ["newHouse", "newCharacter", "fit", "zoomIn", "zoomOut"]) el(id).hidden = false;
}

$query.addEventListener("input", renderPicker);
$back.addEventListener("click", () => {
  showPicker();
  post({ type: "list" });
});
el("refresh").addEventListener("click", () => {
  if (state.tree) post({ type: "open", dynasty: state.tree.dynasty.id });
  else post({ type: "list" });
});
el("fit").addEventListener("click", fit);
const centre = (): { x: number; y: number } => {
  const rect = $canvas.getBoundingClientRect();
  return { x: rect.width / 2, y: rect.height / 2 };
};
el("zoomIn").addEventListener("click", () => zoomAt(centre().x, centre().y, 1.2));
el("zoomOut").addEventListener("click", () => zoomAt(centre().x, centre().y, 1 / 1.2));
el("newDynasty").addEventListener("click", () => void newDynasty());
el("newHouse").addEventListener("click", () => void newHouse());
el("newCharacter").addEventListener("click", () => {
  state.draft = blankForm();
  state.draftFile = undefined;
  renderInspector();
});

$canvas.addEventListener("pointerdown", (ev) => {
  if ((ev.target as Element).closest(".card")) return;
  const startX = ev.clientX;
  const startY = ev.clientY;
  const origin = { x: view.x, y: view.y };
  $canvas.setAttribute("data-panning", "");
  $canvas.setPointerCapture(ev.pointerId);
  const move = (m: PointerEvent): void => {
    view.x = origin.x + (m.clientX - startX);
    view.y = origin.y + (m.clientY - startY);
    applyView();
  };
  const up = (): void => {
    $canvas.removeAttribute("data-panning");
    $canvas.removeEventListener("pointermove", move);
    $canvas.removeEventListener("pointerup", up);
    $canvas.removeEventListener("pointercancel", up);
  };
  $canvas.addEventListener("pointermove", move);
  $canvas.addEventListener("pointerup", up);
  $canvas.addEventListener("pointercancel", up);
});
$canvas.addEventListener(
  "wheel",
  (ev) => {
    ev.preventDefault();
    const rect = $canvas.getBoundingClientRect();
    zoomAt(ev.clientX - rect.left, ev.clientY - rect.top, ev.deltaY < 0 ? 1.1 : 1 / 1.1);
  },
  { passive: false }
);

window.addEventListener("message", (event: MessageEvent<HostToApp>) => {
  const msg = event.data;
  switch (msg.type) {
    case "init":
      state.mods = msg.mods;
      state.gameName = msg.gameName;
      state.setupProblem = msg.setupProblem;
      $banner.hidden = !msg.setupProblem;
      if (msg.setupProblem) $banner.textContent = msg.setupProblem;
      break;
    case "loading":
      $pickerNote.textContent = `Reading ${msg.what}…`;
      break;
    case "list":
      state.supported = msg.supported;
      state.dynasties = msg.dynasties;
      state.nextDynastyId = msg.nextDynastyId;
      state.nextCharacterId = msg.nextCharacterId;
      showPicker();
      if (state.supported) $pickerNote.textContent += ` Read in ${msg.ms} ms.`;
      break;
    case "tree":
      state.tree = msg.tree;
      state.selected = null;
      state.draft = null;
      showTree();
      $title.textContent = `${msg.tree.dynasty.name || msg.tree.dynasty.nameKey} · ${msg.tree.characters.length} characters`;
      drawTree();
      fit();
      renderInspector();
      break;
    case "options":
      state.options = msg.sets;
      if (state.draft) renderInspector();
      break;
    case "toast":
      toast(msg.message, msg.variant);
      break;
    case "error":
      toast(msg.message, "destructive");
      break;
  }
});

window.addEventListener("resize", () => {
  if (state.tree) fit();
});

post({ type: "ready" });
