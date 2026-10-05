import type { MigrationManifest, MigrationQuestion } from "@px-lsp/protocol/migration";
import type { MigrationViewMessage, MigrationViewState } from "./messages";
import { icon } from "../shared/icons";
import { closePopover, isPopoverAnchor, menu } from "../shared/overlay";

export function migrationClient(): void {
  const vscode = (
    window as unknown as {
      acquireVsCodeApi(): { postMessage(message: MigrationViewMessage): void };
    }
  ).acquireVsCodeApi();
  let state: MigrationViewState;
  let focusToRestore: string | undefined;
  const drafts = new Map<string, string>();
  const esc = (value: unknown) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
    );
  const send = (message: MigrationViewMessage) => vscode.postMessage(message);
  const doneLabels = {
    applied: "Applied",
    "not-applicable": "Not applicable",
    manual: "Manual resolution",
    read: "Read",
  };
  const action = (name: string, label: string, disabled = false, primary = false) =>
    `<button id="action-${name}" data-action="${name}" ${disabled ? "disabled" : ""} class="px-btn" data-variant="${primary ? "default" : "outline"}">${label}</button>`;
  const list = (items: string[]) => `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`;

  function entryButton(entry: MigrationManifest, s: MigrationViewState): string {
    const progress = s.entries[entry.id];
    const completed = progress?.completion;
    const label = completed
      ? doneLabels[completed.state]
      : progress?.blocked
        ? "Waiting"
        : entry.kind === "recipe"
          ? "Migration recipe"
          : "Compatibility note";
    return `<li><button class="entry-button" data-entry="${esc(entry.id)}" aria-current="${s.selected?.id === entry.id}" ${s.busy ? "disabled" : ""}>
      <span class="entry-title">${esc(entry.title)}</span><span class="entry-meta"><span class="tag ${completed ? "complete-tag" : ""}">${label}</span>${entry.requirement === "informational" ? '<span class="muted">For reference</span>' : ""}</span></button></li>`;
  }
  function routeNavigation(s: MigrationViewState): string {
    const selectedRoute = s.route;
    const completed = selectedRoute?.entryIds.filter((id) => s.entries[id]?.completion).length ?? 0;
    let html = `<div class="route-heading"><h2>${selectedRoute ? "Your route" : "Available entries"}</h2>${selectedRoute ? `<span class="help">${completed} of ${selectedRoute.entryIds.length} handled</span>` : ""}</div>`;
    if (selectedRoute) {
      html += selectedRoute.transitions
        .map(
          (step) =>
            `<section class="route-group"><p class="transition">${esc(step.fromVersion)} → ${esc(step.toVersion)}</p><ul class="entry-list">${step.entryIds
              .map((id) => s.catalog.find((entry) => entry.id === id))
              .filter((entry): entry is MigrationManifest => !!entry)
              .map((entry) => entryButton(entry, s))
              .join("")}</ul></section>`
        )
        .join("");
      if (s.nextEntryId && s.nextEntryId !== s.selected?.id)
        html += `<button class="next" data-action="next" ${s.busy ? "disabled" : ""}>Continue to next entry →</button>`;
      if (completed === selectedRoute.entryIds.length && completed > 0)
        html +=
          '<p><strong>Listed steps handled.</strong></p><p class="muted">Test your mod in the target game. This library does not cover every possible change.</p>';
    } else if (s.catalog.length) {
      const groups = new Map<string, MigrationManifest[]>();
      for (const entry of s.catalog) {
        const key = `${entry.fromVersion} → ${entry.toVersion}`;
        groups.set(key, [...(groups.get(key) ?? []), entry]);
      }
      html += [...groups]
        .map(
          ([key, entries]) =>
            `<section class="route-group"><p class="transition">${esc(key)}</p><ul class="entry-list">${entries.map((entry) => entryButton(entry, s)).join("")}</ul></section>`
        )
        .join("");
    } else
      html +=
        '<p class="muted">No built-in entries are available for this game. Load a local note or recipe to start.</p>';
    return html;
  }
  function question(q: MigrationQuestion, s: MigrationViewState): string {
    const value = s.answers[q.id];
    const disabled = s.busy || s.entries[s.selected!.id]?.blocked ? "disabled" : "";
    const common = `id="q-${esc(q.id)}" data-question="${esc(q.id)}" ${disabled} ${q.required ? 'aria-required="true"' : ""}`;
    let input: string;
    if (q.kind === "choice" || q.kind === "boolean") {
      const label =
        q.kind === "boolean"
          ? value === true
            ? "Yes"
            : value === false
              ? "No"
              : "Choose…"
          : (q.options?.find((option) => option.value === value)?.label ?? "Choose…");
      input = `<button type="button" class="px-btn px-dropdown" data-variant="outline" aria-haspopup="listbox" aria-labelledby="label-${esc(q.id)} q-${esc(q.id)}" ${common} ${q.kind === "boolean" ? 'data-boolean="true"' : ""} value="${esc(value ?? "")}"><span class="px-truncate">${esc(label)}</span>${icon("chevronDown")}</button>`;
    } else input = `<input class="px-input" ${common} value="${esc(value ?? "")}">`;
    return `<div class="question" data-search="${esc(`${q.group ?? ""} ${q.label} ${q.description ?? ""}`.toLocaleLowerCase())}"><label id="label-${esc(q.id)}" for="q-${esc(q.id)}">${esc(q.label)}${q.required ? '<span class="required">Required</span>' : ""}</label>${q.description ? `<p class="help">${esc(q.description)}</p>` : ""}${input}</div>`;
  }
  function questions(s: MigrationViewState): string {
    const groups = new Map<string, MigrationQuestion[]>();
    for (const q of s.inspection!.questions) {
      const group = q.group ?? "";
      const items = groups.get(group) ?? [];
      items.push(q);
      groups.set(group, items);
    }
    const filter =
      s.inspection!.questions.length > 6
        ? `<input id="choice-filter" class="px-input choice-filter" type="search" aria-label="Filter choices" placeholder="Find a faith, file or choice…" value="${esc(drafts.get(`filter:${s.selected!.id}`) ?? "")}">`
        : "";
    return `${filter}<div id="choices">${[...groups]
      .map(([group, items]) => {
        const content = items.map((q) => question(q, s)).join("");
        if (!group) return content;
        const remaining = items.filter((q) => s.missing.includes(q.id)).length;
        const answered = items.filter((q) => s.answers[q.id] !== undefined).length;
        return `<details id="choices-${esc(group)}" class="question-group" ${remaining || groups.size < 4 ? "open" : ""}><summary>${icon("chevronRight")}<span>${esc(group)}</span><span class="help">${remaining ? `${remaining} to choose` : `${answered} of ${items.length} set`}</span></summary><div class="group-questions">${content}</div></details>`;
      })
      .join("")}</div><p id="choices-empty" class="help" hidden>No choices match your search.</p>`;
  }
  function filterChoices(): void {
    const query =
      (document.getElementById("choice-filter") as HTMLInputElement | null)?.value
        .trim()
        .toLocaleLowerCase() ?? "";
    let found = false;
    document.querySelectorAll<HTMLElement>("#choices .question").forEach((item) => {
      item.hidden = !item.dataset.search!.includes(query);
      found ||= !item.hidden;
    });
    document.querySelectorAll<HTMLDetailsElement>(".question-group").forEach((group) => {
      group.hidden = !group.querySelector(".question:not([hidden])");
      if (query && !group.hidden) group.open = true;
    });
    const empty = document.getElementById("choices-empty");
    if (empty) empty.hidden = found;
  }
  function detail(s: MigrationViewState): string {
    const entry = s.selected;
    if (!entry)
      return '<div class="empty"><h2>Choose where your mod is going</h2><p>Set the game version your mod was built for and the version you want to support. The toolkit connects the available notes and recipes in order.</p><p class="muted">Select an entry to read its scope and evidence. Loading an entry does not change your mod.</p></div>';
    const progress = s.entries[entry.id];
    const blocked = progress?.blocked;
    const trusted = progress?.trusted ?? !s.local;
    const completion = progress?.completion;
    const disabled = s.busy || !!blocked || !trusted;
    let html = `<header class="detail-header"><div class="tags"><span class="tag">${entry.kind === "recipe" ? "Migration recipe" : "Compatibility note"}</span><span class="version-label">${esc(entry.fromVersion)} → ${esc(entry.toVersion)}</span></div><h2 id="entry-heading" tabindex="-1">${esc(entry.title)}</h2><p>${esc(entry.description)}</p><p class="help">${s.local ? (s.localFormat === "data" ? "Local note · Data only" : trusted ? "Trusted local code" : "Local code · Reload to use") : "Built-in library"} · Revision ${esc(entry.revision)}${entry.requirement === "informational" ? " · For reference" : ""}</p></header>`;
    if (entry.guidance) html += `<div class="guidance">${esc(entry.guidance)}</div>`;
    if (entry.limitations.length)
      html += `<details class="section"><summary>Scope and limits</summary>${list(entry.limitations)}</details>`;
    if (blocked) html += `<p class="issues">${esc(blocked)}</p>`;
    if (!trusted)
      html += `<div class="actions">${action("reload", s.localFormat === "data" ? "Refresh note" : "Reload entry…", s.busy)}<p class="help">${s.localFormat === "data" ? "Refresh this saved note from its file before recording progress. JSON notes do not run code." : "Review and trust local code before running it in this session."}</p></div>`;
    const needed = [...new Set(entry.inputs.map((input) => input.root))].filter((root) => root !== "mod");
    const missingFolders =
      !s.roots.mod ||
      needed.some(
        (root) =>
          !s.references.find(
            (reference) => reference.version === (root === "source" ? entry.fromVersion : entry.toVersion)
          )?.path
      );
    if (entry.detection === "script")
      html += `<div class="toolbar actions">${action("scan", s.inspection ? "Check again" : entry.kind === "recipe" ? "Use migration" : "Check mod", disabled || missingFolders, !s.inspection && !completion)}</div>${missingFolders ? '<p class="help">Choose the mod folder and the required game data folders to run this check.</p>' : ""}`;
    if (needed.length)
      html += `<details id="game-data" class="section" ${missingFolders ? "open" : ""}><summary>Game data for this step</summary>${needed
        .map((root) => {
          const version = root === "source" ? entry.fromVersion : entry.toVersion;
          const reference = s.references.find((item) => item.version === version);
          return `<div class="reference"><div class="path"><p><strong>${esc(version)}</strong> <span class="help">${root === "source" ? "Source" : "Target"} · Read-only</span></p><p class="muted">${esc(reference?.path ?? "Choose the game data folder for this version")}</p>${reference?.path && !reference.verified ? '<p class="help">Version selected by you; no matching launcher metadata.</p>' : ""}</div><button data-root="${root}" ${s.busy ? "disabled" : ""}>Choose folder</button></div>`;
        })
        .join("")}</details>`;
    if (completion)
      html += `<div class="completion"><strong>${doneLabels[completion.state]}</strong>${completion.note ? `<p>${esc(completion.note)}</p>` : ""}${completion.state === "manual" ? '<p class="help">Recorded by you. The toolkit has not verified this manual work.</p>' : ""}</div>`;
    if (s.inspection) {
      const inspection = s.inspection;
      html += `<section class="section"><h3>What this check found</h3>${inspection.findings.map((finding) => `<div class="finding"><span class="tag">${esc(finding.severity)}</span>${esc(finding.message)}${finding.path ? `<div class="help">${esc(finding.path)}${finding.line ? ":" + finding.line : ""}</div>` : ""}</div>`).join("")}`;
      if (!inspection.findings.length)
        html += `<p>${inspection.applicability === "not-applicable" ? "This entry does not apply to the inspected files." : inspection.applicability === "unknown" ? "The check could not determine whether this entry applies. Review the guidance and limits." : "No findings were reported within this entry’s scope."}</p><p class="help">This check does not establish compatibility.</p>`;
      if (inspection.questions.length)
        html += `<h3>Your choices</h3>${s.missing.length ? `<p class="help">${s.missing.length} required ${s.missing.length === 1 ? "choice remains" : "choices remain"}.</p>` : ""}${questions(s)}`;
      if (inspection.coverage.length)
        html += `<details open><summary>Coverage and remaining work</summary>${list(inspection.coverage)}</details>`;
      if (entry.kind === "recipe" && !s.preview && !completion)
        html += `<div class="toolbar actions">${action("prepare", "Review changes", disabled || !!s.missing.length || inspection.findings.some((f) => f.severity === "error") || inspection.applicability !== "applicable", true)}</div>`;
      html += "</section>";
    }
    if ((entry.kind === "advisory" || s.inspection) && !completion) {
      html +=
        entry.kind === "advisory"
          ? '<section class="section manual"><h3>Handle this note</h3>'
          : '<details class="section manual"><summary>Resolve this step manually</summary>';
      if (entry.requirement === "informational")
        html += `<p>Keep this information in mind as you update your mod.</p>${action("read", "Mark read", disabled, true)}`;
      else
        html += `<p>Make the required changes in your mod, then record what you did. You can also explain why this note does not apply.</p><label for="manual-note">Resolution note</label><textarea id="manual-note" placeholder="What did you change or check?" ${disabled ? "disabled" : ""}>${esc(drafts.get(entry.id) ?? "")}</textarea><div class="toolbar">${action("manual", "Record manual resolution", disabled || !(drafts.get(entry.id) ?? "").trim(), true)}</div><p class="help">This records your decision. It does not run a game validation.</p>`;
      html += entry.kind === "advisory" ? "</section>" : "</details>";
    }
    if (s.preview) {
      html += `<section class="section"><h3>Review changes</h3><p>Review the exact output before applying it. Applying saves the listed files, including any unsaved edits included in this review.</p>${s.preview.files.map((file) => `<div class="file"><span><code>${esc(file.path)}</code><br><span class="help">${file.before} → ${file.after} bytes</span></span><button data-diff="${esc(file.path)}" ${s.busy ? "disabled" : ""}>${file.text ? "Open diff" : "Review metadata"}</button></div>`).join("")}${!s.preview.files.length ? "<p>No automatic edits were prepared. Check the remaining work above.</p>" : ""}${s.preview.checks.length ? `<details open><summary>Validation checks</summary><ul>${s.preview.checks.map((check) => `<li>${esc(check.label)}: <strong>${esc(check.status)}</strong> <span class="help">(${esc(check.necessity)}, ${esc(check.stage)})</span>${check.detail ? `<p class="help">${esc(check.detail)}</p>` : ""}</li>`).join("")}</ul></details>` : ""}${s.preview.blocked ? `<p class="issues">${esc(s.preview.blocked)}</p>` : ""}<div class="toolbar actions">${action("apply", "Apply migration", disabled || !s.preview.files.length || !!s.preview.blocked, true)}</div></section>`;
    }
    if (entry.evidence.length)
      html += `<details><summary>Sources and evidence</summary>${list(entry.evidence)}</details>`;
    return html;
  }
  function render(s: MigrationViewState): void {
    closePopover();
    const previousEntry = state?.selected?.id;
    state = s;
    const focused = document.activeElement as HTMLInputElement | null;
    if (focused?.id) focusToRestore = focused.id;
    const focusId = previousEntry !== s.selected?.id ? "entry-heading" : focusToRestore;
    const selection =
      focused?.tagName === "TEXTAREA" || focused?.tagName === "INPUT"
        ? [focused.selectionStart, focused.selectionEnd]
        : undefined;
    const openDetails =
      previousEntry === s.selected?.id
        ? new Map(
            Array.from(document.querySelectorAll<HTMLDetailsElement>("details[id]")).map((item) => [
              item.id,
              item.open,
            ])
          )
        : new Map<string, boolean>();
    const app = document.getElementById("app")!;
    app.setAttribute("aria-busy", String(s.busy));
    const disabled = s.busy ? "disabled" : "";
    app.innerHTML = `<section class="setup" aria-label="Choose mod and game versions"><div class="mod-folder"><strong>Mod folder</strong><span class="path muted">${esc(s.roots.mod ?? "Choose the mod you want to update")}</span><button data-root="mod" ${disabled}>Choose folder</button></div><form id="versions" class="version-form"><div class="version-field"><label for="from-version">Built for game version</label><input id="from-version" list="game-versions" placeholder="Source version" value="${esc(drafts.get("version:from") ?? s.fromVersion)}" ${disabled} required></div><span class="arrow" aria-hidden="true">→</span><div class="version-field"><label for="to-version">Update to game version</label><input id="to-version" list="game-versions" placeholder="Target version" value="${esc(drafts.get("version:to") ?? s.toVersion)}" ${disabled} required></div><button type="submit" ${disabled}>Find route</button><datalist id="game-versions">${s.versions.map((version) => `<option value="${esc(version)}"></option>`).join("")}</datalist></form><div class="setup-footer"><p class="help">Use exact game builds, for example 1.19.0.6 and 1.20.0.2.</p><div class="toolbar"><button class="link-button" data-action="load" title="Select one or more JSON notes or JavaScript recipes" ${disabled}>Load files…</button><button class="link-button" data-action="load-folder" title="Find contributions in a folder and its subfolders" ${disabled}>Load folder…</button><button class="link-button" data-action="template" ${disabled}>Create an entry…</button></div></div></section><div class="feedback"><div class="${s.busy ? "busy" : ""}"><div class="status" role="status">${esc(s.status)}</div>${s.canCancel ? action("cancel", "Cancel") : ""}</div>${s.error ? `<div class="error" role="alert">${esc(s.error)}</div>` : ""}${s.issues.length ? `<div class="issues"><strong>Route needs attention</strong>${s.issues.map((issue) => `<p>${esc(issue)}</p>`).join("")}</div>` : ""}</div>`;
    if (s.routes.length > 1)
      app.innerHTML += `<details ${s.route ? "" : "open"}><summary>${s.route ? "Review alternative routes" : "Choose a route"}</summary><p>These routes contain different entries. Read their scopes before you choose.</p><div class="route-alternatives">${s.routes.map((route) => `<button class="route-choice" data-route="${esc(route.id)}" ${disabled}><strong>${esc([route.fromVersion, ...route.transitions.map((step) => step.toVersion)].join(" → "))}</strong><span class="help">${route.entryIds.length} entries · ${esc(route.entryIds.map((id) => s.catalog.find((entry) => entry.id === id)?.title ?? id).join(", "))}</span></button>`).join("")}</div></details>`;
    app.innerHTML += `<div class="workspace"><nav class="route-nav" aria-label="Compatibility route">${routeNavigation(s)}</nav><article class="detail" aria-label="Selected compatibility entry">${detail(s)}</article></div><footer class="footer"><p class="muted coverage-note">The library covers known changes. A connected route and handled entries do not establish full compatibility. Test the result in your target game.</p>${s.canRestore ? action("restore", "Restore last applied migration", s.busy) : ""}</footer>`;
    app.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
      button.classList.add("px-btn");
      button.dataset.variant ??= button.dataset.entry ? "ghost" : "outline";
    });
    app.querySelectorAll("input").forEach((input) => input.classList.add("px-input"));
    app.querySelectorAll("textarea").forEach((input) => input.classList.add("px-textarea"));
    app.querySelectorAll(".tag").forEach((tag) => tag.classList.add("px-badge"));
    app.querySelectorAll<HTMLDetailsElement>("details[id]").forEach((item) => {
      const open = openDetails.get(item.id);
      if (open !== undefined) item.open = open;
    });
    filterChoices();
    if (focusId && !s.busy) {
      const next = document.getElementById(focusId) as HTMLInputElement | null;
      next?.focus({ preventScroll: true });
      if (selection && next && (next.tagName === "TEXTAREA" || next.type === "text"))
        next.setSelectionRange(selection[0], selection[1]);
      focusToRestore = undefined;
    }
  }
  document.addEventListener("submit", (event) => {
    if ((event.target as HTMLElement).id !== "versions") return;
    event.preventDefault();
    drafts.delete("version:from");
    drafts.delete("version:to");
    send({
      type: "versions",
      fromVersion: (document.getElementById("from-version") as HTMLInputElement).value.trim(),
      toVersion: (document.getElementById("to-version") as HTMLInputElement).value.trim(),
    });
  });
  document.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest("button");
    if (!button || button.disabled) return;
    const data = button.dataset;
    if (data.question && button.classList.contains("px-dropdown")) {
      if (isPopoverAnchor(button)) {
        closePopover();
        return;
      }
      const q = state.inspection?.questions.find((item) => item.id === data.question);
      if (!q) return;
      const options =
        q.kind === "boolean"
          ? [
              { value: "true", label: "Yes" },
              { value: "false", label: "No" },
            ]
          : (q.options ?? []);
      menu(button, [{ value: "", label: "Choose…" }, ...options], {
        value: button.value,
        width: Math.max(240, button.getBoundingClientRect().width),
        onPick: (value) => {
          button.value = value;
          button.querySelector("span")!.textContent =
            options.find((option) => option.value === value)?.label ?? "Choose…";
          button.dispatchEvent(new Event("change", { bubbles: true }));
        },
      });
    } else if (data.entry) send({ type: "recipe", id: data.entry });
    else if (data.route) send({ type: "route", id: data.route });
    else if (data.root) send({ type: "root", root: data.root as "mod" | "source" | "target" });
    else if (data.diff) send({ type: "diff", path: data.diff });
    else if (data.action === "manual")
      send({
        type: "complete",
        state: "manual",
        note: (document.getElementById("manual-note") as HTMLTextAreaElement).value.trim(),
      });
    else if (data.action === "read") send({ type: "complete", state: "read" });
    else if (data.action) send({ type: data.action } as MigrationViewMessage);
  });
  document.addEventListener("input", (event) => {
    const el = event.target as HTMLTextAreaElement;
    if (el.id === "choice-filter" && state.selected) {
      drafts.set(`filter:${state.selected.id}`, el.value);
      filterChoices();
      return;
    }
    if (el.id === "from-version" || el.id === "to-version") {
      drafts.set(el.id === "from-version" ? "version:from" : "version:to", el.value);
      return;
    }
    if (el.id !== "manual-note" || !state.selected) return;
    drafts.set(state.selected.id, el.value);
    const button = document.querySelector<HTMLButtonElement>('[data-action="manual"]');
    if (button)
      button.disabled =
        !el.value.trim() ||
        state.busy ||
        !!state.entries[state.selected.id]?.blocked ||
        !state.entries[state.selected.id]?.trusted;
  });
  document.addEventListener("change", (event) => {
    const el = event.target as HTMLInputElement;
    if (el.dataset.question)
      send({
        type: "answer",
        id: el.dataset.question,
        value: el.dataset.boolean && el.value !== "" ? el.value === "true" : el.value,
      });
  });
  window.addEventListener("message", (event) => {
    if (event.data?.type === "state") render(event.data.state);
  });
  send({ type: "ready" });
}
