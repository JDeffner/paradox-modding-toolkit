/**
 * paradox/scopeAt: the inferred scope chain at a cursor position, for an
 * embedder's scope status bar ("Scope: character →[every_vassal]→ character").
 *
 * Strictly a read-out of the AD-5 inference that completion, hover and inlay
 * hints already run at a position — same parse cache, same canonical
 * InferenceContext — so what a client displays can never disagree with what
 * ranking used. Nothing here influences inference or ranking.
 */
import type { Position } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { ScopeAtResult, ScopeChainStep } from "@px-lsp/protocol/protocol";
import { getParse, getSavedScopes } from "../parseCache";
import { inferScopeAt } from "../scopes/inference";
import { inferenceContextFor } from "../scopes/varTypes";
import type { Scope } from "../scopes/model";
import type { SchemaEntry } from "../schema/types";
import type { ServerData } from "../serverData";

export function computeScopeAt(
  data: ServerData,
  document: TextDocument,
  position: Position,
  rootScopes: Set<Scope> | null,
  entry: SchemaEntry | null
): ScopeAtResult {
  const { result, lineIndex } = getParse(document);
  const ictx = inferenceContextFor(data, entry);
  const saved = getSavedScopes(document, data.scopeModel, rootScopes, entry?.ambientScopes, ictx);
  const inference = inferScopeAt(
    result,
    lineIndex.offsetAt(position),
    data.scopeModel,
    rootScopes,
    saved,
    ictx
  );
  return {
    scopes: list(inference.scopes),
    chain: inference.chain.map(parseStep),
    savedScopes: [...saved]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([name, scopes]) => ({ name, scopes: list(scopes) })),
  };
}

/**
 * inferScopeAt reports its chain as display strings — the seed scope alone
 * first, then `<key> → <scopes>` per step, with "unknown" for an unresolved
 * set and "|" between alternatives. Splitting them back apart is what keeps
 * this request read-only over the inference module.
 */
function parseStep(text: string): ScopeChainStep {
  const sep = text.indexOf(" → ");
  if (sep < 0) return { scopes: parseScopes(text) };
  return { entryKeyword: text.slice(0, sep), scopes: parseScopes(text.slice(sep + 3)) };
}

function parseScopes(text: string): string[] {
  return text === "unknown" ? [] : text.split("|");
}

function list(scopes: Set<Scope> | null): string[] {
  return scopes ? [...scopes] : [];
}
