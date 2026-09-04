/**
 * The section a creator shows its generated script in.
 *
 * It is an ordinary section of the form, open, with the same header a creator's
 * own sections have: what the mod will contain is not a footnote, and a modder
 * who wants to paste the block into a file by hand should not have to find a
 * fold first. Clicking the script copies it, and the copy button the factory
 * returns goes in the creator's top bar next to the other file actions.
 *
 * The clipboard belongs to the host (a webview cannot reach it), so copying is
 * a message: `onCopy` posts `CreatorCopyRequest` and the host answers with the
 * toast. Browser code, styled by ui.css (`.px-script`).
 */
import { iconEl } from "./icons";

export interface ScriptSectionOptions {
  /** Header text; "Script" unless a creator names its block something else. */
  title?: string;
  /** What the section says under the header, when the block needs a word. */
  note?: string;
  /** Hand the text to the host, which owns the clipboard. */
  onCopy: (text: string) => void;
}

export interface ScriptSection {
  /** The section, to append where the creator's other sections are. */
  el: HTMLElement;
  /** The top bar's copy button; the creator places it itself. */
  copyButton: HTMLButtonElement;
  /** Show the block the creator has built. */
  set(text: string): void;
}

const COPY_TIP = "Copy the script to the clipboard";

export function scriptSection(options: ScriptSectionOptions): ScriptSection {
  const section = document.createElement("section");
  section.className = "px-script";

  const head = document.createElement("div");
  head.className = "px-panel-title";
  const title = document.createElement("span");
  title.className = "px-grow";
  title.textContent = options.title ?? "Script";
  const hint = document.createElement("span");
  hint.className = "px-script-hint";
  hint.textContent = "Click to copy";
  head.append(title, hint);

  const body = document.createElement("pre");
  body.dataset.tip = COPY_TIP;
  section.append(head, body);
  if (options.note) {
    const note = document.createElement("div");
    note.className = "px-script-note";
    note.textContent = options.note;
    section.append(note);
  }

  const copy = (): void => options.onCopy(body.textContent ?? "");
  section.addEventListener("click", copy);

  const copyButton = document.createElement("button");
  copyButton.className = "px-btn";
  copyButton.dataset.variant = "ghost";
  copyButton.dataset.size = "icon-sm";
  copyButton.dataset.tip = COPY_TIP;
  copyButton.append(iconEl("copy"));
  copyButton.onclick = copy;

  return {
    el: section,
    copyButton,
    set: (text) => {
      body.textContent = text;
    },
  };
}
