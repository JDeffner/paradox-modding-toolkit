/** Versioned JSON contract shared by the pxtk CLI and local MCP tools. */
import type { ExampleWikiIndex, ExampleWikiDetail, StatusPayload, OverrideInfo } from "./protocol";

export type PxtkOperation =
  | "status"
  | "search"
  | "inspect"
  | "impact"
  | "validate"
  | "init"
  | "create"
  | "loc"
  | "logs"
  | "format"
  | "image";
export interface PxtkRequest {
  operation: PxtkOperation;
  query?: string;
  name?: string;
  kind?: string;
  limit?: number;
  baseline?: string;
  action?: string;
  files?: string[];
  file?: string;
  output?: string;
  value?: string;
  language?: string;
  prefix?: string;
  stage?: string;
  write?: boolean;
  expect?: string;
  check?: boolean;
  since?: string;
  format?: "png" | "jpeg" | "webp" | "dds";
  dds?: "auto" | "bc1" | "bc3" | "bgra8";
  width?: number;
  height?: number;
  fit?: "contain" | "cover" | "fill" | "inside";
  background?: string;
  examples?: boolean;
  templates?: boolean;
}
export interface PxtkSources {
  game: string;
  gamePath: string | null;
  gameVersion: string;
  mod: string;
  parents: string[];
  logsPath: string | null;
  /** Script identifier documentation. Data-type provenance is in the status command's index data. */
  documentation: "generated" | "bundled" | "wiki" | "none" | "unknown";
  documentationMatchesGame: "unknown";
  serverVersion: string;
  savedFilesOnly: true;
}
export interface PxtkResult<Data = Record<string, unknown>> {
  schemaVersion: 1;
  operation: PxtkOperation;
  status: "ok" | "not_found" | "ambiguous" | "incomplete";
  sources: PxtkSources;
  warnings: string[];
  data: Data;
}
export interface PxtkWindow<T> {
  items: T[];
  total: number;
  truncated: boolean;
}
export interface PxtkStatusData {
  configFile: string | null;
  issues: string[];
  indexed?: false;
  index?: StatusPayload | null;
  capabilities?: {
    knowledge: boolean;
    vanillaExamples: boolean;
    structuralValidation: boolean;
    tigerSupported: boolean;
    tigerConfigured: boolean;
  };
  tiger?: { path: string | null; binaryName: string | null; config: string | null };
  nextSteps?: string[];
}
export interface PxtkSearchData {
  documentation: PxtkWindow<ExampleWikiIndex["entries"][number]>;
  definitions: PxtkWindow<PxtkSymbol>;
  documentationSources: ExampleWikiIndex["sources"];
}
/** Standard LSP workspace symbol shape, including 0-based positions. */
export interface PxtkSymbol {
  name: string;
  kind: number;
  containerName?: string;
  location: {
    uri: string;
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
  };
}
export interface PxtkSourceExcerpt {
  file: string;
  /** 1-based source location and first excerpt line. */
  line: number;
  contextStart: number;
  context: string[];
}
export type PxtkInspectData =
  | {
      documentation: PxtkWindow<ExampleWikiDetail>;
      examples?: PxtkWindow<ExampleWikiDetail["examples"][number]>;
      templates?: PxtkWindow<import("./protocol").SnippetCatalogueEntry>;
      definitions: PxtkWindow<{ name: string; kind: string; source: PxtkSourceExcerpt }>;
    }
  | {
      candidates: Array<{ name: string; kind: string; source: "documentation" | PxtkSymbol["location"] }>;
      nextStep: string;
    };
export interface PxtkDependency {
  name: string;
  kind: string;
  file: string;
  /** 1-based. */
  line: number;
}
/** Preparation writes are previews until write is explicitly true. */
export interface PxtkWriteData {
  mode: "preview" | "check" | "written";
  previewToken: string;
  changed: number;
  written: string[];
  files: Array<{
    file: string;
    action: "create" | "update";
    beforeSha256: string | null;
    afterSha256: string;
    bytes: number;
    content?: string;
    contentTruncated?: boolean;
  }>;
}
export type PxtkImpactData =
  | {
      definition: PxtkDependency | null;
      callers: PxtkWindow<PxtkDependency>;
      references: PxtkWindow<{ file: string; line: number; column: number }>;
      dependencies: PxtkWindow<PxtkDependency>;
      /** All site lines are converted from LSP positions to 1-based lines. */
      overrides: PxtkWindow<OverrideInfo>;
      coverage: {
        callers: string;
        references: string;
        overrides: string;
        precedence: string;
        lines: "1-based";
      };
    }
  | { name: string; kinds: string[]; nextStep: string };
export interface PxtkFinding {
  source: "structural" | "tiger";
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  file: string | null;
  /** 1-based; null for reports without a location. */
  line: number | null;
  column: number | null;
}
export interface PxtkValidationData {
  complete: boolean;
  scope: { structural: "selected_files" | "workspace"; tiger: "workspace"; selected: string[] };
  baselineApplied: boolean;
  structural: { status: "complete"; files: number };
  tiger: {
    status: "complete" | "unavailable" | "failed";
    version?: string;
    reason?: string;
    stderr?: string;
    config?: string | null;
  };
  context: Record<string, string>;
  findings: PxtkWindow<PxtkFinding>;
  newFindings: PxtkWindow<PxtkFinding>;
  existingFindings: number;
  resolvedFindings: PxtkWindow<PxtkFinding>;
  newErrors: number;
  gameplayTested: false;
  baselineWritten?: string;
}
export interface PxtkBaseline {
  schemaVersion: 1;
  type: "pxtk-baseline";
  context: Record<string, string>;
  findings: PxtkFinding[];
}
export interface PxtkError {
  schemaVersion: 1;
  status: "error";
  error: { code: string; message: string };
}
