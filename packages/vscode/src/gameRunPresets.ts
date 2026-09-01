/**
 * Launch presets for the `paradox-game` run configurations (gameRun.ts): the
 * list a game offers and the Steam URL that starts it. No `vscode` imports,
 * so the logic is unit-testable in plain Node; per-game extras come from the
 * GameProfile (`GameMeta.launchPresets`), never from game checks here.
 */
import type { GameMeta } from "@px-lsp/server/games/profile";

/** The family-wide debug default, what `px.launchGame` has always passed. */
export const DEBUG_ARGS = ["-debug_mode", "-develop"];

export interface RunPreset {
  /** Run-configuration name, shown in the Run panel dropdown. */
  name: string;
  args: string[];
}

/**
 * Every preset a game offers, debug default first. Between the fixed entries
 * sit the game's own verified extras (CK3/Vic3: the map editor); the vanilla
 * launch closes the list so "no options" is always one pick away.
 */
export function runPresets(meta: GameMeta): RunPreset[] {
  return [
    { name: `Launch ${meta.shortName} (debug mode)`, args: DEBUG_ARGS },
    ...(meta.launchPresets ?? []).map((p) => ({
      name: `Launch ${meta.shortName} ${p.label}`,
      args: p.args,
    })),
    { name: `Launch ${meta.shortName} (vanilla, no options)`, args: [] },
  ];
}

/** `steam://run/<appid>//<options>/` - the launch URL the Steam client accepts. */
export function steamRunUrl(steamAppId: number, args: string[]): string {
  return `steam://run/${steamAppId}//${encodeURIComponent(args.join(" "))}/`;
}
