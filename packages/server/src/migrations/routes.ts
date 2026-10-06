import type {
  MigrationManifest,
  MigrationRoute,
  MigrationRouteResult,
  MigrationTransition,
} from "@px-lsp/protocol/migration";
import { validateMigrationMetadata, validateMigrationVersion } from "./engine";

const routeLimit = 128;
const searchLimit = 10_000;
const compareText = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

/** Numeric ordering does not identify builds or create implied transitions. */
function compareVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return difference;
  }
  return compareText(left, right);
}

/**
 * A route includes every known entry for each explicit directed transition.
 * Completion of these entries does not establish target-game compatibility.
 */
export function planMigrationRoutes(
  catalog: readonly MigrationManifest[],
  gameId: string,
  fromVersion: string,
  toVersion: string
): MigrationRouteResult {
  const result: MigrationRouteResult = { versions: [], routes: [], issues: [] };
  const issue = (message: string) => {
    if (!result.issues.includes(message)) result.issues.push(message);
  };
  try {
    validateMigrationVersion(fromVersion);
    validateMigrationVersion(toVersion);
    if (typeof gameId !== "string" || !gameId.trim()) throw new Error("Missing migration game profile.");
    if (!Array.isArray(catalog)) throw new Error("Migration catalog must be an array.");
    for (const entry of catalog) validateMigrationMetadata(entry);
  } catch (error) {
    issue(error instanceof Error ? error.message : String(error));
    return result;
  }

  const allIds = new Set<string>();
  for (const entry of catalog) {
    if (allIds.has(entry.id)) issue(`Duplicate migration entry ID: ${entry.id}.`);
    allIds.add(entry.id);
  }
  const entries: MigrationManifest[] = catalog.filter((entry) => entry.gameId === gameId);
  result.versions = [...new Set(entries.flatMap((entry) => [entry.fromVersion, entry.toVersion]))].sort(
    compareVersions
  );
  if (!entries.length) issue(`No migration entries are available for ${gameId}.`);
  if (result.issues.length) return result;

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const checkDependencies = (id: string) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      issue(`Cyclic migration prerequisite: ${id}.`);
      return;
    }
    visiting.add(id);
    for (const dependency of [...byId.get(id)!.dependsOn].sort(compareText)) {
      if (!byId.has(dependency)) issue(`Entry ${id} has missing prerequisite ${dependency} for ${gameId}.`);
      else checkDependencies(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of [...byId.keys()].sort(compareText)) checkDependencies(id);
  if (result.issues.length) return result;
  if (fromVersion === toVersion) {
    issue(`Source and target are already the same build (${fromVersion}); no migration route is needed.`);
    return result;
  }

  const grouped = new Map<string, Map<string, MigrationManifest[]>>();
  for (const entry of entries) {
    const outgoing = grouped.get(entry.fromVersion) ?? new Map<string, MigrationManifest[]>();
    const group = outgoing.get(entry.toVersion) ?? [];
    group.push(entry);
    outgoing.set(entry.toVersion, group);
    grouped.set(entry.fromVersion, outgoing);
  }
  const transitions = new Map<string, MigrationTransition[]>();
  for (const [from, outgoing] of grouped) {
    const list: MigrationTransition[] = [];
    for (const [to, group] of outgoing) {
      const members = new Set(group.map((entry) => entry.id));
      const ordered: string[] = [];
      const finished = new Set<string>();
      const order = (id: string) => {
        if (finished.has(id)) return;
        for (const dependency of [...byId.get(id)!.dependsOn].sort(compareText)) {
          if (members.has(dependency)) order(dependency);
        }
        finished.add(id);
        ordered.push(id);
      };
      for (const id of [...members].sort(compareText)) order(id);
      list.push({ fromVersion: from, toVersion: to, entryIds: ordered });
    }
    list.sort((a, b) => compareVersions(a.toVersion, b.toVersion));
    transitions.set(from, list);
  }

  let searches = 0;
  let limited = false;
  let foundVersionPath = false;
  const seenVersions = new Set([fromVersion]);
  const path: MigrationTransition[] = [];
  const enumerate = (version: string) => {
    if (++searches > searchLimit) {
      limited = true;
      return;
    }
    if (version === toVersion) {
      foundVersionPath = true;
      const completed = new Set<string>();
      for (const transition of path) {
        for (const id of transition.entryIds) {
          const missing = byId.get(id)!.dependsOn.filter((dependency) => !completed.has(dependency));
          if (missing.length) {
            issue(
              `Route ${fromVersion} to ${toVersion}: entry ${id} has missing or forward prerequisites: ${missing.join(", ")}.`
            );
            return;
          }
          completed.add(id);
        }
      }
      if (result.routes.length === routeLimit) {
        limited = true;
        return;
      }
      const route: MigrationRoute = {
        id: [fromVersion, ...path.map((transition) => transition.toVersion)].join("->"),
        fromVersion,
        toVersion,
        transitions: path.map((transition) => ({ ...transition, entryIds: [...transition.entryIds] })),
        entryIds: [...completed],
      };
      result.routes.push(route);
      return;
    }
    for (const transition of transitions.get(version) ?? []) {
      if (limited) break;
      if (seenVersions.has(transition.toVersion)) continue;
      seenVersions.add(transition.toVersion);
      path.push(transition);
      enumerate(transition.toVersion);
      path.pop();
      seenVersions.delete(transition.toVersion);
    }
  };
  enumerate(fromVersion);
  if (limited)
    issue(
      `Route enumeration limit reached (${routeLimit} alternatives or ${searchLimit} search steps); the listed routes are incomplete.`
    );
  if (!foundVersionPath && !limited)
    issue(
      `No explicit migration path from ${fromVersion} to ${toVersion} for ${gameId}; the catalog has a version gap.`
    );
  else if (!result.routes.length && !limited)
    issue(`No valid migration route from ${fromVersion} to ${toVersion} satisfies all prerequisites.`);
  return result;
}
