import type { PatchEntry, PatchResolution } from "@px-lsp/server/compatch/model";
import type { PatchFilter, PatchViewMessage, PatchViewState } from "./messages";

export function patchClient(): void {
  const api = (
    window as unknown as { acquireVsCodeApi(): { postMessage(message: PatchViewMessage): void } }
  ).acquireVsCodeApi();
  const app = document.getElementById("app")!;
  let state: PatchViewState;
  let sourcesOpen = true;
  let scannedProject = false;
  const drafts = new Map<string, string>();
  const esc = (value: unknown) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
    );
  const send = (message: PatchViewMessage) => api.postMessage(message);
  const labels = {
    "needs-decision": "Choose a result",
    changed: "Inputs changed",
    ready: "Decision saved",
    identical: "Same content",
    unsupported: "Manual review",
  };
  const button = (action: string, label: string, disabled = false, primary = false, extra = "") =>
    `<button type="button" class="px-btn" data-variant="${primary ? "default" : "outline"}" data-action="${action}" ${disabled ? "disabled" : ""} ${extra}>${label}</button>`;
  const note = () => (document.getElementById("decision-note") as HTMLTextAreaElement | null)?.value ?? "";
  const resolve = (resolution: PatchResolution) =>
    state.selected &&
    send({ type: "resolve", id: state.selected.id, resolution: { ...resolution, note: note() } });
  function detail(entry: PatchEntry): string {
    const disabled = state.busy || state.needsRefresh || state.recoveryBlocked;
    const supported = entry.state !== "unsupported";
    const modes = entry.allowedModes ?? [
      "defer",
      ...(entry.winner ? ["winner"] : []),
      ...(supported ? ["source", "manual", ...(entry.fieldsSupported ? ["fields"] : [])] : []),
    ];
    const selected = entry.decision?.resolution;
    const fieldChoice = (key: string) => {
      const draft = drafts.get(`${entry.id}:field:${key}`);
      if (draft !== undefined) return draft;
      const chosen = selected?.fields?.[key];
      const fallback =
        entry.contributors.find((c) => c.id === entry.winner && c.fields[key] !== undefined)?.id ??
        entry.contributors.find((c) => c.fields[key] !== undefined)?.id;
      return chosen === null ? "" : (chosen ?? fallback ?? "");
    };
    return `<div class="section-heading"><h2>${esc(entry.name)}</h2><span class="px-badge">${selected?.mode === "defer" ? "Manual work remains" : labels[entry.state]}</span></div>
      <p>${esc(entry.explanation)}</p>
      ${entry.state === "changed" ? '<p class="notice">The inputs for this decision changed. Your previous choice is shown below. Review it before saving again.</p>' : ""}
      ${entry.issues.length ? `<ul class="help">${entry.issues.map((issue) => `<li>${esc(issue)}</li>`).join("")}</ul>` : ""}
      <div>${entry.contributors.map((c) => `<section class="contribution"><div class="section-heading"><h3>${esc(c.sourceName)}</h3><span class="px-badge">${c.id === entry.winner ? "Expected winner" : c.active ? "Loaded contribution" : "Hidden by another file"}</span></div><div class="path help">${esc(c.path)}</div>${c.reason ? `<p class="help">${esc(c.reason)}</p>` : ""}<details><summary>Read contribution</summary><pre>${esc(c.text.slice(0, 12000))}${c.text.length > 12000 ? "\n... Open source to read the full file." : ""}</pre></details><div class="toolbar">${button("source", "Open source", state.busy, false, `data-contributor="${esc(c.id)}"`)}${button("use-source", selected?.mode === "source" && selected.contributorId === c.id ? "Save this choice again" : "Use this contribution", disabled || !modes.includes("source"), false, `data-contributor="${esc(c.id)}"`)}</div></section>`).join("")}</div>
      <section class="decision"><label for="decision-note">Decision note <span class="help">(optional)</span></label><textarea id="decision-note" class="px-input resolution-note" rows="2" ${disabled ? "disabled" : ""}>${esc(drafts.get(`${entry.id}:note`) ?? selected?.note ?? "")}</textarea>
      <div class="toolbar">${button("winner", entry.winner ? "Keep expected winner" : "Accept removal", disabled || !modes.includes("winner"))}${button("defer", "Handle outside toolkit", disabled)}</div>
      ${
        entry.fieldsSupported
          ? `<details><summary>Combine fields</summary><p class="help">Choose the source for each complete field. Repeated fields stay together; their order is preserved.</p><div class="field-grid">${entry.fieldKeys
              .map(
                (key, index) =>
                  `<label for="field-${index}">${esc(key)}</label><select id="field-${index}" class="px-select" data-field="${esc(key)}" ${disabled ? "disabled" : ""}><option value="" ${fieldChoice(key) === "" ? "selected" : ""}>Omit this field</option>${entry.contributors
                    .filter((c) => c.fields[key] !== undefined)
                    .map(
                      (c) =>
                        `<option value="${esc(c.id)}" ${fieldChoice(key) === c.id ? "selected" : ""}>${esc(c.sourceName)}</option>`
                    )
                    .join("")}</select>`
              )
              .join("")}</div>${button("fields", "Save field choices", disabled, true)}</details>`
          : ""
      }
      ${modes.includes("manual") ? `<details><summary>Write a manual result</summary><p class="help">Enter the complete ${entry.kind === "file" ? "file" : "definition or localization entry"}. The toolkit checks its structure before saving the choice.</p><textarea id="manual-text" class="px-input manual-text" aria-label="Manual result" spellcheck="false" ${disabled ? "disabled" : ""}>${esc(drafts.get(`${entry.id}:text`) ?? selected?.text ?? entry.contributors.find((c) => c.id === entry.winner)?.text ?? entry.contributors[0]?.text ?? "")}</textarea>${button("manual", "Save manual result", disabled)}</details>` : ""}</section>`;
  }
  function render(): void {
    const active = document.activeElement?.id;
    const s = state;
    const locked = s.busy || s.recoveryBlocked;
    const message = `${s.error ? `<div class="notice error" role="alert">${esc(s.error)}</div>` : ""}${s.status ? `<p role="status">${esc(s.status)}</p>` : ""}`;
    if (!s.output) {
      app.innerHTML = `<section class="empty"><h2>Build a patch you can maintain</h2><p>Add the mods in their launcher order, choose how their conflicting content should work together, and write the result to a separate mod.</p><label for="new-name">Patch name</label><div class="toolbar"><input id="new-name" class="px-input new-name" value="${esc(drafts.get("name") ?? "My compatibility patch")}" maxlength="100">${button("create", "Create patch", s.busy, true)}${button("open", "Open existing patch", s.busy)}</div><p class="help">Choices are saved with the patch. Source folders are kept in your local settings.</p></section>${message}`;
      app.setAttribute("aria-busy", String(s.busy));
      return;
    }
    app.innerHTML = `<details class="setup" ${sourcesOpen ? "open" : ""}><summary>${esc(s.name)} · ${s.inputs.length} source mods</summary><p class="path help">Output: ${esc(s.output)}</p><p>Match the order in the launcher. The first source loads first. Load this patch after the source mods for script file replacements.</p><ol class="source-list">${s.inputs.map((input, index) => `<li><div class="source-row"><div class="source-main"><strong>${esc(input.name)}${input.version ? ` <span class="help">${esc(input.version)}</span>` : ""}</strong><small>${esc(input.path ?? "Folder not connected on this machine")}</small></div><div class="source-actions">${button("up", "↑", locked || index === 0, false, `data-id="${esc(input.id)}" aria-label="Move ${esc(input.name)} earlier"`)}${button("down", "↓", locked || index === s.inputs.length - 1, false, `data-id="${esc(input.id)}" aria-label="Move ${esc(input.name)} later"`)}${button("bind", input.path ? "Change folder" : "Connect folder", locked, false, `data-id="${esc(input.id)}"`)}${button("remove", "Remove", locked, false, `data-id="${esc(input.id)}"`)}</div></div></li>`).join("")}</ol><div class="toolbar">${button("add", "Add mods", locked)}${button("open", "Open another patch", locked)}${button("migrations", "Game version updates", s.busy)}</div></details>
      <div class="section-heading"><div class="entry-meta"><span>${s.counts.attention} need review</span><span>${s.counts.ready} decisions saved</span>${s.counts.manual ? `<span>${s.counts.manual} left for manual work</span>` : ""}<span>${s.counts.identical} identical</span></div><div class="toolbar">${button("scan", s.needsRefresh ? "Refresh conflicts" : "Scan mods", locked || s.inputs.length < 2, !s.canPrepare)}${s.busy ? (s.canCancel ? button("cancel", "Cancel", false) : "") : button("prepare", "Build patch", !s.canPrepare, true)}${button("restore", "Restore last update", s.busy || !s.canRestore)}</div></div>
      ${message}${s.recoveryBlocked ? '<p class="notice">An earlier write did not finish. Restore it before changing this project.</p>' : ""}
      ${s.issues.length ? `<details class="coverage"><summary>Coverage and source notes (${s.issues.length})</summary><ul>${s.issues.map((issue) => `<li>${esc(issue)}</li>`).join("")}</ul></details>` : ""}
      <div class="workbench"><nav class="queue" aria-label="Patch conflicts"><h2>Review decisions</h2><label class="help" for="entry-filter">Show</label><select id="entry-filter" class="px-select" ${s.busy ? "disabled" : ""}>${(
        [
          ["attention", "Needs review"],
          ["ready", "Saved decisions"],
          ["all", "All overlaps"],
        ] as const
      )
        .map(
          ([value, title]) =>
            `<option value="${value}" ${s.filter === value ? "selected" : ""}>${title}</option>`
        )
        .join(
          ""
        )}</select><ul class="entry-list">${s.rows.map((row) => `<li><button class="entry-button" data-entry="${esc(row.id)}" aria-current="${s.selected?.id === row.id}" ${s.busy ? "disabled" : ""}><span class="entry-name">${esc(row.name)}</span><span class="entry-meta">${esc(row.kind)} · ${labels[row.state]}</span></button></li>`).join("")}</ul>${s.rows.length ? `<div class="pagination">${button("previous", "Previous", s.busy || s.page === 0)}<small>${s.page * 40 + 1}–${Math.min((s.page + 1) * 40, s.total)} of ${s.total}</small>${button("next", "Next", s.busy || (s.page + 1) * 40 >= s.total)}</div>` : '<p class="help">No items in this view. Scan the mods or choose another filter.</p>'}</nav><section class="detail">${s.selected ? detail(s.selected) : '<h2>Choose an item to review</h2><p class="help">See each contribution, the expected result, and the choices the toolkit can safely apply.</p>'}</section></div>
      ${s.files.length || s.conflicts.length ? `<section class="output"><div class="section-heading"><h2>Patch changes</h2>${button("apply", "Apply patch", !s.canApply, true)}</div><p class="help">Review the file changes before applying. A recovery copy is saved for this update.</p>${s.conflicts.map((c) => `<div class="conflict"><strong class="path">${esc(c.path)}</strong><p>${esc(c.reason)}</p><div class="toolbar">${button("diff", "Compare results", s.busy, false, `data-path="${esc(c.path)}"`)}${button("keep-output", "Keep current output", s.busy, false, `data-path="${esc(c.path)}"`)}${button("generated-output", c.generated === undefined ? "Remove this file" : "Use generated result", s.busy, false, `data-path="${esc(c.path)}"`)}</div></div>`).join("")}${s.files.map((file) => `<div class="file-row"><span><span class="px-badge">${file.action}</span> <span class="path">${esc(file.path)}</span></span>${button("diff", "Review changes", s.busy, false, `data-path="${esc(file.path)}"`)}</div>`).join("")}</section>` : ""}`;
    app.setAttribute("aria-busy", String(s.busy));
    app.querySelector<HTMLDetailsElement>(".setup")?.addEventListener("toggle", (event) => {
      sourcesOpen = (event.target as HTMLDetailsElement).open;
    });
    if (active) document.getElementById(active)?.focus();
  }
  app.addEventListener("input", (event) => {
    const input = event.target as HTMLInputElement;
    if (input.id === "new-name") drafts.set("name", input.value);
    if (state.selected && input.id === "decision-note") drafts.set(`${state.selected.id}:note`, input.value);
    if (state.selected && input.id === "manual-text") drafts.set(`${state.selected.id}:text`, input.value);
  });
  app.addEventListener("change", (event) => {
    const input = event.target as HTMLSelectElement;
    if (input.id === "entry-filter") send({ type: "filter", value: input.value as PatchFilter });
    if (input.dataset.field && state.selected)
      drafts.set(`${state.selected.id}:field:${input.dataset.field}`, input.value);
  });
  app.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!target || target.disabled) return;
    if (target.dataset.entry) {
      send({ type: "select", id: target.dataset.entry });
      return;
    }
    const action = target.dataset.action;
    switch (action) {
      case "create":
        send({ type: "create", name: (document.getElementById("new-name") as HTMLInputElement).value });
        break;
      case "up":
      case "down":
        send({ type: "move", id: target.dataset.id!, direction: action === "up" ? -1 : 1 });
        break;
      case "remove":
      case "bind":
        send({ type: action, id: target.dataset.id! });
        break;
      case "source":
        if (state.selected)
          send({ type: "source", id: state.selected.id, contributorId: target.dataset.contributor! });
        break;
      case "use-source":
        resolve({ mode: "source", contributorId: target.dataset.contributor });
        break;
      case "winner":
        resolve({ mode: "winner" });
        break;
      case "defer":
        resolve({ mode: "defer" });
        break;
      case "fields":
        resolve({
          mode: "fields",
          fields: Object.fromEntries(
            Array.from(app.querySelectorAll<HTMLSelectElement>("[data-field]")).map((select) => [
              select.dataset.field!,
              select.value || null,
            ])
          ),
        });
        break;
      case "manual":
        resolve({
          mode: "manual",
          text: (document.getElementById("manual-text") as HTMLTextAreaElement).value,
        });
        break;
      case "previous":
      case "next":
        send({ type: "page", value: state.page + (action === "previous" ? -1 : 1) });
        break;
      case "diff":
        send({ type: "diff", path: target.dataset.path! });
        break;
      case "keep-output":
      case "generated-output":
        send({
          type: "output-choice",
          path: target.dataset.path!,
          choice: action === "keep-output" ? "current" : "generated",
        });
        break;
      case "open":
      case "add":
      case "scan":
      case "prepare":
      case "apply":
      case "restore":
      case "cancel":
      case "migrations":
        send({ type: action });
        break;
    }
  });
  window.addEventListener("message", (event: MessageEvent<{ type: string; state: PatchViewState }>) => {
    if (event.data.type === "state") {
      if (state?.output !== event.data.state.output) {
        sourcesOpen = true;
        scannedProject = false;
      }
      const counts = event.data.state.counts;
      if (
        !scannedProject &&
        !event.data.state.needsRefresh &&
        counts.attention + counts.ready + counts.identical > 0
      ) {
        sourcesOpen = false;
        scannedProject = true;
      }
      state = event.data.state;
      render();
    }
  });
  send({ type: "ready" });
}
