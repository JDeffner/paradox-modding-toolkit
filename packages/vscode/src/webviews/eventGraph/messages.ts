/**
 * The wire between the event graph host (panel.ts) and its app (app/).
 *
 * The app owns the whole editing session: history, node positions, and the file
 * edits waiting for Save. The host writes nothing until it receives `save`.
 * Every history step is mirrored to the host as `state`, for one reason: a
 * webview panel cannot cancel its own close, so the host must already hold the
 * unsaved work when the tab goes away.
 */
import type {
  EventBannerResult,
  EventDetail,
  EventGraph,
  EventGraphParams,
  EventValueOptionsResult,
  EventVocabularyResult,
} from "@px-lsp/protocol/protocol";
import type { GraphState, PendingEdit } from "./history";

/** Per-user layout the host remembers across sessions. */
export interface UiState {
  panelWidth: number;
  panelCollapsed: boolean;
  /** The tools rail on the left of the graph. */
  railCollapsed: boolean;
  /** Node captions: the raw id, or the localized title where there is one. */
  titleMode: "raw" | "loc";
  /** Draw the event's theme illustration behind its card. */
  banner: boolean;
  /** Where the simulation window was left, in page pixels. */
  simX?: number;
  simY?: number;
}

export type AppToHost =
  | { type: "open"; file: string; line?: number }
  | { type: "fetch"; params: EventGraphParams }
  | { type: "export"; svg: string }
  /** Inspector: full detail for the selected node. */
  | { type: "select"; id: string }
  /** Simulation window: detail for the event being walked through. */
  | { type: "simulate"; id: string }
  /** Apply the pending edits, in order, and report back. */
  | { type: "save"; edits: PendingEdit[] }
  /** Mirror of the app's session, so the host can guard an unsaved close. */
  | { type: "state"; state: GraphState; dirty: number }
  | { type: "banner"; theme: string }
  /** What set does this VALUE belong to (all secrets, all traits…)? */
  | { type: "valueOptions"; value: string }
  | { type: "uiState"; state: UiState };

export type HostToApp =
  | { type: "init"; ui?: UiState }
  | { type: "graph"; graph: EventGraph; params: EventGraphParams }
  | { type: "error"; message: string }
  | { type: "loading" }
  | { type: "detail"; detail: EventDetail | null; id: string }
  | { type: "sim"; detail: EventDetail | null; id: string }
  | { type: "vocabulary"; vocabulary: EventVocabularyResult }
  /** One theme's illustration, resolved to a webview url (null = draw the placeholder). */
  | { type: "banner"; result: EventBannerResult; url: string | null }
  /** Answer to a valueOptions ask; null = nothing enumerable, use an input. */
  | { type: "valueOptions"; value: string; result: EventValueOptionsResult | null }
  /** Save result. `applied` = batch indices of the edits that reached disk;
   *  with `error` set the batch stopped there and the rest were not written. */
  | { type: "saved"; applied: number[]; error?: string }
  /** The user cancelled an unsaved close: put the session back as it was. */
  | { type: "restore"; state: GraphState };
