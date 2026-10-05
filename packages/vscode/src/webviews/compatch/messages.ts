import type {
  MigrationAnswers,
  MigrationCheck,
  MigrationInspection,
  MigrationManifest,
  MigrationRoot,
  MigrationRoute,
  MigrationCompletion,
} from "@px-lsp/protocol/migration";

export interface MigrationViewState {
  roots: Partial<Record<MigrationRoot, string>>;
  catalog: MigrationManifest[];
  fromVersion: string;
  toVersion: string;
  versions: string[];
  routes: MigrationRoute[];
  route?: MigrationRoute;
  issues: string[];
  entries: Record<
    string,
    {
      trusted: boolean;
      blocked?: string;
      completion?: MigrationCompletion;
    }
  >;
  nextEntryId?: string;
  references: { version: string; path?: string; verified: boolean }[];
  selected?: MigrationManifest;
  local: boolean;
  localFormat?: "data" | "code";
  answers: MigrationAnswers;
  inspection?: MigrationInspection;
  missing: string[];
  busy: boolean;
  canCancel: boolean;
  status: string;
  error?: string;
  preview?: {
    blocked?: string;
    files: { path: string; before: number; after: number; text: boolean }[];
    checks: MigrationCheck[];
  };
  canRestore: boolean;
}

export type MigrationViewMessage =
  | {
      type:
        | "ready"
        | "scan"
        | "prepare"
        | "apply"
        | "restore"
        | "cancel"
        | "load"
        | "load-folder"
        | "template"
        | "next"
        | "reload";
    }
  | { type: "versions"; fromVersion: string; toVersion: string }
  | { type: "route"; id: string }
  | { type: "complete"; state: "manual" | "read"; note?: string }
  | { type: "root"; root: MigrationRoot }
  | { type: "recipe"; id: string }
  | { type: "answer"; id: string; value: string | boolean }
  | { type: "diff"; path: string };
