/**
 * Inlay hints, both directions of the localization workflow:
 *  - in script files: the resolved loc text next to loc-key references
 *    ("missing loc" for strict properties with no entry);
 *  - in translated loc files: the reference-language text next to each entry,
 *    so a translator never has to switch back to the source file.
 */
import { MarkupKind, type InlayHint, type Range } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import * as path from "path";
import type { ServerData } from "../serverData";
import type { ParadoxSettings } from "@paradox-lsp/protocol/protocol";
import { findLocKeyRefs, locKeyOnLine } from "@paradox-lsp/protocol/locRefs";
import { detectLocFileLanguage } from "@paradox-lsp/protocol/translationCore";
import { getLineText } from "../documents";
import { getParse, getSavedScopes } from "../parseCache";
import { inferScopeAt } from "../scopes/inference";
import { inferenceContextFor } from "../scopes/varTypes";
import type { SchemaEntry } from "../schema/types";
import type { Scope } from "../scopes/model";
import { walkStatements } from "../parser";

const HINT_MAX_LEN = 60;

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

export function provideInlayHints(
  data: ServerData,
  settings: ParadoxSettings,
  document: TextDocument,
  range: Range,
  rootScopes: Set<Scope> | null,
  entry: SchemaEntry | null
): InlayHint[] {
  if (document.languageId === "paradox-loc") return translationOverlayHints(data, settings, document, range);
  const hints = locPreviewHints(data, document, range);
  if (settings.scopeInlayHints) hints.push(...scopeHints(data, document, range, rootScopes, entry));
  return hints;
}

/** Optional (off by default): the inferred scope after each scope-changing block opener. */
function scopeHints(
  data: ServerData,
  document: TextDocument,
  range: Range,
  rootScopes: Set<Scope> | null,
  entry: SchemaEntry | null
): InlayHint[] {
  const { result, lineIndex } = getParse(document);
  const ictx = inferenceContextFor(data, entry);
  const savedScopes = getSavedScopes(document, data.scopeModel, rootScopes, entry?.ambientScopes, ictx);
  const hints: InlayHint[] = [];
  walkStatements(result.root, (stmt) => {
    if (stmt.kind !== "assignment" || stmt.key.quoted || stmt.value?.kind !== "block") return;
    const key = stmt.key.text.toLowerCase();
    const changes =
      /^(?:every|any|random|ordered)_/.test(key) ||
      key.startsWith("scope:") ||
      data.scopeModel.links.has(key);
    if (!changes) return;
    const pos = lineIndex.positionAt(stmt.value.openBrace + 1);
    if (pos.line < range.start.line || pos.line > range.end.line) return;
    const inference = inferScopeAt(
      result,
      stmt.value.openBrace + 1,
      data.scopeModel,
      rootScopes,
      savedScopes,
      ictx
    );
    if (!inference.scopes || inference.scopes.size === 0) return;
    hints.push({
      position: pos,
      label: ` ${[...inference.scopes].join("|")}`,
      paddingLeft: true,
    });
  });
  return hints;
}

/** Script files: resolved loc text (or "missing loc") after each loc-key reference. */
function locPreviewHints(data: ServerData, document: TextDocument, range: Range): InlayHint[] {
  const hints: InlayHint[] = [];
  for (let lineNo = range.start.line; lineNo <= range.end.line && lineNo < document.lineCount; lineNo++) {
    const lineText = getLineText(document, lineNo);
    for (const ref of findLocKeyRefs(lineText)) {
      const defs = data.index.lookup(ref.key).filter((d) => d.kind === "loc_key");
      const position = { line: lineNo, character: ref.end };
      if (defs.length > 0) {
        const def = defs[0];
        hints.push({
          position,
          label: truncate(def.value ?? "", HINT_MAX_LEN),
          paddingLeft: true,
          tooltip: {
            kind: MarkupKind.Markdown,
            value: `${def.value ?? ""}\n\n*${path.basename(def.file)}:${def.line + 1} (${def.source})*`,
          },
        });
      } else if (ref.strictness === "strict") {
        hints.push({
          position,
          label: "missing loc",
          paddingLeft: true,
          tooltip: `No "${ref.key}" entry in the indexed localization files.`,
        });
      }
    }
  }
  return hints;
}

/** Translated loc files: overlay the reference-language text per entry. */
function translationOverlayHints(
  data: ServerData,
  settings: ParadoxSettings,
  document: TextDocument,
  range: Range
): InlayHint[] {
  const fsPath = URI.parse(document.uri).fsPath;
  const fileLang = detectLocFileLanguage(fsPath);
  // Only overlay in files of another language than the reference itself.
  if (!fileLang || fileLang === settings.locLanguage) return [];

  const hints: InlayHint[] = [];
  for (let lineNo = range.start.line; lineNo <= range.end.line && lineNo < document.lineCount; lineNo++) {
    const lineText = getLineText(document, lineNo);
    const key = locKeyOnLine(lineText);
    if (!key) continue;
    const def = data.index.lookup(key).find((d) => d.kind === "loc_key");
    if (!def || def.value === undefined) continue;
    const label = def.value.length > 80 ? def.value.slice(0, 79) + "…" : def.value;
    hints.push({
      position: { line: lineNo, character: lineText.length },
      label: `⟵ ${settings.locLanguage}: ${label}`,
      paddingLeft: true,
      tooltip: {
        kind: MarkupKind.Markdown,
        value: `**${settings.locLanguage}**: ${def.value}\n\n*${path.basename(def.file)}:${def.line + 1} (${def.source})*`,
      },
    });
  }
  return hints;
}
