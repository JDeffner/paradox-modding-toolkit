/**
 * The px-ui component gallery: every shared component with its variants,
 * wired through the same modules the panels use (menu, popover, dialog,
 * toast, scrub, sortable, color picker). shared/README.md says to show a new
 * component here before using it in a page; this is that gallery.
 *
 * Markup AND wiring live in this browser bundle on purpose: the dev server
 * watches it, so editing anything here (or in shared/) reloads the page. The
 * server serves ui.css fresh from disk. Never shipped.
 */
import { confirmDialog, menu, popover, toast } from "../../packages/vscode/src/webviews/shared/overlay";
import { scrubbable } from "../../packages/vscode/src/webviews/shared/scrub";
import { sortable } from "../../packages/vscode/src/webviews/shared/sortable";
import { colorPicker, paintSwatch, type Rgb } from "../../packages/vscode/src/webviews/shared/colorPicker";
import { icon } from "../../packages/vscode/src/webviews/shared/icons";
import { modifierLine, renderModifierLine } from "../../packages/vscode/src/webviews/shared/modifierLines";
import type { ModifierFormat } from "../../packages/protocol/src/protocol";
import {
  boolField,
  colorField,
  enumField,
  iconField,
  locField,
  modifierListField,
  multiRefField,
  numberField,
  refField,
  scriptField,
  textField,
} from "../../packages/vscode/src/webviews/shared/fields";

const PAGE_CSS = `
  body { margin: 0; padding: 20px 24px 80px; }
  h1 { font-size: 15px; margin: 0 0 4px; }
  .lede { color: var(--px-muted-fg); font-size: var(--px-text-sm); margin: 0 0 18px; }
  main { display: flex; flex-direction: column; gap: 18px; max-width: 860px; }
  section { display: flex; flex-direction: column; gap: 8px; }
  .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .hint { color: var(--px-muted-fg); font-size: var(--px-text-xs); }
  .token { display: flex; align-items: center; gap: 6px; font-size: var(--px-text-xs); }
  #tokens { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 6px; }
`;

const section = (title: string, body: string): string =>
  `<section><div class="px-panel-title">${title}</div>${body}</section>`;

const listRow = (label: string, hint: string): string => `
  <div class="px-item"><span>${label}</span><span class="hint">${hint}</span>
    <span class="px-item-tools">
      <button class="px-btn" data-variant="ghost" data-size="icon-xs" data-tip="Rename">${icon("pencil")}</button>
      <button class="px-btn" data-variant="ghost" data-size="icon-xs" data-tip="Delete">${icon("trash")}</button>
    </span>
  </div>`;

function markup(): string {
  const buttons = `
    <div class="row">
      <button class="px-btn">Save</button>
      <button class="px-btn" data-variant="outline">Outline</button>
      <button class="px-btn" data-variant="secondary">Secondary</button>
      <button class="px-btn" data-variant="ghost">Ghost</button>
      <button class="px-btn" data-variant="destructive">Destructive</button>
      <button class="px-btn" data-variant="link">Link</button>
    </div>
    <div class="row">
      <button class="px-btn" data-size="sm">Small</button>
      <button class="px-btn" data-size="xs" data-variant="outline">Extra small</button>
      <button class="px-btn" data-size="icon" data-variant="outline" data-tip="An icon button always carries a tooltip">${icon("plus")}</button>
      <button class="px-btn" data-size="icon-sm" data-variant="ghost" data-tip="Ghost, toolbar size">${icon("copy")}</button>
      <button class="px-btn" disabled>Disabled</button>
    </div>`;

  const inputs = `
    <div class="row">
      <input class="px-input" placeholder="A text input" style="width:180px" />
      <div class="px-input-group">${icon("search")}<input class="px-input" data-size="sm" placeholder="With an icon" /></div>
      <label class="px-labeled"><span>x</span><input class="px-input" data-size="sm" type="number" step="1" value="120" id="scrub-x" style="width:80px" /></label>
      <label class="px-labeled"><span>y</span><input class="px-input" data-size="sm" type="number" step="1" value="64" id="scrub-y" style="width:80px" /></label>
      <span class="hint">numbers scrub: drag horizontally, click to type</span>
    </div>`;

  const pickers = `
    <div class="row">
      <button class="px-dropdown" id="demo-dropdown" style="width:200px;flex:0 0 auto"><span class="px-truncate" id="demo-dropdown-value">liege</span>${icon("chevronDown")}</button>
      <span class="px-swatch" id="demo-swatch" data-tip="Click for the color picker" style="width:24px;height:24px;cursor:pointer"></span>
      <span class="hint">the dropdown grows a filter box past 8 items</span>
    </div>`;

  const toggles = `
    <div class="row">
      <div class="px-toggle-group" id="demo-toggles">
        <button class="px-toggle" data-size="sm" aria-pressed="true">Triggers</button>
        <button class="px-toggle" data-size="sm" aria-pressed="false">Effects</button>
        <button class="px-toggle" data-size="sm" aria-pressed="false">Targets</button>
      </div>
      <label class="px-switch" data-tip="A switch"><input type="checkbox" checked /><span></span></label>
      <input class="px-slider" type="range" min="0" max="100" value="40" style="width:140px" />
    </div>
    <div class="row">
      <div class="px-tabs" id="demo-tabs">
        <button class="px-tab" aria-selected="true">Layout</button>
        <button class="px-tab" aria-selected="false">Source</button>
        <button class="px-tab" aria-selected="false">History</button>
      </div>
      <div class="px-tabs" data-variant="line" id="demo-tabs-line">
        <button class="px-tab" aria-selected="true">Overview</button>
        <button class="px-tab" aria-selected="false">Details</button>
      </div>
    </div>`;

  const passive = `
    <div class="row">
      <span class="px-badge">badge</span>
      <span class="px-badge" data-variant="secondary">secondary</span>
      <span class="px-badge" data-variant="outline">outline</span>
      <span class="px-badge" data-variant="destructive">destructive</span>
      <span class="px-kbd">Ctrl</span><span class="px-kbd">Shift</span><span class="px-kbd">P</span>
      <span data-tip="Tooltips ride on data-tip" data-tip-side="right" style="text-decoration:underline dotted;cursor:help">hover me</span>
    </div>`;

  const list = `
    <div class="px-list" id="demo-list" style="max-width:360px">
      ${listRow("crown_authority", "law")}
      ${listRow("feudal_government", "government")}
      ${listRow("stewardship_lifestyle", "lifestyle")}
      ${listRow("obligatory_fourth_row", "drag me")}
    </div>
    <div class="hint">rows reorder by pointer drag (sortable)</div>`;

  const overlays = `
    <div class="row">
      <button class="px-btn" data-variant="outline" id="demo-popover">Popover</button>
      <button class="px-btn" data-variant="destructive" id="demo-confirm">Confirm dialog</button>
      <button class="px-btn" data-variant="secondary" id="demo-toast">Toast</button>
      <button class="px-btn" data-variant="secondary" id="demo-toast-err">Destructive toast</button>
    </div>`;

  const tokens = [
    "bg",
    "muted",
    "muted-strong",
    "popover",
    "border",
    "input",
    "ring",
    "muted-fg",
    "primary",
    "destructive",
  ]
    .map(
      (name) =>
        `<div class="token"><span class="px-swatch" style="background:var(--px-${name});width:22px;height:22px"></span><code>--px-${name}</code></div>`
    )
    .join("");

  return `<main>
    <h1>px-ui gallery</h1>
    <p class="lede">Every shared component, from the same ui.css the panels inline.
    Edit anything under <code>src/webviews/shared/</code> (or this gallery) and the page reloads.</p>
    ${section("Buttons", buttons)}
    ${section("Inputs", inputs)}
    ${section("Dropdown and color", pickers)}
    ${section("Toggles, switch, slider, tabs", toggles)}
    ${section("Badges, kbd, tooltip", passive)}
    ${section("List (sortable)", list)}
    ${section("Overlays", overlays)}
    ${section("Game tooltip (modifierLines.ts)", `<div id="gametip" class="px-stack"></div>`)}
    ${section("Creator fields (fields.ts)", `<div id="fields" class="px-stack"></div>`)}
    ${section("Tokens", `<div id="tokens">${tokens}</div>`)}
  </main>`;
}

const style = document.createElement("style");
style.textContent = PAGE_CSS;
document.head.appendChild(style);
document.body.insertAdjacentHTML("afterbegin", markup());

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

// Numbers scrub.
for (const id of ["scrub-x", "scrub-y"]) {
  const input = byId<HTMLInputElement>(id);
  scrubbable(input, { onChange: (value) => (input.value = String(value)) });
}

// Dropdown: enough items to grow the filter box.
const SCOPES = [
  "liege",
  "top_liege",
  "primary_heir",
  "primary_spouse",
  "capital_county",
  "capital_province",
  "culture",
  "faith",
  "dynasty",
  "house",
  "court_owner",
  "employer",
];
const dropdown = byId<HTMLButtonElement>("demo-dropdown");
const dropdownValue = byId<HTMLSpanElement>("demo-dropdown-value");
dropdown.addEventListener("click", () => {
  menu(
    dropdown,
    SCOPES.map((s) => ({ value: s, label: s, hint: "scope" })),
    {
      value: dropdownValue.textContent ?? undefined,
      onPick: (value) => {
        dropdownValue.textContent = value;
      },
    }
  );
});

// Color swatch opens the picker.
let rgb: Rgb = [122, 84, 214];
const swatch = byId<HTMLSpanElement>("demo-swatch");
paintSwatch(swatch, rgb);
swatch.addEventListener("click", () => {
  colorPicker(swatch, rgb, {
    onChange: (next) => {
      rgb = next;
      paintSwatch(swatch, rgb);
    },
  });
});

// Toggle group (single-select) and tabs.
const exclusive = (container: HTMLElement, selector: string, attr: string): void => {
  container.addEventListener("click", (ev) => {
    const target = (ev.target as HTMLElement).closest<HTMLElement>(selector);
    if (!target) return;
    for (const el of container.querySelectorAll<HTMLElement>(selector))
      el.setAttribute(attr, String(el === target));
  });
};
exclusive(byId("demo-toggles"), ".px-toggle", "aria-pressed");
exclusive(byId("demo-tabs"), ".px-tab", "aria-selected");
exclusive(byId("demo-tabs-line"), ".px-tab", "aria-selected");

// Sortable list: move the row in the DOM, the way a panel would.
const list = byId("demo-list");
sortable(list, {
  rows: () => Array.from(list.querySelectorAll<HTMLElement>(".px-item")),
  onReorder: (from, to) => {
    const rows = Array.from(list.querySelectorAll<HTMLElement>(".px-item"));
    const moved = rows[from];
    const anchor = rows[to];
    if (from < to) anchor.after(moved);
    else anchor.before(moved);
  },
});

// Overlays.
byId("demo-popover").addEventListener("click", () => {
  const content = document.createElement("div");
  content.style.cssText = "padding:10px 12px;max-width:240px;font-size:12px";
  content.textContent = "A popover: closes on outside click or Escape, and the anchor toggles it.";
  popover(byId("demo-popover"), content);
});
byId("demo-confirm").addEventListener("click", () => {
  void confirmDialog({
    title: "Delete 3 emblems?",
    description: "They are removed from the coat of arms.",
    details: ["emblem_lion_rampant", "emblem_cross_bold", "emblem_border_simple"],
    confirmLabel: "Delete",
    destructive: true,
  }).then((ok) => toast(ok ? "Deleted." : "Kept.", ok ? "destructive" : "default"));
});
byId("demo-toast").addEventListener("click", () => toast("Saved to gui/window_character.gui"));
byId("demo-toast-err").addEventListener("click", () =>
  toast("The engine would drop that write.", "destructive")
);

// The game tooltip: modifier rows printed the way the game prints them. These
// formats are the shape paradox/modifierFormats answers with (CK3's own
// numbers for these four, read out of common/modifier_definition_formats), and
// the icon is a data URI - the gallery has no game folder to decode a .dds from.
const ICON_PNG = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#c9a227"/></svg>`
)}`;

const FORMATS: Record<string, ModifierFormat> = {
  diplomacy: {
    label: "Diplomacy",
    decimals: 0,
    color: "good",
    prefix: [{ icon: { texture: "icon_skills.dds" } }],
  },
  monthly_income: {
    label: "Monthly Income",
    decimals: 2,
    color: "good",
    prefix: [{ icon: { texture: "icon_gold.dds" } }],
    suffix: [{ text: "/month" }],
  },
  stress_gain_mult: { label: "Stress Gain", decimals: 0, percent: true, color: "bad" },
  hostile_scheme_phase_duration_add: {
    label: "Scheme Phase Duration",
    decimals: 0,
    color: "bad",
    noSign: true,
    suffix: [{ text: " days slower per Scheme Phase" }],
    negativeSuffix: [{ text: " days faster per Scheme Phase" }],
  },
};

const gametip = byId("gametip");
const tip = document.createElement("div");
tip.className = "px-game-tip";
const tipTitle = document.createElement("div");
tipTitle.className = "px-game-tip-title";
tipTitle.textContent = "Stoic";
const tipBody = document.createElement("div");
tipBody.className = "px-game-tip-body";
tipBody.textContent = "Feels nothing, says less.";
tip.append(tipTitle, tipBody);
for (const [name, value] of [
  ["diplomacy", 2],
  ["monthly_income", 0.3],
  ["stress_gain_mult", -0.1],
  ["hostile_scheme_phase_duration_add", -5],
  ["some_unformatted_modifier", 1],
] as [string, number][]) {
  tip.append(renderModifierLine(modifierLine(name, value, FORMATS[name]), () => ICON_PNG));
}
gametip.append(tip);

// Creator fields (fields.ts): one of each, with the shapes a creator feeds
// them. The pictures are inline SVG data URIs — the gallery has no game.
const swatchPng = (fill: string): string =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="${fill}"/></svg>`
  )}`;

// `label` is the loc-resolved name the server sends: the picker reads it, and
// keeps the KEY as the dimmer hint, because the key is what gets written.
const TRAITS = [
  { value: "brave", label: "Brave", doc: "Courage in war and in council.", hint: "game" },
  { value: "craven", label: "Craven", doc: "Avoids every risk.", hint: "game" },
  { value: "px_stoic", label: "Stoic", doc: "Feels nothing, says less.", hint: "this mod" },
  { value: "ambitious", doc: "Wants more than it holds.", hint: "game" },
];

const fields = byId("fields");
for (const field of [
  textField({ label: "Name", doc: "The definition key the game reads.", value: "px_stoic" }),
  textField({
    label: "Category",
    doc: "Which trait list this belongs to.",
    value: "personality",
    suggestions: ["personality", "education", "lifestyle", "fame", "health"],
  }),
  numberField({ label: "Martial", doc: "Added to the character's martial skill.", value: 2 }),
  textField({
    label: "monthly_county_control_change_factor",
    doc: "A key as long as the game made it: the label wraps, the input keeps its width.",
    placeholder: "0.15",
  }),
  boolField({ label: "Physical", doc: "A trait of the body, not the mind." }),
  enumField({ label: "Valid sex", doc: "Who may have it.", values: ["all", "male", "female"], value: "all" }),
  refField({ label: "Opposite", doc: "A trait that cannot be held with this one.", items: TRAITS }),
  multiRefField({
    label: "Opposites",
    doc: "Traits that cannot be held with this one.",
    items: TRAITS,
    values: ["craven"],
    thumb: (value) => swatchPng(value === "craven" ? "#c05a5a" : "#5a7ac0"),
  }),
  colorField({ label: "Color", doc: "The color the game paints it with.", value: [122, 84, 214] }),
  iconField({
    label: "Icon",
    doc: "The picture in the character window.",
    value: "brave.dds",
    items: ["brave", "craven", "ambitious", "content"].map((key, i) => ({
      key: `${key}.dds`,
      url: swatchPng(["#c9a227", "#c05a5a", "#5a7ac0", "#5ac07a"][i]),
    })),
    onCustom: () => toast("The panel would open a file dialog here."),
  }),
  modifierListField({
    label: "Modifiers",
    doc: "What the trait changes while it is held.",
    items: [
      { name: "monthly_prestige", doc: "Prestige gained every month." },
      { name: "health", doc: "Added to the character's health." },
      { name: "stress_loss_mult", doc: "Multiplies stress lost." },
    ],
    rows: [{ name: "monthly_prestige", value: 0.5 }],
  }),
  locField({
    label: "Name text",
    key: "trait_px_stoic",
    value: "Stoic",
    doc: "What the player reads. Written into the mod's localization.",
  }),
  scriptField({
    label: "Trigger",
    doc: "A block no widget can express; kept verbatim.",
    value: "trigger = {\n\tage >= 16\n}",
  }),
]) {
  fields.append(field.el);
}
