/**
 * The Workshop panel app: the focused mod's Workshop item on one page - what
 * the descriptor and workshop.json say (editable drafts), what Steam says
 * live (fetched through the host), and an Upload that submits the checked
 * parts. Drafts autosave to the mod's workshop.json; nothing reaches Steam
 * until Upload. Built from the shared px-ui classes; talks to the host only
 * through messages.ts.
 */
import type { ItemDetails, WorkshopVisibility } from "../../../steam/jobs";
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
/** Local drafts under edit (mirrors of workshop.json, saved debounced). */
let draftDescription = "";
let draftTranslations: Record<string, TranslationDraft> = {};
const collapsed = new Set<string>();

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
  $("busy").classList.toggle("on", busy || fetching);
}

function renderItem(): void {
  $("noDescriptor").classList.toggle("on", !!info?.descriptorMissing);
  $("itemSection").style.display = info && !info.descriptorMissing ? "" : "none";
  if (!info || info.descriptorMissing) return;

  const title = $<HTMLInputElement>("title");
  title.value = live?.title && !info.name ? live.title : (info.name ?? "");
  if (!info.name) title.placeholder = "descriptor has no name=";

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

  const tags = $("tags");
  tags.replaceChildren();
  for (const t of info.tags) {
    const b = document.createElement("span");
    b.className = "px-badge";
    b.dataset.variant = "secondary";
    b.textContent = t;
    tags.append(b);
  }
  if (!info.tags.length) {
    const s = document.createElement("span");
    s.className = "px-muted px-xs";
    s.textContent = "none - set tags={} in the descriptor";
    tags.append(s);
  }

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
  const remove = document.createElement("button");
  remove.className = "px-btn";
  remove.dataset.variant = "ghost";
  remove.dataset.size = "icon-xs";
  remove.setAttribute("data-tip", "Remove this language (its drafts are deleted from workshop.json)");
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
  head.append(caret, name, state, remove);
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
  body.append(title, desc);

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
      `Uploading translations needs steamworks.js ${info.requiredSteamworksVersion} or newer bundled ` +
      "with the extension. Drafts still save locally; they upload once the extension ships the newer binding.";
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
  info = next;
  live = null;
  liveTranslations = {};
  liveError = null;
  pickedVisibility = null;
  draftDescription = next?.description ?? "";
  draftTranslations = structuredClone(next?.translations ?? {});
  $<HTMLTextAreaElement>("desc").value = draftDescription;
  $<HTMLInputElement>("note").value = next?.changeNoteSuggestion ?? "";
  renderAll();
  if (next?.publishedId) {
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
      collapsed.delete(api);
      queueSave();
      renderTranslations();
      renderPublish();
    },
  });
});

$("upload").addEventListener("click", () => {
  if (!info || busy) return;
  const content = $<HTMLInputElement>("incContent").checked;
  const details = $<HTMLInputElement>("incDetails").checked;
  const languages = $<HTMLInputElement>("incLangs").checked ? uploadableLanguages() : [];
  if (!content && !details && !languages.length) {
    toast("Nothing to upload - check at least one part under Publish.", "destructive");
    return;
  }
  flushSave();
  send({
    type: "upload",
    content,
    details,
    languages,
    changeNote: $<HTMLInputElement>("note").value,
    visibility: details ? pickedVisibility : null,
  });
});

send({ type: "ready" });
