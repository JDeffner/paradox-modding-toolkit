/**
 * "<mod> > traits/mymod_traits.txt": the line a creator's top bar shows from
 * the moment the form loads. The mod name carries the message; the path drops
 * its `common/` lead because every creator folder has one, and the full
 * mod-relative path stays in the tooltip.
 *
 * Where a definition lands used to be a question asked at save time, which
 * means a modder only found out after committing to the save. The host resolves
 * the default target up front and sends it; this line SHOWS it, and clicking it
 * asks the host for the same picker, so the target can be changed before
 * anything is written.
 *
 * Browser code, styled by ui.css (`.px-target`). The path is the host's, always
 * mod-relative: a webview never shows an absolute machine path.
 */
import { iconEl } from "./icons";
import type { CreatorSaveTarget } from "./creatorMessages";

export interface SaveTargetLine {
  /** The button to place in the top bar. */
  el: HTMLButtonElement;
  /** Show a target, or hide the line when there is nowhere to save yet. */
  set(target: CreatorSaveTarget | null): void;
}

/** `common/traits/x.txt` -> `traits/x.txt`; other roots (`gfx/…`) stay as they are. */
export function shortPath(path: string): string {
  return path.replace(/^common\//, "");
}

export function saveTargetLine(onChange: () => void): SaveTargetLine {
  const button = document.createElement("button");
  button.className = "px-target";
  button.type = "button";
  button.onclick = onChange;

  const mod = document.createElement("span");
  const path = document.createElement("span");
  path.className = "px-target-path";
  button.append(iconEl("save"), mod, path);

  return {
    el: button,
    set: (target) => {
      button.hidden = target === null;
      if (!target) return;
      mod.textContent = target.modLabel;
      path.textContent = `› ${shortPath(target.path)}`;
      button.dataset.tip = `${target.path} in ${target.modLabel}. Click to save somewhere else.`;
      button.dataset.tipWrap = "";
    },
  };
}
