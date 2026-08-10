/**
 * Registry of in-repo game profiles. Profiles are not a plugin API (PLAN.md
 * non-goals): adding a game means adding a games/<id>/ module and registering
 * it here.
 */
import type { GameProfile } from "./profile";
import { ck3Profile } from "./ck3";
import { vic3Profile } from "./vic3";
import { eu5Profile } from "./eu5";

const profiles = new Map<string, GameProfile>([
  [ck3Profile.id, ck3Profile],
  [vic3Profile.id, vic3Profile],
  [eu5Profile.id, eu5Profile],
]);

export const defaultProfile: GameProfile = ck3Profile;

/** The profile for a wire gameId; unknown/absent ids fall back to the default
 * (bare LSP clients predating gameId keep working). */
export function resolveProfile(id: string | null | undefined): GameProfile {
  return (id && profiles.get(id)) || defaultProfile;
}

export function allProfiles(): GameProfile[] {
  return [...profiles.values()];
}
