/**
 * The active game's meta, for everything the client says or does per game.
 * Client code must read names, folders and tool availability from here rather
 * than naming a game, so a Vic3/EU5 workspace never sees a CK3 artifact.
 */
import { ck3Meta } from "@px-lsp/server/games/ck3/meta";
import { vic3Meta } from "@px-lsp/server/games/vic3/meta";
import { eu5Meta } from "@px-lsp/server/games/eu5/meta";
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

/**
 * Whether the GUI editor may open for this game: it draws measured pixels, so
 * it needs the game's own in-game-measured text metrics. Data, not a game list,
 * so a game becomes supported the moment its probe results land in its meta.
 */
export function guiEditorSupported(gameId: string): boolean {
  return metaFor(gameId).guiTextMetrics !== undefined;
}

/** Subfolder of `Documents/Paradox Interactive/<game>/` holding script_docs dumps. */
export function scriptDocsDir(meta: GameMeta): string {
  return meta.scriptDocsSubdir ?? "logs";
}

/**
 * Whether a visual content creator opens for this game. The profile lists the
 * creators built against that game's own files (`GameMeta.creators`), so a
 * panel is offered where its data exists and nowhere else.
 */
export function creatorSupported(gameId: string, kind: string): boolean {
  return (metaFor(gameId).creators ?? []).some((creator) => creator.kind === kind);
}

/** Whether the Flag Builder opens for this game: its meta declares the coat-of-arms layout. */
export function flagBuilderSupported(gameId: string): boolean {
  return metaFor(gameId).flagBuilder === true;
}

/**
 * Whether the game ships `_*.info` format docs inside its own files. Only CK3
 * does; for the other games "format docs" means the vanilla files of the same
 * folder plus a search on the game's modding wiki.
 */
export function hasFormatDocs(gameId: string): boolean {
  return isCk3(gameId);
}

/**
 * Base URL of the game's modding wiki, for the games that ship no `_*.info`
 * docs. Client-side data on purpose: the server carries no wiki addresses.
 */
const WIKI_BASE: Record<string, string> = {
  [vic3Meta.id]: "https://vic3.paradoxwikis.com",
  [eu5Meta.id]: "https://eu5.paradoxwikis.com",
};

/** Wiki search for one content folder ("buildings"), or null when the game has no wiki entry. */
export function wikiSearchUrl(gameId: string, folder: string): string | null {
  const base = WIKI_BASE[gameId];
  return base ? `${base}/index.php?search=${encodeURIComponent(folder)}+modding` : null;
}
