/**
 * What a textbox SHOWS, as far as a static preview can know it.
 *
 * A `text = "..."` value is one of: a localization key, a literal, or a mix of
 * literal text and `[datafunction]` expressions the running game evaluates.
 * The preview resolves what is knowable (a key through the loc index,
 * `Localize('key')`, `Concept('key', 'text')`, a value the modder typed into
 * the per-mod preview table) and shows the rest honestly: the last segment of
 * the chain (`GetName`) marked as unresolved, never an invented value. The
 * result is segmented so a client can style and explain each part.
 *
 * Pure: the loc index is an injected lookup. No vscode, no fs.
 */
import type { GuiTextSegment } from "@px-lsp/protocol/protocol";

export interface TextResolvers {
  /** The configured language's value for a loc key, or undefined. */
  loc: (key: string) => string | undefined;
  /** Modder-supplied preview text per exact `[...]` source (without brackets). */
  previewValues?: Record<string, string>;
}

export interface ResolvedText {
  /** What is measured and drawn. */
  text: string;
  /** Absent when the text is a plain literal with nothing to explain. */
  segments?: GuiTextSegment[];
}

/** A loc key: one word of key characters, nothing a literal sentence would have. */
const LOC_KEY = /^[A-Za-z0-9_][A-Za-z0-9_.\-']*$/;

/**
 * Loc formatting the game does not draw: `#bold text#!`, `#R text#!`, `§Ytext§!`,
 * `@icon!` icon references. Removed for measurement; the preview has no glyphs for them.
 */
function stripFormatting(s: string): string {
  return s
    .replace(/#!/g, "")
    .replace(/#[A-Za-z_][A-Za-z0-9_;:]*\s?/g, "")
    .replace(/§!/g, "")
    .replace(/§[A-Za-z0-9]/g, "")
    .replace(/@[A-Za-z0-9_]+!/g, "")
    .replace(/\\n/g, "\n");
}

/** Split `a [Fn] b [[literal]` into literal and datafunction pieces. */
function tokenize(s: string): { literal?: string; fn?: string }[] {
  const out: { literal?: string; fn?: string }[] = [];
  let lit = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "[" && s[i + 1] === "[") {
      lit += "[";
      i++;
      continue;
    }
    if (c === "[") {
      let depth = 1;
      let j = i + 1;
      for (; j < s.length && depth > 0; j++) {
        if (s[j] === "[") depth++;
        else if (s[j] === "]") depth--;
      }
      if (depth !== 0) {
        lit += s.slice(i);
        break;
      }
      if (lit) out.push({ literal: lit });
      lit = "";
      out.push({ fn: s.slice(i + 1, j - 1) });
      i = j - 1;
      continue;
    }
    lit += c;
  }
  if (lit) out.push({ literal: lit });
  return out;
}

/** `Localize('key')` / `Concept('key','shown')` / `Concept('key')`: the loc the chain stands for. */
function locOfCall(fn: string, loc: TextResolvers["loc"]): string | undefined {
  const m = /^(Localize|Concept)\s*\(\s*'([^']*)'(?:\s*,\s*'([^']*)')?\s*\)$/.exec(fn.trim());
  if (!m) return undefined;
  if (m[1] === "Concept" && m[3] !== undefined) return loc(m[3]) ?? m[3];
  return loc(m[2]);
}

/** `GetPlayer.GetName` -> `GetName`; `Concept('x','y')` -> `Concept`; strips a `Get` prefix and arguments. */
function chipFor(fn: string): string {
  // `|0`, `|%`: format specifiers after the chain, not part of the name.
  const chain = fn.split("|")[0];
  const last = chain.split(".").pop() ?? chain;
  const name = last.replace(/\(.*$/, "").trim() || fn;
  return name.replace(/^Get(?=[A-Z])/, "") || name;
}

function resolveFn(fn: string, r: TextResolvers): GuiTextSegment {
  const override = r.previewValues?.[fn] ?? r.previewValues?.[`[${fn}]`];
  if (override !== undefined) return { text: override, kind: "datafn", source: fn, resolved: true };
  const viaLoc = locOfCall(fn, r.loc);
  if (viaLoc !== undefined)
    return { text: stripFormatting(viaLoc), kind: "datafn", source: fn, resolved: true };
  return { text: chipFor(fn), kind: "datafn", source: fn, resolved: false };
}

/** Resolve one string's datafunctions into segments (no loc-key lookup of the whole). */
function resolveMixed(s: string, r: TextResolvers): GuiTextSegment[] {
  return tokenize(s).map((t) =>
    t.fn !== undefined
      ? resolveFn(t.fn, r)
      : {
          text: stripFormatting(t.literal ?? ""),
          kind: "literal" as const,
          source: t.literal ?? "",
          resolved: true,
        }
  );
}

export function resolveGuiText(raw: string, r: TextResolvers): ResolvedText {
  const trimmed = raw.trim();
  if (!trimmed) return { text: "" };
  if (LOC_KEY.test(trimmed)) {
    const value = r.loc(trimmed);
    if (value !== undefined) {
      // The value itself may hold datafunctions; those resolve one level deep.
      const inner = resolveMixed(value, r);
      const text = inner.map((s) => s.text).join("");
      const segments: GuiTextSegment[] =
        inner.length === 1 && inner[0].kind === "literal"
          ? [{ text, kind: "loc", source: trimmed, resolved: true }]
          : inner.map((s) => (s.kind === "literal" ? { ...s, kind: "loc", source: trimmed } : s));
      return { text, segments };
    }
    // Not in the index: a key nobody localized yet, or a literal word. Shown as is, flagged.
    if (trimmed.includes("_") || trimmed.includes(".")) {
      return { text: trimmed, segments: [{ text: trimmed, kind: "loc", source: trimmed, resolved: false }] };
    }
    return { text: trimmed };
  }
  const segments = resolveMixed(trimmed, r);
  const text = segments.map((s) => s.text).join("");
  return segments.every((s) => s.kind === "literal") ? { text } : { text, segments };
}
