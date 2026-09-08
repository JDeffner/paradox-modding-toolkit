// The log records panel actions; the host still owns the document and its undo history.
import { iconEl } from "../../shared/icons";
import { closePopover, isPopoverAnchor, popover } from "../../shared/overlay";

export function createSessionToolbar(
  {
    save: saveEl,
    changes: changesEl,
    undo: undoBtn,
    redo: redoBtn,
  }: Record<"save" | "changes" | "undo" | "redo", HTMLButtonElement>,
  send: (type: "save" | "undo" | "redo") => void
) {
  /** Labels of this panel's committed changes, oldest first, and the undone ones. */
  const sessionChanges: string[] = [];
  const undoneChanges: string[] = [];
  let docDirty = false;

  function syncChanges(): void {
    const count = sessionChanges.length;
    changesEl.disabled = count === 0;
    changesEl.querySelector(".count")!.textContent = String(count);
    changesEl.dataset.tip =
      count === 0
        ? "No changes yet this session"
        : `List the ${count} change${count === 1 ? "" : "s"} made here, newest last; each row can be undone`;
    if (count === 0 && isPopoverAnchor(changesEl)) closePopover();
    // Undo and redo are SCOPED TO THIS PANEL'S SESSION: with nothing of ours to
    // take back, the buttons are off, so the panel can never walk into the
    // document's older history (edits made in the text editor before or beside
    // this session stay that editor's to undo).
    undoBtn.disabled = count === 0;
    undoBtn.dataset.tip =
      count === 0
        ? "Nothing from this panel to undo. The text editor's own history stays its own"
        : `Undo ${sessionChanges[count - 1]}`;
    redoBtn.disabled = undoneChanges.length === 0;
    redoBtn.dataset.tip =
      undoneChanges.length === 0 ? "Nothing to redo" : `Redo ${undoneChanges[undoneChanges.length - 1]}`;
    saveEl.disabled = !docDirty;
    saveEl.dataset.tip = !docDirty
      ? "Nothing to save: the file on disk already matches"
      : count > 0
        ? "Write the changes to the .gui file on disk (Ctrl+S)"
        : "Write the document to disk (Ctrl+S). These changes came from outside this panel";
  }

  function recordChange(label: string): void {
    sessionChanges.push(label);
    undoneChanges.length = 0;
    docDirty = true;
    syncChanges();
  }

  /** Undo the last `count` changes through the document's own history. */
  function undoBack(count: number): void {
    for (let i = 0; i < count && sessionChanges.length > 0; i++) {
      undoneChanges.push(sessionChanges.pop()!);
      send("undo");
    }
    syncChanges();
  }

  changesEl.addEventListener("click", () => {
    if (isPopoverAnchor(changesEl)) {
      closePopover();
      return;
    }
    const list = el("div", "px-list");
    list.id = "changeList";
    sessionChanges.forEach((label, index) => {
      const row = el("div", "px-item");
      row.title = label;
      const after = sessionChanges.length - 1 - index;
      row.appendChild(el("span", "what", label));
      const undo = document.createElement("button");
      undo.type = "button";
      undo.className = "px-btn";
      undo.dataset.variant = "ghost";
      undo.dataset.size = "icon-xs";
      undo.dataset.tip = after === 0 ? "Undo this change" : `Undo this change and the ${after} after it`;
      undo.setAttribute("aria-label", undo.dataset.tip);
      if (undo.dataset.tip.length > 40) undo.dataset.tipWrap = "";
      undo.appendChild(iconEl("undo"));
      undo.addEventListener("click", () => {
        closePopover();
        undoBack(sessionChanges.length - index);
      });
      row.appendChild(undo);
      list.appendChild(row);
    });
    popover(changesEl, list);
  });

  saveEl.addEventListener("click", () => {
    if (saveEl.disabled) return;
    send("save");
  });

  undoBtn.addEventListener("click", () => {
    // Session-scoped: only a change this panel made is ever taken back, so the
    // button never reaches the document's pre-session history. Best effort past
    // that: the log cannot see keystrokes typed in the text editor in between.
    if (sessionChanges.length === 0) return;
    undoneChanges.push(sessionChanges.pop()!);
    syncChanges();
    send("undo");
  });
  redoBtn.addEventListener("click", () => {
    if (undoneChanges.length === 0) return;
    sessionChanges.push(undoneChanges.pop()!);
    syncChanges();
    send("redo");
  });

  return {
    recordChange,
    setDirty(dirty: boolean): void {
      docDirty = dirty;
      syncChanges();
    },
    save(): void {
      saveEl.click();
    },
  };
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
