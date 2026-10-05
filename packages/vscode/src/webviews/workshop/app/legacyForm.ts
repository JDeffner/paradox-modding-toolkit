import { legacyVersion } from "../../../steam/legacyVersion";
import { el } from "../../shared/dom";
import { closePopover } from "../../shared/overlay";

let cancelOpenForm: (() => void) | undefined;

export function closeLegacyForm(): void {
  cancelOpenForm?.();
}

/** Local creation only. Steam publication remains a separate, confirmed action. */
export function legacyForm(
  seed: string,
  existing: string[],
  pickZip: () => Promise<{ id: string; name: string } | null>
): Promise<{ version: string; archive?: string } | null> {
  closeLegacyForm();
  closePopover();
  const previous = document.activeElement as HTMLElement | null;
  const dialog = el("form", "section legacy-form");
  dialog.setAttribute("aria-labelledby", "legacy-dialog-title");
  dialog.setAttribute("aria-describedby", "legacy-dialog-description");
  const title = el("h2", "px-dialog-title", "Create legacy version");
  title.id = "legacy-dialog-title";
  const description = el(
    "p",
    "px-dialog-description",
    "Create a separate Workshop listing for players who stay on an older game version. This copies your live listing into a local legacy folder. Your live listing stays unchanged."
  );
  description.id = "legacy-dialog-description";
  const note = el(
    "p",
    "px-dialog-description",
    "Nothing is uploaded yet. The first upload sends the chosen mod files to a new, private Steam item. Later uploads can update its listing information only."
  );
  const label = document.createElement("label");
  label.className = "px-label";
  label.textContent = "Game version";
  label.htmlFor = "legacy-game-version";
  const input = document.createElement("input");
  input.id = label.htmlFor;
  input.className = "px-input";
  input.value = seed;
  input.placeholder = "For example, 1.19.*";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-describedby", "legacy-version-help legacy-version-error");
  const hint = el(
    "p",
    "px-dialog-description",
    "Use 1.19 for all 1.19 patches, or 1.19.2 for one exact patch."
  );
  hint.id = "legacy-version-help";
  const error = el("p", "legacy-error");
  error.id = "legacy-version-error";
  error.setAttribute("role", "alert");
  const actions = el("div", "px-dialog-actions");
  const sources = el("fieldset", "legacy-sources");
  sources.append(el("legend", "px-label", "Mod files"));
  const sourceOption = (value: string, text: string, checked: boolean) => {
    const label = el("label", "legacy-source");
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "legacy-source";
    radio.value = value;
    radio.checked = checked;
    radio.id = `legacy-source-${value}`;
    label.append(radio, document.createTextNode(text));
    sources.append(label);
    return radio;
  };
  const current = sourceOption("project", "Current project files", true);
  const zip = sourceOption("zip", "Files from a ZIP archive", false);
  const zipRow = el("div", "legacy-zip-row");
  zipRow.hidden = true;
  const browse = el("button", "px-btn", "Choose ZIP…") as HTMLButtonElement;
  browse.id = "legacy-choose-zip";
  browse.type = "button";
  browse.dataset.variant = "outline";
  const zipName = el("span", "px-truncate", "No ZIP selected");
  zipName.id = "legacy-zip-name";
  zipName.setAttribute("aria-live", "polite");
  zipRow.append(browse, zipName);
  const sourceHint = el("p", "px-dialog-description");
  let archive: { id: string; name: string } | null = null;
  let picking = false;
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.id = "legacy-cancel";
  cancel.className = "px-btn";
  cancel.dataset.variant = "outline";
  cancel.textContent = "Cancel";
  const confirm = document.createElement("button");
  confirm.type = "submit";
  confirm.className = "px-btn";
  confirm.dataset.variant = "default";
  confirm.textContent = "Create local legacy version";
  const renderSource = () => {
    zipRow.hidden = !zip.checked;
    confirm.disabled = picking || (zip.checked && !archive);
    browse.disabled = picking;
    zipName.textContent = archive?.name ?? "No ZIP selected";
    zipName.title = archive?.name ?? "";
    sourceHint.textContent = zip.checked
      ? "The ZIP is extracted and saved locally now. Its files must already work with the game version above. Include one mod with its descriptor; an enclosing folder is OK."
      : "Uses the project files at upload time. No copy of the mod files is saved now.";
  };
  current.onchange = zip.onchange = renderSource;
  browse.onclick = async () => {
    picking = true;
    error.textContent = "";
    renderSource();
    try {
      const selected = await pickZip();
      if (selected) archive = selected;
    } catch (e) {
      error.textContent = (e as Error).message;
    } finally {
      picking = false;
      renderSource();
      if (browse.isConnected) browse.focus();
    }
  };
  renderSource();
  actions.append(cancel, confirm);
  dialog.append(title, description, note, label, input, hint, sources, zipRow, sourceHint, error, actions);
  document.getElementById("page")!.prepend(dialog);
  document.getElementById("main")!.scrollTop = 0;
  input.focus();
  input.select();
  return new Promise((resolve) => {
    const close = (value: { version: string; archive?: string } | null) => {
      dialog.remove();
      cancelOpenForm = undefined;
      if (previous?.isConnected) previous.focus();
      resolve(value);
    };
    cancelOpenForm = () => close(null);
    cancel.onclick = cancelOpenForm;
    dialog.onsubmit = (event) => {
      event.preventDefault();
      if (confirm.disabled) return;
      try {
        const version = legacyVersion(input.value);
        if (existing.includes(version.key))
          throw new Error(
            "A legacy listing for this game version already exists. Select it from the version menu."
          );
        close({
          version: version.supportedVersion,
          ...(zip.checked && archive ? { archive: archive.id } : {}),
        });
      } catch (e) {
        error.textContent = (e as Error).message;
        input.setAttribute("aria-invalid", "true");
        input.focus();
      }
    };
    input.oninput = () => {
      error.textContent = "";
      input.removeAttribute("aria-invalid");
    };
    dialog.onkeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close(null);
      }
    };
  });
}
