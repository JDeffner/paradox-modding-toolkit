/**
 * The shapes a host stores the GUI editor's per-user state in, and the one
 * piece of arithmetic reading it back needs.
 *
 * This lives apart from `panel.ts` for the same reason `textureCache.ts` does:
 * no `vscode` import, so a second host (the Studio's WebView2 adapter) can
 * reuse the shapes and the unit test can read them without a window. The
 * STORAGE is the host's own — `workspaceState` for `panel.ts`, whatever the
 * next host has — but the shape is part of the contract, because a component
 * saved in one host should not be unreadable in the other.
 *
 * Nothing here is bundled content. An editor that shipped its own components or
 * presets would be guessing at what a mod's widgets look like; the panels say
 * they are empty instead.
 */
import type { EditProperty, GuiEditorUiState, GuiPanelState, GuiValueMode } from "./messages";

/** Storage keys, so both halves of a host agree on them without a string literal. */
export const COMPONENTS_KEY = "px.guiEditor.components";
export const PRESETS_KEY = "px.guiEditor.presets";
export const VISIBILITY_KEY = "px.guiEditor.visibility";
export const UI_KEY = "px.guiEditor.ui";

/**
 * name -> the widgets' VERBATIM block text, exactly as `blockText` read it out
 * of the document. Not a rendering and not a parse: a component is pasted back
 * with comments, tabs and single-line bodies intact, which is only possible if
 * the bytes were what was kept.
 */
export type StoredComponents = Record<string, string>;

/** name -> the property writes, in the order they were saved. */
export type StoredPresets = Record<string, EditProperty[]>;

/**
 * document uri -> its conditional-visibility options. Keyed by document because
 * "hide the conditionals" is a statement about the file being looked at, not a
 * preference about .gui files in general. The default is never stored.
 */
export type StoredVisibility = Record<string, { mode: string; checks?: Record<string, boolean> }>;

/** The value display modes a stored preference may name. */
const VALUE_MODES: readonly GuiValueMode[] = ["full", "abbreviated", "hidden"];

/**
 * The stored view preferences, or undefined when the user has never changed
 * one. Validated rather than cast: the store outlives the version that wrote it
 * and a mode this build does not know must not reach the inspector.
 */
export function readUiState(stored: unknown): GuiEditorUiState | undefined {
  const record = stored as
    { valueMode?: unknown; panels?: unknown; snap?: unknown; grid?: unknown } | undefined;
  const mode = record?.valueMode;
  if (!VALUE_MODES.includes(mode as GuiValueMode)) return undefined;
  const panels = record?.panels as { left?: unknown; right?: unknown } | undefined;
  const left = readPanelState(panels?.left);
  const right = readPanelState(panels?.right);
  const state: GuiEditorUiState = { valueMode: mode as GuiValueMode };
  if (left && right) state.panels = { left, right };
  // Only a boolean reaches the toggles: anything else is left to the page's default.
  if (typeof record?.snap === "boolean") state.snap = record.snap;
  if (typeof record?.grid === "boolean") state.grid = record.grid;
  return state;
}

/** One side panel's remembered width and collapsed state, or undefined when the bytes are not that. */
function readPanelState(stored: unknown): GuiPanelState | undefined {
  const record = stored as { width?: unknown; collapsed?: unknown } | undefined;
  return typeof record?.width === "number" && typeof record.collapsed === "boolean"
    ? { width: record.width, collapsed: record.collapsed }
    : undefined;
}

/**
 * How many top-level blocks a saved component holds, for its row's label. A
 * brace count rather than a parse: the host keeps the text opaque, and the app
 * only needs to be told "this is three widgets, not one". Strings and comments
 * are skipped, because a `#` in a texture path and a `{` in a comment both
 * appear in real .gui files.
 */
export function countTopLevelBlocks(text: string): number {
  let depth = 0;
  let blocks = 0;
  let inString = false;
  let inComment = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inComment) {
      if (ch === "\n") inComment = false;
      continue;
    }
    if (inString) {
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "#") inComment = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) blocks++;
      // Unbalanced text is not worth a second opinion: report at least one, so
      // a row never claims a saved component holds nothing.
      if (depth < 0) return Math.max(1, blocks);
    }
  }
  return Math.max(1, blocks);
}
