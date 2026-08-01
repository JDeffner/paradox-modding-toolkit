/**
 * Game selection, kept free of vscode imports so the ladder is unit-testable.
 * The explicit `px.gameId` setting wins; "auto" walks the descriptor-shape
 * ladder. EU5's mandatory load-stage layout (in_game/ etc.) is a stronger
 * signature than the metadata descriptor it shares with Vic3, so it is
 * checked first. The ladder ends in ck3, preserving pre-multi-game behavior
 * for every existing workspace.
 */
import * as fs from "fs";
import * as path from "path";
import { hasMetadataDescriptor } from "@px-lsp/protocol/descriptorMetadata";
import { ck3Meta } from "@px-lsp/server/games/ck3/meta";
import { vic3Meta } from "@px-lsp/server/games/vic3/meta";
import { eu5Meta } from "@px-lsp/server/games/eu5/meta";
import type { GameMeta } from "@px-lsp/server/games/profile";

/** Metas by id, for per-game path fallbacks and user-facing names. */
export const GAME_METAS: Record<string, GameMeta> = {
  [ck3Meta.id]: ck3Meta,
  [vic3Meta.id]: vic3Meta,
  [eu5Meta.id]: eu5Meta,
};

/** A metadata-style mod: .metadata/metadata.json, no launcher .mod descriptor. */
export function looksLikeMetadataMod(dir: string): boolean {
  try {
    return hasMetadataDescriptor(dir) && !fs.existsSync(path.join(dir, "descriptor.mod"));
  } catch {
    return false;
  }
}

/** Whether any of the game's load-stage folders exists at the mod root. */
function hasStageRoots(dir: string, meta: GameMeta): boolean {
  return (meta.stageRoots ?? []).some((stage) => {
    try {
      return fs.statSync(path.join(dir, stage)).isDirectory();
    } catch {
      return false;
    }
  });
}

export function detectGameId(explicit: string, primaryRoot: string | null): string {
  if (explicit in GAME_METAS) return explicit;
  if (primaryRoot !== null && looksLikeMetadataMod(primaryRoot)) {
    return hasStageRoots(primaryRoot, eu5Meta) ? eu5Meta.id : vic3Meta.id;
  }
  return ck3Meta.id;
}
