/**
 * The Coat of Arms Designer app: the game's own designer, rebuilt over the
 * toolkit's renderer.
 *
 * The three tabs are the game's (gui/shared/coa_designer.gui, strings from
 * localization/english/gui/coa_designer_l_english.yml): Background is the
 * pattern grid and the pattern's color slots, Layout is the ~35 whole-arms
 * layouts, Emblems is the emblem catalog by category with the selected
 * emblem's colors and its instances. Everything they offer arrives in
 * `db.designer`, read from the same files the game reads.
 *
 * Rendering is render.ts and the canvas gestures are elements.ts, both shared
 * with the Flag Builder: this panel is a different way to reach the same
 * `coat_of_arms` definition, not a second renderer.
 */
import {
  COLOR_SLOTS,
  colorToRgb,
  DEFAULT_INSTANCE,
  writeFlag,
  type CoaColor,
  type CoaFlag,
  type CoaInstance,
  type CoaLayer,
  type DesignerEntry,
  type Rgb,
} from "@px-lsp/server/coa/coa";
import type {
  AppToHost,
  DesignerTab,
  DesignerUiState,
  FlagDatabase,
  FlagEntry,
  FlagTarget,
  HostToApp,
  ModTarget,
} from "../messages";
import { GRID_COLUMNS } from "../messages";
import { targetAction } from "../../flagBuilder/target";
import { middleEllipsis } from "../../flagBuilder/app/paths";
import { clearRenderCaches, previewThumb, renderFlag, textureKeys } from "../../flagBuilder/app/render";
import {
  boxOf,
  cornerAt,
  cornerCursor,
  corners,
  hitElement,
  moveBox,
  resizeBox,
  writeBox,
  DRAG_THRESHOLD,
  HANDLE_SIZE,
  type Corner,
  type ElementRef,
} from "../../flagBuilder/app/elements";
import { iconEl } from "../../shared/icons";
import { sidePanel } from "../../shared/sidePanel";
import { closePopover, confirmDialog, menu, popover, toast, type MenuItem } from "../../shared/overlay";
import { helpDialog } from "../../shared/help";
import { scrubbable } from "../../shared/scrub";
import { colorPicker, paintSwatch, rgbToHex } from "../../shared/colorPicker";
import { sortable } from "../../shared/sortable";
import { installTips } from "../../shared/tips";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();
const send = (m: AppToHost): void => vscode.postMessage(m);
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

installTips();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let db: FlagDatabase | null = null;
let mods: ModTarget[] = [];
let flag: CoaFlag = { name: "new_coa", pattern: "", colors: [], layers: [] };
/**
 * The game's two modes. "adjusted" is what "Adjust Existing Design" gives:
 * the structure of the opened design stays and only its colors and instances
 * move (COA_DESIGNER_BACKGROUND_PATTERN_DISABLED_IN_ADJUSTED_MODE).
 */
let mode: "custom" | "adjusted" = "custom";
let tab: DesignerTab = "background";
/** The emblem layer under edit, or -1. */
let layerIndex = -1;
/** The instance of that layer the detail edit is on. */
let instIndex = 0;
/** The element the canvas outlines, or null. */
let picked: ElementRef | null = null;
let frameId = "";
let emblemCategory = "";
let opened: { name: string; source: string; file: string } | null = null;
let target: FlagTarget | undefined;

const designer = (): FlagDatabase["designer"] | undefined => db?.designer;

/** The one layer kind this panel creates: the designer only makes colored emblems. */
type EmblemLayer = Extract<CoaLayer, { kind: "colored_emblem" }>;

// ---------------------------------------------------------------------------
// Textures (the host decodes; the app only ever holds images)
// ---------------------------------------------------------------------------

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

const FULL_SOURCE = { image: (k: string): HTMLImageElement | null => images.get(k) ?? null };
const THUMB_SOURCE = { image: (k: string): HTMLImageElement | null => thumbs.get(k) ?? null };

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

const past: string[] = [];
const future: string[] = [];
let snapshot = "";

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
  clampSelection();
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

const dirty = (): boolean => past.length > 0;

async function confirmDiscard(what: string): Promise<boolean> {
  if (!dirty()) return true;
  return confirmDialog({
    title: `${what} discards your changes`,
    description: "The current design has unsaved edits.",
    confirmLabel: "Discard",
    destructive: true,
  });
}

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

/**
 * Square, because CK3 draws arms square: every coat-of-arms widget in
 * gui/shared/coat_of_arms.gui asks for one size twice
 * (`GetTexture('(int32)56','(int32)56')`), and the frames are square too.
 */
const CANVAS_SIZE = 512;
const canvas = $<HTMLCanvasElement>("canvas");
canvas.width = CANVAS_SIZE;
canvas.height = CANVAS_SIZE;

/** The GUI editor's selection colors, so the editors read as one product. */
const SELECT_STROKE = "#4fc1ff";
const SELECT_SHADOW = "rgba(0,0,0,0.65)";

const scratch = document.createElement("canvas");

function renderContext(): Parameters<typeof renderFlag>[3] {
  return {
    textures: FULL_SOURCE,
    namedColors: db?.namedColors ?? {},
    definitions: db?.definitions ?? {},
  };
}

/** `overlay` = false for the PNG export: the outline is a tool, not the arms. */
function draw(overlay = true): void {
  if (!db) return;
  const ctx = canvas.getContext("2d")!;
  const rect = { x: 0, y: 0, w: canvas.width, h: canvas.height };
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const mask = frameId ? images.get(`masks/${frameId}`) : null;
  const frame = frameId ? images.get(`frames/${frameId}`) : null;
  if (frameId && (mask === undefined || frame === undefined)) {
    request(`masks/${frameId}`, false);
    request(`frames/${frameId}`, false);
  }
  let complete: boolean;
  if (frameId && mask) {
    // The game masks the arms with `<frame>_mask.dds` and draws `<frame>.dds`
    // over them (gui/shared/coat_of_arms.gui). Both cover the whole preview:
    // the few pixels the frame overhangs by in game are not worth moving the
    // arms out from under the pointer for.
    scratch.width = canvas.width;
    scratch.height = canvas.height;
    const sctx = scratch.getContext("2d")!;
    sctx.clearRect(0, 0, scratch.width, scratch.height);
    complete = renderFlag(sctx, flag, rect, renderContext());
    sctx.globalCompositeOperation = "destination-in";
    sctx.drawImage(mask, 0, 0, scratch.width, scratch.height);
    sctx.globalCompositeOperation = "source-over";
    ctx.drawImage(scratch, 0, 0);
    if (frame) ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
  } else {
    complete = renderFlag(ctx, flag, rect, renderContext());
  }
  const keys = textureKeys(flag, db.definitions);
  if (!complete) for (const key of keys) request(key, false);
  const missing = keys.filter((k) => images.get(k) === null);
  $("hint").textContent = missing.length ? `Missing textures: ${missing.join(", ")}` : "";
  if (overlay) paintSelection(ctx);
}

function paintSelection(ctx: CanvasRenderingContext2D): void {
  const layer = picked ? flag.layers[picked.layer] : null;
  if (!picked || !layer) return;
  const box = boxOf(layer, picked.instance);
  const screen = canvas.getBoundingClientRect();
  const f = screen.width ? screen.width / canvas.width : 1;
  const points = corners(box).map((p) => [p.x * canvas.width, p.y * canvas.height] as const);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (const [x, y] of points.slice(1)) ctx.lineTo(x, y);
  ctx.closePath();
  ctx.lineWidth = 3 / f;
  ctx.strokeStyle = SELECT_SHADOW;
  ctx.stroke();
  ctx.lineWidth = 1.5 / f;
  ctx.strokeStyle = SELECT_STROKE;
  ctx.stroke();
  const side = HANDLE_SIZE / f;
  ctx.lineWidth = 1 / f;
  ctx.strokeStyle = SELECT_SHADOW;
  ctx.fillStyle = SELECT_STROKE;
  for (const [x, y] of points) {
    ctx.fillRect(x - side / 2, y - side / 2, side, side);
    ctx.strokeRect(x - side / 2, y - side / 2, side, side);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Small px-ui builders
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

function button(label: string, onClick: () => void, variant = "ghost", size?: string): HTMLButtonElement {
  const b = el("button", "px-btn", label);
  b.dataset.variant = variant;
  if (size) b.dataset.size = size;
  b.onclick = onClick;
  return b;
}

function iconButton(name: Parameters<typeof iconEl>[0], tip: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", "px-btn", iconEl(name));
  b.dataset.variant = "ghost";
  b.dataset.size = "icon-xs";
  b.dataset.tip = tip;
  b.onclick = onClick;
  return b;
}

function field(label: string, control: HTMLElement): HTMLElement {
  const wrap = el("div", "px-field");
  wrap.append(el("span", "px-label", label), control);
  return wrap;
}

function numberInput(value: number, step: number, onChange: (v: number) => void): HTMLInputElement {
  const input = el("input", "px-input");
  input.type = "number";
  input.step = String(step);
  input.value = String(value);
  const apply = (v: number): void => {
    if (Number.isFinite(v)) onChange(Math.round(v * 1000) / 1000);
  };
  input.oninput = () => apply(Number(input.value));
  input.onchange = () => {
    apply(Number(input.value));
    commit();
  };
  scrubbable(input, {
    step,
    onChange: (v) => {
      input.value = String(Math.round(v * 1000) / 1000);
      apply(v);
    },
    onCommit: commit,
  });
  return input;
}

function checkbox(label: string, checked: boolean, onChange: (on: boolean) => void): HTMLElement {
  const box = el("input");
  box.type = "checkbox";
  box.checked = checked;
  box.onchange = () => onChange(box.checked);
  const wrap = el("label", "check", box, label);
  return wrap;
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

function rgbOf(color: CoaColor | undefined): Rgb | null {
  if (!color || !db) return null;
  return colorToRgb(color, db.namedColors, flag.colors);
}

/** The color at `slot` (0-based) of `colors`, adding empty slots up to it. */
function ensureSlot(colors: CoaColor[], slot: number, fallback: CoaColor): CoaColor {
  while (colors.length <= slot) colors.push({ ...fallback, name: COLOR_SLOTS[colors.length] });
  return colors[slot];
}

/**
 * The palette: the 13 named colors the game's designer offers, plus the free
 * picker it hides behind "Color Picker". A free color is written as
 * `rgb { r g b }`, which is what the game's own export does.
 */
function openPalette(
  anchor: HTMLElement,
  current: CoaColor | undefined,
  onPick: (c: CoaColor) => void
): void {
  const cat = designer();
  if (!cat) return;
  const root = el("div");
  const grid = el("div", "palette");
  for (const entry of cat.palette) {
    const sw = el("span", "px-swatch");
    paintSwatch(sw, entry.rgb);
    sw.dataset.tip = entry.name;
    if (current?.kind === "named" && current.value === entry.name) sw.setAttribute("aria-selected", "true");
    sw.onclick = () => {
      closePopover();
      onPick({ name: current?.name ?? "color1", kind: "named", value: entry.name });
      commit();
    };
    grid.append(sw);
  }
  const foot = el("div", "paletteFoot");
  foot.append(
    button(
      "Color Picker",
      () => {
        const start = rgbOf(current) ?? [255, 255, 255];
        // popover() closes the palette before opening the picker on the same anchor.
        colorPicker(anchor, start, {
          onChange: (rgb) => {
            onPick({ name: current?.name ?? "color1", kind: "rgb", value: rgb });
          },
          onClose: commit,
          onCopy: (text) => send({ type: "copy", text }),
        });
      },
      "outline",
      "sm"
    )
  );
  root.append(grid, foot);
  popover(anchor, root);
}

/** One labelled swatch button per color slot the entry declares. */
function colorRows(
  host: HTMLElement,
  colors: CoaColor[],
  count: number,
  labels: string[],
  onChange: () => void
): void {
  for (let slot = 0; slot < count; slot++) {
    const btn = el("button", "px-btn swatchBtn");
    btn.dataset.variant = "outline";
    const sw = el("span", "px-swatch");
    btn.append(sw);
    const paint = (): void => {
      const color = colors[slot];
      const rgb = rgbOf(color);
      if (rgb) paintSwatch(sw, rgb);
      else sw.style.setProperty("--px-swatch", "transparent");
      btn.dataset.tip = !color
        ? "Not set"
        : color.kind === "named"
          ? color.value
          : rgb
            ? rgbToHex(rgb)
            : "unset";
    };
    paint();
    btn.onclick = () =>
      openPalette(btn, colors[slot], (c) => {
        const name = COLOR_SLOTS[slot];
        ensureSlot(colors, slot, { name, kind: "named", value: "white" });
        colors[slot] = { ...c, name };
        paint();
        onChange();
      });
    const row = el("div", "colorRow");
    row.append(el("span", "px-label", labels[slot] ?? COLOR_SLOTS[slot]), btn);
    host.append(row);
  }
}

/** The game's own names for the five color slots (coa_designer_l_english.yml). */
const COLOR_LABELS = [
  "Primary Color",
  "Secondary Color",
  "Tertiary Color",
  "Quaternary Color",
  "Quinary Color",
];

// ---------------------------------------------------------------------------
// Catalog lookups
// ---------------------------------------------------------------------------

function patternEntry(): DesignerEntry | undefined {
  return designer()?.patterns.find((p) => p.file === flag.pattern);
}

function emblemEntry(texture: string): DesignerEntry | undefined {
  return designer()?.emblems.find((e) => e.file === texture);
}

/** The emblem layers, which is what the Emblems tab edits. */
function emblemLayers(): { layer: CoaLayer; index: number }[] {
  return flag.layers
    .map((layer, index) => ({ layer, index }))
    .filter(({ layer }) => layer.kind === "colored_emblem");
}

function selectedLayer(): CoaLayer | null {
  return layerIndex >= 0 ? (flag.layers[layerIndex] ?? null) : null;
}

function clampSelection(): void {
  if (layerIndex >= flag.layers.length) layerIndex = flag.layers.length - 1;
  const layer = selectedLayer();
  if (!layer) {
    layerIndex = emblemLayers()[0]?.index ?? -1;
    instIndex = 0;
  }
  const current = selectedLayer();
  if (current && instIndex >= Math.max(1, current.instances.length)) instIndex = 0;
  if (picked && (!flag.layers[picked.layer] || picked.instance >= Math.max(1, boxCount(picked.layer))))
    picked = null;
}

function boxCount(index: number): number {
  const layer = flag.layers[index];
  return layer ? Math.max(1, layer.instances.length) : 0;
}

// ---------------------------------------------------------------------------
// Tiles (lazy thumbnails)
// ---------------------------------------------------------------------------

interface Tile {
  canvas: HTMLCanvasElement;
  keys: string[];
  paint: () => void;
}

const tiles = new Map<HTMLElement, Tile>();
let observer: IntersectionObserver | null = null;

function tileObserver(): IntersectionObserver {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const tile = tiles.get(entry.target as HTMLElement);
        if (!tile) continue;
        // In view order, batched: request() coalesces one message per tick.
        for (const key of tile.keys) request(key, true);
        tile.paint();
      }
    },
    { root: null, rootMargin: "200px" }
  );
  return observer;
}

function paintTiles(): void {
  for (const tile of tiles.values()) tile.paint();
}

/** A grid tile drawing `flagOf()` at thumbnail size; repainted as textures land. */
function makeTile(flagOf: () => CoaFlag, square: boolean, tip: string, onPick: () => void): HTMLElement {
  const host = el("div", "tile");
  if (square) host.dataset.square = "";
  host.dataset.tip = tip;
  const c = el("canvas");
  c.width = square ? 96 : 144;
  c.height = 96;
  host.append(c);
  host.onclick = onPick;
  const paint = (): void => {
    const source = flagOf();
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    renderFlag(
      ctx,
      source,
      { x: 0, y: 0, w: c.width, h: c.height },
      {
        textures: THUMB_SOURCE,
        namedColors: db?.namedColors ?? {},
        definitions: db?.definitions ?? {},
        cacheTag: "t",
      }
    );
  };
  tiles.set(host, { canvas: c, keys: [], paint });
  return host;
}

function registerTile(host: HTMLElement, keys: string[]): void {
  const tile = tiles.get(host);
  if (tile) tile.keys = keys;
  tileObserver().observe(host);
}

function clearTiles(host: HTMLElement): void {
  for (const child of Array.from(host.children)) {
    tiles.delete(child as HTMLElement);
    tileObserver().unobserve(child as HTMLElement);
  }
  host.replaceChildren();
}

// ---------------------------------------------------------------------------
// Background tab
// ---------------------------------------------------------------------------

function renderBackground(): void {
  const cat = designer();
  const colorsHost = $("bgColors");
  colorsHost.replaceChildren();
  if (!cat) return;
  const count = patternEntry()?.colors ?? 3;
  colorRows(colorsHost, flag.colors, count, COLOR_LABELS, () => {
    refresh();
  });

  const grid = $("patternGrid");
  clearTiles(grid);
  grid.style.setProperty("--cols", String(GRID_COLUMNS));
  if (mode === "adjusted") {
    const note = el(
      "div",
      "note",
      "In Adjusted mode the background pattern may not be changed, but you can adjust the colors above."
    );
    const back = button(
      "Customize Design",
      () => {
        mode = "custom";
        refresh(false);
      },
      "outline",
      "sm"
    );
    grid.style.removeProperty("--cols");
    grid.append(note, back);
    return;
  }
  for (const entry of cat.patterns) {
    const key = `patterns/${entry.file}`;
    const host = makeTile(
      () => ({ name: "", pattern: entry.file, colors: flag.colors, layers: [] }),
      true,
      entry.file,
      () => {
        flag.pattern = entry.file;
        // The new pattern may show fewer or more color buttons; keep what the
        // design already picked and let the extra slots stay in the script.
        refresh();
      }
    );
    if (entry.file === flag.pattern) host.setAttribute("aria-selected", "true");
    grid.append(host);
    registerTile(host, [key]);
  }
}

// ---------------------------------------------------------------------------
// Layout tab
// ---------------------------------------------------------------------------

/**
 * A layout is a whole coat of arms written against `@pattern`, `@color_1..3`
 * and `@texture_1..2`. Substituting is what "picking a layout" means: the
 * design's own pattern and colors stay, and the emblems it already has fill
 * the texture and emblem-color holes (the first two, in layer order).
 */
function substituteLayout(layout: CoaFlag, defaults: Record<string, string>): CoaFlag {
  const cat = designer();
  const emblems = emblemLayers().map(({ layer }) => layer as Extract<CoaLayer, { kind: "colored_emblem" }>);
  const texture = (n: 1 | 2): string =>
    emblems[n - 1]?.texture ?? emblems[0]?.texture ?? defaults[`@texture_${n}`] ?? "";
  const emblemColor = (n: 2 | 3): CoaColor | null =>
    emblems[n - 2]?.colors[0] ?? emblems[0]?.colors[0] ?? null;
  const named = (value: string, name: string): CoaColor => ({ name, kind: "named", value });

  const layers: CoaLayer[] = layout.layers.map((source) => {
    if (source.kind !== "colored_emblem") return JSON.parse(JSON.stringify(source)) as CoaLayer;
    const file = source.texture === "@texture_2" ? texture(2) : texture(1);
    const slots = cat?.emblems.find((e) => e.file === file)?.colors ?? source.colors.length;
    const colors: CoaColor[] = [];
    for (let slot = 0; slot < slots; slot++) {
      const placeholder = source.colors[slot];
      const which = placeholder?.kind === "named" && placeholder.value === "@color_3" ? 3 : 2;
      const from = emblemColor(which as 2 | 3) ?? flag.colors[slot + 1] ?? flag.colors[0];
      colors.push(
        from
          ? { ...from, name: COLOR_SLOTS[slot] }
          : named(defaults[`@color_${which}`] ?? "white", COLOR_SLOTS[slot])
      );
    }
    return {
      kind: "colored_emblem",
      texture: file,
      mask: source.mask,
      colors,
      instances: source.instances.map((i) => ({ ...i, scale: [...i.scale], position: [...i.position] })),
    };
  });
  return { name: flag.name, pattern: flag.pattern, colors: flag.colors, layers };
}

/** The layout as its own file writes it: neutral emblems and neutral colors. */
function layoutPreview(layout: CoaFlag, defaults: Record<string, string>): CoaFlag {
  const resolve = (value: string, name: string): CoaColor =>
    value.startsWith("@")
      ? { name, kind: "named", value: defaults[value] ?? "white" }
      : { name, kind: "named", value };
  const colors = layout.colors.map((c) =>
    c.kind === "named" ? resolve(c.value, c.name) : { ...c, name: c.name }
  );
  const layers = layout.layers.map((layer) => {
    if (layer.kind !== "colored_emblem") return layer;
    return {
      ...layer,
      texture: layer.texture.startsWith("@") ? (defaults[layer.texture] ?? "") : layer.texture,
      colors: layer.colors.map((c) => (c.kind === "named" ? resolve(c.value, c.name) : c)),
    };
  });
  return {
    name: layout.name,
    pattern: layout.pattern.startsWith("@") ? (defaults[layout.pattern] ?? "") : layout.pattern,
    colors,
    layers,
  };
}

function renderLayout(): void {
  const cat = designer();
  const grid = $("layoutGrid");
  clearTiles(grid);
  grid.style.setProperty("--cols", String(GRID_COLUMNS));
  if (!cat) return;
  for (const layout of cat.layouts) {
    const preview = layoutPreview(layout.flag, cat.layoutDefaults);
    const host = makeTile(
      () => preview,
      true,
      layout.name,
      () => {
        flag.layers = substituteLayout(layout.flag, cat.layoutDefaults).layers;
        layerIndex = emblemLayers()[0]?.index ?? -1;
        instIndex = 0;
        picked = null;
        refresh();
      }
    );
    grid.append(host);
    registerTile(host, textureKeys(preview, db?.definitions ?? {}));
  }
}

// ---------------------------------------------------------------------------
// Emblems tab
// ---------------------------------------------------------------------------

function emblemLabel(texture: string): string {
  return texture
    .replace(/^ce_/, "")
    .replace(/\.(dds|tga|png)$/i, "")
    .replace(/_/g, " ");
}

function renderLayerList(): void {
  const list = $("layerList");
  list.replaceChildren();
  for (const { layer, index } of emblemLayers()) {
    if (layer.kind !== "colored_emblem") continue;
    const row = el("div", "px-item");
    if (index === layerIndex) row.setAttribute("aria-selected", "true");
    row.append(el("span", "px-item-kind", iconEl("shapes")));
    row.append(el("span", "px-item-label", emblemLabel(layer.texture) || "no emblem"));
    const tools = el("div", "px-item-tools");
    tools.append(
      iconButton("trash", "Remove this emblem", () => {
        flag.layers.splice(index, 1);
        clampSelection();
        refresh();
      })
    );
    row.append(tools);
    row.onclick = (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      layerIndex = index;
      instIndex = 0;
      picked = { layer: index, instance: 0 };
      refresh(false);
      draw();
    };
    list.append(row);
  }
}

// Registered once, not per render: the list element outlives its rows.
// "Click and drag emblems to set which one is drawn on top of others"
// (COA_DESIGNER_DETAIL_DRAG_INSTRUCTION), which is layer order, so a drop
// moves the layer inside `flag.layers`.
sortable($("layerList"), {
  rows: () => Array.from($("layerList").children) as HTMLElement[],
  onReorder: (from, to) => {
    const order = emblemLayers().map((e) => e.index);
    const [moved] = flag.layers.splice(order[from], 1);
    flag.layers.splice(order[to], 0, moved);
    layerIndex = order[to];
    picked = null;
    refresh();
  },
});

function renderEmblems(): void {
  renderLayerList();
  const cat = designer();
  const body = $("emblemBody");
  clearTiles(body);
  if (!cat) return;
  const layer = selectedLayer();
  if (!layer || layer.kind !== "colored_emblem") {
    body.append(el("div", "note", "Add an emblem to place a shape on the arms."));
    return;
  }

  // Colors of the selected emblem: as many buttons as the catalog declares.
  const colorsHost = el("div", "colors");
  const slots = emblemEntry(layer.texture)?.colors ?? layer.colors.length;
  colorRows(colorsHost, layer.colors, slots, COLOR_LABELS, () => refresh());
  body.append(el("div", "px-panel-title", "Colors"), colorsHost);

  // The catalog, one category at a time: 1577 emblems never all reach the DOM.
  if (mode !== "adjusted") {
    const head = el("div", "px-panel-title", "Textures");
    const pick = el("button", "px-btn px-dropdown");
    pick.dataset.variant = "outline";
    pick.dataset.size = "sm";
    pick.style.width = "auto";
    const category = emblemCategory || cat.categories[0] || "";
    pick.append(el("span", "px-truncate", categoryLabel(category)), iconEl("chevronDown"));
    pick.onclick = () =>
      menu(
        pick,
        cat.categories.map((id): MenuItem => ({ value: id, label: categoryLabel(id) })),
        {
          value: category,
          width: 220,
          onPick: (value) => {
            emblemCategory = value;
            renderEmblems();
          },
        }
      );
    const grid = el("div", "grid gridScroll");
    grid.style.setProperty("--cols", String(GRID_COLUMNS));
    for (const entry of cat.emblems) {
      if (entry.category !== category) continue;
      const host = emblemTile(entry, layer);
      grid.append(host);
      registerTile(host, [`colored_emblems/${entry.file}`]);
    }
    body.append(head, pick, grid);
  }

  body.append(el("div", "px-panel-title", "Placement"));
  body.append(instanceGrid(layer));
  body.append(detailEdit(layer));
}

/** A raw emblem thumbnail, recolored for reading like the game's own grid. */
function emblemTile(entry: DesignerEntry, layer: EmblemLayer): HTMLElement {
  const key = `colored_emblems/${entry.file}`;
  const host = el("div", "tile");
  host.dataset.square = "";
  host.dataset.tip = entry.file;
  const c = el("canvas");
  c.width = 96;
  c.height = 96;
  host.append(c);
  if (layer.texture === entry.file) host.setAttribute("aria-selected", "true");
  host.onclick = () => pickEmblem(entry);
  const paint = (): void => {
    const img = thumbs.get(key);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    if (img) ctx.drawImage(previewThumb("t" + key, img, "colored_emblems"), 0, 0, c.width, c.height);
  };
  tiles.set(host, { canvas: c, keys: [key], paint });
  return host;
}

/** Swap the selected layer's texture and fit its color slots to the emblem's. */
function pickEmblem(entry: DesignerEntry): void {
  const layer = selectedLayer();
  if (!layer || layer.kind !== "colored_emblem") return;
  layer.texture = entry.file;
  layer.colors.length = Math.min(layer.colors.length, entry.colors);
  while (layer.colors.length < entry.colors) {
    const name = COLOR_SLOTS[layer.colors.length];
    const from = layer.colors[0] ?? flag.colors[1] ?? flag.colors[0];
    layer.colors.push(from ? { ...from, name } : { name, kind: "named", value: "white" });
  }
  refresh();
}

function categoryLabel(id: string): string {
  // COA_DESIGNER_CATEGORY_<id> in coa_designer_l_english.yml.
  const LABELS: Record<string, string> = {
    abstract: "Abstract",
    animals: "Animals",
    circles_spirals: "Circles and Spirals",
    crosses_and_knots: "Crosses and Knots",
    faiths: "Faiths",
    manmade: "Man-Made",
    nature: "Nature",
    patterns: "Patterns",
    tribal_seal: "Tribal Seals",
    writing: "Writing",
    figures: "Figures",
    kamon: "Kamon",
    chinese_seal: "Chinese Seals",
  };
  return LABELS[id] ?? id.replace(/_/g, " ");
}

/** The instances of a layer, four per row as the game lists them. */
function instanceGrid(layer: EmblemLayer): HTMLElement {
  const grid = el("div", "instances");
  const count = Math.max(1, layer.instances.length);
  for (let i = 0; i < count; i++) {
    const tile = el("div", "instTile", String(i + 1));
    tile.dataset.tip = "Click to edit, right-click to remove";
    if (i === instIndex) tile.setAttribute("aria-selected", "true");
    tile.onclick = () => {
      instIndex = i;
      picked = { layer: layerIndex, instance: i };
      refresh(false);
      draw();
    };
    tile.oncontextmenu = (e) => {
      e.preventDefault();
      if (layer.instances.length <= 1) return;
      layer.instances.splice(i, 1);
      instIndex = 0;
      picked = null;
      refresh();
    };
    grid.append(tile);
  }
  const add = el("div", "instTile", "+");
  add.dataset.tip = "Add Emblem";
  add.onclick = () => {
    materialize(layer);
    const from = layer.instances[instIndex] ?? DEFAULT_INSTANCE;
    layer.instances.push({
      rotation: from.rotation,
      scale: [from.scale[0], from.scale[1]],
      position: [Math.min(1, from.position[0] + 0.1), Math.min(1, from.position[1] + 0.1)],
    });
    instIndex = layer.instances.length - 1;
    refresh();
  };
  grid.append(add);
  return grid;
}

/** An implicit default instance becomes a real one before anything edits it. */
function materialize(layer: CoaLayer): void {
  if (layer.instances.length) return;
  if (layer.kind === "sub") layer.instances.push({ offset: [0, 0], scale: [1, 1] });
  else layer.instances.push({ ...DEFAULT_INSTANCE, scale: [1, 1], position: [0.5, 0.5] });
}

/** Whether the two axes of the selected instance are kept equal. */
const matchScale = new Set<string>();

function detailEdit(layer: EmblemLayer): HTMLElement {
  const body = el("div", "detail");
  materialize(layer);
  const inst = layer.instances[Math.min(instIndex, layer.instances.length - 1)] as CoaInstance;
  const matchKey = `${layerIndex}:${instIndex}`;
  const matched = matchScale.has(matchKey);

  const position = el("div", "pair");
  position.append(
    field(
      "Position X",
      numberInput(inst.position[0], 0.01, (v) => {
        inst.position[0] = v;
        draw();
      })
    ),
    field(
      "Position Y",
      numberInput(inst.position[1], 0.01, (v) => {
        inst.position[1] = v;
        draw();
      })
    )
  );

  const scale = el("div", "pair");
  const scaleY = numberInput(inst.scale[1], 0.01, (v) => {
    inst.scale[1] = v;
    if (matchScale.has(matchKey)) inst.scale[0] = Math.sign(inst.scale[0] || 1) * Math.abs(v);
    draw();
    if (matchScale.has(matchKey)) renderPanel();
  });
  const scaleX = numberInput(inst.scale[0], 0.01, (v) => {
    inst.scale[0] = v;
    if (matchScale.has(matchKey)) {
      inst.scale[1] = Math.sign(inst.scale[1] || 1) * Math.abs(v);
      scaleY.value = String(inst.scale[1]);
    }
    draw();
  });
  scale.append(field(matched ? "Scale" : "Scale X", scaleX), field(matched ? "Scale" : "Scale Y", scaleY));

  const rest = el("div", "pair");
  rest.append(
    field(
      "Rotation",
      numberInput(inst.rotation, 1, (v) => {
        inst.rotation = v;
        draw();
      })
    ),
    field(
      "Depth",
      numberInput(inst.depth ?? 0, 0.01, (v) => {
        // 0 is what an instance with no `depth` means, so writing 0 drops the key.
        if (v === 0) delete inst.depth;
        else inst.depth = v;
      })
    )
  );

  const checks = el("div", "checks");
  checks.append(
    checkbox("Match X and Y scale", matched, (on) => {
      if (on) {
        matchScale.add(matchKey);
        inst.scale[0] = Math.sign(inst.scale[0] || 1) * Math.abs(inst.scale[1]);
      } else matchScale.delete(matchKey);
      refresh();
    }),
    // A flip is a negative scale on that axis; the game's own checkbox writes
    // exactly that (`scale = { -0.61 0.61 }` in 01_landed_titles.txt).
    checkbox("Flip X Axis", inst.scale[0] < 0, (on) => {
      inst.scale[0] = (on ? -1 : 1) * Math.abs(inst.scale[0]);
      refresh();
    }),
    checkbox("Flip Y Axis", inst.scale[1] < 0, (on) => {
      inst.scale[1] = (on ? -1 : 1) * Math.abs(inst.scale[1]);
      refresh();
    })
  );

  body.append(position, scale, rest, checks);
  return body;
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

function renderPanel(): void {
  // Adjusted mode keeps the opened design's structure, so a whole new layout
  // is not on offer there; the Background tab carries the way back to custom.
  if (mode === "adjusted" && tab === "layout") tab = "background";
  for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>(".px-tab"))) {
    const on = btn.dataset.tab === tab;
    btn.setAttribute("aria-selected", String(on));
    if (btn.dataset.tab === "layout") {
      btn.disabled = mode === "adjusted";
      btn.dataset.tip = btn.disabled ? "Layouts need Customize Design (Background tab)" : "";
    }
  }
  for (const [id, name] of [
    ["tabBackground", "background"],
    ["tabLayout", "layout"],
    ["tabEmblems", "emblems"],
  ] as const) {
    if (name === tab) $(id).setAttribute("data-active", "");
    else $(id).removeAttribute("data-active");
  }
  if (tab === "background") renderBackground();
  else if (tab === "layout") renderLayout();
  else renderEmblems();
}

function refresh(record = true): void {
  clampSelection();
  renderPanel();
  draw();
  updateOrigin();
  if (record) commit();
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

function setFlag(next: CoaFlag): void {
  flag = JSON.parse(JSON.stringify(next));
  $<HTMLInputElement>("name").value = flag.name;
  layerIndex = emblemLayers()[0]?.index ?? -1;
  instIndex = 0;
  picked = null;
  matchScale.clear();
  emblemCategory = "";
  resetHistory();
}

/** "Start From Scratch": the game's own `coa_designer_blank_default`. */
function startFromScratch(): void {
  const template = designer()?.template;
  const name = target?.name ?? flag.name;
  setFlag(
    template
      ? { ...JSON.parse(JSON.stringify(template)), name }
      : { name, pattern: "", colors: [], layers: [] }
  );
  mode = "custom";
  opened = null;
  tab = "background";
  refresh(false);
}

function updateOrigin(): void {
  const label = target?.label ? `for ${target.label}` : "";
  const from = opened ? `from ${opened.source}` : "";
  $("target").textContent = [label, from].filter(Boolean).join(" · ");
}

function randomPick<T>(items: readonly T[]): T | undefined {
  return items.length ? items[Math.floor(Math.random() * items.length)] : undefined;
}

/** "Randomize": a visible pattern, palette colors, one emblem in one layout. */
function randomize(): void {
  const cat = designer();
  if (!cat) return;
  const pattern = randomPick(cat.patterns);
  const emblem = randomPick(cat.emblems.filter((e) => e.colors > 0));
  const layout = randomPick(cat.layouts);
  if (!pattern || !layout) return;
  const color = (name: string): CoaColor => ({
    name,
    kind: "named",
    value: randomPick(cat.palette)?.name ?? "white",
  });
  flag.pattern = pattern.file;
  flag.colors = COLOR_SLOTS.slice(0, Math.max(pattern.colors, 3)).map(color);
  flag.layers = substituteLayout(layout.flag, cat.layoutDefaults).layers;
  for (const layer of flag.layers) {
    if (layer.kind !== "colored_emblem" || !emblem) continue;
    layer.texture = emblem.file;
    layer.colors = COLOR_SLOTS.slice(0, emblem.colors).map(color);
  }
  mode = "custom";
  layerIndex = emblemLayers()[0]?.index ?? -1;
  instIndex = 0;
  picked = null;
  refresh();
}

function applyTarget(next: FlagTarget): void {
  target = next;
  if (!db) return;
  const action = targetAction(next.name, db.flags);
  if (action.kind === "new") {
    flag.name = next.name;
    $<HTMLInputElement>("name").value = next.name;
    resetHistory();
    updateOrigin();
    return;
  }
  const definition = db.definitions[action.entry.name];
  if (!definition) return;
  opened = action.entry;
  setFlag(definition);
  mode = "adjusted";
  refresh(false);
}

// ---------------------------------------------------------------------------
// Side panel, mod picker and frame
// ---------------------------------------------------------------------------

let uiState: DesignerUiState = { panelWidth: 360, panelCollapsed: false };
const panel = sidePanel($("side"), {
  width: uiState.panelWidth,
  onChange: (state) => {
    uiState = { ...uiState, ...state };
    send({ type: "uiState", state: uiState });
    updateToggle();
  },
});

function updateToggle(): void {
  const btn = $("togglePanel");
  btn.replaceChildren(iconEl(panel.collapsed ? "panelRightOpen" : "panelRightClose"));
  btn.dataset.tip = panel.collapsed ? "Show the panel" : "Hide the panel";
}

function saveTarget(): ModTarget | undefined {
  return mods.find((m) => m.path === uiState.savePath) ?? mods[0];
}

const MOD_PATH_CHARS = 62;

function updateModPicker(): void {
  const btn = $("mod");
  const target = saveTarget();
  btn.querySelector(".px-truncate")!.textContent = target ? target.label : "No mod";
  btn.dataset.tip = target ? `Saves into ${target.path}` : "Open a mod folder to save arms into it";
  (btn as HTMLButtonElement).disabled = mods.length === 0;
}

function openModMenu(): void {
  menu(
    $("mod"),
    mods.map((m) => ({
      value: m.path,
      label: m.label,
      description: middleEllipsis(m.path, MOD_PATH_CHARS),
    })),
    {
      value: saveTarget()?.path,
      width: 420,
      onPick: (value) => {
        uiState = { ...uiState, savePath: value };
        send({ type: "uiState", state: uiState });
        updateModPicker();
      },
    }
  );
}

function updateFramePicker(): void {
  const cat = designer();
  const label = frameId ? (cat?.frames.find((f) => f.id === frameId)?.label ?? frameId) : "No frame";
  $("frame").querySelector(".px-truncate")!.textContent = label;
}

function openFrameMenu(): void {
  const cat = designer();
  if (!cat) return;
  menu(
    $("frame"),
    [{ value: "", label: "No frame" }, ...cat.frames.map((f) => ({ value: f.id, label: f.label }))],
    {
      value: frameId,
      width: 220,
      onPick: (value) => {
        frameId = value;
        uiState = { ...uiState, frame: value };
        send({ type: "uiState", state: uiState });
        updateFramePicker();
        draw();
      },
    }
  );
}

/**
 * The frame a save target implies, so the preview matches where the arms will
 * show: a dynasty gets the dynasty frame, a house or a character the house one
 * (a character's arms are keyed by their house), anything else the title one.
 * The only signal a target carries is its label, which target.ts builds as
 * `<name> (<kind>)`.
 */
function defaultFrame(label: string | undefined): string {
  const kind = /\(([^)]+)\)\s*$/.exec(label ?? "")?.[1] ?? "";
  const wanted =
    kind === "dynasty" ? "dynasty" : kind === "house" || kind === "character" ? "house" : "title";
  return designer()?.frames.some((f) => f.id === wanted) ? wanted : "";
}

// ---------------------------------------------------------------------------
// Stage view
// ---------------------------------------------------------------------------

const stage = $("stage");
const viewport = $("viewport");
const view = { x: 0, y: 0, scale: 1 };

function applyView(): void {
  viewport.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  $("zoom").textContent = `${Math.round(view.scale * 100)}%`;
  draw();
}

$("recenter").onclick = () => {
  view.x = view.y = 0;
  view.scale = 1;
  applyView();
};
stage.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const next = Math.max(0.1, Math.min(16, view.scale * Math.exp(-e.deltaY * 0.0015)));
    view.x = px - ((px - view.x) * next) / view.scale;
    view.y = py - ((py - view.y) * next) / view.scale;
    view.scale = next;
    applyView();
  },
  { passive: false }
);
stage.addEventListener("pointerdown", (down) => {
  if (down.target instanceof Element && down.target.closest("#stageTools, #stageInfo")) return;
  if (down.button !== 1) return;
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

// ---------------------------------------------------------------------------
// Direct manipulation on the canvas (elements.ts)
// ---------------------------------------------------------------------------

function unitAt(e: PointerEvent): [number, number] {
  const r = canvas.getBoundingClientRect();
  return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
}

function handleTolerance(): [number, number] {
  const r = canvas.getBoundingClientRect();
  return [HANDLE_SIZE / 2 / r.width, HANDLE_SIZE / 2 / r.height];
}

function cornerUnder(u: number, v: number): Corner | null {
  const layer = picked ? flag.layers[picked.layer] : null;
  if (!layer) return null;
  const [tu, tv] = handleTolerance();
  return cornerAt(boxOf(layer, picked!.instance), u, v, tu, tv);
}

interface Gesture {
  ref: ElementRef;
  corner: Corner | null;
  grabU: number;
  grabV: number;
  startX: number;
  startY: number;
  started: boolean;
}

let gesture: Gesture | null = null;

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  const [u, v] = unitAt(e);
  const corner = cornerUnder(u, v);
  const ref = corner ? picked! : hitElement(flag.layers, u, v);
  if (!ref) {
    picked = null;
    draw();
    return;
  }
  e.preventDefault();
  if (!corner) {
    picked = ref;
    layerIndex = ref.layer;
    instIndex = ref.instance;
    tab = "emblems";
    renderPanel();
  }
  const box = boxOf(flag.layers[ref.layer], ref.instance);
  gesture = {
    ref,
    corner,
    grabU: u - box.cx,
    grabV: v - box.cy,
    startX: e.clientX,
    startY: e.clientY,
    started: false,
  };
  canvas.setPointerCapture(e.pointerId);
  draw();
});

canvas.addEventListener("pointermove", (e) => {
  const [u, v] = unitAt(e);
  if (!gesture) {
    const corner = cornerUnder(u, v);
    canvas.style.cursor = corner ? cornerCursor(corner) : hitElement(flag.layers, u, v) ? "move" : "";
    return;
  }
  if (!gesture.started) {
    if (Math.hypot(e.clientX - gesture.startX, e.clientY - gesture.startY) < DRAG_THRESHOLD) return;
    gesture.started = true;
    materialize(flag.layers[gesture.ref.layer]);
  }
  const layer = flag.layers[gesture.ref.layer];
  const box = boxOf(layer, gesture.ref.instance);
  const next = gesture.corner
    ? resizeBox(box, gesture.corner, u, v)
    : moveBox(box, u - gesture.grabU - box.cx, v - gesture.grabV - box.cy);
  writeBox(layer, gesture.ref.instance, next);
  renderPanel();
  draw();
});

const endGesture = (e: PointerEvent): void => {
  if (!gesture) return;
  const moved = gesture.started;
  gesture = null;
  canvas.releasePointerCapture(e.pointerId);
  if (moved) commit();
};
canvas.addEventListener("pointerup", endGesture);
canvas.addEventListener("pointercancel", endGesture);

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

for (const btn of Array.from(document.querySelectorAll<HTMLElement>(".px-tab"))) {
  btn.onclick = () => {
    tab = (btn.dataset.tab as DesignerTab) ?? "background";
    uiState = { ...uiState, tab };
    send({ type: "uiState", state: uiState });
    renderPanel();
  };
}

$("new").onclick = async () => {
  if (await confirmDiscard("Starting from scratch")) startFromScratch();
};
$("open").onclick = async () => {
  if (!db) return;
  if (await confirmDiscard("Opening a design")) send({ type: "open" });
};
$("paste").onclick = () => send({ type: "paste" });
$("copy").onclick = () => send({ type: "copy", text: writeFlag(flag) });
$("random").onclick = randomize;
$("undo").onclick = undo;
$("redo").onclick = redo;
$("mod").onclick = openModMenu;
$("frame").onclick = openFrameMenu;
$("togglePanel").onclick = () => panel.toggle();
$("addEmblem").onclick = () => {
  const cat = designer();
  const empty = cat?.emptyEmblem;
  const start = cat?.emblems.find((e) => e.colors > 0);
  const texture = start?.file ?? empty ?? "";
  const slots = start?.colors ?? 1;
  flag.layers.push({
    kind: "colored_emblem",
    texture,
    mask: 0,
    colors: COLOR_SLOTS.slice(0, slots).map((name) => ({
      name,
      kind: "named",
      value: flag.colors[1]?.kind === "named" ? flag.colors[1].value : "white",
    })),
    instances: [{ ...DEFAULT_INSTANCE, scale: [0.7, 0.7] }],
  });
  layerIndex = flag.layers.length - 1;
  instIndex = 0;
  tab = "emblems";
  refresh();
};
$("save").onclick = () => {
  const target = saveTarget();
  if (!target) return;
  if (!flag.name.trim()) {
    toast("Give the arms a name first.", "destructive");
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
$("png").onclick = () => {
  draw(false);
  const dataUrl = canvas.toDataURL("image/png");
  draw();
  send({ type: "exportPng", name: flag.name, dataUrl });
};

/**
 * What "Adjust Existing Design" lands on. The picking itself is the host's
 * QuickPick (messages.ts `open`): the list is every definition the game and the
 * mods ship, thousands of rows, which is a size VS Code's picker handles and an
 * in-page list does not.
 */
function openDefinition(entry: FlagEntry, definition: CoaFlag): void {
  opened = entry;
  setFlag(definition);
  mode = "adjusted";
  tab = "background";
  refresh(false);
}

const nameInput = $<HTMLInputElement>("name");
nameInput.oninput = () => {
  flag.name = nameInput.value.replace(/[^\w.-]/g, "_");
};
nameInput.onchange = commit;

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && picked) {
    picked = null;
    draw();
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

$("help").onclick = () =>
  helpDialog({
    title: "Coat of Arms Designer",
    intro:
      "The game's own Coat of Arms designer, over your mod's files. Everything it offers is read from the game: the patterns, the palette, the layouts and the 1500-odd emblems. Save writes a real coat_of_arms definition into your mod.",
    sections: [
      {
        title: "Starting",
        items: [
          {
            lead: "Start From Scratch",
            text: "gives you the game's blank template: a solid pattern and one emblem.",
          },
          {
            lead: "Adjust Existing Design",
            text: "opens any coat of arms the game or a mod ships. Its structure stays put and you change colors and placement; Customize Design unlocks the rest.",
          },
          { lead: "Paste from Clipboard", text: "reads a definition straight out of the clipboard." },
          { lead: "Randomize", text: "rolls a pattern, palette colors, a layout and an emblem." },
        ],
      },
      {
        title: "The three tabs",
        items: [
          {
            lead: "Background",
            text: "picks the pattern and its colors. How many color buttons you get is what the pattern declares.",
          },
          {
            lead: "Layout",
            text: "places your emblems in one of the game's arrangements: the pattern and colors stay, the emblems move.",
          },
          {
            lead: "Emblems",
            text: "picks the shape by category, its colors, and where each copy of it sits. Drag the rows to change which emblem is drawn on top.",
          },
        ],
      },
      {
        title: "Placement",
        items: [
          {
            lead: "On the canvas:",
            text: "click an emblem to select it, drag to move it, drag a corner to resize it.",
          },
          {
            lead: "By numbers:",
            text: "position and scale are fractions of the arms, rotation is degrees. Drag any number sideways to scrub it.",
          },
          { lead: "Flip X or Y", text: "mirrors the emblem, which the game writes as a negative scale." },
          {
            lead: "Depth",
            text: "is the z value the in-game designer writes. It is kept so a design round-trips; the preview draws in row order.",
          },
        ],
      },
      {
        title: "Preview and saving",
        items: [
          {
            lead: "The frame",
            text: "at the bottom left shows the arms the way the game frames a dynasty, a house or a title. It is preview only and never written.",
          },
          { lead: "Pick the mod", text: "in the toolbar; Save writes into that mod's coat_of_arms folder." },
          { lead: "Saving under a vanilla key", text: "overrides those arms; a new key adds new arms." },
        ],
      },
      {
        title: "Keyboard",
        shortcuts: [
          { keys: ["Esc"], does: "Deselect the emblem" },
          { keys: ["Ctrl", "Z"], does: "Undo" },
          { keys: ["Ctrl", "Y"], does: "Redo (Ctrl+Shift+Z too)" },
        ],
      },
    ],
  });

window.addEventListener("message", (event: MessageEvent<HostToApp>) => {
  const m = event.data;
  switch (m.type) {
    case "init": {
      const first = db === null;
      db = m.db;
      mods = m.mods;
      const cat = m.db.designer;
      $("info").dataset.tip =
        `${db.gameName}: ${db.flags.length} coats of arms` +
        (cat
          ? `, ${cat.patterns.length} patterns, ${cat.emblems.length} emblems in ${cat.categories.length} categories, ${cat.layouts.length} layouts`
          : "") +
        (db.gameMissing ? "\nGame folder not found: set px.gamePath." : "");
      images.clear();
      thumbs.clear();
      clearRenderCaches();
      if (first) {
        if (m.ui) {
          uiState = m.ui;
          panel.setWidth(m.ui.panelWidth);
          panel.toggle(m.ui.panelCollapsed);
          if (m.ui.tab) tab = m.ui.tab;
          frameId = m.ui.frame ?? "";
        }
        updateToggle();
        startFromScratch();
      }
      // A remembered frame wins; otherwise the target says what these arms are.
      if (m.ui?.frame === undefined) frameId = defaultFrame(m.target?.label);
      updateModPicker();
      updateFramePicker();
      applyView();
      if (m.target) applyTarget(m.target);
      else refresh(false);
      return;
    }
    case "textures":
      receiveTextures(m.urls, m.thumbs);
      return;
    case "opened":
      openDefinition(m.entry, m.flag);
      return;
    case "pasted":
      void (async () => {
        if (!(await confirmDiscard(`Pasting ${m.flag.name}`))) return;
        opened = null;
        setFlag(m.flag);
        mode = "custom";
        refresh(false);
        toast(`Pasted ${m.flag.name}.`);
      })();
      return;
    case "toast":
      toast(m.message);
      return;
  }
});

send({ type: "ready" });
