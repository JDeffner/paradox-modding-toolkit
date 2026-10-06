import type {
  MigrationAnswers,
  MigrationCheck,
  MigrationFinding,
  MigrationInspection,
  MigrationRoot,
  MigrationByteRequest,
  MigrationInput,
} from "@px-lsp/protocol/migration";
import { isValidUtf8, hasUtf8Bom } from "../parser/encoding";
import { parseLoc } from "../parser/locParser";
import { parseScript } from "../parser/parser";
import { MIGRATION_LIMITS } from "./sdk";
import type {
  MigrationChange,
  MigrationContext,
  MigrationManifest,
  MigrationProposal,
  MigrationEntry,
  MigrationSnapshot,
  MigrationTextEdit,
  PreparedMigration,
  PreparedMigrationFile,
} from "./sdk";

const roots = new Set(["mod", "source", "target"]);
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Migration: ${message}`);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function string(value: unknown): value is string {
  return typeof value === "string";
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(string);
}

function unique(values: string[], label: string): void {
  requireValue(new Set(values).size === values.length, `duplicate ${label}`);
}

function registerPath(names: Map<string, string>, path: string, root = ""): void {
  const parts = path.split("/");
  for (let length = 1; length <= parts.length; length++) {
    const prefix = parts.slice(0, length).join("/");
    const key = `${root}/${prefix.toLowerCase()}`;
    const previous = names.get(key);
    requireValue(previous === undefined || previous === prefix, `case-colliding path: ${path}`);
    names.set(key, prefix);
  }
}

/** Paths have one portable spelling. The empty prefix denotes a declared root. */
export function validateMigrationPath(path: string, allowRoot = false): string {
  requireValue(string(path), "path must be a string");
  if (allowRoot && path === "") return path;
  requireValue(
    path.length > 0 &&
      !/[\\:<>"|?*]/u.test(path) &&
      ![...path].some((character) => character.charCodeAt(0) < 32) &&
      path
        .split("/")
        .every(
          (part) =>
            part !== "" &&
            part !== "." &&
            part !== ".." &&
            !/[. ]$/u.test(part) &&
            !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part)
        ),
    `invalid relative path: ${path}`
  );
  return path;
}

/** Exact numeric game builds, not ranges or the contribution's own revision. */
export function validateMigrationVersion(version: unknown): asserts version is string {
  requireValue(
    string(version) &&
      /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){1,3}$/u.test(version) &&
      version.split(".").every((part) => Number.isSafeInteger(Number(part))),
    `invalid exact game version: ${String(version)}`
  );
}

/** Shared by executable entries and the pure route catalog boundary. */
export function validateMigrationMetadata(manifest: MigrationManifest): MigrationManifest {
  requireValue(record(manifest), "missing manifest");
  for (const key of ["id", "revision", "gameId", "title"] as const) {
    requireValue(string(manifest[key]) && manifest[key].trim().length > 0, `invalid manifest ${key}`);
  }
  requireValue([1, 2].includes(manifest.sdkVersion), "unsupported SDK version");
  validateMigrationVersion(manifest.fromVersion);
  validateMigrationVersion(manifest.toVersion);
  requireValue(manifest.fromVersion !== manifest.toVersion, "transition must use distinct game builds");
  requireValue(["advisory", "recipe"].includes(manifest.kind), "invalid entry kind");
  requireValue(["none", "script"].includes(manifest.detection), "invalid detection capability");
  requireValue(["required", "informational"].includes(manifest.requirement), "invalid entry requirement");
  requireValue(
    manifest.kind !== "recipe" || manifest.detection === "script",
    "recipe requires script detection"
  );
  requireValue(string(manifest.description) && strings(manifest.evidence), "invalid manifest documentation");
  requireValue(string(manifest.guidance) && strings(manifest.limitations), "invalid manifest guidance");
  requireValue(
    strings(manifest.dependsOn) && manifest.dependsOn.every((id) => id.trim().length > 0),
    "invalid entry dependencies"
  );
  unique(manifest.dependsOn, "entry dependencies");
  requireValue(Array.isArray(manifest.inputs), "invalid manifest inputs");
  for (const input of manifest.inputs) {
    requireValue(record(input) && roots.has(input.root), "invalid input root");
    validateMigrationPath(input.path, true);
    requireValue(
      input.capture === undefined || ["bytes", "listing", "prefix"].includes(input.capture),
      "invalid capture mode"
    );
    requireValue(
      (input.capture !== "listing" && input.capture !== "prefix" && input.matchModFiles === undefined) ||
        manifest.sdkVersion === 2,
      "selective capture requires SDK 2"
    );
    requireValue(
      input.capture === "prefix"
        ? Number.isSafeInteger(input.prefixBytes) &&
            input.prefixBytes! > 0 &&
            input.prefixBytes! <= MIGRATION_LIMITS.fileBytes
        : input.prefixBytes === undefined,
      "invalid prefix capture length"
    );
    requireValue(
      input.matchModFiles === undefined || (input.matchModFiles === true && input.root !== "mod"),
      "matchModFiles requires a reference root"
    );
    if (input.extensions !== undefined) {
      requireValue(
        strings(input.extensions) &&
          input.extensions.length > 0 &&
          input.extensions.every((extension) => /^\.[A-Za-z0-9_]+$/u.test(extension)),
        "invalid literal input extensions"
      );
      unique(
        input.extensions.map((extension) => extension.toLowerCase()),
        "input extensions"
      );
    }
  }
  return structuredClone(manifest);
}

export function validateMigrationManifest(entry: MigrationEntry): MigrationManifest {
  requireValue(record(entry), "entry must be an object");
  const manifest = validateMigrationMetadata(entry.manifest);
  requireValue(
    manifest.detection === "script" ? typeof entry.inspect === "function" : entry.inspect === undefined,
    manifest.detection === "script" ? "missing inspection function" : "data-only detection cannot inspect"
  );
  requireValue(
    manifest.kind === "recipe" ? typeof entry.prepare === "function" : entry.prepare === undefined,
    manifest.kind === "recipe" ? "missing preparation function" : "advisory cannot prepare edits"
  );
  requireValue(
    entry.discover === undefined ||
      (manifest.sdkVersion === 2 && manifest.detection === "script" && typeof entry.discover === "function"),
    "discovery requires SDK 2 executable inspection"
  );
  return manifest;
}

export function migrationInputMatches(input: MigrationInput, root: MigrationRoot, path: string): boolean {
  return (
    input.root === root &&
    (!input.path || path === input.path || path.startsWith(input.path + "/")) &&
    (!input.extensions ||
      input.extensions.some((extension) => path.toLowerCase().endsWith(extension.toLowerCase())))
  );
}

export function validateMigrationDiscovery(
  manifest: MigrationManifest,
  requests: MigrationByteRequest[]
): MigrationByteRequest[] {
  requireValue(
    Array.isArray(requests) && requests.length <= MIGRATION_LIMITS.files,
    "discovery file limit exceeded. Select a smaller migration batch."
  );
  const selected = new Map<string, MigrationByteRequest>();
  for (const request of requests) {
    requireValue(record(request) && roots.has(request.root), "invalid discovery request root");
    validateMigrationPath(request.path);
    requireValue(
      manifest.inputs.some(
        (input) =>
          (input.capture === "listing" || input.capture === "prefix") &&
          migrationInputMatches(input, request.root, request.path)
      ),
      `discovery request is outside declared listing inputs: ${request.root}/${request.path}`
    );
    const key = `${request.root}:${request.path.toLowerCase()}`;
    const previous = selected.get(key);
    requireValue(!previous || previous.path === request.path, "case-colliding discovery requests");
    selected.set(key, { root: request.root, path: request.path });
  }
  return [...selected.values()].sort((a, b) => compare(a.root, b.root) || compare(a.path, b.path));
}

/** Validate size limits without making a detached byte copy. */
export function assertMigrationSnapshotLimits(snapshot: MigrationSnapshot): void {
  requireValue(
    Array.isArray(snapshot.files) && snapshot.files.length <= MIGRATION_LIMITS.files,
    "input file limit exceeded. Select a smaller migration batch."
  );
  let bytes = 0;
  for (const file of snapshot.files) {
    requireValue(
      file.bytes instanceof Uint8Array && file.bytes.length <= MIGRATION_LIMITS.fileBytes,
      "input file size limit exceeded. Select a smaller migration batch."
    );
    bytes += file.bytes.length;
  }
  requireValue(
    bytes <= MIGRATION_LIMITS.inputBytes,
    "input byte limit exceeded. Select a smaller migration batch."
  );
  requireValue(
    (snapshot.listings?.length ?? 0) <= MIGRATION_LIMITS.listingEntries,
    "listing limit exceeded. Select a smaller migration batch."
  );
}

export async function discoverMigration(
  recipe: MigrationEntry,
  snapshot: MigrationSnapshot,
  answers: MigrationAnswers
): Promise<MigrationByteRequest[]> {
  const manifest = validateMigrationManifest(recipe);
  const captured = validateMigrationSnapshot(snapshot);
  requireValue(manifest.gameId === captured.gameId, "discovery game does not match snapshot");
  return validateMigrationDiscovery(
    manifest,
    recipe.discover ? await recipe.discover(context(captured, manifest), answerDraft(answers)) : []
  );
}

/** Validates every declared root and returns a detached snapshot. */
export function validateMigrationSnapshot(snapshot: MigrationSnapshot): MigrationSnapshot {
  requireValue(
    record(snapshot) && string(snapshot.gameId) && snapshot.gameId.length > 0,
    "invalid snapshot game"
  );
  requireValue(Array.isArray(snapshot.files) && record(snapshot.metadata), "invalid snapshot");
  requireValue(Object.values(snapshot.metadata).every(string), "invalid snapshot metadata");
  assertMigrationSnapshotLimits(snapshot);
  const seen = new Map<string, string>();
  const names = new Map<string, string>();
  const files = snapshot.files.map((file) => {
    requireValue(
      record(file) && roots.has(file.root) && file.bytes instanceof Uint8Array,
      "invalid snapshot file"
    );
    validateMigrationPath(file.path);
    registerPath(names, file.path, file.root);
    const key = `${file.root}/${file.path.toLowerCase()}`;
    requireValue(!seen.has(key), `duplicate or case-colliding snapshot path: ${file.path}`);
    seen.set(key, file.path);
    return { root: file.root, path: file.path, bytes: new Uint8Array(file.bytes) };
  });
  for (const file of files) {
    const parts = file.path.split("/");
    for (let length = 1; length < parts.length; length++) {
      requireValue(
        !seen.has(`${file.root}/${parts.slice(0, length).join("/").toLowerCase()}`),
        `file/directory collision: ${file.path}`
      );
    }
  }
  const listed = new Set<string>();
  requireValue(
    snapshot.listings === undefined || Array.isArray(snapshot.listings),
    "invalid snapshot listings"
  );
  const listings = snapshot.listings?.map((file) => {
    requireValue(
      record(file) && roots.has(file.root) && Number.isSafeInteger(file.size) && file.size >= 0,
      "invalid listing file"
    );
    validateMigrationPath(file.path);
    registerPath(names, file.path, file.root);
    const key = `${file.root}:${file.path.toLowerCase()}`;
    requireValue(!listed.has(key), "duplicate listing path");
    listed.add(key);
    return { root: file.root, path: file.path, size: file.size };
  });
  if (snapshot.capture) {
    requireValue(
      record(snapshot.capture) &&
        Array.isArray(snapshot.capture.selected) &&
        snapshot.capture.selected.length <= MIGRATION_LIMITS.files,
      "invalid capture descriptor"
    );
    for (const request of snapshot.capture.selected) {
      requireValue(record(request) && roots.has(request.root), "invalid capture root");
      validateMigrationPath(request.path);
    }
  }
  return {
    gameId: snapshot.gameId,
    files,
    metadata: { ...snapshot.metadata },
    ...(listings ? { listings } : {}),
    ...(snapshot.capture ? { capture: structuredClone(snapshot.capture) } : {}),
  };
}

function context(snapshot: MigrationSnapshot, manifest: MigrationManifest): MigrationContext {
  const allowed = (root: MigrationRoot, path: string) =>
    manifest.inputs.some((input) => migrationInputMatches(input, root, path));
  const read = (root: MigrationRoot, path: string) => {
    requireValue(roots.has(root), "invalid read root");
    validateMigrationPath(path);
    if (!allowed(root, path)) return undefined;
    return snapshot.files.find((file) => file.root === root && file.path === path)?.bytes;
  };
  return Object.freeze({
    gameId: snapshot.gameId,
    list(root: MigrationRoot, prefix = "") {
      requireValue(roots.has(root), "invalid list root");
      validateMigrationPath(prefix, true);
      return [
        ...new Map(
          [...snapshot.files, ...(snapshot.listings ?? [])].map((file) => [`${file.root}:${file.path}`, file])
        ).values(),
      ]
        .filter(
          (file) =>
            file.root === root &&
            allowed(root, file.path) &&
            (prefix === "" || file.path === prefix || file.path.startsWith(`${prefix}/`))
        )
        .map((file) => file.path)
        .sort();
    },
    fileInfo(root: MigrationRoot, path: string) {
      requireValue(roots.has(root), "invalid info root");
      validateMigrationPath(path);
      if (!allowed(root, path)) return undefined;
      const listing = snapshot.listings?.find((file) => file.root === root && file.path === path);
      const file = snapshot.files.find((file) => file.root === root && file.path === path);
      return listing ? { size: listing.size } : file ? { size: file.bytes.length } : undefined;
    },
    readText(root: MigrationRoot, path: string) {
      const bytes = read(root, path);
      return bytes && isValidUtf8(bytes) ? decoder.decode(bytes) : undefined;
    },
    readBytes(root: MigrationRoot, path: string) {
      return read(root, path)?.slice();
    },
  });
}

function validateFindings(findings: MigrationFinding[]): void {
  requireValue(Array.isArray(findings), "invalid findings");
  for (const finding of findings) {
    requireValue(
      record(finding) &&
        string(finding.id) &&
        finding.id.length > 0 &&
        string(finding.message) &&
        ["info", "warning", "error"].includes(finding.severity),
      "invalid finding"
    );
    if (finding.path !== undefined) validateMigrationPath(finding.path);
    if (finding.line !== undefined)
      requireValue(Number.isSafeInteger(finding.line) && finding.line > 0, "invalid finding line");
  }
}

function validateInspection(inspection: MigrationInspection): void {
  requireValue(
    record(inspection) && ["applicable", "not-applicable", "unknown"].includes(inspection.applicability),
    "invalid inspection applicability"
  );
  validateFindings(inspection.findings);
  requireValue(
    strings(inspection.coverage) && Array.isArray(inspection.questions),
    "invalid inspection questions or coverage"
  );
  for (const question of inspection.questions) {
    requireValue(
      record(question) &&
        string(question.id) &&
        question.id.length > 0 &&
        string(question.label) &&
        ["choice", "text", "boolean"].includes(question.kind) &&
        typeof question.required === "boolean",
      "invalid question"
    );
    requireValue(
      question.description === undefined || string(question.description),
      "invalid question description"
    );
    requireValue(question.group === undefined || string(question.group), "invalid question group");
    if (question.kind === "choice") {
      requireValue(
        Array.isArray(question.options) && question.options.length > 0,
        "choice question needs options"
      );
      for (const option of question.options) {
        requireValue(record(option) && string(option.value) && string(option.label), "invalid choice option");
      }
      unique(
        question.options.map((option) => option.value),
        "choice values"
      );
    } else {
      requireValue(question.options === undefined, "options require a choice question");
    }
  }
  unique(
    inspection.questions.map((question) => question.id),
    "question IDs"
  );
}

function answerDraft(answers: MigrationAnswers): MigrationAnswers {
  requireValue(
    record(answers) && Object.values(answers).every((value) => string(value) || typeof value === "boolean"),
    "invalid answer draft"
  );
  return Object.freeze({ ...answers });
}

async function inspect(
  recipe: MigrationEntry,
  captured: MigrationSnapshot,
  manifest: MigrationManifest,
  draft: MigrationAnswers
) {
  requireValue(
    manifest.gameId === captured.gameId,
    `recipe game ${manifest.gameId} does not match snapshot ${captured.gameId}`
  );
  if (captured.capture) validateMigrationDiscovery(manifest, captured.capture.selected);
  const validatedDraft = answerDraft(draft);
  const value: MigrationInspection = recipe.inspect
    ? await recipe.inspect(context(captured, manifest), validatedDraft)
    : {
        applicability: "unknown",
        findings: [],
        questions: [],
        coverage: [manifest.guidance, ...manifest.limitations].filter((text) => text.length > 0),
      };
  validateInspection(value);
  const inspection = structuredClone(value);
  const answers: MigrationAnswers = {};
  const invalidAnswers: string[] = [];
  const missingAnswers: string[] = [];
  const questions = new Map(inspection.questions.map((question) => [question.id, question]));
  for (const id of Object.keys(draft).sort()) {
    const question = questions.get(id);
    const value = draft[id];
    const valid =
      question &&
      (question.kind === "boolean"
        ? typeof value === "boolean"
        : string(value) &&
          (question.kind !== "choice" || question.options!.some((option) => option.value === value)));
    if (valid)
      Object.defineProperty(answers, id, { value, enumerable: true, writable: true, configurable: true });
    else invalidAnswers.push(id);
  }
  for (const question of inspection.questions) {
    const value = answers[question.id];
    if (question.required && (!Object.hasOwn(answers, question.id) || (string(value) && value.trim() === "")))
      missingAnswers.push(question.id);
  }
  return { inspection, answers, invalidAnswers, missingAnswers };
}

/** Inspection sees the draft; only answers to the returned questions survive. */
export async function inspectMigration(
  recipe: MigrationEntry,
  snapshot: MigrationSnapshot,
  answers: MigrationAnswers
) {
  const manifest = validateMigrationManifest(recipe);
  return inspect(recipe, validateMigrationSnapshot(snapshot), manifest, answers);
}

function validateChecks(checks: MigrationCheck[]): void {
  requireValue(Array.isArray(checks), "invalid checks");
  for (const check of checks) {
    requireValue(
      record(check) &&
        string(check.id) &&
        check.id.length > 0 &&
        string(check.label) &&
        ["before-apply", "after-apply"].includes(check.stage) &&
        ["required", "advisory"].includes(check.necessity) &&
        ["passed", "failed", "not-run"].includes(check.status) &&
        (check.detail === undefined || string(check.detail)),
      "invalid check"
    );
  }
  unique(
    checks.map((check) => check.id),
    "check IDs"
  );
}

function validateProposal(proposal: MigrationProposal): void {
  requireValue(record(proposal) && Array.isArray(proposal.groups), "invalid proposal");
  requireValue(
    proposal.continuation === undefined || typeof proposal.continuation === "boolean",
    "invalid continuation flag"
  );
  validateFindings(proposal.unresolved);
  validateChecks(proposal.checks);
  let outputBytes = 0;
  let outputFiles = 0;
  for (const group of proposal.groups) {
    requireValue(
      record(group) &&
        string(group.id) &&
        group.id.length > 0 &&
        string(group.title) &&
        strings(group.dependsOn) &&
        Array.isArray(group.changes),
      "invalid group"
    );
    unique(group.dependsOn, "group dependencies");
    for (const change of group.changes) {
      requireValue(
        ++outputFiles <= MIGRATION_LIMITS.files,
        "output file limit exceeded. Select a smaller migration batch."
      );
      requireValue(
        record(change) && ["text", "create", "replace", "delete"].includes(change.kind),
        "invalid change"
      );
      validateMigrationPath(change.path);
      if (change.kind === "text") {
        requireValue(Array.isArray(change.edits), "invalid text edits");
        for (const edit of change.edits) {
          requireValue(
            record(edit) &&
              Number.isSafeInteger(edit.start) &&
              Number.isSafeInteger(edit.end) &&
              edit.start >= 0 &&
              edit.end >= edit.start &&
              string(edit.text),
            "invalid text edit"
          );
        }
      } else if (change.kind !== "delete") {
        requireValue(change.bytes instanceof Uint8Array, "invalid change bytes");
        requireValue(
          change.bytes.length <= MIGRATION_LIMITS.fileBytes,
          "output file size limit exceeded. Select a smaller migration batch."
        );
        outputBytes += change.bytes.length;
      }
    }
  }
  requireValue(
    outputBytes <= MIGRATION_LIMITS.outputBytes,
    "output byte limit exceeded. Select a smaller migration batch."
  );
  unique(
    proposal.groups.map((group) => group.id),
    "group IDs"
  );
}

function selectGroups(proposal: MigrationProposal, selected?: string[]): string[] {
  requireValue(selected === undefined || strings(selected), "invalid selected groups");
  const groups = new Map(proposal.groups.map((group) => [group.id, group]));
  const finished = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string) => {
    const group = groups.get(id);
    requireValue(group, `missing group dependency or selection: ${id}`);
    requireValue(!visiting.has(id), `cyclic group dependency: ${id}`);
    if (finished.has(id)) return;
    visiting.add(id);
    for (const dependency of group.dependsOn) visit(dependency);
    visiting.delete(id);
    finished.add(id);
  };
  // Invalid dependency graphs are rejected even in groups omitted by the user.
  for (const id of groups.keys()) visit(id);
  finished.clear();
  for (const id of selected ?? groups.keys()) visit(id);
  return [...finished].sort();
}

function equalBytes(left: Uint8Array | undefined, right: Uint8Array | undefined): boolean {
  return left === undefined || right === undefined
    ? left === right
    : left.length === right.length && left.every((value, index) => value === right[index]);
}

function validUnicode(text: string): boolean {
  return decoder.decode(encoder.encode(text)) === text;
}

function applyText(bytes: Uint8Array, edits: MigrationTextEdit[], path: string): Uint8Array {
  requireValue(isValidUtf8(bytes), `text edit requires valid UTF-8: ${path}`);
  const text = decoder.decode(bytes);
  const ordered = [...edits].sort((left, right) => left.start - right.start || left.end - right.end);
  const boundary = (offset: number) =>
    !(
      offset > 0 &&
      offset < text.length &&
      /[\uD800-\uDBFF]/u.test(text[offset - 1]) &&
      /[\uDC00-\uDFFF]/u.test(text[offset])
    );
  let end = 0;
  let previous: MigrationTextEdit | undefined;
  let output = "";
  for (const edit of ordered) {
    requireValue(
      edit.end <= text.length && boundary(edit.start) && boundary(edit.end) && validUnicode(edit.text),
      `invalid UTF-16 edit range or text: ${path}`
    );
    requireValue(
      edit.start >= end && !(previous && previous.start === previous.end && edit.start === previous.start),
      `overlapping text edits: ${path}`
    );
    output += text.slice(end, edit.start) + edit.text;
    end = edit.end;
    previous = edit;
  }
  return encoder.encode(output + text.slice(end));
}

function ensureEncoding(path: string, bytes: Uint8Array): Uint8Array {
  const script = /\.txt$/iu.test(path);
  const localization = /_l_([^/]+)\.yml$/iu.exec(path);
  if (!script && !localization) return bytes;
  requireValue(isValidUtf8(bytes), `output requires valid UTF-8: ${path}`);
  const text = decoder.decode(bytes);
  if (script) {
    const result = parseScript(text);
    requireValue(result.errors.length === 0, `invalid script output: ${path}: ${result.errors[0]?.message}`);
  } else if (localization) {
    const result = parseLoc(text);
    requireValue(
      result.errors.length === 0 && result.language === localization[1],
      `invalid localization output or filename/header mismatch: ${path}`
    );
  }
  if (hasUtf8Bom(bytes)) return bytes;
  const result = new Uint8Array(bytes.length + 3);
  result.set([0xef, 0xbb, 0xbf]);
  result.set(bytes, 3);
  return result;
}

function buildFiles(
  snapshot: MigrationSnapshot,
  proposal: MigrationProposal,
  selected: string[]
): PreparedMigrationFile[] {
  const before = new Map(
    snapshot.files.filter((file) => file.root === "mod").map((file) => [file.path, file.bytes])
  );
  const names = new Map<string, string>();
  for (const path of before.keys()) registerPath(names, path);
  for (const file of snapshot.listings ?? []) if (file.root === "mod") registerPath(names, file.path);
  const changes = new Map<string, MigrationChange[]>();
  for (const group of proposal.groups.filter((group) => selected.includes(group.id))) {
    for (const change of group.changes) {
      registerPath(names, change.path);
      const list = changes.get(change.path) ?? [];
      const compatible =
        list.length === 0 || (change.kind === "text" && list.every((item) => item.kind === "text"));
      requireValue(compatible, `conflicting changes: ${change.path}`);
      changes.set(change.path, [...list, change]);
    }
  }
  const result: PreparedMigrationFile[] = [];
  const outputPaths = new Set([
    ...before.keys(),
    ...(snapshot.listings ?? []).filter((file) => file.root === "mod").map((file) => file.path),
  ]);
  for (const [path, list] of changes) {
    const original = before.get(path);
    const change = list[0];
    const info = snapshot.listings?.find((file) => file.root === "mod" && file.path === path);
    requireValue(
      change.kind === "create"
        ? !info
        : !info || original?.length === info.size || !!snapshot.metadata[`editor:${path}`],
      `change requires an exact full-file capture: ${path}`
    );
    requireValue(
      change.kind === "create" ? original === undefined : original !== undefined,
      `${change.kind === "create" ? "existing" : "missing"} change path: ${path}`
    );
    let after: Uint8Array | undefined;
    switch (change.kind) {
      case "text":
        after = applyText(
          original!,
          list.flatMap((item) => (item as Extract<MigrationChange, { kind: "text" }>).edits),
          path
        );
        break;
      case "create":
      case "replace":
        after = change.bytes.slice();
        break;
      case "delete":
        outputPaths.delete(path);
        break;
    }
    if (equalBytes(original, after)) continue;
    if (after !== undefined) {
      after = ensureEncoding(path, after);
      outputPaths.add(path);
    }
    if (!equalBytes(original, after))
      result.push({
        path,
        ...(original === undefined ? {} : { before: original.slice() }),
        ...(after === undefined ? {} : { after }),
      });
  }
  const lowerPaths = new Set([...outputPaths].map((path) => path.toLowerCase()));
  for (const path of outputPaths) {
    const parts = path.split("/");
    for (let length = 1; length < parts.length; length++) {
      requireValue(
        !lowerPaths.has(parts.slice(0, length).join("/").toLowerCase()),
        `file/directory collision: ${path}`
      );
    }
  }
  return result.sort((left, right) => compare(left.path, right.path));
}

export async function prepareMigration(
  recipe: MigrationEntry,
  snapshot: MigrationSnapshot,
  answers: MigrationAnswers,
  codeHash: string,
  selectedGroups?: string[]
): Promise<PreparedMigration> {
  const manifest = validateMigrationManifest(recipe);
  requireValue(manifest.kind === "recipe" && recipe.prepare, "advisory entries cannot prepare edits");
  const captured = validateMigrationSnapshot(snapshot);
  requireValue(string(codeHash) && codeHash.length > 0, "missing recipe code hash");
  const result = await inspect(recipe, captured, manifest, answers);
  requireValue(
    result.inspection.applicability === "applicable",
    `recipe applicability is ${result.inspection.applicability}${findingDetails(result.inspection.findings)}`
  );
  requireValue(
    result.invalidAnswers.length === 0 && result.missingAnswers.length === 0,
    `invalid or missing answers: ${[...result.invalidAnswers, ...result.missingAnswers].join(", ")}${findingDetails(result.inspection.findings)}`
  );
  requireValue(
    !result.inspection.findings.some((finding) => finding.severity === "error"),
    `inspection contains unresolved errors${findingDetails(result.inspection.findings.filter((finding) => finding.severity === "error"))}`
  );
  const value = await recipe.prepare(context(captured, manifest), answerDraft(result.answers));
  validateProposal(value);
  const proposal = structuredClone(value);
  requireValue(
    !proposal.unresolved.some((finding) => finding.severity === "error"),
    `proposal contains unresolved errors${findingDetails(proposal.unresolved.filter((finding) => finding.severity === "error"))}`
  );
  requireValue(
    !proposal.checks.some(
      (check) => check.stage === "before-apply" && check.necessity === "required" && check.status !== "passed"
    ),
    `required before-apply checks have not passed: ${proposal.checks
      .filter(
        (check) =>
          check.stage === "before-apply" && check.necessity === "required" && check.status !== "passed"
      )
      .map(
        (check) => `${check.id} (${check.status}): ${check.label}${check.detail ? `: ${check.detail}` : ""}`
      )
      .join("; ")}`
  );
  const selected = selectGroups(proposal, selectedGroups);
  const plan: Omit<PreparedMigration, "hash"> = {
    version: 1,
    ...(selected.length < proposal.groups.length
      ? { continuation: true }
      : proposal.continuation !== undefined
        ? { continuation: proposal.continuation }
        : {}),
    recipe: { id: manifest.id, revision: manifest.revision, codeHash },
    snapshotHash: await hashSnapshot(captured),
    ...(captured.capture ? { capture: captured.capture } : {}),
    answers: result.answers,
    selectedGroups: selected,
    files: buildFiles(captured, proposal, selected),
    inspection: result.inspection,
    checks: proposal.checks,
    unresolved: proposal.unresolved,
  };
  let outputBytes = 0;
  requireValue(
    plan.files.length <= MIGRATION_LIMITS.files,
    "output file limit exceeded. Select a smaller migration batch."
  );
  for (const file of plan.files) {
    requireValue(
      (file.after?.length ?? 0) <= MIGRATION_LIMITS.fileBytes,
      "output file size limit exceeded. Select a smaller migration batch."
    );
    outputBytes += file.after?.length ?? 0;
  }
  requireValue(
    outputBytes <= MIGRATION_LIMITS.outputBytes,
    "output byte limit exceeded. Select a smaller migration batch."
  );
  return { ...plan, hash: await hashPlan(plan) };
}

function findingDetails(findings: MigrationFinding[]): string {
  if (findings.length === 0) return "";
  return `: ${findings
    .map(
      (finding) =>
        `${finding.id}${finding.path ? ` (${finding.path}${finding.line ? `:${finding.line}` : ""})` : ""}: ${finding.message}`
    )
    .join("; ")}`;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function canonical(value: unknown): Promise<string> {
  if (value instanceof Uint8Array) {
    const hash = await globalThis.crypto.subtle.digest("SHA-256", value as Uint8Array<ArrayBuffer>);
    return `["bytes",${value.length},"${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}"]`;
  }
  if (Array.isArray(value)) return `["array",[${(await Promise.all(value.map(canonical))).join(",")}]]`;
  if (record(value))
    return `["object",[${(
      await Promise.all(
        Object.keys(value)
          .sort()
          .filter((key) => value[key] !== undefined)
          .map(async (key) => `[${JSON.stringify(key)},${await canonical(value[key])}]`)
      )
    ).join(",")}]]`;
  requireValue(
    value === null ||
      string(value) ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value)),
    "nonserializable hash input"
  );
  return JSON.stringify(value);
}

async function digest(value: unknown): Promise<string> {
  requireValue(globalThis.crypto?.subtle, "Web Crypto SHA-256 is unavailable");
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(await canonical(value)));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashSnapshot(snapshot: MigrationSnapshot): Promise<string> {
  const captured = validateMigrationSnapshot(snapshot);
  captured.files.sort((left, right) => compare(left.root, right.root) || compare(left.path, right.path));
  captured.listings?.sort((left, right) => compare(left.root, right.root) || compare(left.path, right.path));
  return digest(captured);
}

export async function hashPlan(plan: Omit<PreparedMigration, "hash">): Promise<string> {
  return digest(plan);
}

/** The host also verifies recipe code and captured inputs before any write. */
export async function verifyPreparedMigration(plan: PreparedMigration): Promise<boolean> {
  try {
    requireValue(record(plan) && plan.version === 1 && string(plan.hash), "invalid prepared plan");
    requireValue(
      record(plan.recipe) &&
        [plan.recipe.id, plan.recipe.revision, plan.recipe.codeHash, plan.snapshotHash].every(
          (value) => string(value) && value.length > 0
        ),
      "invalid prepared identity"
    );
    answerDraft(plan.answers);
    requireValue(
      strings(plan.selectedGroups) && Array.isArray(plan.files),
      "invalid prepared groups or files"
    );
    unique(plan.selectedGroups, "prepared groups");
    const names: string[] = [];
    for (const file of plan.files) {
      requireValue(record(file), "invalid prepared file");
      validateMigrationPath(file.path);
      requireValue(
        (file.before === undefined || file.before instanceof Uint8Array) &&
          (file.after === undefined || file.after instanceof Uint8Array) &&
          !equalBytes(file.before, file.after),
        "invalid prepared bytes"
      );
      names.push(file.path.toLowerCase());
    }
    unique(names, "prepared paths");
    validateInspection(plan.inspection);
    validateChecks(plan.checks);
    validateFindings(plan.unresolved);
    const { hash, ...content } = plan;
    return hash === (await hashPlan(content));
  } catch {
    return false;
  }
}
