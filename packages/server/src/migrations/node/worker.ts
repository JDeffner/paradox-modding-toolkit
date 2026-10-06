import { parentPort, workerData } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolveProfile } from "../../games/registry";
import {
  discoverMigration,
  hashPlan,
  inspectMigration,
  prepareMigration,
  validateMigrationManifest,
} from "../engine";
import type { MigrationEntry } from "../sdk";
import type { MigrationWorkerRequest, MigrationWorkerResponse } from "./runner";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function run(request: MigrationWorkerRequest): Promise<MigrationWorkerResponse> {
  const profile = resolveProfile(request.gameId);
  if (profile.id !== request.gameId) throw new Error("Unknown migration game profile.");
  if (request.action === "catalog")
    return { kind: "catalog", manifests: profile.migrations.map(validateMigrationManifest) };

  let entries: MigrationEntry[];
  let codeHash: string;
  if (request.selection?.localPath) {
    const filename = request.selection.localPath;
    if (!/\.(?:c?js|json)$/i.test(filename))
      throw new Error("Select a data-only .json catalog or a built, self-contained .cjs or .js artifact.");
    const bytes = await readFile(filename);
    codeHash = hash(bytes);
    const dataOnly = /\.json$/i.test(filename);
    // Executable modules need explicit trust before even evaluating their exports.
    // JSON loads are data reads; every later action still pins the loaded bytes.
    if ((!dataOnly || request.action !== "load") && request.selection.codeHash !== codeHash)
      throw new Error(
        "Local artifact changed. Explicitly load and trust the new artifact before running it."
      );
    if (request.selection.codeHash !== undefined && request.selection.codeHash !== codeHash)
      throw new Error(
        "Local artifact changed. Explicitly load and trust the new artifact before running it."
      );
    const exported: unknown = dataOnly
      ? JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/u, ""))
      : createRequire(__filename)(filename);
    const value =
      !dataOnly && exported !== null && typeof exported === "object" && "default" in exported
        ? exported.default
        : exported;
    entries = (Array.isArray(value) ? value : [value]) as MigrationEntry[];
    if (!entries.length) throw new Error("The artifact exports no migration entries.");
    for (const entry of entries) {
      if (
        dataOnly &&
        (entry?.manifest?.kind !== "advisory" ||
          entry.manifest.detection !== "none" ||
          entry.discover !== undefined ||
          entry.inspect !== undefined ||
          entry.prepare !== undefined)
      )
        throw new Error("JSON entries must be data-only advisories with no executable capabilities.");
      validateMigrationManifest(entry);
    }
    if (hash(await readFile(filename)) !== codeHash) throw new Error("Local artifact changed while loading.");
  } else {
    const entry = profile.migrations.find((item) => item.manifest.id === request.selection?.id);
    if (!entry) throw new Error("Select a migration entry from this game profile.");
    entries = [entry];
    codeHash = hash(await readFile(__filename));
    if (request.selection?.codeHash && request.selection.codeHash !== codeHash)
      throw new Error("Toolkit recipe library changed. Load the recipe and prepare a new preview.");
  }
  const manifests = entries.map(validateMigrationManifest);
  if (manifests.some((manifest) => manifest.gameId !== request.gameId))
    throw new Error("The artifact uses a different game profile.");
  if (new Set(manifests.map((manifest) => manifest.id)).size !== manifests.length)
    throw new Error("The artifact contains duplicate migration entry IDs.");
  if (request.action === "load") return { kind: "loaded", manifests, codeHash };
  const recipe = request.selection?.id
    ? entries.find((entry) => entry.manifest.id === request.selection?.id)
    : entries.length === 1
      ? entries[0]
      : undefined;
  if (!recipe) throw new Error("Select one migration entry ID from the loaded artifact.");
  if (!request.snapshot) throw new Error("Capture migration inputs before running the recipe.");
  if (request.action === "discover")
    return {
      kind: "discovered",
      selected: await discoverMigration(recipe, request.snapshot, request.answers ?? {}),
    };
  if (request.action === "inspect")
    return {
      kind: "inspected",
      result: await inspectMigration(recipe, request.snapshot, request.answers ?? {}),
    };
  const plan = await prepareMigration(recipe, request.snapshot, request.answers ?? {}, codeHash);
  const support = profile.compatch;
  if (support) {
    const { parseLoc } = await import("../../parser");
    for (const file of plan.files) {
      if (!file.after) continue;
      const relative = file.path.toLowerCase();
      if (
        profile.eventNamespaces &&
        relative.startsWith(`${support.events.toLowerCase()}/`) &&
        relative.endsWith(".txt")
      ) {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(file.after);
        if (!/^namespace\s*=\s*[^\s#]+/.test(text))
          throw new Error(`Event output must start with its namespace declaration: ${file.path}`);
      }
      if (relative.startsWith(`${support.localization.toLowerCase()}/`) && relative.endsWith(".yml")) {
        const output = parseLoc(new TextDecoder("utf-8", { fatal: true }).decode(file.after));
        const language = /_l_([A-Za-z_]+)\.yml$/i.exec(file.path)?.[1];
        if (
          !language ||
          language !== output.language ||
          output.errors.length ||
          file.after[0] !== 239 ||
          file.after[1] !== 187 ||
          file.after[2] !== 191
        )
          throw new Error(
            `Localization output requires a matching _l_<language>.yml filename, language header and UTF-8 BOM: ${file.path}`
          );
      }
    }
    plan.checks.push({
      id: "toolkit.output-conventions",
      label: "Output conventions",
      stage: "before-apply",
      necessity: "required",
      status: "passed",
    });
    const { hash: _hash, ...unsigned } = plan;
    plan.hash = await hashPlan(unsigned);
  }
  return { kind: "prepared", plan };
}

void run(workerData as MigrationWorkerRequest).then(
  (result) => parentPort?.postMessage({ result }),
  (error: unknown) =>
    parentPort?.postMessage({
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    })
);
