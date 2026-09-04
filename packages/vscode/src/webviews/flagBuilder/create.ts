/**
 * `Paradox: New Coat of Arms…` — say what the arms are for, land in the Flag
 * Builder on the key the game reads them under.
 *
 * The modder knows the dynasty, the house or the title; the toolkit knows how
 * the game keys arms (target.ts) and what the mod holds (paradox/modOverview),
 * so nothing here asks for a path or a setting. Every pick ends in the one
 * command that opens the panel, so the Dynasty Tree and the palette take the
 * same road.
 */
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { LanguageClient } from "vscode-languageclient/node";
import {
  modOverviewRequest,
  type ModOverview,
  type ModScopedParams,
  type OverviewDef,
  type OverviewKind,
} from "@px-lsp/protocol/protocol";
import type { FlagTarget } from "./messages";
import { blockScalars, coaTargetItems, coaTargetLabel, COA_TARGET_KINDS, type CoaTargetKind } from "./target";

/** The designer's own key field is where a new key is typed, once. */
const NAME_IN_DESIGNER = "$(new-file) Name it in the designer";

export async function createCoatOfArmsCommand(lc: LanguageClient, modRoot: string | null): Promise<void> {
  const overview = await lc.sendRequest<ModOverview>(modOverviewRequest, {
    modRoot,
  } satisfies ModScopedParams);
  const byKind = new Map(overview.kinds.map((k) => [k.kind, k]));
  // Only kinds the mod actually has: a game that keys arms differently never
  // sees a row that does not fit it, and typing a key always works.
  const kinds = COA_TARGET_KINDS.filter((k) => byKind.has(k.defKind));

  const chosen = await vscode.window.showQuickPick(
    [
      ...kinds.map((kind) => ({
        label: kind.label,
        description: `${byKind.get(kind.defKind)!.count} in the mod`,
        detail: kind.detail,
        family: kind as CoaTargetKind | undefined,
      })),
      {
        label: NAME_IN_DESIGNER,
        description: "",
        detail: "Start blank; the key goes in the designer's top-left field.",
        family: undefined,
      },
    ],
    { placeHolder: "What are the arms for?", matchOnDetail: true }
  );
  if (!chosen) return;

  if (!chosen.family) {
    await vscode.commands.executeCommand("px.openFlagBuilder");
    return;
  }
  const target = await pickDefinition(chosen.family, byKind.get(chosen.family.defKind)!);
  if (target === undefined) return;
  await vscode.commands.executeCommand("px.openFlagBuilder", target ?? undefined);
}

/**
 * One pick per definition of the kind, plus the escape for keys not in the
 * mod: null opens the designer blank, undefined is a cancel.
 */
async function pickDefinition(
  kind: CoaTargetKind,
  bucket: OverviewKind
): Promise<FlagTarget | null | undefined> {
  const items = coaTargetItems(kind, bucket.defs, blockScalarsOf(cachedReader()));
  const capped = bucket.count > bucket.defs.length;
  const picked = await vscode.window.showQuickPick(
    [
      { label: NAME_IN_DESIGNER, description: "", detail: "", target: null as FlagTarget | null },
      ...items.map((item) => ({
        label: item.title,
        // A dynasty key is a number and a character key is their house: the
        // key the arms are written under is never hidden behind the name.
        description: item.title === item.key ? path.basename(item.file) : item.key,
        detail: item.title === item.key ? "" : path.basename(item.file),
        target: { name: item.key, label: coaTargetLabel(kind, item) },
      })),
    ],
    {
      placeHolder: capped
        ? `${kind.label} (${bucket.count} in the mod, first ${bucket.defs.length} listed)`
        : `${kind.label} in the mod`,
      matchOnDescription: true,
    }
  );
  if (!picked) return undefined;
  return picked.target;
}

/** One read per file, however many definitions of it the picker lists. */
function cachedReader(): (file: string) => string {
  const cache = new Map<string, string>();
  return (file) => {
    let text = cache.get(file);
    if (text === undefined) {
      try {
        text = fs.readFileSync(file, "utf8");
      } catch {
        text = "";
      }
      cache.set(file, text);
    }
    return text;
  };
}

function blockScalarsOf(read: (file: string) => string): (def: OverviewDef) => Record<string, string> {
  return (def) => blockScalars(read(def.file), def.line);
}
