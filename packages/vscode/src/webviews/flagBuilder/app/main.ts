/**
 * The Flag Builder app: one flag under edit, drawn by render.ts, edited
 * through the layer list (drag to reorder) and the inspector in a resizable,
 * collapsible side panel, with a browser overlay for the game's textures and
 * flags (rendered previews). Undo/redo is snapshot-based: every structural
 * edit and every committed field value is one step. Built from the shared
 * px-ui classes; talks to the host only through messages.ts.
 */
import {
  COLOR_SLOTS,
  colorToRgb,
  DEFAULT_INSTANCE,
  DEFAULT_SUB_INSTANCE,
  writeFlag,
  type CoaColor,
  type CoaFlag,
  type CoaLayer,
  type Rgb,
} from "@px-lsp/server/coa/coa";
import type { AppToHost, FlagDatabase, HostToApp, ModTarget, TextureKind, UiState } from "../messages";
import { iconEl, type IconName } from "../../shared/icons";
import { sidePanel } from "../../shared/sidePanel";
import { confirmDialog, infoDialog, menu, toast, type MenuItem } from "../../shared/overlay";
import { scrubbable } from "../../shared/scrub";
import { colorPicker } from "../../shared/colorPicker";
import { sortable } from "../../shared/sortable";
import { clearRenderCaches, previewThumb, renderFlag, textureKeys } from "./render";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();
const send = (m: AppToHost): void => vscode.postMessage(m);
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let db: FlagDatabase | null = null;
let mods: ModTarget[] = [];
let flag: CoaFlag = { name: "new_flag", pattern: "", colors: [], layers: [] };
/** -1 = the flag itself, otherwise a layer index. */
let selected = -1;

/** Decoded textures by key; undefined = not asked yet, null = host has none. */
const images = new Map<string, HTMLImageElement | null>();
const thumbs = new Map<string, HTMLImageElement | null>();
const pending = { full: new Set<string>(), thumb: new Set<string>() };
let flushTimer: ReturnType<typeof setTimeout> | undefined;

function request(key: string, thumb: boolean): void {
  const store = thumb ? thumbs : images;
  const queue = thumb ? pending.thumb : pending.full;
  if (store.has(key) || queue.has(key)) return;
  queue.add(key);
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      for (const [q, isThumb] of [
        [pending.full, false],
        [pending.thumb, true],
      ] as const) {
        if (q.size) send({ type: "textures", keys: [...q], thumbs: isThumb });
        q.clear();
      }
    }, 0);
  }
}

function receiveTextures(urls: Record<string, string | null>, thumb: boolean): void {
  const store = thumb ? thumbs : images;
  for (const [key, url] of Object.entries(urls)) {
    if (!url) {
      store.set(key, null);
      if (thumb) paintTiles();
      continue;
    }
    const img = new Image();
    img.onload = () => {
      store.set(key, img);
      if (thumb) paintTiles();
      else draw();
    };
    img.onerror = () => store.set(key, null);
    img.src = url;
  }
  if (!thumb) draw();
}

/** Clipboard reads go through the host; the next `clipboard` reply answers the oldest ask. */
const clipboardWaiters: ((text: string) => void)[] = [];
function readClipboard(): Promise<string> {
  return new Promise((resolve) => {
    clipboardWaiters.push(resolve);
    send({ type: "readClipboard" });
  });
}

/** "rgb { 255 0 0 }", "hsv360 { 0 100 100 }", "255 0 0" or "#ff0000" from the clipboard. */
function parseColorText(text: string): { kind: "rgb" | "hsv360"; value: [number, number, number] } | null {
  const t = text.trim();
  const hex = /^#?([0-9a-f]{6})$/i.exec(t);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { kind: "rgb", value: [(n >> 16) & 255, (n >> 8) & 255, n & 255] };
  }
  const m = /^(?:(rgb|hsv360|hsv)\s*)?\{?\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*\}?$/i.exec(t);
  if (!m) return null;
  const n = [Number(m[2]), Number(m[3]), Number(m[4])];
  if (n.some((x) => !Number.isFinite(x))) return null;
  const tag = (m[1] ?? "rgb").toLowerCase();
  if (tag === "hsv") return { kind: "hsv360", value: [n[0] * 360, n[1] * 100, n[2] * 100] };
  if (tag === "hsv360") return { kind: "hsv360", value: [n[0], n[1], n[2]] };
  const rgb = n.every((x) => x <= 1) ? n.map((x) => Math.round(x * 255)) : n.map(Math.round);
  return { kind: "rgb", value: [rgb[0], rgb[1], rgb[2]] };
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

const past: string[] = [];
const future: string[] = [];
let snapshot = "";

/** Record the current flag as one undo step (no-op when nothing changed). */
function commit(): void {
  const now = JSON.stringify(flag);
  if (now === snapshot) return;
  past.push(snapshot);
  if (past.length > 200) past.shift();
  future.length = 0;
  snapshot = now;
  updateHistoryButtons();
}

function restore(json: string): void {
  snapshot = json;
  flag = JSON.parse(json);
  $<HTMLInputElement>("name").value = flag.name;
  if (selected >= flag.layers.length) selected = -1;
  refresh(false);
  updateHistoryButtons();
}

function undo(): void {
  const prev = past.pop();
  if (prev === undefined) return;
  future.push(snapshot);
  restore(prev);
}

function redo(): void {
  const next = future.pop();
  if (next === undefined) return;
  past.push(snapshot);
  restore(next);
}

function resetHistory(): void {
  past.length = 0;
  future.length = 0;
  snapshot = JSON.stringify(flag);
  updateHistoryButtons();
}

function updateHistoryButtons(): void {
  $<HTMLButtonElement>("undo").disabled = past.length === 0;
  $<HTMLButtonElement>("redo").disabled = future.length === 0;
}

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

/** The flag's own size: 3:2, what the games render and the tool exports at. */
const canvas = $<HTMLCanvasElement>("canvas");
canvas.width = 768;
canvas.height = 512;

function draw(): void {
  if (!db) return;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const complete = renderFlag(
    ctx,
    flag,
    { x: 0, y: 0, w: canvas.width, h: canvas.height },
    {
      textures: { image: (k) => images.get(k) ?? null },
      namedColors: db.namedColors,
      definitions: db.definitions,
    }
  );
  if (!complete) for (const key of textureKeys(flag, db.definitions)) request(key, false);
  const missing = textureKeys(flag, db.definitions).filter((k) => images.get(k) === null);
  $("hint").textContent = missing.length ? `Missing textures: ${missing.join(", ")}` : "";
}

// ---------------------------------------------------------------------------
// Element helpers (px-ui)
// ---------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  e.append(...children);
  return e;
}

interface ButtonOptions {
  icon?: IconName;
  variant?: "default" | "outline" | "secondary" | "ghost" | "destructive";
  size?: "sm" | "xs" | "icon" | "icon-sm" | "icon-xs";
  tip?: string;
}

function button(label: string, onClick: () => void, o: ButtonOptions = {}): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "px-btn";
  b.dataset.variant = o.variant ?? "ghost";
  if (o.size) b.dataset.size = o.size;
  if (o.icon) b.append(iconEl(o.icon));
  if (label) b.append(label);
  if (o.tip) b.dataset.tip = o.tip;
  b.onclick = (e) => {
    e.stopPropagation();
    onClick();
  };
  return b;
}

/** A field-like trigger that opens a `menu`; the shadcn Select shape. */
function dropdown(
  items: MenuItem[],
  value: string,
  onPick: (v: string) => void,
  o: { small?: boolean; placeholder?: string; search?: boolean } = {}
): HTMLButtonElement {
  const current = items.find((i) => i.value === value);
  const b = button("", () => menu(b, items, { value, search: o.search, onPick }), {
    variant: "outline",
    size: o.small ? "sm" : undefined,
  });
  b.classList.add("px-dropdown");
  if (!current) b.setAttribute("data-placeholder", "");
  if (current?.swatch) {
    const sw = el("span", "px-swatch");
    sw.style.setProperty("--px-swatch", current.swatch);
    b.append(sw);
  }
  b.append(el("span", "px-truncate", current?.label ?? o.placeholder ?? value), iconEl("chevronDown"));
  return b;
}

function numberInput(value: number, step: number, onChange: (v: number) => void): HTMLInputElement {
  const i = document.createElement("input");
  i.className = "px-input";
  i.dataset.size = "sm";
  i.type = "number";
  i.step = String(step);
  i.value = String(Number(value.toFixed(3)));
  i.oninput = () => {
    const v = Number(i.value);
    if (Number.isFinite(v)) {
      onChange(v);
      draw();
    }
  };
  // The undo step is the committed value, not every keystroke.
  i.onchange = commit;
  scrubbable(i, {
    onChange: (v) => {
      onChange(v);
      draw();
    },
    onCommit: commit,
  });
  return i;
}

/** A number field with a short prefix inside it ("h", "s", "v"). */
function labeled(prefix: string, input: HTMLInputElement): HTMLElement {
  return el("label", "px-labeled", el("span", undefined, prefix), input);
}

function field(label: string, ...value: (HTMLElement | string)[]): HTMLElement {
  const v = el("div", "px-row", ...value);
  v.style.minWidth = "0";
  return el("div", "px-field", el("span", "px-label", label), v);
}

function swatch(rgb: Rgb | null): HTMLSpanElement {
  const s = el("span", "px-swatch");
  if (rgb) s.style.setProperty("--px-swatch", rgbHex(rgb));
  else s.setAttribute("data-missing", "");
  s.title = rgb ? rgbHex(rgb) : "unresolved color";
  return s;
}

function rgbHex(rgb: Rgb): string {
  return (
    "#" +
    rgb
      .map((v) =>
        Math.max(0, Math.min(255, Math.round(v)))
          .toString(16)
          .padStart(2, "0")
      )
      .join("")
  );
}

function rgbToHsv360(rgb: Rgb): [number, number, number] {
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return [Math.round(h), Math.round(max ? (d / max) * 100 : 0), Math.round(max * 100)];
}

// ---------------------------------------------------------------------------
// Layer list
// ---------------------------------------------------------------------------

function layerLabel(layer: CoaLayer): [string, string] {
  switch (layer.kind) {
    case "colored_emblem":
      return ["Colored emblem", layer.texture || "(no texture)"];
    case "textured_emblem":
      return ["Textured emblem", layer.texture || "(no texture)"];
    case "sub":
      return ["Sub flag", layer.parent || "(no parent)"];
  }
}

function renderLayers(): void {
  const list = $("layers");
  list.replaceChildren();
  const rows: { label: string; kind: string; index: number }[] = [
    { label: flag.pattern || "(no pattern)", kind: "Pattern", index: -1 },
    ...flag.layers.map((l, i) => {
      const [kind, label] = layerLabel(l);
      return { label, kind, index: i };
    }),
  ];
  for (const r of rows) {
    const row = el(
      "div",
      "px-item",
      el("span", "px-item-kind", r.kind),
      el("span", "px-item-label", r.label)
    );
    if (r.index === selected) row.setAttribute("aria-selected", "true");
    row.onclick = () => select(r.index);
    if (r.index < 0) {
      list.append(row);
      continue;
    }
    const i = r.index;
    row.append(
      el(
        "span",
        "px-item-tools",
        button(
          "",
          () => {
            flag.layers.splice(i, 1);
            select(Math.min(selected, flag.layers.length - 1));
          },
          { icon: "x", size: "icon-xs", tip: "Remove layer" }
        )
      )
    );
    list.append(row);
  }
}

// The pattern row is fixed; every layer row below it drags.
sortable($("layers"), {
  rows: () => Array.from($("layers").children).slice(1) as HTMLElement[],
  onReorder: (from, to) => {
    const [moved] = flag.layers.splice(from, 1);
    flag.layers.splice(to, 0, moved);
    select(to);
  },
});

function select(index: number): void {
  selected = index;
  refresh();
}

/** Redraw everything after an edit; `record` = false when restoring history. */
function refresh(record = true): void {
  renderLayers();
  renderInspector();
  draw();
  updateOrigin();
  if (record) commit();
}

function addLayer(kind: CoaLayer["kind"]): void {
  const layer: CoaLayer =
    kind === "sub"
      ? { kind, parent: "", instances: [] }
      : kind === "colored_emblem"
        ? { kind, texture: "", mask: 0, colors: [], instances: [] }
        : { kind, texture: "", instances: [] };
  flag.layers.push(layer);
  select(flag.layers.length - 1);
  if (kind === "sub") openBrowser("parent");
  else openBrowser(kind === "colored_emblem" ? "colored_emblems" : "textured_emblems");
}

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

function namedColorItems(): MenuItem[] {
  return Object.keys(db!.namedColors)
    .sort()
    .map((n) => ({ value: n, label: n, swatch: rgbHex(db!.namedColors[n]) }));
}

function colorEditor(colors: CoaColor[], title: string): HTMLElement {
  const free = COLOR_SLOTS.find((s) => !colors.some((c) => c.name === s));
  const add = button(
    "Add",
    () => {
      if (!free) return;
      const first = Object.keys(db!.namedColors)[0];
      colors.push(
        first
          ? { name: free, kind: "named", value: first }
          : { name: free, kind: "rgb", value: [255, 255, 255] }
      );
      refresh();
    },
    { icon: "plus", size: "xs" }
  );
  add.disabled = !free;
  const wrap = el("div", "colors", el("div", "subhead", el("span", "px-label", title), add));

  for (const color of colors) {
    const rgb = colorToRgb(color, db!.namedColors, flag.colors);
    const sw = swatch(rgb);
    const kind = dropdown(
      [
        { value: "named", label: "named" },
        { value: "rgb", label: "rgb" },
        { value: "hsv360", label: "hsv360" },
        { value: "ref", label: "same as" },
      ],
      color.kind,
      (k) => {
        const current = colorToRgb(color, db!.namedColors, flag.colors) ?? [255, 255, 255];
        const i = colors.indexOf(color);
        colors[i] =
          k === "named"
            ? { name: color.name, kind: "named", value: Object.keys(db!.namedColors)[0] ?? "white" }
            : k === "rgb"
              ? { name: color.name, kind: "rgb", value: current }
              : k === "hsv360"
                ? { name: color.name, kind: "hsv360", value: rgbToHsv360(current) }
                : { name: color.name, kind: "ref", value: flag.colors[0]?.name ?? "color1" };
        refresh();
      },
      { small: true }
    );

    const value = el("div", "px-row");
    value.style.minWidth = "0";
    let values: HTMLElement | null = null;
    const copyText = (text: string): void => send({ type: "copy", text });
    const pasteColor = async (): Promise<void> => {
      const parsed = parseColorText(await readClipboard());
      if (!parsed) {
        toast("The clipboard holds no color (rgb { 255 0 0 }, 255 0 0 or #ff0000).", "destructive");
        return;
      }
      const i = colors.indexOf(color);
      colors[i] = { name: color.name, ...parsed };
      refresh();
    };
    if (color.kind === "named") {
      value.append(
        dropdown(
          namedColorItems(),
          color.value,
          (v) => {
            color.value = v;
            refresh();
          },
          { small: true, search: true }
        )
      );
    } else if (color.kind === "rgb") {
      const text = el("span", "px-mono px-truncate");
      const show = (): void => {
        text.textContent = `R ${color.value[0]}  G ${color.value[1]}  B ${color.value[2]}`;
      };
      show();
      const edit = button(
        "",
        () =>
          colorPicker(edit, color.value, {
            onChange: (rgb) => {
              color.value = rgb;
              sw.style.setProperty("--px-swatch", rgbHex(rgb));
              show();
              draw();
            },
            onClose: commit,
          }),
        { icon: "pencil", size: "icon-xs", tip: "Pick a color" }
      );
      values = el(
        "div",
        "color-values",
        text,
        edit,
        button("", () => copyText(`rgb { ${color.value.join(" ")} }`), {
          icon: "copy",
          size: "icon-xs",
          tip: "Copy rgb { r g b }",
        }),
        button("", () => void pasteColor(), { icon: "paste", size: "icon-xs", tip: "Paste a color" })
      );
    } else if (color.kind === "hsv360") {
      const v = color.value;
      values = el(
        "div",
        "color-values",
        labeled(
          "h",
          numberInput(v[0], 1, (x) => (v[0] = x))
        ),
        labeled(
          "s",
          numberInput(v[1], 1, (x) => (v[1] = x))
        ),
        labeled(
          "v",
          numberInput(v[2], 1, (x) => (v[2] = x))
        ),
        button("", () => copyText(`hsv360 { ${v.map(Math.round).join(" ")} }`), {
          icon: "copy",
          size: "icon-xs",
          tip: "Copy hsv360 { h s v }",
        }),
        button("", () => void pasteColor(), { icon: "paste", size: "icon-xs", tip: "Paste a color" })
      );
    } else {
      const bases = flag.colors.filter((b) => !(colors === flag.colors && b.name === color.name));
      value.append(
        dropdown(
          bases.map((b) => ({
            value: b.name,
            label: b.name,
            swatch: rgbHex(colorToRgb(b, db!.namedColors, flag.colors) ?? [0, 0, 0]),
          })),
          color.value,
          (v) => {
            color.value = v;
            refresh();
          },
          { small: true }
        )
      );
    }
    wrap.append(
      el(
        "div",
        "color-row",
        el("span", "px-muted px-sm", color.name),
        sw,
        kind,
        value,
        button(
          "",
          () => {
            colors.splice(colors.indexOf(color), 1);
            refresh();
          },
          { icon: "x", size: "icon-xs", tip: "Remove color" }
        )
      )
    );
    if (values) wrap.append(values);
  }
  return wrap;
}

/** Instances folded by the user, by "layer:index"; forgotten with the panel. */
const collapsedInstances = new Set<string>();

function instanceEditor(layer: CoaLayer): HTMLElement {
  const wrap = el(
    "div",
    "colors",
    el(
      "div",
      "subhead",
      el(
        "span",
        "px-label",
        layer.instances.length ? "Instances" : "Instances (default: centered, full size)"
      ),
      button(
        "Add",
        () => {
          if (layer.kind === "sub") layer.instances.push({ ...DEFAULT_SUB_INSTANCE });
          else layer.instances.push({ ...DEFAULT_INSTANCE });
          refresh();
        },
        { icon: "plus", size: "xs" }
      )
    )
  );
  const pair = (a: HTMLElement, b: HTMLElement): HTMLElement => {
    const row = el("div", "px-row", a, b);
    row.style.minWidth = "0";
    return row;
  };
  layer.instances.forEach((inst, i) => {
    const block = el("div", "instance");
    const key = `${selected}:${i}`;
    if (collapsedInstances.has(key)) block.setAttribute("data-collapsed", "");
    const caret = iconEl("chevronDown", "px-icon caret");
    const head = el(
      "div",
      "subhead",
      el("span", "px-row", caret, el("span", "px-muted px-xs", `Instance ${i + 1}`)),
      button(
        "",
        () => {
          layer.instances.splice(i, 1);
          refresh();
        },
        { icon: "x", size: "icon-xs", tip: "Remove instance" }
      )
    );
    head.onclick = () => {
      if (collapsedInstances.has(key)) collapsedInstances.delete(key);
      else collapsedInstances.add(key);
      block.toggleAttribute("data-collapsed");
    };
    block.append(head);
    if (layer.kind === "sub") {
      const sub = layer.instances[i];
      block.append(
        field(
          "Offset",
          pair(
            numberInput(sub.offset[0], 0.01, (v) => (sub.offset[0] = v)),
            numberInput(sub.offset[1], 0.01, (v) => (sub.offset[1] = v))
          )
        )
      );
    } else {
      const it = layer.instances[i];
      block.append(
        field(
          "Position",
          pair(
            numberInput(it.position[0], 0.01, (v) => (it.position[0] = v)),
            numberInput(it.position[1], 0.01, (v) => (it.position[1] = v))
          )
        )
      );
    }
    block.append(
      field(
        "Scale",
        pair(
          numberInput(inst.scale[0], 0.01, (v) => (inst.scale[0] = v)),
          numberInput(inst.scale[1], 0.01, (v) => (inst.scale[1] = v))
        )
      )
    );
    if (layer.kind !== "sub") {
      const it = layer.instances[i];
      const rot = numberInput(it.rotation, 1, (v) => (it.rotation = v));
      rot.style.width = "calc(50% - 3px)";
      block.append(field("Rotation", rot));
    }
    wrap.append(block);
  });
  return wrap;
}

/** An outline button that reads as a picker: current value left, chevron right. */
function pickButton(current: string, placeholder: string, onClick: () => void): HTMLButtonElement {
  const b = button("", onClick, { variant: "outline" });
  b.classList.add("px-dropdown");
  if (!current) b.setAttribute("data-placeholder", "");
  b.append(el("span", "px-truncate", current || placeholder), iconEl("chevronDown"));
  return b;
}

function renderInspector(): void {
  const box = $("inspector");
  box.replaceChildren();
  const layer = selected >= 0 ? flag.layers[selected] : null;
  if (!layer) {
    $("inspectorTitle").textContent = "Flag";
    box.append(
      field(
        "Pattern",
        pickButton(flag.pattern, "Choose a pattern…", () => openBrowser("patterns"))
      ),
      colorEditor(flag.colors, "Flag colors")
    );
    return;
  }
  $("inspectorTitle").textContent = layerLabel(layer)[0];
  if (layer.kind === "sub") {
    box.append(
      field(
        "Parent",
        pickButton(layer.parent, "Choose a flag…", () => openBrowser("parent"))
      ),
      instanceEditor(layer)
    );
    return;
  }
  const kind: TextureKind = layer.kind === "colored_emblem" ? "colored_emblems" : "textured_emblems";
  box.append(
    field(
      "Texture",
      pickButton(layer.texture, "Choose a texture…", () => openBrowser(kind))
    )
  );
  if (layer.kind === "colored_emblem") {
    const mask = dropdown(
      [
        { value: "0", label: "none" },
        { value: "1", label: "pattern color1" },
        { value: "2", label: "pattern color2" },
        { value: "3", label: "pattern color3" },
      ],
      String(layer.mask),
      (v) => {
        layer.mask = Number(v);
        refresh();
      }
    );
    box.append(field("Mask", mask), colorEditor(layer.colors, "Emblem colors"));
  }
  box.append(instanceEditor(layer));
}

// ---------------------------------------------------------------------------
// Browser overlay
// ---------------------------------------------------------------------------

type BrowserMode = TextureKind | "flags" | "parent";
let browserMode: BrowserMode = "patterns";
/** Tiles waiting for their pixels: each paints itself once its textures arrived. */
const tiles = new Map<string, { canvas: HTMLCanvasElement; paint: () => boolean }>();
let observer: IntersectionObserver | null = null;

function openBrowser(mode: BrowserMode): void {
  browserMode = mode;
  $("browserTitle").textContent =
    mode === "flags" ? "Open a flag" : mode === "parent" ? "Parent flag" : mode.replace("_", " ");
  const search = $<HTMLInputElement>("browserSearch");
  search.value = "";
  $("browser").classList.add("open");
  fillBrowser();
  search.focus();
}

function closeBrowser(): void {
  $("browser").classList.remove("open");
  observer?.disconnect();
  observer = null;
  tiles.clear();
}

const THUMB_SOURCE = { image: (k: string): HTMLImageElement | null => thumbs.get(k) ?? null };

/** Words that mean "the base game" in the Open search, beside the game's own name. */
const GAME_WORDS = ["game", "vanilla", "basegame", "base game", "base"];

/** Grid pages: the next batch is appended when the sentinel scrolls into view. */
const PAGE = 120;

function fillBrowser(): void {
  if (!db) return;
  const body = $("browserBody");
  body.replaceChildren();
  observer?.disconnect();
  tiles.clear();
  const q = $<HTMLInputElement>("browserSearch").value.trim().toLowerCase();
  const grid = el("div");
  grid.id = "grid";
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const t = e.target as HTMLElement;
      if (!e.isIntersecting) continue;
      if (t.id === "more") appendPage();
      else tiles.get(t.dataset.key!)?.paint();
    }
  });

  let makeTile: (i: number) => HTMLElement;
  let total: number;
  if (browserMode === "flags" || browserMode === "parent") {
    const gameName = db.gameName.toLowerCase();
    const matches = db.flags.filter((f) => {
      if (!q) return true;
      if (f.name.toLowerCase().includes(q) || f.file.toLowerCase().includes(q)) return true;
      const source = f.source.toLowerCase();
      if (source === "game")
        return gameName.includes(q) || GAME_WORDS.some((w) => w.startsWith(q) || q.startsWith(w));
      return source.includes(q);
    });
    total = matches.length;
    makeTile = (i) => {
      const entry = matches[i];
      const def = db!.definitions[entry.name];
      const c = document.createElement("canvas");
      c.width = 120;
      c.height = 80;
      const tile = el(
        "div",
        "tile",
        c,
        el("div", "name", entry.name),
        el("div", "src", `${sourceLabel(entry.source)} · ${entry.file}`)
      );
      tile.dataset.kind = "flag";
      tile.dataset.key = `flag:${entry.name}`;
      tile.title = entry.name;
      tile.onclick = () => {
        if (browserMode === "parent") {
          const layer = flag.layers[selected];
          if (layer?.kind === "sub") layer.parent = entry.name;
        } else {
          loadFlag(entry);
        }
        closeBrowser();
        refresh(browserMode === "parent");
      };
      tiles.set(tile.dataset.key, {
        canvas: c,
        paint: () => {
          if (c.dataset.done) return true;
          const keys = textureKeys(def, db!.definitions);
          for (const k of keys) request(k, true);
          if (!keys.every((k) => thumbs.has(k))) return false;
          const ctx = c.getContext("2d")!;
          ctx.clearRect(0, 0, c.width, c.height);
          renderFlag(
            ctx,
            def,
            { x: 0, y: 0, w: c.width, h: c.height },
            {
              textures: THUMB_SOURCE,
              namedColors: db!.namedColors,
              definitions: db!.definitions,
              cacheTag: "thumb:",
            }
          );
          c.dataset.done = "1";
          return true;
        },
      });
      return tile;
    };
  } else {
    const kind = browserMode;
    const matches = db.textures[kind].filter((t) => !q || t.toLowerCase().includes(q));
    total = matches.length;
    makeTile = (i) => {
      const file = matches[i];
      const key = `${kind}/${file}`;
      const c = document.createElement("canvas");
      c.width = 108;
      c.height = 72;
      const tile = el("div", "tile", c, el("div", "name", file));
      tile.dataset.key = key;
      tile.title = file;
      tile.onclick = () => {
        if (kind === "patterns") flag.pattern = file;
        else {
          const layer = flag.layers[selected];
          if (layer && layer.kind !== "sub") layer.texture = file;
        }
        closeBrowser();
        refresh();
      };
      tiles.set(key, {
        canvas: c,
        paint: () => {
          if (c.dataset.done) return true;
          request(key, true);
          const img = thumbs.get(key);
          if (img === undefined) return false;
          c.dataset.done = "1";
          const ctx = c.getContext("2d")!;
          if (!img) {
            ctx.fillStyle = "#a33";
            ctx.fillText("cannot decode", 20, 40);
            return true;
          }
          const src = previewThumb(`thumb:${key}`, img, kind);
          const scale = Math.min(c.width / img.naturalWidth, c.height / img.naturalHeight);
          const w = img.naturalWidth * scale;
          const h = img.naturalHeight * scale;
          ctx.drawImage(src, (c.width - w) / 2, (c.height - h) / 2, w, h);
          return true;
        },
      });
      return tile;
    };
  }

  const more = el("div");
  more.id = "more";
  let shown = 0;
  const appendPage = (): void => {
    const end = Math.min(total, shown + PAGE);
    for (; shown < end; shown++) {
      const tile = makeTile(shown);
      grid.append(tile);
      observer!.observe(tile);
    }
    if (shown >= total) {
      observer!.unobserve(more);
      more.remove();
    }
    $("browserCount").textContent = `${total} ${total === 1 ? "match" : "matches"}`;
  };
  body.append(grid, more);
  appendPage();
  if (shown < total) observer.observe(more);
}

/** Paint every tile whose pixels have arrived (called as thumbnails load). */
function paintTiles(): void {
  for (const t of tiles.values()) if (!t.canvas.dataset.done) t.paint();
}

// ---------------------------------------------------------------------------
// Flags in and out
// ---------------------------------------------------------------------------

/** The flag as opened from the database: its origin, for the footer, the name reset and the save target. */
let opened: { name: string; source: string; file: string } | null = null;

function sourceLabel(source: string): string {
  return source === "game" ? (db?.gameName ?? "game") : source;
}

function updateOrigin(): void {
  $("origin").textContent = opened ? `Opened from ${sourceLabel(opened.source)} · ${opened.file}` : "";
  const reset = $<HTMLButtonElement>("resetName");
  reset.hidden = !opened || opened.name === flag.name;
  if (opened) reset.dataset.tip = `Reset the name to ${opened.name} (to override the opened flag)`;
}

function setFlag(next: CoaFlag): void {
  flag = next;
  $<HTMLInputElement>("name").value = flag.name;
  selected = -1;
  resetHistory();
}

function loadFlag(entry: { name: string; source: string; file: string }): void {
  const def = db?.definitions[entry.name];
  if (!def) return;
  opened = { ...entry };
  setFlag(JSON.parse(JSON.stringify(def)));
}

function newFlag(): void {
  const patterns = db?.textures.patterns ?? [];
  const pattern = patterns.find((p) => p.startsWith("pattern_solid")) ?? patterns[0] ?? "";
  const named = Object.keys(db?.namedColors ?? {});
  opened = null;
  setFlag({
    name: "new_flag",
    pattern,
    colors: named.length
      ? [{ name: "color1", kind: "named", value: named.includes("red") ? "red" : named[0] }]
      : [],
    layers: [],
  });
  refresh(false);
}

/** True when the flag differs from what was last loaded, created or restored. */
const dirty = (): boolean => past.length > 0;

async function confirmDiscard(what: string): Promise<boolean> {
  if (!dirty()) return true;
  return confirmDialog({
    title: `Discard changes to ${flag.name}?`,
    description: `${what} replaces the flag you are editing. Copy its script first if you want to keep it.`,
    confirmLabel: "Discard and continue",
    destructive: true,
  });
}

// ---------------------------------------------------------------------------
// Side panel and save target
// ---------------------------------------------------------------------------

let uiState: UiState = { panelWidth: 340, panelCollapsed: false };
const panel = sidePanel($("side"), {
  width: uiState.panelWidth,
  collapsed: uiState.panelCollapsed,
  onChange: (s) => {
    uiState = { ...uiState, panelWidth: s.width, panelCollapsed: s.collapsed };
    updateToggle();
    send({ type: "uiState", state: uiState });
  },
});

function updateToggle(): void {
  const b = $("togglePanel");
  b.replaceChildren(iconEl(panel.collapsed ? "panelRightOpen" : "panelRightClose"));
  b.dataset.tip = panel.collapsed ? "Show inspector" : "Hide inspector";
}

function saveTarget(): ModTarget | undefined {
  return mods.find((m) => m.path === uiState.savePath) ?? mods[0];
}

/** "…\content\3472248460": the mod folder and the one above it, the rest elided. */
function shortPath(p: string): string {
  const sep = p.includes("\\") ? "\\" : "/";
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length > 2 ? `…${sep}${parts.slice(-2).join(sep)}` : p;
}

function updateModPicker(): void {
  const b = $<HTMLButtonElement>("mod");
  const target = saveTarget();
  const label = target
    ? target.label.length > 40
      ? target.label.slice(0, 39) + "…"
      : target.label
    : "No mod in workspace";
  b.querySelector(".px-truncate")!.textContent = label;
  b.dataset.tip = target
    ? `Save writes into this mod: ${target.label}. Click to choose another.`
    : "No mod in the workspace to save into";
  b.disabled = mods.length === 0;
  $<HTMLButtonElement>("save").disabled = !target;
  $("save").dataset.tip = target
    ? `Write the flag into ${target.label}/common/coat_of_arms/coat_of_arms/`
    : "No mod in the workspace to save into";
}

// ---------------------------------------------------------------------------
// Stage view: locked (fit) by default; unlocked = middle-drag pans, wheel zooms
// ---------------------------------------------------------------------------

const stage = $("stage");
const viewport = $("viewport");
const view = { locked: true, x: 0, y: 0, scale: 1 };

function applyView(): void {
  viewport.style.transform = view.locked ? "" : `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  $("zoom").textContent = view.locked ? "" : `${Math.round(view.scale * 100)}%`;
  stage.toggleAttribute("data-unlocked", !view.locked);
  const b = $("lock");
  b.replaceChildren(iconEl(view.locked ? "lock" : "unlock"));
  b.dataset.tip = view.locked
    ? "View locked. Unlock to pan with the middle mouse button and zoom with the wheel"
    : "View unlocked: middle-drag pans, wheel zooms, double-click resets. Lock to fit again";
}

$("lock").onclick = () => {
  view.locked = !view.locked;
  view.x = view.y = 0;
  view.scale = 1;
  applyView();
};
stage.addEventListener(
  "wheel",
  (e) => {
    if (view.locked) return;
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const next = Math.max(0.1, Math.min(16, view.scale * Math.exp(-e.deltaY * 0.0015)));
    // Zoom about the pointer: the stage point under it stays put.
    view.x = px - ((px - view.x) * next) / view.scale;
    view.y = py - ((py - view.y) * next) / view.scale;
    view.scale = next;
    applyView();
  },
  { passive: false }
);
stage.addEventListener("pointerdown", (down) => {
  if (view.locked || down.button !== 1) return;
  down.preventDefault();
  stage.setPointerCapture(down.pointerId);
  stage.setAttribute("data-panning", "");
  let lastX = down.clientX;
  let lastY = down.clientY;
  const move = (ev: PointerEvent): void => {
    view.x += ev.clientX - lastX;
    view.y += ev.clientY - lastY;
    lastX = ev.clientX;
    lastY = ev.clientY;
    applyView();
  };
  const up = (): void => {
    stage.removeEventListener("pointermove", move);
    stage.removeEventListener("pointerup", up);
    stage.removeAttribute("data-panning");
  };
  stage.addEventListener("pointermove", move);
  stage.addEventListener("pointerup", up);
});
stage.addEventListener("dblclick", () => {
  if (view.locked) return;
  view.x = view.y = 0;
  view.scale = 1;
  applyView();
});
applyView();

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

$("new").onclick = async () => {
  if (await confirmDiscard("A new flag")) newFlag();
};
$("open").onclick = async () => {
  if (await confirmDiscard("Opening a flag")) openBrowser("flags");
};
$("paste").onclick = () => send({ type: "paste" });
$("undo").onclick = undo;
$("redo").onclick = redo;
$("copy").onclick = () => send({ type: "copy", text: writeFlag(flag) });
$("save").onclick = () => {
  const target = saveTarget();
  if (!target) return;
  if (!flag.name.trim()) {
    toast("Give the flag a name first.", "destructive");
    return;
  }
  send({
    type: "save",
    name: flag.name.trim(),
    script: writeFlag(flag),
    modPath: target.path,
    sourceFile: opened?.file,
  });
};
$("mod").onclick = () =>
  menu(
    $("mod"),
    mods.map((m) => ({ value: m.path, label: m.label, hint: shortPath(m.path), description: m.path })),
    {
      value: saveTarget()?.path,
      search: false,
      width: 260,
      onPick: (v) => {
        uiState = { ...uiState, savePath: v };
        send({ type: "uiState", state: uiState });
        updateModPicker();
      },
    }
  );
$("png").onclick = () => send({ type: "exportPng", name: flag.name, dataUrl: canvas.toDataURL("image/png") });
$("togglePanel").onclick = () => panel.toggle();
$("help").onclick = () =>
  infoDialog("How to build a flag", [
    [
      "Start",
      "New gives you a solid flag with one color. Open shows every flag of the game and your mods as a preview; pick one to start from it. Paste reads a definition from the clipboard.",
    ],
    [
      "Pattern and colors",
      "The pattern is the base texture; its red, yellow and white areas become color1, color2 and color3 of the flag. Select the Pattern row to change it and the flag colors.",
    ],
    [
      "Layers",
      "Add a colored emblem (recolorable shape), a textured emblem (drawn as is) or a sub flag (another flag inside this one). Drag rows to change the draw order; later rows draw on top.",
    ],
    [
      "Placing",
      "Each layer has instances: position is a fraction of the flag (0.5 0.5 = center), scale a fraction of its size, rotation in degrees. Drag a number sideways to scrub it.",
    ],
    [
      "Emblem colors",
      "An emblem's color1..3 can be a named game color, an rgb or hsv value, or \"same as\" one of the flag's colors. Mask limits an emblem to one pattern color's area.",
    ],
    [
      "Saving",
      "Choose the mod in the toolbar, then Save writes the script into its coat_of_arms folder. Saving to the same file name as the opened flag overrides the game's flag. Copy puts the script on the clipboard; Export PNG renders the preview.",
    ],
  ]);
$("addLayer").onclick = () =>
  menu(
    $("addLayer"),
    [
      { value: "colored_emblem", label: "Colored emblem", hint: "recolorable" },
      { value: "textured_emblem", label: "Textured emblem", hint: "as is" },
      { value: "sub", label: "Sub flag", hint: "another flag" },
    ],
    { search: false, width: 220, onPick: (v) => addLayer(v as CoaLayer["kind"]) }
  );
const nameInput = $<HTMLInputElement>("name");
nameInput.oninput = () => {
  flag.name = nameInput.value.replace(/[^\w.-]/g, "_");
  updateOrigin();
};
$("resetName").onclick = () => {
  if (!opened) return;
  flag.name = opened.name;
  nameInput.value = opened.name;
  commit();
  updateOrigin();
};
nameInput.onchange = commit;
$("browserClose").onclick = closeBrowser;
$<HTMLInputElement>("browserSearch").oninput = fillBrowser;
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && $("browser").classList.contains("open")) {
    closeBrowser();
    return;
  }
  const editing = (e.target as HTMLElement).tagName === "INPUT";
  if ((e.ctrlKey || e.metaKey) && !editing) {
    if (e.key === "z" && !e.shiftKey) undo();
    else if (e.key === "y" || (e.key === "z" && e.shiftKey)) redo();
    else return;
    e.preventDefault();
  }
});

window.addEventListener("message", (event: MessageEvent<HostToApp>) => {
  const m = event.data;
  switch (m.type) {
    case "init": {
      const first = db === null;
      db = m.db;
      mods = m.mods;
      const t = db.textures;
      $("info").dataset.tip =
        `${db.gameName}: ${db.flags.length} flags, ${t.patterns.length} patterns, ` +
        `${t.colored_emblems.length} colored and ${t.textured_emblems.length} textured emblems` +
        (db.gameMissing ? ". Game folder not found: set px.gamePath." : ".");
      images.clear();
      thumbs.clear();
      clearRenderCaches();
      if (first) {
        if (m.ui) {
          uiState = m.ui;
          panel.setWidth(m.ui.panelWidth);
          panel.toggle(m.ui.panelCollapsed);
        }
        updateToggle();
        newFlag();
      } else refresh(false);
      updateModPicker();
      return;
    }
    case "textures":
      receiveTextures(m.urls, m.thumbs);
      return;
    case "pasted":
      void (async () => {
        if (!(await confirmDiscard(`Pasting ${m.flag.name}`))) return;
        opened = null;
        setFlag(m.flag);
        refresh(false);
        toast(`Pasted ${m.flag.name}.`);
      })();
      return;
    case "clipboard":
      clipboardWaiters.shift()?.(m.text);
      return;
    case "toast":
      toast(m.message);
      return;
  }
});

send({ type: "ready" });
