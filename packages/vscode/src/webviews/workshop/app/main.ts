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
import { confirmDialog, menu, toast, type MenuItem } from "../../shared/overlay";
import type {
  AppToHost,
  HostToApp,
  LiveTranslation,
  ModChoice,
  TranslationDraft,
  WorkshopModInfo,
} from "../messages";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();
const send = (m: AppToHost): void => vscode.postMessage(m);
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

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
  renderPublish();
}

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
  $<HTMLButtonElement>("upload").disabled = busy || !info || info.descriptorMissing;
  $<HTMLButtonElement>("refresh").disabled = fetching || !info?.publishedId;
  $<HTMLButtonElement>("pull").disabled = busy || fetching || !info?.publishedId;
  $("busy").classList.toggle("on", busy || fetching);
}

function renderItem(): void {
  $("noDescriptor").classList.toggle("on", !!info?.descriptorMissing);
  $("itemSection").style.display = info && !info.descriptorMissing ? "" : "none";
  if (!info || info.descriptorMissing) return;

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
    info.previewTooLarge
      ? "This image is 1 MB or larger; Steam rejects it, uploads keep the current one."
      : ""
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
    const link = document.createElement("button");
    link.className = "px-btn";
    link.dataset.variant = "outline";
    link.dataset.size = "sm";
    link.append(iconEl("link"), document.createTextNode(" Link existing item…"));
    link.setAttribute("data-tip", "Pick one of your published Workshop items to connect this mod to.");
    link.addEventListener("click", () => send({ type: "linkExisting" }));
    idBox.append(s, link);
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
      "The description and translations are stored as files here (description.bbcode, <language>/title.txt + description.bbcode, item.json), so the listing diffs and versions like code. Location: px.workshop.dir, resolved against the mod folder."
    );
    hint.textContent = info.workshopDir;
    hint.setAttribute("data-tip", info.workshopDir);
  } else {
    badge.textContent = "workshop.json";
    badge.setAttribute(
      "data-tip",
      "Drafts save to <configDir>/workshop.json inside the mod. To track the listing as diffable files instead, create the workshop folder (px.workshop.dir, default ../workshop next to the mod) or use the toolbar's download button - it sets the folder up from what is on Steam."
    );
    hint.textContent = `no folder at ${info.workshopDir}`;
    hint.setAttribute("data-tip", info.workshopDir);
  }
  badge.setAttribute("data-tip-wrap", "");
  const gear = document.createElement("button");
  gear.className = "px-btn";
  gear.dataset.variant = "ghost";
  gear.dataset.size = "icon-xs";
  gear.setAttribute(
    "data-tip",
    "Open the settings behind this: px.workshop.dir (where the listing files live, relative to the mod) and px.workshop.changelog (where changenotes come from)."
  );
  gear.setAttribute("data-tip-wrap", "");
  gear.append(iconEl("settings"));
  gear.addEventListener("click", () => send({ type: "openWorkshopSettings" }));
  box.append(badge, hint, gear);
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
    k.append(iconEl(icon), document.createTextNode(label));
    el.append(v, k);
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
    text.setAttribute(
      "data-tip",
      "What Steam currently serves for this language (its default-language fallback when no translation exists yet)."
    );
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
  const gate = $("langGate");
  const supported = info?.languageUploadOk ?? true;
  gate.classList.toggle("on", !!info && !supported);
  if (info && !supported) {
    $("langGateText").textContent =
      "Uploading translations needs a steamworks.js build with per-language updates " +
      `(UgcUpdate.language / SetItemUpdateLanguage). The bundled ${info.steamworksVersion} does not ` +
      "carry it yet - drafts still save locally and upload once a build with it ships.";
  }
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

function renderPublish(): void {
  const langs = uploadableLanguages();
  const supported = info?.languageUploadOk ?? false;
  $("langCount").textContent = langs.length ? `- ${langs.map(langLabel).join(", ")}` : "- none drafted yet";
  const incLangs = $<HTMLInputElement>("incLangs");
  incLangs.disabled = !langs.length || !supported;
  if (!langs.length || !supported) incLangs.checked = false;
}

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
      $("liveState").textContent = m.message ?? (busy ? "uploading…" : "");
      return;
    case "toast":
      toast(m.message, m.variant);
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
      flushSave();
      send({
        type: "upload",
        content: picked.content,
        details: picked.details,
        languages: picked.languages,
        changeNote: $<HTMLTextAreaElement>("note").value,
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
  const langs = uploadableLanguages();
  const supported = info.languageUploadOk;

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
    $<HTMLInputElement>("incLangs").checked && langs.length > 0 && supported,
    langs.length === 0 || !supported,
    "Translations",
    langs.length ? langs.map(langLabel).join(", ") : "none drafted"
  );

  const note = $<HTMLTextAreaElement>("note").value.trim();
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
    toast("Nothing was checked - upload skipped.", "destructive");
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
    btn.setAttribute(
      "data-tip",
      `The box was filled from this changelog entry${info?.version ? ` (version ${info.version})` : ""}. Edit freely - only the text in the box uploads.`
    );
  } else if (noteSource === "commit") {
    label.textContent = "From last git commit";
    btn.setAttribute("data-tip", "The box was filled with the mod's last commit subject. Edit freely.");
  } else {
    label.textContent = "Manual changenote";
    btn.setAttribute("data-tip", "Written by hand (or edited). Click to fill from a source instead.");
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
          label: "Changelog entry",
          hint: "none found",
          description: `Looked at ${info.changelogPath}${info.version ? ` for version ${info.version}` : " (the descriptor has no version)"}. Folder: a ${info.version ?? "<version>"}.md/.bbcode/.txt file. Single file: a headline containing the version.`,
        },
    {
      value: "commit",
      label: "Last git commit",
      hint: commit ? commit.split("\n")[0].slice(0, 40) : "no commits",
      description: "The mod's most recent commit subject.",
    },
    { value: "manual", label: "Empty", description: "Clear the box and write your own." },
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
        toast(
          `No changelog entry for ${info?.version ? `version ${info.version}` : "this mod"} at ${info?.changelogPath ?? "the changelog path"}. The ? button next to the box explains the layout; px.workshop.changelog moves the location.`,
          "destructive"
        );
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
      const go = await confirmDialog({
        title: "Download the listing from Steam into files?",
        description:
          "The live description and every translated language are written into the workshop folder, which becomes the canonical store for the listing:",
        details: [
          `Folder: ${info.workshopDir} (px.workshop.dir)`,
          "description.bbcode - the default-language description",
          "<language>/title.txt and <language>/description.bbcode per translated language",
          "item.json - title and publishedfileid",
          "THIS OVERWRITES those files and replaces the local drafts. Local text that was never uploaded to Steam is lost - commit or copy it first if it matters.",
        ],
        confirmLabel: "Download & overwrite",
        destructive: true,
        wide: true,
      });
      if (!go) return;
      send({ type: "pullListing" });
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

send({ type: "ready" });
