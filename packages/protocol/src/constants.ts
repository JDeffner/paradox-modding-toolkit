/**
 * Constants needed on both sides of the LSP boundary.
 */
import type { TokenKind } from "./types";

/** The script_docs log files and the token kind each one contributes. */
export const LOG_FILES: Array<{ file: string; kind: TokenKind }> = [
  { file: "triggers.log", kind: "trigger" },
  { file: "effects.log", kind: "effect" },
  { file: "event_targets.log", kind: "event_target" },
  { file: "modifiers.log", kind: "modifier" },
];
