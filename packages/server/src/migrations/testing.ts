import type { MigrationAnswers } from "@px-lsp/protocol/migration";
import {
  discoverMigration,
  inspectMigration,
  migrationInputMatches,
  prepareMigration,
  validateMigrationSnapshot,
} from "./engine";
export { MIGRATION_LIMITS } from "./sdk";
import type { MigrationRecipe, MigrationSnapshot, PreparedMigration } from "./sdk";

export interface MigrationFixture {
  recipe: MigrationRecipe;
  snapshot: MigrationSnapshot;
  answers?: MigrationAnswers;
  codeHash?: string;
  selectedGroups?: string[];
}

/** Text is encoded exactly as supplied. Add a BOM to script fixtures when required. */
export function createMigrationSnapshot(input: {
  gameId: string;
  mod: Record<string, string | Uint8Array>;
  source?: Record<string, string | Uint8Array>;
  target?: Record<string, string | Uint8Array>;
  metadata?: Record<string, string>;
}): MigrationSnapshot {
  const encoder = new TextEncoder();
  const files: MigrationSnapshot["files"] = [];
  for (const root of ["mod", "source", "target"] as const) {
    for (const [path, content] of Object.entries(input[root] ?? {})) {
      if (typeof content !== "string" && !(content instanceof Uint8Array))
        throw new Error(`Migration: invalid fixture bytes: ${root}/${path}`);
      files.push({ root, path, bytes: typeof content === "string" ? encoder.encode(content) : content });
    }
  }
  return validateMigrationSnapshot({ gameId: input.gameId, files, metadata: input.metadata ?? {} });
}

/** Runs the production engine and applies its bytes to a new in-memory snapshot. */
export async function runMigrationFixture(
  fixture: MigrationFixture
): Promise<{ plan: PreparedMigration; snapshot: MigrationSnapshot }> {
  let captured = fixture.snapshot;
  if (fixture.recipe.manifest.sdkVersion === 2) {
    const inputs = fixture.recipe.manifest.inputs;
    const seed = validateMigrationSnapshot({
      ...fixture.snapshot,
      listings: fixture.snapshot.files
        .filter((file) => inputs.some((input) => migrationInputMatches(input, file.root, file.path)))
        .map((file) => ({ root: file.root, path: file.path, size: file.bytes.length })),
      files: fixture.snapshot.files.flatMap((file) => {
        const matches = inputs.filter((input) => migrationInputMatches(input, file.root, file.path));
        const full = matches.some((input) => !input.capture || input.capture === "bytes");
        const prefix = Math.max(
          0,
          ...matches.filter((input) => input.capture === "prefix").map((input) => input.prefixBytes!)
        );
        return full ? [file] : prefix ? [{ ...file, bytes: file.bytes.slice(0, prefix) }] : [];
      }),
    });
    const selected = await discoverMigration(fixture.recipe, seed, fixture.answers ?? {});
    const selectedKeys = new Set(selected.map((file) => `${file.root}:${file.path}`));
    captured = {
      ...seed,
      capture: { selected },
      files: [
        ...seed.files.filter((file) => !selectedKeys.has(`${file.root}:${file.path}`)),
        ...fixture.snapshot.files.filter((file) => selectedKeys.has(`${file.root}:${file.path}`)),
      ],
    };
  }
  const plan = await prepareMigration(
    fixture.recipe,
    captured,
    fixture.answers ?? {},
    fixture.codeHash ?? "fixture",
    fixture.selectedGroups
  );
  const mod = new Map(
    fixture.snapshot.files
      .filter((file) => file.root === "mod")
      .map((file) => [file.path, new Uint8Array(file.bytes)])
  );
  for (const file of plan.files) {
    if (file.after === undefined) mod.delete(file.path);
    else mod.set(file.path, file.after.slice());
  }
  return {
    plan,
    snapshot: {
      gameId: fixture.snapshot.gameId,
      metadata: { ...fixture.snapshot.metadata },
      files: [
        ...fixture.snapshot.files
          .filter((file) => file.root !== "mod")
          .map((file) => ({ ...file, bytes: new Uint8Array(file.bytes) })),
        ...[...mod]
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([path, bytes]) => ({ root: "mod" as const, path, bytes })),
      ],
    },
  };
}

/** A second run must be inapplicable or produce no output files. Failures stay visible. */
export async function assertMigrationIdempotent(
  fixture: MigrationFixture
): Promise<{ plan: PreparedMigration; snapshot: MigrationSnapshot }> {
  const first = await runMigrationFixture(fixture);
  const result = await inspectMigration(fixture.recipe, first.snapshot, fixture.answers ?? {});
  if (result.inspection.applicability === "not-applicable") return first;
  const second = await runMigrationFixture({ ...fixture, snapshot: first.snapshot });
  if (second.plan.files.length > 0)
    throw new Error(
      `Migration fixture is not idempotent: the second run changes files: ${second.plan.files.map((file) => file.path).join(", ")}`
    );
  return first;
}
