/** Versioned, serializable migration workspace messages. No client or filesystem dependencies. */
export type MigrationRoot = "mod" | "source" | "target";
export type MigrationAnswers = Record<string, string | boolean>;

export interface MigrationInput {
  root: MigrationRoot;
  path: string;
  /** Literal file extensions, including the dot. Matching is case-insensitive. */
  extensions?: string[];
  /** Listing captures expose names and sizes without reading file contents (SDK 2). */
  capture?: "bytes" | "listing" | "prefix";
  prefixBytes?: number;
  /** Reference files at the same paths as declared mod inputs (SDK 2). */
  matchModFiles?: boolean;
}

export interface MigrationByteRequest {
  root: MigrationRoot;
  path: string;
}

/** Frozen exact reads selected by discovery. Recapture never executes author code. */
export interface MigrationCapture {
  selected: MigrationByteRequest[];
}

export interface MigrationFinding {
  id: string;
  severity: "info" | "warning" | "error";
  message: string;
  path?: string;
  line?: number;
}

export interface MigrationQuestion {
  group?: string;
  id: string;
  label: string;
  description?: string;
  kind: "choice" | "text" | "boolean";
  required: boolean;
  options?: { value: string; label: string }[];
}

export interface MigrationInspection {
  applicability: "applicable" | "not-applicable" | "unknown";
  findings: MigrationFinding[];
  questions: MigrationQuestion[];
  /** Uninspected or unsupported cases, never a compatibility percentage. */
  coverage: string[];
}

export interface MigrationManifest {
  id: string;
  revision: string;
  sdkVersion: 1 | 2;
  gameId: string;
  /** Exact game builds, independent of this contribution's revision. */
  fromVersion: string;
  toVersion: string;
  kind: "advisory" | "recipe";
  detection: "none" | "script";
  requirement: "required" | "informational";
  title: string;
  description: string;
  /** Plain text. Data-only notes never evaluate author code or HTML. */
  guidance: string;
  limitations: string[];
  /** Entry IDs, including prerequisites in an earlier transition. */
  dependsOn: string[];
  evidence: string[];
  /** Each prefix is a normalized root-relative file or directory. No glob language. */
  inputs: MigrationInput[];
}

export interface MigrationTransition {
  fromVersion: string;
  toVersion: string;
  entryIds: string[];
}

export interface MigrationRoute {
  id: string;
  fromVersion: string;
  toVersion: string;
  transitions: MigrationTransition[];
  entryIds: string[];
}

export interface MigrationRouteResult {
  versions: string[];
  routes: MigrationRoute[];
  issues: string[];
}

export interface MigrationCompletion {
  revision: string;
  capture?: MigrationCapture;
  state: "applied" | "not-applicable" | "manual" | "read";
  /** Manual resolution is an author report, not target-game verification. */
  note?: string;
}

export interface SavedMigrationEntry {
  manifest: MigrationManifest;
  localPath: string;
  codeHash: string;
}

export interface MigrationCheck {
  id: string;
  label: string;
  stage: "before-apply" | "after-apply";
  necessity: "required" | "advisory";
  status: "passed" | "failed" | "not-run";
  detail?: string;
}

export interface MigrationSession {
  version: 2;
  gameId: string;
  roots: Partial<Record<MigrationRoot, string>>;
  recipeId?: string;
  answers: Record<string, MigrationAnswers>;
  fromVersion: string;
  toVersion: string;
  routeId?: string;
  /** Concrete game build to explicitly selected read-only game-data folder. */
  references: Record<string, string>;
  localEntries: SavedMigrationEntry[];
  completions: Record<string, MigrationCompletion>;
  checkpoint?: string;
}
