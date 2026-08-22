/**
 * The Flag Builder app: one flag under edit, drawn by render.ts, edited
 * through the layer list and the inspector, with a browser overlay for the
 * game's textures and flags. Talks to the host only through messages.ts.
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
import type { AppToHost, FlagDatabase, HostToApp, TextureKind } from "../messages";
import { clearRenderCaches, previewThumb, renderFlag, textureKeys } from "./render";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();
const send = (m: AppToHost): void => vscode.postMessage(m);
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let db: FlagDatabase | null = null;
let canSave = false;
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

function button(text: string, title: string, onClick: () => void, cls = "icon"): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = cls;
  b.textContent = text;
  b.title = title;
  b.onclick = (e) => {
    e.stopPropagation();
    onClick();
  };
  return b;
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
    const row = document.createElement("div");
    row.className = "row" + (r.index === selected ? " selected" : "");
    row.innerHTML = `<span class="kind"></span><span class="label"></span>`;
    row.querySelector(".kind")!.textContent = r.kind;
    row.querySelector(".label")!.textContent = r.label;
    row.onclick = () => select(r.index);
    if (r.index >= 0) {
      const i = r.index;
      const tools = document.createElement("span");
      tools.className = "tools";
      tools.append(
        button("▲", "Move down in draw order (drawn earlier)", () => moveLayer(i, -1)),
        button("▼", "Move up in draw order (drawn later)", () => moveLayer(i, 1)),
        button("✕", "Remove layer", () => {
          flag.layers.splice(i, 1);
          select(Math.min(selected, flag.layers.length - 1));
        })
      );
      row.append(tools);
    }
    list.append(row);
  }
}

function moveLayer(i: number, dir: -1 | 1): void {
  const j = i + dir;
  if (j < 0 || j >= flag.layers.length) return;
  [flag.layers[i], flag.layers[j]] = [flag.layers[j], flag.layers[i]];
  select(j);
}

function select(index: number): void {
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

function field(label: string, ...value: (HTMLElement | string)[]): HTMLElement {
  const f = document.createElement("div");
  f.className = "field";
  const l = document.createElement("label");
  l.textContent = label;
  const v = document.createElement("div");
  v.className = "value";
  v.append(...value);
  f.append(l, v);
  return f;
}

function numberInput(value: number, step: number, onChange: (v: number) => void): HTMLInputElement {
  const i = document.createElement("input");
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

function colorEditor(colors: CoaColor[], title: string): HTMLElement {
  const wrap = document.createElement("div");
  const head = document.createElement("div");
  head.className = "subhead";
  head.textContent = title;
  const free = COLOR_SLOTS.find((s) => !colors.some((c) => c.name === s));
  const add = button(
    "+ Add color",
    "Add the next color slot",
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
    ""
  );
  add.disabled = !free;
  head.append(add);
  wrap.append(head);

  const table = document.createElement("table");
  for (const color of colors) {
    const tr = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = color.name;
    const sw = document.createElement("td");
    const swatch = document.createElement("span");
    const rgb = colorToRgb(color, db!.namedColors, flag.colors);
    swatch.className = "swatch" + (rgb ? "" : " missing");
    if (rgb) swatch.style.background = rgbHex(rgb);
    swatch.title = rgb ? rgbHex(rgb) : "unresolved color";
    sw.append(swatch);
    sw.style.width = "22px";

    const kind = document.createElement("select");
    for (const [v, label] of [
      ["named", "named"],
      ["rgb", "rgb"],
      ["hsv360", "hsv360"],
      ["ref", "same as"],
    ]) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = label;
      o.selected = v === color.kind;
      kind.append(o);
    }
    kind.onchange = () => {
      const current = colorToRgb(color, db!.namedColors, flag.colors) ?? [255, 255, 255];
      const i = colors.indexOf(color);
      const k = kind.value as CoaColor["kind"];
      colors[i] =
        k === "named"
          ? { name: color.name, kind: "named", value: Object.keys(db!.namedColors)[0] ?? "white" }
          : k === "rgb"
            ? { name: color.name, kind: "rgb", value: current }
            : k === "hsv360"
              ? { name: color.name, kind: "hsv360", value: rgbToHsv360(current) }
              : { name: color.name, kind: "ref", value: flag.colors[0]?.name ?? "color1" };
      refresh();
    };
    const kindTd = document.createElement("td");
    kindTd.style.width = "80px";
    kindTd.append(kind);

    const value = document.createElement("td");
    if (color.kind === "named") {
      const sel = document.createElement("select");
      sel.style.width = "100%";
      const names = Object.keys(db!.namedColors).sort();
      if (!names.includes(color.value)) names.unshift(color.value);
      for (const n of names) {
        const o = document.createElement("option");
        o.value = n;
        o.textContent = n;
        o.selected = n === color.value;
        sel.append(o);
      }
      sel.onchange = () => {
        color.value = sel.value;
        refresh();
      };
      value.append(sel);
    } else if (color.kind === "rgb") {
      const c = document.createElement("input");
      c.type = "color";
      c.value = rgbHex(color.value);
      c.oninput = () => {
        color.value = hexRgb(c.value);
        swatch.style.background = c.value;
        draw();
      };
      value.append(c, ` rgb { ${color.value.join(" ")} }`);
      c.onchange = () => refresh();
    } else if (color.kind === "hsv360") {
      const v = color.value;
      value.append(
        numberInput(v[0], 1, (x) => (v[0] = x)),
        numberInput(v[1], 1, (x) => (v[1] = x)),
        numberInput(v[2], 1, (x) => (v[2] = x))
      );
    } else {
      const sel = document.createElement("select");
      for (const base of flag.colors) {
        if (colors === flag.colors && base.name === color.name) continue;
        const o = document.createElement("option");
        o.value = base.name;
        o.textContent = base.name;
        o.selected = base.name === color.value;
        sel.append(o);
      }
      sel.onchange = () => {
        color.value = sel.value;
        refresh();
      };
      value.append(sel);
    }
    const del = document.createElement("td");
    del.style.width = "28px";
    del.append(
      button("✕", "Remove color", () => {
        colors.splice(colors.indexOf(color), 1);
        refresh();
      })
    );
    tr.append(name, sw, kindTd, value, del);
    table.append(tr);
  }
  wrap.append(table);
  return wrap;
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

function instanceEditor(layer: CoaLayer): HTMLElement {
  const wrap = document.createElement("div");
  const head = document.createElement("div");
  head.className = "subhead";
  head.textContent = layer.instances.length ? "Instances" : "Instances (default: centered, full size)";
  head.append(
    button(
      "+ Add instance",
      "Add a placement",
      () => {
        if (layer.kind === "sub") layer.instances.push({ ...DEFAULT_SUB_INSTANCE });
        else layer.instances.push({ ...DEFAULT_INSTANCE });
        refresh();
      },
      ""
    )
  );
  wrap.append(head);
  const instances: { scale: [number, number] }[] = layer.instances;
  instances.forEach((inst, i) => {
    const row = document.createElement("div");
    row.className = "inst";
    const s = (t: string): HTMLSpanElement => {
      const e = document.createElement("span");
      e.textContent = t;
      return e;
    };
    if (layer.kind === "sub") {
      const o = layer.instances[i].offset;
      row.append(
        s("offset"),
        numberInput(o[0], 0.01, (v) => (o[0] = v)),
        numberInput(o[1], 0.01, (v) => (o[1] = v))
      );
    } else {
      const it = layer.instances[i];
      row.append(
        s("rot"),
        numberInput(it.rotation, 1, (v) => (it.rotation = v)),
        s("pos"),
        numberInput(it.position[0], 0.01, (v) => (it.position[0] = v)),
        numberInput(it.position[1], 0.01, (v) => (it.position[1] = v))
      );
    }
    row.append(
      s("scale"),
      numberInput(inst.scale[0], 0.01, (v) => (inst.scale[0] = v)),
      numberInput(inst.scale[1], 0.01, (v) => (inst.scale[1] = v)),
      button("✕", "Remove instance", () => {
        layer.instances.splice(i, 1);
        refresh();
      })
    );
    wrap.append(row);
  });
  return wrap;
}

function pickButton(current: string, placeholder: string, onClick: () => void): HTMLButtonElement {
  const b = button(current || placeholder, "Choose…", onClick, "pick");
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
      colorEditor(flag.colors, "Flag colors (pattern slots 1-3; emblems may reference any)")
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
    const mask = document.createElement("select");
    for (const [v, label] of [
      ["0", "none"],
      ["1", "pattern color1"],
      ["2", "pattern color2"],
      ["3", "pattern color3"],
    ]) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = label;
      o.selected = Number(v) === layer.mask;
      mask.append(o);
    }
    mask.onchange = () => {
      layer.mask = Number(mask.value);
      draw();
    };
    box.append(field("Mask", mask), colorEditor(layer.colors, "Emblem colors (slots 1-3)"));
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
    mode === "flags"
      ? "Open a flag"
      : mode === "parent"
        ? "Choose the parent flag"
        : `Choose from ${mode.replace("_", " ")}`;
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
    for (const entry of matches.slice(0, 500)) {
      const row = document.createElement("div");
      row.className = "flagrow";
      row.innerHTML = `<b></b><span class="src"></span>`;
      row.querySelector("b")!.textContent = entry.name;
      row.querySelector(".src")!.textContent = `${entry.source} · ${entry.file}`;
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
      body.append(row);
    }
    if (matches.length > 500) body.append(`… ${matches.length - 500} more, narrow the search`);
    return;
  }
  const kind = browserMode;
  const grid = document.createElement("div");
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
    const tile = document.createElement("div");
    tile.className = "tile";
    tile.dataset.key = key;
    const c = document.createElement("canvas");
    c.width = 108;
    c.height = 72;
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = file;
    name.title = file;
    tile.append(c, name);
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
  if (matches.length > 600) body.append(`… ${matches.length - 600} more, narrow the search`);
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

function toast(message: string): void {
  const t = $("toast");
  t.textContent = message;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2500);
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

$("new").onclick = newFlag;
$("open").onclick = () => openBrowser("flags");
$("copy").onclick = () => send({ type: "copy", text: writeFlag(flag) });
$("save").onclick = () => {
  if (!flag.name.trim()) {
    toast("Give the flag a name first.");
    return;
  }
  send({ type: "save", name: flag.name.trim(), script: writeFlag(flag) });
};
$("png").onclick = () => send({ type: "exportPng", name: flag.name, dataUrl: canvas.toDataURL("image/png") });
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
    select(flag.layers.length - 1);
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
      canSave = m.canSave;
      $<HTMLButtonElement>("save").disabled = !canSave;
      $<HTMLButtonElement>("save").title = canSave
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
      if (first) newFlag();
      else refresh();
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
