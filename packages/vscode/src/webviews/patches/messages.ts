import type { PatchEntry, PatchResolution, PatchOutputConflict } from "@px-lsp/server/compatch/model";

export type PatchFilter = "attention" | "ready" | "all";
export interface PatchViewState {
  name?: string;
  output?: string;
  inputs: { id: string; name: string; path?: string; version?: string }[];
  rows: Pick<PatchEntry, "id" | "name" | "kind" | "state">[];
  selected?: PatchEntry;
  filter: PatchFilter;
  page: number;
  total: number;
  counts: { attention: number; ready: number; manual: number; identical: number };
  files: { path: string; action: "create" | "update" | "remove" }[];
  conflicts: PatchOutputConflict[];
  issues: string[];
  busy: boolean;
  canCancel?: boolean;
  status: string;
  error?: string;
  needsRefresh: boolean;
  canPrepare: boolean;
  canApply: boolean;
  canRestore: boolean;
  recoveryBlocked: boolean;
}
export type PatchViewMessage =
  | { type: "ready" | "open" | "add" | "scan" | "prepare" | "apply" | "restore" | "cancel" | "migrations" }
  | { type: "create"; name: string }
  | { type: "move"; id: string; direction: -1 | 1 }
  | { type: "remove"; id: string }
  | { type: "bind"; id: string }
  | { type: "select"; id: string }
  | { type: "filter"; value: PatchFilter }
  | { type: "page"; value: number }
  | { type: "resolve"; id: string; resolution: PatchResolution }
  | { type: "source"; id: string; contributorId: string }
  | { type: "diff"; path: string }
  | { type: "output-choice"; path: string; choice: "current" | "generated" };
