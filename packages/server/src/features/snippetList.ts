/**
 * The `paradox/snippets` answer: everything a host can offer to insert at a
 * cursor in one script document.
 *
 * Two sources, both derived. The document's folder decides its definition kind,
 * and that kind's measured skeleton (schema/skeletons.ts) supplies the
 * definition and its child blocks. The cursor's block context decides which
 * engine triggers/effects are legal there, and each of those contributes the
 * block form of the `usage:` example its own script_docs entry ships
 * (features/blockSnippets.ts). Nothing is added that the game did not state.
 */
import type { SnippetItem } from "@px-lsp/protocol/protocol";
import type { TokenData } from "@px-lsp/protocol/types";
import { detectContextFromParse } from "../context";
import type { ParseResult } from "../parser";
import type { KindSkeleton } from "../schema/skeletons";
import { blockTemplateFor } from "./blockSnippets";
import { skeletonsFor } from "./definitionSkeletons";

/**
 * Engine tokens the answer carries. A picker filters as the user types, so the
 * cap is only about payload: the list is frequency-ordered, and past ~60 the
 * tail is tokens nobody reaches for by name.
 */
const MAX_TOKENS = 60;

export function buildSnippetList(
  parse: ParseResult,
  offset: number,
  kind: string | null,
  skeletons: Record<string, KindSkeleton> | undefined,
  tokens: TokenData[],
  counts: Record<string, number>
): SnippetItem[] {
  const out: SnippetItem[] = kind
    ? skeletonsFor(parse, kind, skeletons).map((offer) => ({
        id: offer.id,
        label: offer.label,
        detail: offer.detail,
        form: offer.form,
        snippet: offer.text.snippet,
        plain: offer.text.plain,
      }))
    : [];

  const { context } = detectContextFromParse(parse, offset);
  const seen = new Set<string>();
  const candidates: Array<{ token: TokenData; count: number }> = [];
  for (const token of tokens) {
    // The same context gate key-position completion applies: a trigger block
    // takes no effects and an effect block takes no triggers.
    if (context === "trigger" && (token.kind === "effect" || token.kind === "modifier")) continue;
    if (context === "effect" && (token.kind === "trigger" || token.kind === "modifier")) continue;
    if (seen.has(token.name)) continue;
    if (!blockTemplateFor(token)) continue;
    seen.add(token.name);
    candidates.push({ token, count: counts[token.name] ?? 0 });
  }
  candidates.sort((a, b) => b.count - a.count || (a.token.name < b.token.name ? -1 : 1));
  for (const { token } of candidates.slice(0, MAX_TOKENS)) {
    const template = blockTemplateFor(token)!;
    out.push({
      id: token.name,
      label: token.name,
      detail: `${token.kind} block, from the game's own usage example`,
      form: "token",
      snippet: template.snippet,
      plain: template.plain,
    });
  }
  return out;
}
