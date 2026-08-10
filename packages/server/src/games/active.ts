/**
 * The active game profile. One server instance serves one game at a time
 * (PLAN.md non-goals: no multi-game workspaces), so features and engine
 * modules read the profile through this accessor instead of threading it
 * through every signature. server.ts sets it from settings.gameId at
 * initialize and on config changes; tests may set it directly.
 */
import type { GameProfile } from "./profile";
import { defaultProfile } from "./registry";

let current: GameProfile = defaultProfile;

export function activeProfile(): GameProfile {
  return current;
}

export function setActiveProfile(profile: GameProfile): void {
  current = profile;
}
