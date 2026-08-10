/**
 * The active game's meta, for everything the client says or does per game.
 * Client code must read names, folders and tool availability from here rather
 * than naming a game, so a Vic3/EU5 workspace never sees a CK3 artifact.
 */
import { ck3Meta } from "@px-lsp/server/games/ck3/meta";
import type { GameMeta } from "@px-lsp/server/games/profile";
import { GAME_METAS } from "./gameDetect";

/** Meta of `gameId`; CK3 for an unknown id (matches config.ts's fallback). */
export function metaFor(gameId: string): GameMeta {
  return GAME_METAS[gameId] ?? ck3Meta;
}

/** True for the CK3 profile — the gate for the few genuinely CK3-only features. */
export function isCk3(gameId: string): boolean {
  return gameId === ck3Meta.id;
}

/** Subfolder of `Documents/Paradox Interactive/<game>/` holding script_docs dumps. */
export function scriptDocsDir(meta: GameMeta): string {
  return meta.scriptDocsSubdir ?? "logs";
}
