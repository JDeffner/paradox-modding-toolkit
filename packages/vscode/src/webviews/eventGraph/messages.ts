/**
 * The wire between the event graph host (panel.ts) and its app (app/).
 */
import type { EventDetail, EventGraph, EventGraphParams } from "@px-lsp/protocol/protocol";

/** Per-user layout the host remembers across sessions. */
export interface UiState {
  panelWidth: number;
  panelCollapsed: boolean;
}

export type AppToHost =
  | { type: "open"; file: string; line?: number }
  | { type: "refocus"; id: string }
  | { type: "fetch"; params: EventGraphParams }
  | { type: "export"; svg: string }
  | { type: "select"; id: string }
  | { type: "simulate"; id: string }
  | { type: "editLoc"; id: string; key: string; value: string; file?: string; line?: number }
  | { type: "addOption"; id: string; file: string; endLine: number; count: number }
  | { type: "uiState"; state: UiState };

export type HostToApp =
  | { type: "init"; ui?: UiState }
  | { type: "graph"; graph: EventGraph; params: EventGraphParams }
  | { type: "error"; message: string }
  | { type: "loading" }
  | { type: "detail"; detail: EventDetail | null; id: string };
