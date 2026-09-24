/** Lightweight profile metadata for hosts that do not load the language engine. */
import { ck3Meta } from "./ck3/meta";
import { vic3Meta } from "./vic3/meta";
import { eu5Meta } from "./eu5/meta";
import type { GameMeta } from "./profile";

export const gameMetas: Readonly<Record<string, GameMeta>> = {
  [ck3Meta.id]: ck3Meta,
  [vic3Meta.id]: vic3Meta,
  [eu5Meta.id]: eu5Meta,
};
