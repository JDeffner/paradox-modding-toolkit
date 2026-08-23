/**
 * The Flag Builder app: one flag under edit, drawn by render.ts, edited
 * through the layer list and the inspector (a resizable, collapsible side
 * panel), with a browser overlay for the game's textures and flags. Built
 * from the shared px-ui classes; talks to the host only through messages.ts.
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
import type { AppToHost, FlagDatabase, HostToApp, TextureKind, UiState } from "../messages";
import { iconEl, type IconName } from "../../shared/icons";
import { sidePanel } from "../../shared/sidePanel";
import { toast } from "../../shared/overlay";
import { clearRenderCaches, previewThumb, renderFlag, textureKeys } from "./render";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();
const send = (m: AppToHost): void => vscode.postMessage(m);
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let db: FlagDatabase | null = null;
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
      continue;
    }
    const img = new Image();
    img.onload = () => {
      store.set(key, img);
      if (thumb) paintThumbs();
      else draw();
    };
    img.onerror = () => store.set(key, null);
    img.src = url;
  }
  if (!thumb) draw();
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

function select(
  options: [string, string][],
  value: string,
  onChange: (v: string) => void,
  small = true
): HTMLSelectElement {
  const s = document.createElement("select");
  s.className = "px-select";
  if (small) s.dataset.size = "sm";
  for (const [v, label] of options) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = label;
    o.selected = v === value;
    s.append(o);
  }
  s.onchange = () => onChange(s.value);
  return s;
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
  return i;
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

function hexRgb(hex: string): Rgb {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
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
    row.onclick = () => select_(r.index);
    if (r.index >= 0) {
      const i = r.index;
      row.append(
        el(
          "span",
          "px-item-tools",
          button("", () => moveLayer(i, -1), { icon: "arrowUp", size: "icon-xs", tip: "Draw earlier" }),
          button("", () => moveLayer(i, 1), { icon: "arrowDown", size: "icon-xs", tip: "Draw later" }),
          button(
            "",
            () => {
              flag.layers.splice(i, 1);
              select_(Math.min(selected, flag.layers.length - 1));
            },
            { icon: "x", size: "icon-xs", tip: "Remove layer" }
          )
        )
      );
    }
    list.append(row);
  }
}

function moveLayer(i: number, dir: -1 | 1): void {
  const j = i + dir;
  if (j < 0 || j >= flag.layers.length) return;
  [flag.layers[i], flag.layers[j]] = [flag.layers[j], flag.layers[i]];
  select_(j);
}

function select_(index: number): void {
  selected = index;
  refresh();
}

function refresh(): void {
  renderLayers();
  renderInspector();
  draw();
}

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

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
    const kind = select(
      [
        ["named", "named"],
        ["rgb", "rgb"],
        ["hsv360", "hsv360"],
        ["ref", "same as"],
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
      }
    );

    const value = el("div", "px-row");
    value.style.minWidth = "0";
    if (color.kind === "named") {
      const names = Object.keys(db!.namedColors).sort();
      if (!names.includes(color.value)) names.unshift(color.value);
      const s = select(
        names.map((n) => [n, n]),
        color.value,
        (v) => {
          color.value = v;
          refresh();
        }
      );
      s.style.width = "100%";
      value.append(s);
    } else if (color.kind === "rgb") {
      const c = document.createElement("input");
      c.type = "color";
      c.value = rgbHex(color.value);
      c.style.cssText = "width:28px;height:24px;padding:0;border:none;background:none;cursor:pointer";
      const text = el("span", "px-muted px-xs px-mono", `rgb { ${color.value.join(" ")} }`);
      c.oninput = () => {
        color.value = hexRgb(c.value);
        sw.style.setProperty("--px-swatch", c.value);
        text.textContent = `rgb { ${color.value.join(" ")} }`;
        draw();
      };
      value.append(c, text);
    } else if (color.kind === "hsv360") {
      const v = color.value;
      value.append(
        numberInput(v[0], 1, (x) => (v[0] = x)),
        numberInput(v[1], 1, (x) => (v[1] = x)),
        numberInput(v[2], 1, (x) => (v[2] = x))
      );
    } else {
      const bases = flag.colors.filter((b) => !(colors === flag.colors && b.name === color.name));
      value.append(
        select(
          bases.map((b) => [b.name, b.name]),
          color.value,
          (v) => {
            color.value = v;
            refresh();
          }
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
  }
  return wrap;
}

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
  const tag = (t: string): HTMLSpanElement => el("span", "px-muted px-xs", t);
  const instances: { scale: [number, number] }[] = layer.instances;
  instances.forEach((inst, i) => {
    const row = el("div", "inst");
    if (layer.kind === "sub") {
      const o = layer.instances[i].offset;
      row.append(
        tag("offset"),
        numberInput(o[0], 0.01, (v) => (o[0] = v)),
        numberInput(o[1], 0.01, (v) => (o[1] = v))
      );
    } else {
      const it = layer.instances[i];
      row.append(
        tag("rot"),
        numberInput(it.rotation, 1, (v) => (it.rotation = v)),
        tag("pos"),
        numberInput(it.position[0], 0.01, (v) => (it.position[0] = v)),
        numberInput(it.position[1], 0.01, (v) => (it.position[1] = v))
      );
    }
    row.append(
      tag("scale"),
      numberInput(inst.scale[0], 0.01, (v) => (inst.scale[0] = v)),
      numberInput(inst.scale[1], 0.01, (v) => (inst.scale[1] = v)),
      button(
        "",
        () => {
          layer.instances.splice(i, 1);
          refresh();
        },
        { icon: "x", size: "icon-xs", tip: "Remove instance" }
      )
    );
    wrap.append(row);
  });
  return wrap;
}

/** An outline button that reads as a picker: current value left, chevron right. */
function pickButton(current: string, placeholder: string, onClick: () => void): HTMLButtonElement {
  const b = button("", onClick, { variant: "outline" });
  b.style.cssText = "width:100%;justify-content:space-between";
  const label = el("span", "px-truncate", current || placeholder);
  if (!current) label.classList.add("px-muted");
  b.append(label, iconEl("chevronDown"));
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
    const mask = select(
      [
        ["0", "none"],
        ["1", "pattern color1"],
        ["2", "pattern color2"],
        ["3", "pattern color3"],
      ],
      String(layer.mask),
      (v) => {
        layer.mask = Number(v);
        draw();
      },
      false
    );
    mask.style.width = "100%";
    box.append(field("Mask", mask), colorEditor(layer.colors, "Emblem colors"));
  }
  box.append(instanceEditor(layer));
}

// ---------------------------------------------------------------------------
// Browser overlay
// ---------------------------------------------------------------------------

type BrowserMode = TextureKind | "flags" | "parent";
let browserMode: BrowserMode = "patterns";
const tileCanvases = new Map<string, HTMLCanvasElement>();
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
  tileCanvases.clear();
}

function fillBrowser(): void {
  if (!db) return;
  const body = $("browserBody");
  body.replaceChildren();
  observer?.disconnect();
  tileCanvases.clear();
  const q = $<HTMLInputElement>("browserSearch").value.trim().toLowerCase();
  if (browserMode === "flags" || browserMode === "parent") {
    const matches = db.flags.filter(
      (f) => !q || f.name.toLowerCase().includes(q) || f.file.toLowerCase().includes(q)
    );
    const list = el("div", "px-list");
    for (const entry of matches.slice(0, 500)) {
      const row = el(
        "div",
        "px-item flagrow",
        el("span", "px-item-label", entry.name),
        el("span", "px-item-kind", `${entry.source} · ${entry.file}`)
      );
      row.onclick = () => {
        if (browserMode === "parent") {
          const layer = flag.layers[selected];
          if (layer?.kind === "sub") layer.parent = entry.name;
        } else {
          loadFlag(entry.name);
        }
        closeBrowser();
        refresh();
      };
      list.append(row);
    }
    body.append(list);
    if (matches.length > 500)
      body.append(el("div", "px-muted px-sm", `… ${matches.length - 500} more, narrow the search`));
    return;
  }
  const kind = browserMode;
  const grid = el("div");
  grid.id = "grid";
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) request((e.target as HTMLElement).dataset.key!, true);
    }
    paintThumbs();
  });
  const matches = db.textures[kind].filter((t) => !q || t.toLowerCase().includes(q));
  for (const file of matches.slice(0, 600)) {
    const key = `${kind}/${file}`;
    const c = document.createElement("canvas");
    c.width = 108;
    c.height = 72;
    const name = el("div", "name", file);
    name.title = file;
    const tile = el("div", "tile", c, name);
    tile.dataset.key = key;
    tile.onclick = () => {
      if (kind === "patterns") flag.pattern = file;
      else {
        const layer = flag.layers[selected];
        if (layer && layer.kind !== "sub") layer.texture = file;
      }
      closeBrowser();
      refresh();
    };
    tileCanvases.set(key, c);
    grid.append(tile);
    observer.observe(tile);
  }
  body.append(grid);
  if (matches.length > 600)
    body.append(el("div", "px-muted px-sm", `… ${matches.length - 600} more, narrow the search`));
  paintThumbs();
}

function paintThumbs(): void {
  for (const [key, c] of tileCanvases) {
    if (c.dataset.done) continue;
    const img = thumbs.get(key);
    if (img === undefined) continue;
    c.dataset.done = "1";
    const ctx = c.getContext("2d")!;
    if (!img) {
      ctx.fillStyle = "#a33";
      ctx.fillText("cannot decode", 20, 40);
      continue;
    }
    const src = previewThumb(`thumb:${key}`, img, key.slice(0, key.indexOf("/")));
    const scale = Math.min(c.width / img.naturalWidth, c.height / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    ctx.drawImage(src, (c.width - w) / 2, (c.height - h) / 2, w, h);
  }
}

// ---------------------------------------------------------------------------
// Flags in and out
// ---------------------------------------------------------------------------

function loadFlag(name: string): void {
  const def = db?.definitions[name];
  if (!def) return;
  flag = JSON.parse(JSON.stringify(def));
  $<HTMLInputElement>("name").value = flag.name;
  selected = -1;
}

function newFlag(): void {
  const patterns = db?.textures.patterns ?? [];
  const pattern = patterns.find((p) => p.startsWith("pattern_solid")) ?? patterns[0] ?? "";
  const named = Object.keys(db?.namedColors ?? {});
  flag = {
    name: "new_flag",
    pattern,
    colors: named.length
      ? [{ name: "color1", kind: "named", value: named.includes("red") ? "red" : named[0] }]
      : [],
    layers: [],
  };
  $<HTMLInputElement>("name").value = flag.name;
  selected = -1;
  refresh();
}

// ---------------------------------------------------------------------------
// Side panel
// ---------------------------------------------------------------------------

let uiState: UiState = { panelWidth: 340, panelCollapsed: false };
const panel = sidePanel($("side"), {
  width: uiState.panelWidth,
  collapsed: uiState.panelCollapsed,
  onChange: (s) => {
    uiState = { panelWidth: s.width, panelCollapsed: s.collapsed };
    updateToggle();
    send({ type: "uiState", state: uiState });
  },
});

function updateToggle(): void {
  const b = $("togglePanel");
  b.replaceChildren(iconEl(panel.collapsed ? "panelRightOpen" : "panelRightClose"));
  b.dataset.tip = panel.collapsed ? "Show inspector" : "Hide inspector";
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

$("new").onclick = newFlag;
$("open").onclick = () => openBrowser("flags");
$("copy").onclick = () => send({ type: "copy", text: writeFlag(flag) });
$("save").onclick = () => {
  if (!flag.name.trim()) {
    toast("Give the flag a name first.", "destructive");
    return;
  }
  send({ type: "save", name: flag.name.trim(), script: writeFlag(flag) });
};
$("png").onclick = () => send({ type: "exportPng", name: flag.name, dataUrl: canvas.toDataURL("image/png") });
$("togglePanel").onclick = () => panel.toggle();
$<HTMLInputElement>("name").oninput = (e) => {
  flag.name = (e.target as HTMLInputElement).value.replace(/[^\w.-]/g, "_");
};
$("browserClose").onclick = closeBrowser;
$<HTMLInputElement>("browserSearch").oninput = fillBrowser;
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && $("browser").classList.contains("open")) closeBrowser();
});
for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-add]"))) {
  b.onclick = () => {
    const kind = b.dataset.add as CoaLayer["kind"];
    const layer: CoaLayer =
      kind === "sub"
        ? { kind, parent: "", instances: [] }
        : kind === "colored_emblem"
          ? { kind, texture: "", mask: 0, colors: [], instances: [] }
          : { kind, texture: "", instances: [] };
    flag.layers.push(layer);
    select_(flag.layers.length - 1);
    if (kind === "sub") openBrowser("parent");
    else openBrowser(kind === "colored_emblem" ? "colored_emblems" : "textured_emblems");
  };
}

window.addEventListener("message", (event: MessageEvent<HostToApp>) => {
  const m = event.data;
  switch (m.type) {
    case "init": {
      const first = db === null;
      db = m.db;
      const save = $<HTMLButtonElement>("save");
      save.disabled = !m.canSave;
      save.dataset.tip = m.canSave
        ? "Write the flag into the mod's coat_of_arms folder"
        : "No mod in the workspace to save into";
      const t = db.textures;
      $("status").textContent =
        `${db.gameName} · ${db.flags.length} flags · ${t.patterns.length} patterns · ` +
        `${t.colored_emblems.length} colored · ${t.textured_emblems.length} textured emblems` +
        (db.gameMissing ? " · game folder not found (set px.gamePath)" : "");
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
      } else refresh();
      return;
    }
    case "textures":
      receiveTextures(m.urls, m.thumbs);
      return;
    case "toast":
      toast(m.message);
      return;
  }
});

send({ type: "ready" });
