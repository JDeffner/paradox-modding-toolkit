import type {
  MigrationAnswers,
  MigrationByteRequest,
  MigrationCapture,
  MigrationCheck,
  MigrationFinding,
  MigrationInspection,
  MigrationManifest,
  MigrationRoot,
} from "@px-lsp/protocol/migration";

export type {
  MigrationAnswers,
  MigrationByteRequest,
  MigrationCapture,
  MigrationCheck,
  MigrationFinding,
  MigrationInspection,
  MigrationManifest,
  MigrationRoot,
};

/** Hosts enforce these before reading or cloning whole batches. */
export const MIGRATION_LIMITS = Object.freeze({
  inputBytes: 128 * 1024 * 1024,
  outputBytes: 128 * 1024 * 1024,
  fileBytes: 32 * 1024 * 1024,
  files: 10_000,
  listingEntries: 100_000,
});

export interface MigrationFileInfo extends MigrationByteRequest {
  size: number;
}

export interface MigrationFile {
  root: MigrationRoot;
  path: string;
  bytes: Uint8Array;
}

export interface MigrationSnapshot {
  gameId: string;
  files: MigrationFile[];
  listings?: MigrationFileInfo[];
  capture?: MigrationCapture;
  /** Included in the fingerprint. Hosts record skipped reads and root identities here. */
  metadata: Record<string, string>;
}

export interface MigrationContext {
  readonly gameId: string;
  list(root: MigrationRoot, prefix?: string): string[];
  fileInfo(root: MigrationRoot, path: string): { size: number } | undefined;
  readText(root: MigrationRoot, path: string): string | undefined;
  readBytes(root: MigrationRoot, path: string): Uint8Array | undefined;
}

export interface MigrationTextEdit {
  /** UTF-16 offsets into the exact captured text, including any BOM. */
  start: number;
  end: number;
  text: string;
}

export type MigrationChange =
  | { kind: "text"; path: string; edits: MigrationTextEdit[] }
  | { kind: "create"; path: string; bytes: Uint8Array }
  | { kind: "replace"; path: string; bytes: Uint8Array }
  | { kind: "delete"; path: string };

export interface MigrationGroup {
  id: string;
  title: string;
  dependsOn: string[];
  changes: MigrationChange[];
}

export interface MigrationProposal {
  /** This batch leaves work in the same entry. */
  continuation?: boolean;
  groups: MigrationGroup[];
  unresolved: MigrationFinding[];
  checks: MigrationCheck[];
}

/** A data-only note or explicitly trusted author code. This is not a sandbox. */
export interface MigrationEntry {
  manifest: MigrationManifest;
  /** Select exact byte reads from declared listing selectors (SDK 2). */
  discover?(
    context: MigrationContext,
    answers: Readonly<MigrationAnswers>
  ): MigrationByteRequest[] | Promise<MigrationByteRequest[]>;
  inspect?(
    context: MigrationContext,
    answers: Readonly<MigrationAnswers>
  ): MigrationInspection | Promise<MigrationInspection>;
  prepare?(
    context: MigrationContext,
    answers: Readonly<MigrationAnswers>
  ): MigrationProposal | Promise<MigrationProposal>;
}

export interface MigrationRecipe extends MigrationEntry {
  inspect: NonNullable<MigrationEntry["inspect"]>;
  prepare: NonNullable<MigrationEntry["prepare"]>;
}

export interface MigrationAdvisory extends MigrationEntry {
  prepare?: never;
}

export interface PreparedMigrationFile {
  path: string;
  before?: Uint8Array;
  after?: Uint8Array;
}

export interface PreparedMigration {
  continuation?: boolean;
  version: 1;
  recipe: { id: string; revision: string; codeHash: string };
  snapshotHash: string;
  capture?: MigrationCapture;
  answers: MigrationAnswers;
  selectedGroups: string[];
  files: PreparedMigrationFile[];
  inspection: MigrationInspection;
  checks: MigrationCheck[];
  unresolved: MigrationFinding[];
  /** A digest of all preceding plan fields. Apply verifies this as well as inputs. */
  hash: string;
}

export function defineMigration(recipe: MigrationRecipe): MigrationRecipe {
  return recipe;
}

export function defineAdvisory(note: MigrationAdvisory): MigrationAdvisory {
  return note;
}
