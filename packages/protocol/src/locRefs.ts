/**
 * Line-level detection of localization-key references in script and of key
 * definitions in loc yml. Used by the server (inlay hints, code actions) and
 * the client (loc reference tracker), so it lives in shared/.
 *
 * No `vscode` imports here: this module is unit-tested in plain Node.
 */
import { isLocProperty } from "./locProperties";

const PROP_VALUE = /([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*("?)([A-Za-z_][A-Za-z0-9_.-]*)\2/g;

export interface LocKeyRef {
  prop: string;
  key: string;
  /** Character range of the key on the line. */
  start: number;
  end: number;
  strictness: "strict" | "broad";
}

export function findLocKeyRefs(lineText: string): LocKeyRef[] {
  const refs: LocKeyRef[] = [];
  PROP_VALUE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PROP_VALUE.exec(lineText)) !== null) {
    const strictness = isLocProperty(m[1]);
    if (!strictness) continue;
    const end = m.index + m[0].length - (m[2] === '"' ? 1 : 0);
    refs.push({ prop: m[1], key: m[3], start: end - m[3].length, end, strictness });
  }
  return refs;
}

/** The loc key defined on the given line of a loc yml, if any. */
export function locKeyOnLine(lineText: string): string | null {
  const m = /^\s*([A-Za-z0-9_.\-']+):\d*\s*"/.exec(lineText.replace(/^﻿/, ""));
  return m ? m[1] : null;
}
