/**
 * The Workshop panel app: the focused mod's Workshop item on one page - what
 * the descriptor and workshop.json say (editable drafts), what Steam says
 * live (fetched through the host), and an Upload that submits the checked
 * parts. Drafts autosave to the workshop folder (or workshop.json while no
 * folder exists); nothing reaches Steam until Upload confirms. Built from the
 * shared px-ui classes; talks to the host only through messages.ts.
 */
import { versionAtLeast, type ItemDetails, type WorkshopVisibility } from "../../../steam/jobs";
import { bbcodeToHtml } from "../bbcode";
import { iconEl } from "../../shared/icons";
import { confirmDialog, menu, type MenuItem } from "../../shared/overlay";
import type {
  AppToHost,
  DlcChoice,
  DlcSource,
  HostToApp,
  LiveTranslation,
  ModChoice,
  PullParts,
  TranslationDraft,
  WorkshopModInfo,
} from "../messages";
import { installTips } from "../../shared/tips";
import { helpDialog } from "../../shared/help";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();
const send = (m: AppToHost): void => vscode.postMessage(m);
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

installTips();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let mods: ModChoice[] = [];
let active: string | null = null;
let info: WorkshopModInfo | null = null;
let live: ItemDetails | null = null;
let liveTranslations: Record<string, LiveTranslation> = {};
let liveError: string | null = null;
let fetching = false;
let busy = false;
/** The game's DLC list, read once per session (from the install, else Steam). */
let dlc: DlcChoice[] | null = null;
let dlcSource: DlcSource = "none";
let dlcError: string | null = null;
let dlcLoading = false;
let dlcAsked = false;
let dlcSteamAsked = false;
/** Translations switched off under Publish (the rest of the drafted ones upload). */
const langsOff = new Set<string>();
/** Titles of required items that are not installed mods (null = Steam does not know the id). */
const itemTitles = new Map<string, string | null>();
/** Ids a lookup is in flight for, so a re-render neither re-asks nor says "not found" early. */
const itemsPending = new Set<string>();
/** The running job's current step, or null when nothing runs. */
let progressStep: { step: string; done: number; total: number } | null = null;

/** The visibility the user picked, or null = whatever the item has. */
let pickedVisibility: WorkshopVisibility | null = null;
/** Local drafts under edit (workshop folder / workshop.json, saved debounced). */
let draftDescription = "";
let draftTranslations: Record<string, TranslationDraft> = {};
const collapsed = new Set<string>();
/** The mod the current drafts belong to, and its languages already seen
 * (languages arriving from disk start collapsed; UI-added ones stay open). */
let lastInfoActive: string | null = null;
const knownLangs = new Set<string>();
/** Where the changenote box was filled from; typing makes it "manual". */
let noteSource: "changelog" | "commit" | "manual" = "manual";
/** Edit vs preview, for the description and per translation language. */
let descMode: "edit" | "preview" = "edit";
const langMode = new Map<string, "edit" | "preview">();

const VISIBILITY_LABELS: Record<number, string> = {
  0: "Public",
  1: "Friends only",
  2: "Private",
  3: "Unlisted",
};

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function queueSave(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    send({ type: "saveLocal", description: draftDescription, translations: draftTranslations });
  }, 600);
}
function flushSave(): void {
  if (saveTimer === undefined) return;
  clearTimeout(saveTimer);
  saveTimer = undefined;
  send({ type: "saveLocal", description: draftDescription, translations: draftTranslations });
}

/** The languages worth asking Steam about: drafted plus suggested. */
function languagesOfInterest(): string[] {
  const langs = new Set<string>(Object.keys(draftTranslations));
  for (const l of info?.suggestedLanguages ?? []) langs.add(l);
  return [...langs];
}

/** Translations that would upload: any draft with text. */
function uploadableLanguages(): string[] {
  return Object.entries(draftTranslations)
    .filter(([, t]) => (t.title ?? "").trim() !== "" || (t.description ?? "").trim() !== "")
    .map(([lang]) => lang)
    .sort();
}

const langLabel = (api: string): string => info?.steamLanguages.find((l) => l.api === api)?.label ?? api;

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderAll(): void {
  renderToolbar();
  renderItem();
  renderStats();
  renderDescriptionHints();
  renderTranslations();
  renderPreviews();
  renderRequirements();
  renderChecks();
  renderPublish();
}

/** The toolbar's inline progress: the step the running job reported, and how far it is. */
function renderProgress(): void {
  const box = $("jobProgress");
  box.hidden = progressStep === null;
  if (!progressStep) return;
  const step = box.querySelector<HTMLElement>(".step")!;
  step.textContent = progressStep.step;
  step.setAttribute("data-tip", progressStep.step);
  box.querySelector<HTMLElement>(".count")!.textContent =
    progressStep.total > 1
      ? `${Math.min(progressStep.done + 1, progressStep.total)}/${progressStep.total}`
      : "";
  const bar = box.querySelector<HTMLElement>(".bar")!;
  const known = progressStep.total > 0;
  bar.toggleAttribute("data-indeterminate", !known);
  (bar.firstElementChild as HTMLElement).style.width = known
    ? `${Math.round((progressStep.done / progressStep.total) * 100)}%`
    : "";
}

const hasErrors = (): boolean => !!info?.checks.some((c) => c.level === "error");

function renderToolbar(): void {
  const modBtn = $<HTMLButtonElement>("mod");
  const label = mods.find((m) => m.path === active)?.label ?? "(no mod)";
  modBtn.querySelector("span.px-truncate")!.textContent = label;
  modBtn.style.display = mods.length > 1 ? "" : "none";

  const state = $("liveState");
  if (fetching) state.textContent = "asking Steam…";
  else if (liveError) state.textContent = "Steam unreachable";
  else if (live) state.textContent = "live";
  else state.textContent = "";
  state.setAttribute("data-tip", liveError ?? "");

  $<HTMLButtonElement>("openPage").disabled = !info?.publishedId;
  $<HTMLButtonElement>("upload").disabled = busy || !info || info.descriptorMissing || hasErrors();
  $<HTMLButtonElement>("refresh").disabled = fetching || !info?.publishedId;
  $<HTMLButtonElement>("pull").disabled = busy || fetching || !info?.publishedId;
  $("busy").classList.toggle("on", fetching && !busy);
}

function renderItem(): void {
  $("noDescriptor").classList.toggle("on", !!info?.descriptorMissing);
  for (const id of ["itemSection", "modFilesSection", "noteSection"])
    $(id).style.display = info && !info.descriptorMissing ? "" : "none";
  if (!info || info.descriptorMissing) return;
  $("modRoot").textContent = info.root;
  $("modRoot").setAttribute("data-tip", info.root);

  const title = $<HTMLInputElement>("title");
  if (document.activeElement !== title) {
    title.value = live?.title && !info.name ? live.title : (info.name ?? "");
  }
  if (!info.name) title.placeholder = "descriptor has no name=";
  const version = $<HTMLInputElement>("version");
  if (document.activeElement !== version) version.value = info.version ?? "";
  const supported = $<HTMLInputElement>("supported");
  if (document.activeElement !== supported) supported.value = info.supportedVersion ?? "";

  const previewUrl = info.previewUri ?? live?.previewUrl ?? null;
  const img = $<HTMLImageElement>("preview");
  img.hidden = !previewUrl;
  $("previewEmpty").style.display = previewUrl ? "none" : "";
  if (previewUrl && img.src !== previewUrl) img.src = previewUrl;
  $("previewName").textContent = info.previewName ?? (previewUrl ? "current Workshop preview" : "");
  $("previewName").setAttribute(
    "data-tip",
    info.previewTooLarge ? "1 MB or larger: Steam rejects it, uploads keep the current one." : ""
  );
  if (info.previewTooLarge) $("previewName").textContent += " (too large!)";

  const visBtn = $<HTMLButtonElement>("visibility");
  const vis = pickedVisibility ?? live?.visibility ?? null;
  visBtn.querySelector("span")!.textContent =
    vis === null ? (info.publishedId ? "…" : "Private (new items start private)") : VISIBILITY_LABELS[vis];
  visBtn.disabled = !info.publishedId && vis === null;

  renderTags(info.tags);
  renderFilesRow();

  const idBox = $("itemIdBox");
  idBox.replaceChildren();
  if (info.publishedId) {
    const id = document.createElement("span");
    id.className = "px-muted px-xs";
    id.textContent = `#${info.publishedId}`;
    idBox.append(id);
  } else {
    const s = document.createElement("span");
    s.className = "px-muted px-xs";
    s.textContent = "not on the Workshop yet";
    idBox.append(s);
  }

  const meta = $("itemMeta");
  if (live) {
    const when = (t: number) => new Date(t * 1000).toLocaleDateString();
    meta.textContent =
      `created ${when(live.timeCreated)}, last update ${when(live.timeUpdated)}` +
      (live.banned ? " - BANNED by Steam" : "");
  } else {
    meta.textContent = "";
  }
}

/** Editable tag chips + an inline add box; every change writes the descriptor. */
function renderTags(current: string[]): void {
  const box = $("tags");
  box.replaceChildren();
  for (const t of current) {
    const chip = document.createElement("span");
    chip.className = "px-badge tag-chip";
    chip.dataset.variant = "secondary";
    chip.append(document.createTextNode(t));
    const x = document.createElement("button");
    x.setAttribute("data-tip", "Remove this tag (writes the descriptor)");
    x.append(iconEl("x"));
    x.addEventListener("click", () => send({ type: "setTags", tags: current.filter((v) => v !== t) }));
    chip.append(x);
    box.append(chip);
  }
  const add = document.createElement("span");
  add.id = "tagAdd";
  const addBtn = document.createElement("button");
  addBtn.className = "px-btn";
  addBtn.dataset.variant = "ghost";
  addBtn.dataset.size = "sm";
  addBtn.append(iconEl("plus"), document.createTextNode(" tag"));
  addBtn.setAttribute("data-tip", "Add a Workshop tag (writes the descriptor)");
  const customInput = (): void => {
    const input = document.createElement("input");
    input.className = "px-input";
    input.dataset.size = "sm";
    input.placeholder = "New tag…";
    input.spellcheck = false;
    add.replaceChildren(input);
    input.focus();
    const commit = (): void => {
      const v = input.value.trim();
      if (v) send({ type: "setTags", tags: [...current, v] });
      else renderTags(current);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") commit();
      else if (e.key === "Escape") renderTags(current);
    });
    input.addEventListener("blur", commit);
  };
  addBtn.addEventListener("click", () => {
    const known = (info?.knownTags ?? []).filter((t) => !current.includes(t));
    if (!known.length) {
      customInput();
      return;
    }
    const CUSTOM = "\u0000custom";
    menu(
      addBtn,
      [
        ...known.map<MenuItem>((t) => ({ value: t, label: t })),
        { value: CUSTOM, label: "Custom tag…", hint: "type your own" },
      ],
      {
        search: true,
        width: 220,
        onPick: (v) => {
          if (v === CUSTOM) customInput();
          else send({ type: "setTags", tags: [...current, v] });
        },
      }
    );
  });
  add.append(addBtn);
  box.append(add);
}

/** Where the listing lives: the workshop folder (as files) or workshop.json. */
function renderFilesRow(): void {
  const box = $("filesBox");
  box.replaceChildren();
  if (!info) return;
  const badge = document.createElement("span");
  badge.className = "px-badge";
  badge.dataset.variant = "outline";
  const hint = document.createElement("span");
  hint.className = "px-muted px-xs px-truncate";
  if (info.filesPresent) {
    badge.textContent = "workshop folder";
    badge.setAttribute(
      "data-tip",
      "The listing is stored as files here, so it diffs and versions like code."
    );
    hint.textContent = info.workshopDir;
    hint.setAttribute("data-tip", info.workshopDir);
  } else {
    badge.textContent = "workshop.json";
    badge.setAttribute("data-tip", "Drafts save to workshop.json inside the mod, not as listing files.");
    hint.textContent = `no folder at ${info.workshopDir}`;
    hint.setAttribute("data-tip", info.workshopDir);
  }
  badge.setAttribute("data-tip-wrap", "");
  box.append(badge, hint);
}

function renderStats(): void {
  const section = $("statsSection");
  if (!live) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const stats = $("stats");
  stats.replaceChildren();
  const tile = (icon: Parameters<typeof iconEl>[0], label: string, value: number | null): void => {
    if (value === null) return;
    const el = document.createElement("div");
    el.className = "stat";
    const v = document.createElement("span");
    v.className = "v";
    v.textContent = value.toLocaleString();
    const k = document.createElement("span");
    k.className = "k";
    const t = document.createElement("span");
    t.className = "t";
    t.textContent = label;
    k.append(iconEl(icon), t);
    el.append(v, k);
    el.setAttribute("data-tip", `${value.toLocaleString()} ${label}`);
    stats.append(el);
  };
  tile("users", "subscribers", live.numSubscriptions);
  tile("heart", "favorites", live.numFavorites);
  tile("eye", "page visits", live.numUniqueWebsiteViews);
  tile("arrowUp", "votes up", live.numUpvotes);
  tile("arrowDown", "votes down", live.numDownvotes);
  tile("messageSquare", "comments", live.numComments);
}

function renderDescriptionHints(): void {
  $<HTMLButtonElement>("pullDesc").disabled = !live;
  renderDescFileButtons();
  renderDescMode();
}

function renderDescFileButtons(): void {
  $("openDescFile").style.display = info?.filesPresent ? "" : "none";
}

function renderDescMode(): void {
  const preview = descMode === "preview";
  $("desc").hidden = preview;
  $("descPreview").hidden = !preview;
  if (preview) $("descPreview").innerHTML = bbcodeToHtml(draftDescription);
  $("descMode")
    .querySelectorAll("button")
    .forEach((b) => b.classList.toggle("on", b.dataset.mode === descMode));
}

function translationRow(lang: string): HTMLElement {
  const draft = draftTranslations[lang] ?? {};
  const row = document.createElement("div");
  row.className = "lang";
  if (collapsed.has(lang)) row.dataset.collapsed = "";

  const head = document.createElement("div");
  head.className = "head";
  const caret = iconEl("chevronDown");
  caret.classList.add("caret");
  const name = document.createElement("span");
  name.textContent = langLabel(lang);
  const state = document.createElement("span");
  state.className = "state px-grow";
  const hasText = (draft.title ?? "").trim() !== "" || (draft.description ?? "").trim() !== "";
  state.textContent = hasText ? "" : "empty - will not upload";
  const seg = document.createElement("div");
  seg.className = "seg";
  seg.addEventListener("click", (e) => e.stopPropagation());
  for (const mode of ["edit", "preview"] as const) {
    const b = document.createElement("button");
    b.textContent = mode === "edit" ? "Edit" : "Preview";
    b.classList.toggle("on", (langMode.get(lang) ?? "edit") === mode);
    b.addEventListener("click", () => {
      langMode.set(lang, mode);
      renderTranslations();
    });
    seg.append(b);
  }
  let open: HTMLButtonElement | null = null;
  if (info?.filesPresent) {
    open = document.createElement("button");
    open.className = "px-btn";
    open.dataset.variant = "ghost";
    open.dataset.size = "icon-xs";
    open.setAttribute("data-tip", `Open ${lang}/description.bbcode in the editor`);
    open.append(iconEl("pencil"));
    open.addEventListener("click", (e) => {
      e.stopPropagation();
      send({ type: "openListingFile", lang });
    });
  }
  const remove = document.createElement("button");
  remove.className = "px-btn";
  remove.dataset.variant = "ghost";
  remove.dataset.size = "icon-xs";
  remove.setAttribute("data-tip", "Remove this language (its local draft files are deleted)");
  remove.append(iconEl("trash"));
  remove.addEventListener(
    "click",
    (e) =>
      void (async () => {
        e.stopPropagation();
        if (hasText) {
          const go = await confirmDialog({
            title: `Remove the ${langLabel(lang)} translation?`,
            description:
              "The local draft is deleted from workshop.json. Text already uploaded stays on Steam.",
            confirmLabel: "Remove",
            destructive: true,
          });
          if (!go) return;
        }
        delete draftTranslations[lang];
        collapsed.delete(lang);
        queueSave();
        renderTranslations();
        renderPublish();
      })()
  );
  head.append(caret, name, state, seg, ...(open ? [open] : []), remove);
  head.addEventListener("click", () => {
    if (collapsed.has(lang)) collapsed.delete(lang);
    else collapsed.add(lang);
    row.toggleAttribute("data-collapsed");
  });

  const body = document.createElement("div");
  body.className = "body";
  const title = document.createElement("input");
  title.className = "px-input";
  title.spellcheck = false;
  title.placeholder = `Title in ${langLabel(lang)} (empty = keep the default title)`;
  title.value = draft.title ?? "";
  title.addEventListener("input", () => {
    draftTranslations[lang] = { ...draftTranslations[lang], title: title.value };
    queueSave();
    renderPublish();
  });
  const desc = document.createElement("textarea");
  desc.className = "px-textarea";
  desc.spellcheck = false;
  desc.placeholder = `Description in ${langLabel(lang)}, BBCode like the default one`;
  desc.value = draft.description ?? "";
  desc.addEventListener("input", () => {
    draftTranslations[lang] = { ...draftTranslations[lang], description: desc.value };
    queueSave();
    renderPublish();
  });
  if ((langMode.get(lang) ?? "edit") === "preview") {
    const prev = document.createElement("div");
    prev.className = "bbprev";
    prev.innerHTML = bbcodeToHtml(draft.description ?? "");
    desc.hidden = true;
    body.append(title, desc, prev);
  } else {
    body.append(title, desc);
  }

  const liveT = liveTranslations[lang];
  if (liveT) {
    const hint = document.createElement("div");
    hint.className = "livehint";
    const label = document.createElement("span");
    label.textContent = "on Steam:";
    const text = document.createElement("span");
    text.className = "text";
    text.textContent = `${liveT.title} - ${liveT.description.slice(0, 160) || "(no description)"}`;
    text.setAttribute("data-tip", "What Steam serves for this language right now.");
    const pull = document.createElement("button");
    pull.className = "px-btn";
    pull.dataset.variant = "ghost";
    pull.dataset.size = "icon-xs";
    pull.setAttribute("data-tip", "Replace the drafts with what Steam serves for this language");
    pull.append(iconEl("arrowDown"));
    pull.addEventListener("click", () => {
      draftTranslations[lang] = { title: liveT.title, description: liveT.description };
      queueSave();
      renderTranslations();
      renderPublish();
    });
    hint.append(label, text, pull);
    body.append(hint);
  }

  row.append(head, body);
  return row;
}

function renderTranslations(): void {
  const box = $("translations");
  box.replaceChildren();
  for (const lang of Object.keys(draftTranslations).sort((a, b) =>
    langLabel(a).localeCompare(langLabel(b))
  )) {
    box.append(translationRow(lang));
  }
  if (!Object.keys(draftTranslations).length) {
    const empty = document.createElement("div");
    empty.className = "px-muted px-xs";
    empty.textContent = "No translations yet.";
    box.append(empty);
  }
}

/** The upload's blockers and warnings, read from the local files. */
function renderChecks(): void {
  const box = $("checks");
  box.replaceChildren();
  for (const c of info?.checks ?? []) {
    const row = document.createElement("div");
    row.className = "check-row";
    row.dataset.level = c.level;
    row.append(iconEl(c.level === "error" ? "circleX" : "alert"), document.createTextNode(c.message));
    box.append(row);
  }
}

/**
 * The extra previews: the local `previews/` folder when it exists (it then
 * REPLACES the item's gallery on upload), else Steam's current gallery,
 * read-only.
 */
function renderPreviews(): void {
  $("previewsSection").style.display = info && !info.descriptorMissing ? "" : "none";
  if (!info || info.descriptorMissing) return;
  const gallery = $("gallery");
  gallery.replaceChildren();
  const hint = $("previewsHint");
  const liveCount = live?.additionalPreviews.length ?? 0;
  const videos = $<HTMLInputElement>("videos");
  if (!info.previews) {
    hint.textContent =
      `No previews folder yet. Add images to create ${info.workshopDir.replace(/\\/g, "/")}/previews; ` +
      `until then the item's gallery on Steam stays as it is` +
      (liveCount ? ` (${liveCount} on Steam now).` : ".");
    for (const p of live?.additionalPreviews ?? [])
      gallery.append(liveTile(p.type, p.urlOrVideoId, p.originalFileName));
    videos.value = "";
    videos.disabled = true;
    return;
  }
  videos.disabled = false;
  const n = info.previews.images.length + info.previews.videos.length;
  hint.textContent =
    n === 0
      ? "The previews folder is empty: the next details upload removes every extra preview on Steam."
      : `${info.previews.images.length} image(s) and ${info.previews.videos.length} video(s). ` +
        `The next details upload replaces the item's gallery${liveCount ? ` (${liveCount} on Steam now)` : ""}.`;
  for (const img of info.previews.images) {
    const tile = document.createElement("div");
    tile.className = "tile";
    const el = document.createElement("img");
    el.src = img.uri;
    el.alt = img.name;
    const cap = document.createElement("span");
    cap.className = "cap";
    cap.textContent = img.name;
    const rm = document.createElement("button");
    rm.className = "px-btn rm";
    rm.dataset.variant = "secondary";
    rm.dataset.size = "icon-xs";
    rm.setAttribute("aria-label", `Remove ${img.name}`);
    rm.append(iconEl("x"));
    rm.addEventListener("click", () => send({ type: "removePreview", name: img.name }));
    tile.append(el, cap, rm);
    tile.dataset.name = img.name;
    tile.setAttribute("data-tip", "Drag to reorder; the order is saved to previews/order.txt");
    gallery.append(tile);
  }
  wireGalleryDrag(gallery);
  for (const id of info.previews.videos) gallery.append(liveTile(1, id, ""));
  if (document.activeElement !== videos) videos.value = info.previews.videos.join(", ");
}

/**
 * Pointer-driven reorder of the image tiles. Press and move past a few pixels
 * lifts a clone of the tile under the pointer; the tile itself stays in the
 * flow as a dashed placeholder and moves between its siblings as the pointer
 * crosses their centres, the siblings sliding into place (FLIP: measure,
 * move, play the inverse transform back to zero). Release commits the order
 * as file names. A plain click (no move) still reaches the Remove button.
 */
function wireGalleryDrag(gallery: HTMLElement): void {
  const tiles = () => Array.from(gallery.querySelectorAll<HTMLElement>(".tile[data-name]"));
  for (const tile of tiles()) {
    tile.addEventListener("pointerdown", (down) => {
      if (down.button !== 0 || (down.target as HTMLElement).closest("button")) return;
      const start = { x: down.clientX, y: down.clientY };
      let ghost: HTMLElement | null = null;
      let offset = { x: 0, y: 0 };
      const before = tiles().map((t) => t.dataset.name);

      // Layout boxes, not getBoundingClientRect: a sibling mid-slide reports
      // its transformed rect, which made the hit test and the FLIP deltas
      // chase the animation (the stutter). offsetLeft/Top ignore transforms.
      const box = (t: HTMLElement) => ({
        left: t.offsetLeft,
        top: t.offsetTop,
        right: t.offsetLeft + t.offsetWidth,
        bottom: t.offsetTop + t.offsetHeight,
        width: t.offsetWidth,
      });
      const flip = (move: () => void): void => {
        const first = new Map(tiles().map((t) => [t, box(t)]));
        move();
        for (const t of tiles()) {
          const a = first.get(t);
          if (!a || t === tile) continue;
          const b = box(t);
          const dx = a.left - b.left;
          const dy = a.top - b.top;
          if (!dx && !dy) continue;
          t.classList.remove("slide");
          t.style.transform = `translate(${dx}px, ${dy}px)`;
          void t.offsetWidth;
          t.classList.add("slide");
          t.style.transform = "";
        }
      };
      const onMove = (e: PointerEvent): void => {
        if (!ghost) {
          if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 4) return;
          const r = tile.getBoundingClientRect();
          offset = { x: start.x - r.left, y: start.y - r.top };
          ghost = tile.cloneNode(true) as HTMLElement;
          ghost.classList.add("lift");
          ghost.removeAttribute("data-tip");
          ghost.removeAttribute("data-name");
          ghost.style.width = `${r.width}px`;
          ghost.style.height = `${r.height}px`;
          gallery.append(ghost);
          tile.classList.add("placeholder");
          tile.setPointerCapture(down.pointerId);
        }
        ghost.style.left = `${e.clientX - offset.x}px`;
        ghost.style.top = `${e.clientY - offset.y}px`;
        // The slot the pointer is over decides where the placeholder goes.
        const g = gallery.getBoundingClientRect();
        const px = e.clientX - g.left + gallery.scrollLeft;
        const py = e.clientY - g.top + gallery.scrollTop;
        const over = tiles().find((t) => {
          if (t === tile) return false;
          const r = box(t);
          return px >= r.left && px <= r.right && py >= r.top && py <= r.bottom;
        });
        if (!over) return;
        const r = box(over);
        const after = px > r.left + r.width / 2;
        const target = after ? over.nextSibling : over;
        if (target === tile || (after && over.nextSibling === tile)) return;
        flip(() => gallery.insertBefore(tile, target));
      };
      const onUp = (): void => {
        tile.removeEventListener("pointermove", onMove);
        tile.removeEventListener("pointerup", onUp);
        tile.removeEventListener("pointercancel", onUp);
        if (!ghost) return;
        ghost.remove();
        tile.classList.remove("placeholder");
        for (const t of tiles()) t.classList.remove("slide");
        const names = tiles()
          .map((t) => t.dataset.name ?? "")
          .filter(Boolean);
        if (names.join("\n") !== before.join("\n")) send({ type: "reorderPreviews", names });
      };
      tile.addEventListener("pointermove", onMove);
      tile.addEventListener("pointerup", onUp);
      tile.addEventListener("pointercancel", onUp);
    });
  }
}

function liveTile(type: number, urlOrId: string, name: string): HTMLElement {
  const tile = document.createElement("div");
  tile.className = "tile";
  if (type === 1) {
    tile.classList.add("video");
    tile.append(iconEl("play"), document.createTextNode(` ${urlOrId}`));
    tile.setAttribute("data-tip", `YouTube video ${urlOrId}`);
    return tile;
  }
  const el = document.createElement("img");
  el.src = urlOrId;
  el.alt = name;
  const cap = document.createElement("span");
  cap.className = "cap";
  cap.textContent = name || "on Steam";
  tile.append(el, cap);
  return tile;
}

/** YouTube ids from ids, watch links or youtu.be links, comma or space separated. */
function parseVideoIds(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[,\s]+/)) {
    const m = /(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{6,20})/.exec(raw) ?? /^([\w-]{6,20})$/.exec(raw);
    if (m && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** What the listing requires: DLC of the game and other Workshop items. */
function renderRequirements(): void {
  $("requirementsSection").style.display = info && !info.descriptorMissing ? "" : "none";
  if (!info || info.descriptorMissing) return;
  // Local dependencies.json wins; without it Steam's current state shows, read-only until edited.
  const apps = info.dependencies?.apps ?? live?.appDependencies ?? [];
  const items = info.dependencies?.items ?? live?.children ?? [];
  const commit = (nextApps: number[], nextItems: string[]) =>
    send({ type: "setDependencies", apps: nextApps, items: nextItems });

  // The list is read from the game install once per session, on open; Steam
  // is the fallback (see the `dlc` message) when the install gives nothing.
  if (!dlcAsked) {
    dlcAsked = true;
    dlcLoading = true;
    send({ type: "loadDlc", allowSteam: false });
  }

  const dlcBox = $("dlcBox");
  dlcBox.replaceChildren();
  if (dlc?.length) {
    const grid = document.createElement("div");
    grid.className = "dlc-grid";
    for (const d of dlc) {
      const tile = document.createElement("button");
      tile.className = "dlc-tile";
      tile.type = "button";
      tile.dataset.on = apps.includes(d.steamId) ? "1" : "";
      tile.setAttribute("data-tip", `${d.name} (#${d.steamId})`);
      tile.setAttribute("data-tip-wrap", "");
      tile.setAttribute("aria-pressed", apps.includes(d.steamId) ? "true" : "false");
      if (d.iconUri) {
        const img = document.createElement("img");
        img.src = d.iconUri;
        img.alt = d.name;
        // A missing or broken icon falls back to the name, like the Steam list.
        img.addEventListener("error", () => img.replaceWith(nameCap(d.name)));
        tile.append(img);
      } else {
        tile.append(nameCap(d.name));
      }
      const mark = document.createElement("span");
      mark.className = "mark";
      mark.append(iconEl("check"));
      tile.append(mark);
      tile.addEventListener("click", () => {
        const on = apps.includes(d.steamId);
        commit(on ? apps.filter((a) => a !== d.steamId) : [...apps, d.steamId], items);
      });
      grid.append(tile);
    }
    dlcBox.append(grid);
  }
  const dlcNote = document.createElement("div");
  dlcNote.className = "px-muted px-xs";
  if (dlcError) dlcNote.textContent = dlcError;
  else if (dlcLoading) dlcNote.textContent = "Reading the DLC list…";
  else if (dlcSource === "game") dlcNote.textContent = "From the game files. Click a DLC to require it.";
  else if (dlcSource === "steam")
    dlcNote.textContent =
      "From the Steam client (the game path is unknown, so there are no icons). Click a DLC to require it.";
  else dlcNote.textContent = "No DLC list: neither the game files nor Steam gave one.";
  dlcBox.append(dlcNote);

  const itemsBox = $("itemsBox");
  itemsBox.replaceChildren();
  // Ids that are not an installed mod are looked up on Steam, once each.
  const candidates = info.dependencyCandidates;
  const unknown = items.filter(
    (id) => !candidates.some((c) => c.itemId === id) && !itemTitles.has(id) && !itemsPending.has(id)
  );
  if (unknown.length) {
    for (const id of unknown) itemsPending.add(id);
    send({ type: "resolveItems", ids: unknown });
  }
  for (const id of items) {
    const row = document.createElement("div");
    row.className = "req-item";
    const label = info.dependencyCandidates.find((c) => c.itemId === id)?.label ?? itemTitles.get(id);
    const text = document.createElement("span");
    text.className = "name";
    text.textContent = label ?? (itemsPending.has(id) ? "looking it up…" : "not found");
    text.setAttribute("data-tip", label ?? "");
    const idEl = document.createElement("span");
    idEl.className = "id";
    idEl.textContent = `#${id}`;
    const rm = document.createElement("button");
    rm.className = "px-btn";
    rm.dataset.variant = "ghost";
    rm.dataset.size = "icon-xs";
    rm.setAttribute("aria-label", `Remove #${id}`);
    rm.append(iconEl("x"));
    rm.addEventListener("click", () =>
      commit(
        apps,
        items.filter((i) => i !== id)
      )
    );
    row.append(text, idEl, rm);
    itemsBox.append(row);
  }
  if (items.length === 0) {
    const none = document.createElement("span");
    none.className = "px-muted px-xs";
    none.textContent = "None. Subscribers are told to get these first.";
    itemsBox.append(none);
  }
}

/** The name caption of a DLC tile without an icon. */
function nameCap(name: string): HTMLElement {
  const cap = document.createElement("span");
  cap.className = "cap";
  cap.textContent = name;
  return cap;
}

/** Translations that upload: drafted with text, and not switched off. */
function enabledLanguages(): string[] {
  if (!$<HTMLInputElement>("incLangs").checked) return [];
  return uploadableLanguages().filter((l) => !langsOff.has(l));
}

function renderPublish(): void {
  const langs = uploadableLanguages();
  const incLangs = $<HTMLInputElement>("incLangs");
  incLangs.disabled = !langs.length;
  if (!langs.length) incLangs.checked = false;
  const on = enabledLanguages();
  $("langCount").textContent = !langs.length
    ? "Upload (none drafted)"
    : on.length === langs.length
      ? `Upload all ${langs.length}`
      : `Upload ${on.length} of ${langs.length}`;

  const rows = $("langRows");
  rows.replaceChildren();
  for (const lang of langs) {
    const row = document.createElement("div");
    row.className = "lang-row";
    if (langsOff.has(lang)) row.dataset.off = "";
    const sw = document.createElement("label");
    sw.className = "px-switch";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !langsOff.has(lang);
    input.addEventListener("change", () => {
      if (input.checked) langsOff.delete(lang);
      else langsOff.add(lang);
      renderPublish();
    });
    sw.append(input, document.createElement("span"));
    const name = document.createElement("span");
    name.textContent = langLabel(lang);
    row.append(sw, name);
    if (langsOff.has(lang)) {
      const chip = document.createElement("span");
      chip.className = "px-muted px-xs";
      chip.textContent = "not uploaded";
      row.append(chip);
    }
    rows.append(row);
  }

  // Each switch owns the card it sits in; the summary says what an upload sends.
  const owned: [string, string][] = [
    ["incContent", "modFilesSection"],
    ["incDetails", "itemSection"],
    ["incLangs", "translationsSection"],
    ["incNote", "noteSection"],
  ];
  for (const [input, section] of owned)
    $(section).toggleAttribute("data-off", !$<HTMLInputElement>(input).checked);
  const sends: string[] = [];
  if ($<HTMLInputElement>("incContent").checked) sends.push("mod files");
  if ($<HTMLInputElement>("incDetails").checked) sends.push("details");
  if (on.length) sends.push(`${on.length} translation${on.length === 1 ? "" : "s"}`);
  if ($<HTMLInputElement>("incNote").checked && $<HTMLTextAreaElement>("note").value.trim())
    sends.push("changenote");
  const summary = $("publishSummary");
  summary.replaceChildren();
  const lead = document.createElement("span");
  lead.className = "sub";
  lead.textContent = sends.length ? "Sends: " : "";
  summary.append(
    lead,
    document.createTextNode(sends.length ? sends.join(", ") : "Nothing: every part is off.")
  );
}
$<HTMLTextAreaElement>("note").addEventListener("input", renderPublish);

for (const id of ["incContent", "incDetails", "incLangs", "incNote"]) {
  $(id).addEventListener("change", renderPublish);
}
// The per-language switches fold away: nine rows is the exception you open,
// not the default view of the card.
$("langsToggle").addEventListener("click", () => {
  const rows = $("langRows");
  rows.hidden = !rows.hidden;
  $("langsToggle").setAttribute("aria-expanded", String(!rows.hidden));
});
$("enableAll").addEventListener("click", () => {
  $("enableAllConfirm").hidden = false;
  $<HTMLButtonElement>("enableAll").disabled = true;
});
$("enableAllNo").addEventListener("click", () => {
  $("enableAllConfirm").hidden = true;
  $<HTMLButtonElement>("enableAll").disabled = false;
});
$("enableAllYes").addEventListener("click", () => {
  $("enableAllConfirm").hidden = true;
  $<HTMLButtonElement>("enableAll").disabled = false;
  for (const id of ["incContent", "incDetails", "incNote"]) $<HTMLInputElement>(id).checked = true;
  $<HTMLInputElement>("incLangs").checked = uploadableLanguages().length > 0;
  langsOff.clear();
  renderPublish();
});

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

function applyInfo(next: WorkshopModInfo | null): void {
  const switched = active !== lastInfoActive;
  lastInfoActive = active;
  info = next;
  if (switched) {
    live = null;
    liveTranslations = {};
    liveError = null;
    pickedVisibility = null;
    collapsed.clear();
    knownLangs.clear();
    langMode.clear();
    langsOff.clear();
  }
  // A pending autosave means the disk is behind the editor: keep the drafts.
  const pendingEdits = !switched && saveTimer !== undefined;
  if (!pendingEdits) {
    draftDescription = next?.description ?? "";
    draftTranslations = structuredClone(next?.translations ?? {});
    $<HTMLTextAreaElement>("desc").value = draftDescription;
  }
  for (const lang of Object.keys(draftTranslations)) {
    if (!knownLangs.has(lang)) {
      knownLangs.add(lang);
      collapsed.add(lang);
    }
  }
  if (switched) {
    noteSource = next?.changelogNote ? "changelog" : next?.changeNoteSuggestion ? "commit" : "manual";
    $<HTMLTextAreaElement>("note").value = next?.changelogNote?.text ?? next?.changeNoteSuggestion ?? "";
  }
  renderNoteSource();
  renderAll();
  // One Steam query per mod (plus the manual refresh button) - metadata
  // edits and draft saves must not spam Steam with re-queries.
  if (next?.publishedId && !live && !fetching) {
    fetching = true;
    renderToolbar();
    send({ type: "refresh", languages: languagesOfInterest() });
  }
}

window.addEventListener("message", (e: MessageEvent<HostToApp>) => {
  const m = e.data;
  switch (m.type) {
    case "init":
      mods = m.mods;
      active = m.active;
      applyInfo(m.info);
      return;
    case "info":
      active = m.active;
      applyInfo(m.info);
      return;
    case "liveBegin":
      fetching = true;
      renderToolbar();
      return;
    case "live":
      fetching = false;
      live = m.item;
      liveTranslations = m.translations;
      liveError = m.error;
      renderAll();
      return;
    case "uploadState":
      busy = m.busy;
      renderToolbar();
      return;
    case "progress":
      progressStep = m.step === null ? null : { step: m.step, done: m.done, total: m.total };
      renderProgress();
      return;
    case "dlc":
      // The install gave nothing: ask Steam once before giving up.
      if (m.source !== "game" && !m.list.length && !dlcSteamAsked) {
        dlcSteamAsked = true;
        send({ type: "loadDlc", allowSteam: true });
        return;
      }
      dlcLoading = false;
      dlc = m.error ? null : m.list;
      dlcSource = m.source;
      dlcError = m.error;
      renderRequirements();
      return;
    case "itemTitles":
      for (const [id, title] of Object.entries(m.titles)) {
        itemsPending.delete(id);
        itemTitles.set(id, title);
      }
      renderRequirements();
      return;
  }
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

$("mod").addEventListener("click", () => {
  menu(
    $("mod"),
    mods.map<MenuItem>((m) => ({ value: m.path, label: m.label, description: m.path })),
    {
      value: active ?? undefined,
      width: 380,
      onPick: (path) => {
        if (path === active) return;
        flushSave();
        send({ type: "selectMod", path });
      },
    }
  );
});

$("refresh").addEventListener("click", () => {
  if (!info?.publishedId) return;
  fetching = true;
  renderToolbar();
  send({ type: "refresh", languages: languagesOfInterest() });
});

$("openPage").addEventListener("click", () => send({ type: "openPage" }));
$("createDescriptor").addEventListener("click", () => send({ type: "createDescriptor" }));

$("visibility").addEventListener("click", () => {
  const items: MenuItem[] = [
    { value: "2", label: "Private", description: "Only you (and Steam) can see the item." },
    { value: "1", label: "Friends only", description: "Visible to your Steam friends." },
    { value: "3", label: "Unlisted", description: "Anyone with the link; not in searches." },
    { value: "0", label: "Public", description: "Everyone; listed and searchable." },
  ];
  const current = pickedVisibility ?? live?.visibility;
  menu($("visibility"), items, {
    value: current === undefined || current === null ? undefined : String(current),
    onPick: (v) => {
      pickedVisibility = Number(v) as WorkshopVisibility;
      renderItem();
    },
  });
});

$<HTMLTextAreaElement>("desc").addEventListener("input", () => {
  draftDescription = $<HTMLTextAreaElement>("desc").value;
  queueSave();
});

$("pullDesc").addEventListener(
  "click",
  () =>
    void (async () => {
      if (!live) return;
      if (draftDescription.trim() && draftDescription !== live.description) {
        const go = await confirmDialog({
          title: "Replace the description draft?",
          description: "The local draft differs from what is on Steam and will be overwritten.",
          confirmLabel: "Replace",
        });
        if (!go) return;
      }
      draftDescription = live.description;
      $<HTMLTextAreaElement>("desc").value = draftDescription;
      queueSave();
    })()
);

$("addLang").addEventListener("click", () => {
  if (!info) return;
  const present = new Set(Object.keys(draftTranslations));
  const suggested = info.suggestedLanguages.filter((l) => !present.has(l));
  const rest = info.steamLanguages.filter((l) => !present.has(l.api) && !suggested.includes(l.api));
  const items: MenuItem[] = [
    ...suggested.map<MenuItem>((api) => ({
      value: api,
      label: langLabel(api),
      hint: "in this mod's localization",
    })),
    ...rest.map<MenuItem>((l) => ({ value: l.api, label: l.label })),
  ];
  menu($("addLang"), items, {
    search: true,
    onPick: (api) => {
      if (!draftTranslations[api]) draftTranslations[api] = {};
      knownLangs.add(api);
      collapsed.delete(api);
      queueSave();
      renderTranslations();
      renderPublish();
    },
  });
});

$("upload").addEventListener(
  "click",
  () =>
    void (async () => {
      if (!info || busy) return;
      const picked = await uploadModal();
      if (!picked) return;
      // Mirror the modal's last word back into the Publish switches.
      $<HTMLInputElement>("incContent").checked = picked.content;
      $<HTMLInputElement>("incDetails").checked = picked.details;
      $<HTMLInputElement>("incLangs").checked = picked.languages.length > 0;
      renderPublish();
      flushSave();
      send({
        type: "upload",
        content: picked.content,
        details: picked.details,
        languages: picked.languages,
        changeNote: $<HTMLInputElement>("incNote").checked ? $<HTMLTextAreaElement>("note").value : "",
        visibility: picked.details ? pickedVisibility : null,
      });
    })()
);

interface UploadChoice {
  content: boolean;
  details: boolean;
  languages: string[];
}

/**
 * The last word before anything reaches Steam: re-offers the three parts (so
 * "actually, only the details" is one uncheck away), shows what rides along,
 * and says plainly that a Workshop update cannot be rolled back.
 */
async function uploadModal(): Promise<UploadChoice | null> {
  if (!info) return null;
  const isNew = !info.publishedId;
  const langs = enabledLanguages();

  const wrap = document.createElement("div");
  wrap.className = "modal-rows";
  const row = (id: string, checked: boolean, disabled: boolean, label: string, sub: string) => {
    const r = document.createElement("div");
    r.className = "pub-row";
    const sw = document.createElement("label");
    sw.className = "px-switch";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = `modal-${id}`;
    input.checked = checked && !disabled;
    input.disabled = disabled;
    const knob = document.createElement("span");
    sw.append(input, knob);
    const text = document.createElement("span");
    text.className = "lbl";
    text.append(document.createTextNode(label));
    const subEl = document.createElement("span");
    subEl.className = "sub";
    subEl.textContent = ` - ${sub}`;
    text.append(subEl);
    r.append(sw, text);
    wrap.append(r);
    return input;
  };
  const content = row(
    "content",
    $<HTMLInputElement>("incContent").checked,
    false,
    "Mod files",
    "every file of the mod, replacing what subscribers have"
  );
  const details = row(
    "details",
    $<HTMLInputElement>("incDetails").checked,
    false,
    "Details",
    "title, description, visibility, tags, preview image"
  );
  const translations = row(
    "translations",
    langs.length > 0,
    langs.length === 0,
    "Translations",
    langs.length ? langs.map(langLabel).join(", ") : "none enabled"
  );

  const note = $<HTMLInputElement>("incNote").checked ? $<HTMLTextAreaElement>("note").value.trim() : "";
  const lines = document.createElement("div");
  lines.className = "modal-line";
  const vis = pickedVisibility ?? live?.visibility ?? null;
  lines.textContent =
    (isNew ? "Creates a NEW item, PRIVATE until you change its visibility. " : "") +
    (vis !== null && details.checked ? `Visibility: ${VISIBILITY_LABELS[vis]}. ` : "") +
    (note
      ? `Changenote: "${note.split("\n")[0].slice(0, 80)}${note.length > 80 ? "…" : ""}"`
      : "No changenote.");
  wrap.append(lines);

  const warn = document.createElement("div");
  warn.className = "modal-note";
  warn.textContent =
    "An update reaches subscribers within minutes and there is no rollback: Steam keeps no previous " +
    "version, and the toolkit cannot recover anything an upload overwrote or broke. Check the parts " +
    "above carefully before you continue.";
  wrap.append(warn);

  const go = await confirmDialog({
    title: isNew
      ? `Publish "${info.name ?? "this mod"}" to the Steam Workshop?`
      : `Upload to the Steam Workshop?`,
    content: wrap,
    confirmLabel: "Upload",
    destructive: !isNew,
    wide: true,
  });
  if (!go) return null;
  const choice: UploadChoice = {
    content: content.checked,
    details: details.checked,
    languages: translations.checked ? langs : [],
  };
  if (!choice.content && !choice.details && !choice.languages.length) {
    send({ type: "notify", message: "Nothing was checked - upload skipped.", warn: true });
    return null;
  }
  return choice;
}

// ---------------------------------------------------------------------------
// Description modes, changenote, listing download
// ---------------------------------------------------------------------------

$("descMode")
  .querySelectorAll("button")
  .forEach((b) =>
    b.addEventListener("click", () => {
      descMode = b.dataset.mode === "preview" ? "preview" : "edit";
      renderDescMode();
    })
  );

function renderNoteSource(): void {
  const btn = $<HTMLButtonElement>("noteSourceBtn");
  const label = btn.querySelector("span.px-truncate")!;
  const from = info?.changelogNote;
  if (noteSource === "changelog" && from) {
    label.textContent = `From changelog: ${from.source}`;
    btn.setAttribute("data-tip", "The box was filled from this changelog entry. Edit freely.");
  } else if (noteSource === "commit") {
    label.textContent = "From last git commit";
    btn.setAttribute("data-tip", "The box was filled with the mod's last commit subject.");
  } else {
    label.textContent = "Manual changenote";
    btn.setAttribute("data-tip", "Written by hand. Click to fill it from a source instead.");
  }
  btn.setAttribute("data-tip-wrap", "");
}

$<HTMLTextAreaElement>("note").addEventListener("input", () => {
  if (noteSource !== "manual") {
    noteSource = "manual";
    renderNoteSource();
  }
});

$("noteSourceBtn").addEventListener("click", () => {
  if (!info) return;
  const from = info.changelogNote;
  const commit = info.changeNoteSuggestion;
  const items: MenuItem[] = [
    from
      ? {
          value: "changelog",
          label: "Changelog entry",
          hint: from.source,
          description: info.version
            ? `The entry matching version ${info.version}; Markdown already converted to BBCode.`
            : "The resolved changelog entry.",
        }
      : {
          value: "changelog-missing",
          label: info.changelogPresent
            ? `No entry for version ${info.version ?? "(unset)"}`
            : "No changelog yet",
          hint: info.changelogPath,
          description: info.changelogPresent
            ? `${info.changelogPath} exists but holds nothing for this version. A folder wants a ${info.version ?? "<version>"}.md/.bbcode/.txt file; a single file wants a headline containing the version.`
            : `Nothing at ${info.changelogPath}. Create one below, or point px.workshop.changelog at a changelog you already keep.`,
        },
    {
      value: "commit",
      label: "Last git commit",
      hint: commit ? commit.split("\n")[0].slice(0, 40) : "no commits",
      description: "The mod's most recent commit subject.",
    },
    { value: "manual", label: "Empty", description: "Clear the box and write your own." },
    ...info.changelogCandidates
      .filter((c) => !c.current)
      .map<MenuItem>((c) => ({
        value: `use:${c.path}`,
        label: `Use this ${c.kind}`,
        hint: c.path,
        description: "Points px.workshop.changelog at it for this workspace folder.",
      })),
    {
      value: "create",
      label: "Create changelog",
      hint: info.version ? `${info.version}.md` : "needs a version",
      description: "Makes the changelog folder and this version's entry, then opens it.",
    },
  ];
  menu($("noteSourceBtn"), items, {
    value: noteSource,
    width: 320,
    onPick: (v) => {
      const note = $<HTMLTextAreaElement>("note");
      if (v === "changelog" && info?.changelogNote) {
        noteSource = "changelog";
        note.value = info.changelogNote.text;
      } else if (v === "changelog-missing") {
        return;
      } else if (v.startsWith("use:")) {
        send({ type: "setChangelogSource", path: v.slice(4) });
        return;
      } else if (v === "create") {
        send({ type: "createChangelog" });
        return;
      } else if (v === "commit") {
        noteSource = "commit";
        note.value = info?.changeNoteSuggestion ?? "";
      } else {
        noteSource = "manual";
        note.value = "";
      }
      renderNoteSource();
    },
  });
});

$("pull").addEventListener(
  "click",
  () =>
    void (async () => {
      if (!info?.publishedId || busy || fetching) return;
      const wrap = document.createElement("div");
      wrap.className = "modal-rows";
      const part = (id: keyof PullParts, label: string, sub: string) => {
        const r = document.createElement("div");
        r.className = "pub-row";
        const sw = document.createElement("label");
        sw.className = "px-switch";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = true;
        sw.append(input, document.createElement("span"));
        const text = document.createElement("span");
        text.className = "lbl";
        text.append(document.createTextNode(label));
        const subEl = document.createElement("span");
        subEl.className = "sub";
        subEl.textContent = ` - ${sub}`;
        text.append(subEl);
        r.append(sw, text);
        wrap.append(r);
        return [id, input] as const;
      };
      const inputs = [
        part("details", "Details", "title, tags and visibility into item.json"),
        part("description", "Description", "description.bbcode"),
        part("translations", "Translations", "translations/<language>/ for every translated language"),
        part("previews", "Previews", "the gallery images, videos.txt and order.txt into previews/"),
        part("requirements", "Requirements", "dependencies.json"),
        part("thumbnail", "Preview image", "the main image into the mod folder"),
      ];
      const warn = document.createElement("div");
      warn.className = "modal-note";
      warn.textContent =
        `Overwrites the matching files in ${info.workshopDir} and replaces the local drafts. ` +
        "Local text never uploaded to Steam is lost - commit or copy it first if it matters.";
      wrap.append(warn);
      const go = await confirmDialog({
        title: "Download from Steam into files?",
        content: wrap,
        confirmLabel: "Download & overwrite",
        destructive: true,
        wide: true,
      });
      if (!go) return;
      const parts = Object.fromEntries(
        inputs.map(([id, input]) => [id, input.checked])
      ) as unknown as PullParts;
      send({ type: "pullListing", parts });
    })()
);

const commitField = (id: string, field: "title" | "version" | "supportedVersion"): void => {
  const input = $<HTMLInputElement>(id);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
  });
  input.addEventListener(
    "change",
    () =>
      void (async () => {
        const current =
          field === "title" ? info?.name : field === "version" ? info?.version : info?.supportedVersion;
        const v = input.value.trim();
        if (v === "" || v === (current ?? "")) {
          input.value = current ?? "";
          return;
        }
        // Going backwards is almost always a typo - say so before writing.
        if (field !== "title" && current && !versionAtLeast(v, current)) {
          const go = await confirmDialog({
            title: field === "version" ? "Lower the mod version?" : "Lower the game version?",
            description:
              `"${v}" is lower than the current "${current}". ` +
              (field === "version"
                ? "Subscribers never see a downgrade as an update, and the changelog lookup follows this value."
                : "The launcher will flag the mod as out of date for players on newer game versions."),
            confirmLabel: "Set anyway",
            destructive: true,
          });
          if (!go) {
            input.value = current;
            return;
          }
        }
        send({ type: "setField", field, value: v });
      })()
  );
};
commitField("title", "title");
commitField("version", "version");
commitField("supported", "supportedVersion");

$("changePreview").addEventListener("click", () => send({ type: "pickPreview" }));
$("addPreviews").addEventListener("click", () => send({ type: "addPreviews" }));
$("openPreviews").addEventListener("click", () => send({ type: "openPreviewsFolder" }));
{
  const videos = $<HTMLInputElement>("videos");
  const commitVideos = () => {
    if (!info?.previews) return;
    const ids = parseVideoIds(videos.value);
    if (ids.join(",") !== info.previews.videos.join(",")) send({ type: "setVideos", ids });
  };
  videos.addEventListener("change", commitVideos);
  videos.addEventListener("keydown", (e) => {
    if (e.key === "Enter") videos.blur();
  });
}
{
  const input = $<HTMLInputElement>("itemIdInput");
  const currentItems = () => info?.dependencies?.items ?? live?.children ?? [];
  const currentApps = () => info?.dependencies?.apps ?? live?.appDependencies ?? [];
  const addItem = (id: string) => {
    if (!/^\d+$/.test(id) || currentItems().includes(id)) return;
    send({ type: "setDependencies", apps: currentApps(), items: [...currentItems(), id] });
  };
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const m = /(\d{6,})/.exec(input.value);
    if (m) addItem(m[1]);
    input.value = "";
  });
  $("addItem").addEventListener("click", () => {
    if (!info) return;
    const present = new Set(currentItems());
    // The id rides as the hint (small, muted, right) so the filter still matches it.
    const items: MenuItem[] = info.dependencyCandidates
      .filter((c) => !present.has(c.itemId))
      .map((c) => ({
        value: c.itemId,
        label: c.label,
        hint: `#${c.itemId}`,
        description: c.declared ? "Declared in the descriptor" : undefined,
      }));
    if (items.length === 0) {
      send({
        type: "notify",
        message: "No other installed Workshop mod to pick; paste an id or link instead.",
      });
      return;
    }
    const rowWidth = $("addItem").parentElement?.getBoundingClientRect().width ?? 0;
    menu($("addItem"), items, { search: true, width: Math.max(320, rowWidth), onPick: addItem });
  });
}
$("openDescFile").addEventListener("click", () => send({ type: "openListingFile", lang: null }));
$("reloadLocal").addEventListener("click", () => {
  // Drop the pending autosave so the reload cannot be overwritten mid-flight.
  clearTimeout(saveTimer);
  saveTimer = undefined;
  send({ type: "reload" });
});
$("previewEmpty").style.cursor = "pointer";
$("previewEmpty").setAttribute("data-tip", "Pick an image to use as the Workshop preview");
$("previewEmpty").addEventListener("click", () => send({ type: "pickPreview" }));

/** The panel's help; `section` scrolls that section into view once open. */
function openHelp(section?: string): void {
  helpDialog(HELP);
  if (!section) return;
  const title = Array.from(document.querySelectorAll<HTMLElement>(".px-help-section-title")).find(
    (t) => t.textContent === section
  );
  title?.parentElement?.scrollIntoView({ block: "start" });
}
$("helpBtn").addEventListener("click", () => openHelp());
$("previewsHelp").addEventListener("click", () => openHelp("Previews"));

const HELP: Parameters<typeof helpDialog>[0] = {
  title: "The Steam Workshop panel",
  intro:
    "Your mod's Workshop item on one page: what the descriptor and your local files say, what Steam serves right now, and an Upload that sends the parts you check. Everything you type is a local draft. Nothing reaches Steam until you confirm an upload.",
  sections: [
    {
      title: "The item",
      items: [
        {
          lead: "Title, mod version and game version",
          text: "come from the mod's descriptor, and editing them here writes the descriptor back.",
        },
        {
          lead: "Tags",
          text: "are the Workshop tags of the item, also kept in the descriptor. Add one from the game's known tags or type your own.",
        },
        {
          lead: "The preview image",
          text: "is the thumbnail in the mod folder. Change picks a new one and copies it in. Steam wants a square image, 512x512 or larger, under 1 MB.",
        },
        {
          lead: "Visibility",
          text: "is sent with the details on the next upload. A brand new item is always created private.",
        },
        {
          lead: "Statistics",
          text: "appear once Steam answers: subscribers, favorites, page visits, votes and comments. The refresh button asks again.",
        },
      ],
    },
    {
      title: "Where the listing lives",
      intro: "Two stores, and the panel says at the Files row which one this mod uses.",
      items: [
        {
          lead: "The workshop folder",
          text: "keeps the listing as files: description.bbcode, translations/<language>/ with title.txt and description.bbcode, previews/, dependencies.json and item.json. They diff and version like the rest of your code. The folder is .px-toolkit/workshop inside the mod unless px.workshop.dir says otherwise.",
        },
        {
          lead: "The download button",
          text: "in the toolbar writes the folder from what is on Steam. You pick the parts: details, description, translations, previews, requirements, the preview image. It overwrites those files and your local drafts, so anything never uploaded is lost.",
        },
        {
          lead: "Reload",
          text: "throws away the panel's unsaved edits and reads the local files again.",
        },
      ],
    },
    {
      title: "Description and translations",
      items: [
        {
          lead: "The description is Steam BBCode",
          text: "([h1], [b], [list], [url=…]). Preview renders it roughly the way the Workshop page will.",
        },
        {
          lead: "It saves as you type,",
          text: "locally. Fetch from Steam replaces the draft with what the item currently shows.",
        },
        {
          lead: "A translation",
          text: "is the title and description a visitor browsing Steam in that language sees. The default text is what everyone else sees.",
        },
        {
          lead: "A language with no text",
          text: "never uploads, and its row says so. Removing a language deletes its local draft, not the text already on Steam.",
        },
      ],
    },
    {
      title: "Previews",
      intro:
        "The gallery on the item's Workshop page: extra images and YouTube videos, kept as files in the listing's previews folder.",
      items: [
        {
          lead: "The previews folder",
          text: "is previews/ inside the workshop folder. Add images copies files into it; Folder opens it. While the folder exists, a details upload replaces the item's whole gallery with its content, an empty folder included. Without the folder, Steam's gallery is left alone.",
        },
        {
          lead: "Accepted images",
          text: "are .png, .jpg, .jpeg and .gif files. Each must be under 1 MB (1,048,576 bytes): Steam rejects larger ones, so the upload skips them and says how many it skipped.",
        },
        {
          lead: "Order",
          text: "follows previews/order.txt, one file name per line; dragging a tile writes it. Images not listed there follow in file-name order.",
        },
        {
          lead: "The first image is not the thumbnail.",
          text: "The item's preview image (the thumbnail.png in the mod folder, under Item above) is a separate file and uploads with the details.",
        },
        {
          lead: "Videos",
          text: "are YouTube ids or links in previews/videos.txt; the Videos box writes it.",
        },
      ],
    },
    {
      title: "Requirements",
      items: [
        {
          lead: "Required DLC and required items",
          text: "are saved in dependencies.json next to the listing and applied after the upload. Steam shows them on the item page; subscribers see what to get first. The DLC grid is read from your game install, so it lists exactly the DLC a mod can require - Chapter bundles and the Subscription are not among them.",
        },
      ],
    },
    {
      title: "Changenotes",
      items: [
        {
          lead: "Whatever stands in the box",
          text: "is what uploads. The dropdown below only fills it.",
        },
        {
          lead: "From changelog",
          text: "takes the entry that matches the mod version. px.workshop.changelog points either at a folder with one file per version (1.2.md, v1.2.bbcode, 1.2.txt) or at a single file, where the section under the headline containing the version is used. Markdown is converted to BBCode. The dropdown offers any changelog the mod already has, and can create the entry for this version.",
        },
        { lead: "From last git commit", text: "fills the box with the mod's last commit subject." },
      ],
    },
    {
      title: "Uploading",
      items: [
        {
          lead: "The switch in each card's title row",
          text: "decides whether that part goes: the mod files, the Item details (title, description, visibility, tags, preview, gallery, requirements), the translations (all, or one by one behind the chevron) and the changenote. A card switched off is dimmed and marked Not uploaded; the Publish card sums up what the next upload sends.",
        },
        {
          lead: "Enable all",
          text: "switches every part on after a confirmation, translations and changenote included.",
        },
        {
          lead: "Upload asks first",
          text: "and re-offers the parts, so you can drop one at the last moment.",
        },
        {
          lead: "There is no rollback.",
          text: "An update reaches subscribers within minutes, Steam keeps no previous version, and the toolkit cannot recover what an upload overwrote.",
        },
      ],
    },
  ],
};

send({ type: "ready" });
