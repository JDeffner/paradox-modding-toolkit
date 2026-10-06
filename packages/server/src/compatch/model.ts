/** Portable patch intent. Absolute source paths and recovery journals belong to the host. */
export interface PatchProject {
  version: 1;
  id: string;
  gameId: string;
  name: string;
  /** Launcher order, first loaded first. Stable IDs survive a local folder change. */
  inputs: PatchInput[];
  decisions: Record<string, PatchDecision>;
  /** Last generated text, before independent manual changes in the output. */
  generated: Record<string, PatchGeneratedFile>;
  [key: string]: unknown;
}
export interface PatchInput {
  id: string;
  name: string;
  workshopId?: string;
  [key: string]: unknown;
}
export interface PatchGeneratedFile {
  text: string;
  entries: string[];
  /** Pre-toolkit contents of an existing file explicitly adopted by the writer. */
  original?: string;
  [key: string]: unknown;
}
export interface PatchResolution {
  mode: "winner" | "source" | "fields" | "manual" | "defer";
  contributorId?: string;
  /** Each direct field group comes from one complete contribution. Null omits it. */
  fields?: Record<string, string | null>;
  text?: string;
  note?: string;
}
export interface PatchDecision {
  fingerprint: string;
  resolution: PatchResolution;
  [key: string]: unknown;
}
export interface PatchPolicy {
  revision: string;
  scriptFolders: { path: string; kind: "definition" | "event"; fields?: "direct" | "ordered" }[];
  localizationFolder: string;
  /** Unknown folders remain explicit review items, without an inferred winner. */
  fileRules: { path: string; precedence: "first" | "last" }[];
  evidence: string[];
  /** Verified event declarations and cross-file override rule, supplied by the game profile. */
  eventRules?: { namespaceKey: string; priorityKey: string; defaultPriority: number };
}
export interface PatchFile {
  path: string;
  text: string;
}
export interface PatchSource extends PatchInput {
  files: PatchFile[];
  replacePaths: string[];
  dependencies: string[];
  version?: string;
  issues: string[];
}
export interface PatchSnapshot {
  gameId: string;
  sources: PatchSource[];
}
export interface PatchContribution {
  id: string;
  sourceId: string;
  sourceName: string;
  path: string;
  text: string;
  /** File-scoped declarations required by this contribution. */
  context: string;
  active: boolean;
  reason?: string;
  fields: Record<string, string>;
}
export interface PatchEntry {
  id: string;
  name: string;
  kind: "definition" | "event" | "localization" | "file";
  contributors: PatchContribution[];
  winner?: string;
  explanation: string;
  fingerprint: string;
  state: "needs-decision" | "ready" | "changed" | "identical" | "unsupported";
  fieldKeys: string[];
  fieldsSupported: boolean;
  issues: string[];
  decision?: PatchDecision;
  /** Available resolution families; final generation still checks each selected contribution. */
  allowedModes?: PatchResolution["mode"][];
}
export interface PatchAnalysis {
  entries: PatchEntry[];
  issues: string[];
  sourceCount: number;
  fileCount: number;
  /** Frozen source content, reused for answers and previews without another filesystem scan. */
  snapshot: PatchSnapshot;
  policy: PatchPolicy;
}
export interface PatchDesiredFile extends PatchFile {
  entries: string[];
  /** Route new localization overrides through the shared placement policy in the host. */
  localization?: { language: string; keys: string[]; override: true; sourcePath: string };
}
export interface PatchDesiredOutput {
  files: PatchDesiredFile[];
  issues: string[];
}
export interface PatchFileChange {
  path: string;
  before?: string;
  after?: string;
}
export interface PatchOutputConflict {
  path: string;
  reason: string;
  current?: string;
  generated?: string;
}
export interface PatchOutputPlan {
  files: PatchFileChange[];
  conflicts: PatchOutputConflict[];
  project: PatchProject;
}
