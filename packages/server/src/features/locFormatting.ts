/**
 * Completion and hover for `#G`, `#bold`, … text-formatting tags inside a
 * localization VALUE string (paradox-loc). Tag names come from the harvested
 * textformatting index (data/textFormatting.ts). The tag context ends at `#!`.
 *
 * Completion docs and the hover card show the format chain plus, when known,
 * the resolved color as `rgb(r, g, b)` text (completion docs cannot color a
 * swatch) or an inline colored ■ span (hover, which supports HTML).
 */
import { CompletionItemKind, MarkupKind, type CompletionItem } from "vscode-languageserver/node";
import * as path from "path";
import type { TextFormattingIndex, FormatEntry } from "../data/textFormatting";
import { rgbCss } from "../data/textFormatting";
import { finalize, MAX_ITEMS, type CompletionResult } from "./completion";
import { colorSwatch, fileLink, renderCard, type CardInput } from "./hoverRender";

/** True when `prefix` ends inside an open loc value (odd count of unescaped `"`). */
function insideLocValue(prefix: string): boolean {
  let quotes = 0;
  for (let i = 0; i < prefix.length; i++) {
    if (prefix[i] === "\\") {
      i++;
      continue;
    }
    if (prefix[i] === '"') quotes++;
  }
  return quotes % 2 === 1;
}

/** A one-line summary of a resolved tag: `→ instruction → G` · rgb(0, 255, 0). */
function summarize(index: TextFormattingIndex, name: string): { chain: string; color: string | null } {
  const { chain, rgb } = index.resolve(name);
  const rest = chain.slice(1);
  return {
    chain: rest.length > 0 ? `→ ${rest.join(" → ")}` : "(direct)",
    color: rgb ? rgbCss(rgb) : null,
  };
}

/** `common/…`-style tail of a source path, from the `gui/` segment onward. */
function guiRelTail(file: string): string {
  const norm = file.replace(/\\/g, "/");
  const i = norm.toLowerCase().lastIndexOf("/gui/");
  return i >= 0 ? norm.slice(i + 1) : path.basename(file);
}

/**
 * `#` tag-name completion inside a loc value, or null when the cursor is not in
 * that context (caller falls through).
 */
export function provideFormatTagCompletion(
  index: TextFormattingIndex,
  linePrefix: string
): CompletionResult | null {
  const m = /#([A-Za-z0-9_]*)$/.exec(linePrefix);
  if (!m) return null;
  if (!insideLocValue(linePrefix.slice(0, m.index))) return null;
  const items: CompletionItem[] = index.names().map((name) => {
    const { chain, color } = summarize(index, name);
    const item: CompletionItem = {
      label: name,
      kind: CompletionItemKind.EnumMember,
      detail: `text format ${chain}${color ? ` · ${color}` : ""}`,
      sortText: name.toLowerCase(),
    };
    const entry = index.winner(name)!;
    const docParts = [
      entry.layer === "builtin" ? "Engine built-in format." : `\`${entry.format || "(style only)"}\``,
    ];
    if (color) docParts.push(`Color: ${color}`);
    item.documentation = { kind: MarkupKind.Markdown, value: docParts.join("\n\n") };
    return item;
  });
  return finalize(items, m[1], MAX_ITEMS);
}

/** The `#tag` under the cursor inside a loc value, or null. */
function tagAt(lineText: string, character: number): { name: string; start: number; end: number } | null {
  const re = /#([A-Za-z0-9_]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(lineText)) !== null) {
    const start = m.index;
    const end = m.index + m[0].length;
    if (character >= start && character <= end && insideLocValue(lineText.slice(0, start))) {
      return { name: m[1], start, end };
    }
  }
  return null;
}

export interface FormatTagHover {
  markdown: string;
  start: number;
  end: number;
}

/** Hover card for a `#tag` in a loc value, or null when there is none / unknown. */
export function provideFormatTagHover(
  index: TextFormattingIndex,
  lineText: string,
  character: number
): FormatTagHover | null {
  const hit = tagAt(lineText, character);
  if (!hit) return null;
  const entry = index.winner(hit.name);
  if (!entry) return null;
  const { chain, rgb } = index.resolve(hit.name);
  const card: CardInput = { kind: "text_format", badgeLabel: "text format", name: `#${hit.name}` };
  const rest = chain.slice(1);
  const doc: string[] = [];
  if (rest.length > 0) doc.push(`Format chain: ${chain.map((c) => `\`${c}\``).join(" → ")}`);
  else if (entry.format) doc.push(`\`${entry.format}\``);
  if (rgb) doc.push(`Color: ${colorSwatch(rgb)} ${rgbCss(rgb)}`);
  if (entry.layer === "builtin") doc.push("Engine built-in format.");
  if (doc.length > 0) card.doc = doc.join("  \n");
  if (entry.file) card.provenance = sourceLink(entry);
  return { markdown: renderCard(card), start: hit.start, end: hit.end };
}

function sourceLink(entry: FormatEntry): string {
  const rel = guiRelTail(entry.file);
  return `${entry.layer} · ${fileLink(entry.file, rel, { fragment: String(entry.line + 1) })}`;
}
