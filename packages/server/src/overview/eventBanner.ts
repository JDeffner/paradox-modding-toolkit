/**
 * paradox/eventBanner: the illustration an event theme puts behind its window.
 *
 * Two hops through the game's own files, no name table of our own:
 *
 *   theme  common/event_themes    `background = { reference = throne_room }`
 *   bg     common/event_backgrounds `background = { reference = "gfx/....dds" }`
 *
 * Both levels list several `background` blocks, all but the last gated by a
 * `trigger` that only the running game can evaluate. The honest pick is the
 * LAST block with no trigger: the file's own unconditional fallback (measured
 * against the vanilla tree, where every background definition ends in one).
 * A theme whose reference is already a path skips the second hop.
 *
 * Answering null is a real answer: the caller draws a labeled placeholder
 * rather than a picture that is not the event's.
 */
import * as fs from "fs";
import type { EventBannerResult } from "@px-lsp/protocol/protocol";
import type { ServerData } from "../serverData";
import { decode, parseScript, type BlockNode, type Statement } from "../parser";

/** A reference that already names a file rather than another definition. */
const TEXTURE_PATH = /\.(dds|tga|png)$/i;

export function computeEventBanner(data: ServerData, theme: string): EventBannerResult {
  // The graph sends whatever the event itself names: an override_background
  // reference (an event_background key, or already a texture path) wins over
  // the theme, because that is the picture the game actually shows.
  if (TEXTURE_PATH.test(theme)) return { theme, texture: theme };

  const themeRef = referenceOf(data, theme, "event_theme");
  if (themeRef !== null) {
    if (TEXTURE_PATH.test(themeRef)) return { theme, texture: themeRef };
    const backgroundRef = referenceOf(data, themeRef, "event_background");
    if (backgroundRef === null) return { theme, reason: `no background definition named ${themeRef}` };
    if (!TEXTURE_PATH.test(backgroundRef)) return { theme, reason: `${themeRef} names no texture` };
    return { theme, texture: backgroundRef };
  }

  // Not a theme: an event_background named directly (override_background).
  const direct = referenceOf(data, theme, "event_background");
  if (direct === null) return { theme, reason: "no theme or background definition with a background" };
  if (!TEXTURE_PATH.test(direct)) return { theme, reason: `${theme} names no texture` };
  return { theme, texture: direct };
}

/**
 * The `reference` of a definition's fallback `background` block: the last one
 * that carries no `trigger`, else the last one there is.
 */
function referenceOf(data: ServerData, name: string, kind: string): string | null {
  const def = data.index.lookup(name).find((d) => d.kind === kind);
  if (!def) return null;
  let block: BlockNode | null = null;
  try {
    const text = decode(fs.readFileSync(def.file)).text;
    const stmt = parseScript(text).root.statements.find(
      (s): s is Statement & { kind: "assignment" } => s.kind === "assignment" && s.key.text === name
    );
    block = stmt ? childBlock(stmt) : null;
  } catch {
    return null;
  }
  if (!block) return null;

  let fallback: string | null = null;
  let last: string | null = null;
  for (const stmt of block.statements) {
    if (stmt.kind !== "assignment" || stmt.key.text.toLowerCase() !== "background") continue;
    const body = childBlock(stmt);
    if (!body) continue;
    let reference: string | null = null;
    let gated = false;
    for (const child of body.statements) {
      if (child.kind !== "assignment") continue;
      const key = child.key.text.toLowerCase();
      if (key === "trigger") gated = true;
      else if (key === "reference" && child.value?.kind === "scalar") reference = child.value.text;
    }
    if (reference === null) continue;
    last = reference;
    if (!gated) fallback = reference;
  }
  return fallback ?? last;
}

function childBlock(stmt: Statement): BlockNode | null {
  if (stmt.kind !== "assignment") return null;
  const v = stmt.value;
  if (!v) return null;
  if (v.kind === "block") return v;
  if (v.kind === "tagged-block") return v.block;
  return null;
}
