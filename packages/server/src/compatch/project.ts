import type { PatchProject, PatchResolution } from "./model";

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a nonempty string`);
}
function strings(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim()))
    throw new Error(`${label} must be an array of nonempty strings`);
}

/** Portable paths must remain inside the output mod on all supported host platforms. */
export function validatePatchPath(path: string): string {
  if (
    !path ||
    /[\\:<>"|?*]/u.test(path) ||
    [...path].some((character) => character.charCodeAt(0) < 32) ||
    path
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          /[. ]$/u.test(part) ||
          /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part)
      )
  )
    throw new Error(`Unsafe patch path: ${path}`);
  return path;
}

/** Validate known fields without dropping extension fields from portable intent. */
export function parsePatchResolution(value: unknown): PatchResolution {
  const resolution = object(value, "Resolution");
  if (
    typeof resolution.mode !== "string" ||
    !["winner", "source", "fields", "manual", "defer"].includes(resolution.mode)
  )
    throw new Error("Unknown patch resolution mode");
  if (resolution.contributorId !== undefined) string(resolution.contributorId, "Contributor ID");
  if (resolution.note !== undefined && typeof resolution.note !== "string")
    throw new Error("Resolution note must be a string");
  if (resolution.text !== undefined && typeof resolution.text !== "string")
    throw new Error("Manual resolution text must be a string");
  if (resolution.fields !== undefined) {
    const fields = object(resolution.fields, "Field choices");
    for (const [key, source] of Object.entries(fields)) {
      string(key, "Field key");
      if (source !== null) string(source, "Field contributor");
    }
  }
  if (resolution.mode === "source") string(resolution.contributorId, "Source contributor ID");
  if (resolution.mode === "fields") object(resolution.fields, "Field choices");
  if (resolution.mode === "manual" && typeof resolution.text !== "string")
    throw new Error("Manual resolution requires text");
  return resolution as unknown as PatchResolution;
}

export function parsePatchProject(raw: unknown, expectedGameId?: string): PatchProject {
  const value = object(
    typeof raw === "string" ? JSON.parse(raw.replace(/^\uFEFF/u, "")) : raw,
    "Patch project"
  );
  if (value.version !== 1) throw new Error("Unsupported patch project version (expected 1)");
  for (const key of ["id", "gameId", "name"]) string(value[key], `Project ${key}`);
  if (expectedGameId && value.gameId !== expectedGameId) throw new Error("Patch project game does not match");
  if (!Array.isArray(value.inputs)) throw new Error("Patch inputs must be an array");
  const ids = new Set<string>();
  for (const item of value.inputs) {
    const input = object(item, "Patch input");
    string(input.id, "Input ID");
    string(input.name, "Input name");
    if (input.workshopId !== undefined) string(input.workshopId, "Workshop ID");
    if (ids.has(input.id)) throw new Error("Duplicate patch input ID");
    ids.add(input.id);
  }
  for (const [id, item] of Object.entries(object(value.decisions, "Patch decisions"))) {
    string(id, "Entry ID");
    const decision = object(item, "Patch decision");
    string(decision.fingerprint, "Decision fingerprint");
    parsePatchResolution(decision.resolution);
  }
  for (const [path, item] of Object.entries(object(value.generated, "Generated files"))) {
    validatePatchPath(path);
    const generated = object(item, "Generated file");
    if (typeof generated.text !== "string") throw new Error("Generated file text must be a string");
    if (generated.original !== undefined && typeof generated.original !== "string")
      throw new Error("Generated original text must be a string");
    strings(generated.entries, "Generated entry IDs");
  }
  // JSON owns the result, so callers cannot mutate the parsed project through input aliases.
  return JSON.parse(JSON.stringify(value)) as PatchProject;
}
