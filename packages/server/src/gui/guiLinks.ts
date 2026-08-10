/**
 * The one link a `.gui` file has to script: `GetScriptedGui('name')`.
 *
 * PdxGui cannot call an event or an effect. It calls a scripted_gui, whose own
 * blocks then reach the rest of the script database, so every GUI-to-script
 * path starts here. Verified over both supported titles' vanilla trees (the
 * only spelling in use is the datafunction, with either quote style);
 * `window_name`, the Imperator-era binding, appears in neither tree.
 *
 * The index is built by the layout service's file walk, which already reads
 * every `.gui` file for the template/type store, so the marginal cost is a
 * substring test per file plus a regex over the handful that match.
 *
 * No `vscode` imports: unit-tested in plain Node.
 */
import { LineIndex } from "../parser";

/** One `GetScriptedGui(...)` call site. */
export interface GuiScriptedGuiCall {
  /** Absolute path of the `.gui` file, or whatever label the caller passed. */
  file: string;
  /** 0-based line of the call. */
  line: number;
}

export interface GuiScriptLinks {
  /** scripted_gui name -> every call site naming it, file order. */
  calls: Map<string, GuiScriptedGuiCall[]>;
}

export function emptyGuiScriptLinks(): GuiScriptLinks {
  return { calls: new Map() };
}

/** The cheap test that lets a non-matching file skip the regex and the LineIndex. */
const MARKER = "GetScriptedGui";

/**
 * `GetScriptedGui('name')` / `GetScriptedGui("name")`, whitespace tolerated
 * around the argument. The name charset is the script-definition one.
 */
const CALL = /GetScriptedGui\s*\(\s*(['"])([A-Za-z0-9_][A-Za-z0-9_.-]*)\1\s*\)/g;

/** Every scripted_gui `text` calls, with the 0-based line of each call. */
export function findScriptedGuiCalls(text: string): { name: string; line: number }[] {
  if (!text.includes(MARKER)) return [];
  const lines = new LineIndex(text);
  const out: { name: string; line: number }[] = [];
  CALL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CALL.exec(text)) !== null) {
    out.push({ name: m[2], line: lines.positionAt(m.index).line });
  }
  return out;
}

/** Merge one file's calls into a links index. */
export function collectScriptedGuiCalls(text: string, file: string, into: GuiScriptLinks): void {
  for (const call of findScriptedGuiCalls(text)) {
    const list = into.calls.get(call.name);
    if (list) list.push({ file, line: call.line });
    else into.calls.set(call.name, [{ file, line: call.line }]);
  }
}
